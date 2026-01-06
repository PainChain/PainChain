import { Injectable, UnauthorizedException, BadRequestException, ConflictException, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { PasswordService } from './services/password.service';
import { JwtTokenService } from './services/jwt.service';
import { SessionService } from './services/session.service';
import { OIDCConfigService } from './services/oidc-config.service';
import { OIDCService } from './services/oidc.service';
import { RegisterDto } from './dto/register.dto';
import { AuthResponseDto, AuthMethodsDto } from './dto/auth-response.dto';
import { User, OIDCProvider } from '@prisma/client';

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
    // Check if registration is allowed
    if (!this.oidcConfigService.isRegistrationAllowed()) {
      throw new BadRequestException('Registration is disabled');
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

    // Hash password
    const passwordHash = await this.passwordService.hashPassword(dto.password);

    // Find or create tenant
    let tenant;
    if (dto.tenantId) {
      tenant = await this.prisma.tenant.findUnique({
        where: { id: dto.tenantId },
      });
      if (!tenant) {
        throw new BadRequestException('Tenant not found');
      }
    } else {
      // Create new tenant for this user
      tenant = await this.prisma.tenant.create({
        data: {
          slug: dto.email.split('@')[0] + '-' + Date.now(),
          name: dto.displayName || dto.email.split('@')[0] + "'s Tenant",
        },
      });
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
        role: dto.tenantId ? 'member' : 'owner', // First user in new tenant is owner
        emailVerified: false, // TODO: Implement email verification
      },
      include: { tenant: true },
    });

    this.logger.log(`User registered: ${user.email} (tenant: ${tenant.slug})`);

    // Generate JWT and create session
    return this.login(user);
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
   * Handle OIDC login (find or create user)
   * @param userInfo - User information from OIDC provider
   * @param provider - OIDC provider configuration
   * @returns Auth response with JWT
   */
  async handleOIDCLogin(userInfo: OIDCUserInfo, provider: OIDCProvider): Promise<AuthResponseDto> {
    // Extract tenant from claims
    const tenantSlug = this.oidcService.extractTenantFromClaims(userInfo, provider.tenantClaimPath);

    if (!tenantSlug) {
      throw new BadRequestException(
        `Unable to extract tenant from OIDC claims. Expected claim: ${provider.tenantClaimPath}`
      );
    }

    // Find or create tenant
    let tenant = await this.prisma.tenant.findUnique({
      where: { slug: tenantSlug },
    });

    if (!tenant) {
      tenant = await this.prisma.tenant.create({
        data: {
          slug: tenantSlug,
          name: tenantSlug,
        },
      });
      this.logger.log(`Created new tenant: ${tenantSlug}`);
    }

    // Find existing OIDC account
    let oidcAccount = await this.prisma.oIDCAccount.findUnique({
      where: {
        providerId_providerUserId: {
          providerId: provider.id,
          providerUserId: userInfo.sub,
        },
      },
      include: { user: true },
    });

    let user: User;

    if (oidcAccount) {
      // User exists, update OIDC account
      user = oidcAccount.user;

      await this.prisma.oIDCAccount.update({
        where: { id: oidcAccount.id },
        data: {
          claims: userInfo,
          lastUsedAt: new Date(),
        },
      });

      // Update user last login
      await this.prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      });
    } else {
      // Check if user exists by email
      user = await this.prisma.user.findUnique({
        where: { email: userInfo.email },
      });

      if (user) {
        // User exists with this email, link OIDC account
        // But verify tenant matches
        if (user.tenantId !== tenant.id) {
          throw new BadRequestException(
            'User already exists in a different tenant. Cannot link OIDC account.'
          );
        }

        await this.prisma.oIDCAccount.create({
          data: {
            userId: user.id,
            providerId: provider.id,
            providerUserId: userInfo.sub,
            claims: userInfo,
          },
        });
      } else {
        // Create new user
        user = await this.prisma.user.create({
          data: {
            email: userInfo.email,
            emailVerified: userInfo.email_verified || false,
            firstName: userInfo.given_name,
            lastName: userInfo.family_name,
            displayName: userInfo.name || userInfo.email.split('@')[0],
            avatarUrl: userInfo.picture,
            tenantId: tenant.id,
            role: 'member', // Default role for OIDC users
            oidcAccounts: {
              create: {
                providerId: provider.id,
                providerUserId: userInfo.sub,
                claims: userInfo,
              },
            },
          },
        });

        this.logger.log(`Created new user via OIDC: ${user.email} (provider: ${provider.name})`);
      }
    }

    // Generate JWT and create session
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
