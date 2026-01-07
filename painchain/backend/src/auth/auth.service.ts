import { Injectable, UnauthorizedException, BadRequestException, ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { PasswordService } from './services/password.service';
import { JwtTokenService } from './services/jwt.service';
import { SessionService } from './services/session.service';
import { OIDCConfigService } from './services/oidc-config.service';
import { OIDCService } from './services/oidc.service';
import { InvitationService } from './services/invitation.service';
import { RegisterDto } from './dto/register.dto';
import { AuthResponseDto, AuthMethodsDto } from './dto/auth-response.dto';
import { User, OIDCProvider, Tenant } from '@prisma/client';

interface SessionMetadata {
  ipAddress?: string;
  userAgent?: string;
}

interface OIDCUserInfo {
  sub: string;
  email: string;
  email_verified?: boolean;
  name?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
  [key: string]: any;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordService: PasswordService,
    private readonly jwtTokenService: JwtTokenService,
    private readonly sessionService: SessionService,
    private readonly oidcConfigService: OIDCConfigService,
    private readonly oidcService: OIDCService,
    private readonly invitationService: InvitationService,
  ) {}

  /**
   * Validate user credentials (used by LocalStrategy)
   * @param email - User's email
   * @param password - User's password
   * @returns User object if valid, null if invalid
   */
  async validateUserCredentials(email: string, password: string): Promise<User | null> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { tenant: true },
    });

    if (!user || !user.passwordHash) {
      return null;
    }

    const isPasswordValid = await this.passwordService.verifyPassword(password, user.passwordHash);
    if (!isPasswordValid) {
      return null;
    }

    if (!user.isActive) {
      throw new UnauthorizedException('Account is inactive');
    }

    // Update last login timestamp
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    return user;
  }

  /**
   * Register a new user with basic auth
   * @param dto - Registration data
   * @returns Auth response with JWT
   */
  async register(dto: RegisterDto): Promise<AuthResponseDto> {
    // Check if registration is allowed (unless using invitation)
    if (!this.oidcConfigService.isRegistrationAllowed() && !dto.invitationToken) {
      throw new BadRequestException('Registration is disabled. You need an invitation to join.');
    }

    // Check if user already exists
    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (existingUser) {
      throw new ConflictException('User with this email already exists');
    }

    // Validate password length
    const minLength = this.oidcConfigService.getMinPasswordLength();
    if (dto.password.length < minLength) {
      throw new BadRequestException(`Password must be at least ${minLength} characters long`);
    }

    const passwordHash = await this.passwordService.hashPassword(dto.password);

    let tenant: Tenant;
    let role = 'member';
    let invitedBy: string | null = null;

    // CASE 1: User has invitation token → Join existing tenant
    if (dto.invitationToken) {
      const invitation = await this.invitationService.validateInvitation(dto.invitationToken);

      tenant = await this.prisma.tenant.findUnique({
        where: { id: invitation.tenantId },
      });

      if (!tenant) {
        throw new NotFoundException('Tenant not found');
      }

      role = invitation.role;
      invitedBy = invitation.createdBy;
    }
    // CASE 2: User provides organization name → Create new tenant
    else if (dto.organizationName) {
      const slug = this.generateSlug(dto.organizationName);

      // Check if slug already exists
      const existingTenant = await this.prisma.tenant.findUnique({
        where: { slug },
      });

      if (existingTenant) {
        throw new ConflictException('An organization with this name already exists');
      }

      // Extract domain from email for OIDC auto-join
      const domain = dto.email.includes('@') ? dto.email.split('@')[1] : null;

      tenant = await this.prisma.tenant.create({
        data: {
          name: dto.organizationName,
          slug,
          domains: domain ? [domain] : [],
        },
      });

      role = 'owner'; // First user is owner
    }
    // CASE 3: No invitation and no org name
    else {
      throw new BadRequestException('Must provide either organizationName or invitationToken');
    }

    // Create user
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash,
        firstName: dto.firstName,
        lastName: dto.lastName,
        displayName: dto.displayName || dto.firstName || dto.email.split('@')[0],
        tenantId: tenant.id,
        role,
        emailVerified: false,
        invitedBy,
        invitedAt: invitedBy ? new Date() : null,
      },
      include: { tenant: true },
    });

    // Mark invitation as used
    if (dto.invitationToken) {
      await this.invitationService.useInvitation(dto.invitationToken, user.id);
    }

    this.logger.log(`User registered: ${user.email} (tenant: ${tenant.slug}, role: ${role})`);

    // Generate JWT and create session
    return this.login(user);
  }

  /**
   * Generate URL-safe slug from organization name
   */
  private generateSlug(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      + '-' + Date.now();
  }

  /**
   * Login user and generate JWT
   * @param user - User object
   * @param metadata - Optional session metadata (IP, user agent)
   * @returns Auth response with JWT
   */
  async login(user: User, metadata?: SessionMetadata): Promise<AuthResponseDto> {
    // Generate session ID
    const sessionId = crypto.randomUUID();

    // Calculate session expiration (7 days)
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    // Create session in database
    await this.sessionService.createSession(user.id, sessionId, expiresAt, metadata);

    // Generate JWT
    const accessToken = await this.jwtTokenService.generateToken({
      userId: user.id,
      email: user.email,
      tenantId: user.tenantId,
      role: user.role,
      sessionId,
    });

    return {
      access_token: accessToken,
      user: {
        id: user.id,
        email: user.email,
        tenantId: user.tenantId,
        role: user.role,
        displayName: user.displayName,
        firstName: user.firstName,
        lastName: user.lastName,
        avatarUrl: user.avatarUrl,
      },
    };
  }

  /**
   * Handle OIDC login (find or create user with domain-based auto-join)
   * @param userInfo - User information from OIDC provider
   * @param provider - OIDC provider configuration
   * @returns Auth response with JWT
   */
  async handleOIDCLogin(userInfo: OIDCUserInfo, provider: OIDCProvider): Promise<AuthResponseDto> {
    const email = userInfo.email;

    if (!email) {
      throw new BadRequestException('Email is required from OIDC provider');
    }

    const domain = email.split('@')[1];

    // Check if user already exists
    let user = await this.prisma.user.findUnique({
      where: { email },
      include: { tenant: true },
    });

    // User exists → update last login
    if (user) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      });

      return this.login(user);
    }

    // User doesn't exist → Find or create tenant based on domain
    let tenant = await this.prisma.tenant.findFirst({
      where: {
        domains: {
          has: domain,
        },
      },
    });

    // No tenant found for this domain → Create new tenant
    if (!tenant) {
      this.logger.log(`Creating new tenant for domain: ${domain}`);

      tenant = await this.prisma.tenant.create({
        data: {
          name: domain.split('.')[0], // "acme" from "acme.com"
          slug: domain.replace(/\./g, '-') + '-' + Date.now(),
          domains: [domain],
        },
      });
    } else {
      this.logger.log(`Auto-joining existing tenant: ${tenant.name} (domain: ${domain})`);
    }

    // Create user and auto-join tenant
    user = await this.prisma.user.create({
      data: {
        email,
        emailVerified: userInfo.email_verified || false,
        firstName: userInfo.given_name,
        lastName: userInfo.family_name,
        displayName: userInfo.name || userInfo.email.split('@')[0],
        avatarUrl: userInfo.picture,
        tenantId: tenant.id,
        role: 'member', // Auto-joined users are members
        oidcAccounts: {
          create: {
            providerId: provider.id,
            providerUserId: userInfo.sub,
            claims: userInfo,
          },
        },
      },
      include: { tenant: true },
    });

    this.logger.log(`OIDC user created and joined tenant: ${user.email} → ${tenant.name}`);

    return this.login(user);
  }

  /**
   * Get available authentication methods for login page
   * @returns Available auth methods
   */
  async getAvailableAuthMethods(): Promise<AuthMethodsDto> {
    const oidcProviders = await this.oidcConfigService.getEnabledProviders();

    return {
      basicAuth: this.oidcConfigService.isBasicAuthEnabled(),
      allowRegistration: this.oidcConfigService.isRegistrationAllowed(),
      oidcProviders: oidcProviders.map(p => ({
        id: p.id,
        name: p.name,
        iconUrl: p.iconUrl,
        displayOrder: p.displayOrder,
      })),
    };
  }

  /**
   * Get user profile by ID
   * @param userId - User ID
   * @returns User profile
   */
  async getUserProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        tenant: true,
        oidcAccounts: {
          select: {
            providerId: true,
            lastUsedAt: true,
          },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return {
      id: user.id,
      email: user.email,
      emailVerified: user.emailVerified,
      firstName: user.firstName,
      lastName: user.lastName,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      role: user.role,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
      tenant: {
        id: user.tenant.id,
        slug: user.tenant.slug,
        name: user.tenant.name,
      },
      oidcAccounts: user.oidcAccounts,
    };
  }

  /**
   * Get user's active sessions
   * @param userId - User ID
   * @returns Array of active sessions
   */
  async getUserSessions(userId: string) {
    return this.sessionService.getUserSessions(userId);
  }

  /**
   * Revoke a specific session for a user
   * @param userId - User ID
   * @param sessionId - Session ID to revoke
   */
  async revokeUserSession(userId: string, sessionId: string): Promise<void> {
    // Verify session belongs to user
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
    });

    if (!session || session.userId !== userId) {
      throw new BadRequestException('Session not found');
    }

    await this.sessionService.revokeSession(session.token);
  }
}
