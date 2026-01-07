import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  Res,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { OIDCConfigService } from './services/oidc-config.service';
import { OIDCService } from './services/oidc.service';
import { InvitationService } from './services/invitation.service';
import { Public } from './decorators/public.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import { LocalAuthGuard } from './guards/local-auth.guard';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { AuthUser } from './interfaces/auth-user.interface';
import { ConfigService } from '@nestjs/config';

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly authService: AuthService,
    private readonly oidcConfigService: OIDCConfigService,
    private readonly oidcService: OIDCService,
    private readonly invitationService: InvitationService,
    private readonly configService: ConfigService,
  ) {}

  // ==================== PUBLIC ROUTES ====================

  /**
   * Get available authentication methods
   * Used by login page to display auth options
   *
   * GET /api/auth/methods
   */
  @Public()
  @Get('methods')
  async getAuthMethods() {
    return this.authService.getAvailableAuthMethods();
  }

  /**
   * Basic auth login
   * POST /api/auth/login
   * Body: { email: string, password: string }
   */
  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UseGuards(LocalAuthGuard)
  async login(@CurrentUser() user, @Req() req: Request) {
    // LocalGuard has already validated credentials via LocalStrategy
    // User object is attached to request by LocalStrategy
    return this.authService.login(user, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  /**
   * User registration (if enabled)
   * POST /api/auth/register
   * Body: { email, password, firstName?, lastName?, displayName?, tenantId? }
   */
  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(@Body() dto: RegisterDto) {
    // register() already creates session and returns JWT
    return this.authService.register(dto);
  }

  /**
   * Initiate OIDC login
   * Redirects to OIDC provider's authorization page
   *
   * GET /api/auth/oidc/:providerId
   */
  @Public()
  @Get('oidc/:providerId')
  async oidcLogin(@Param('providerId') providerId: string, @Res() res: Response) {
    const provider = await this.oidcConfigService.getProvider(providerId);

    if (!provider || !provider.isEnabled) {
      throw new NotFoundException('OIDC provider not found or disabled');
    }

    const authUrl = this.oidcService.generateAuthUrl(provider);

    this.logger.log(`Redirecting to OIDC provider: ${provider.name}`);

    res.redirect(authUrl);
  }

  /**
   * OIDC callback handler
   * Provider redirects here after user authentication
   *
   * GET /api/auth/callback?code=...&state=...
   */
  @Public()
  @Get('callback')
  async oidcCallback(@Query('code') code: string, @Query('state') state: string, @Res() res: Response) {
    try {
      // Decrypt and validate state
      const { providerId } = this.oidcService.decryptState(state);

      // Get provider configuration
      const provider = await this.oidcConfigService.getProvider(providerId);
      if (!provider) {
        throw new NotFoundException('OIDC provider not found');
      }

      this.logger.log(`Processing OIDC callback for provider: ${provider.name}`);

      // Exchange authorization code for tokens
      const tokens = await this.oidcService.exchangeCodeForTokens(code, provider);

      // Fetch user information from provider
      const userInfo = await this.oidcService.getUserInfo(tokens.access_token, provider);

      // Create or update user and generate JWT
      const authResponse = await this.authService.handleOIDCLogin(userInfo, provider);

      // Redirect to frontend with JWT token
      const frontendUrl = this.configService.get<string>('FRONTEND_URL', 'http://localhost:8000');
      const redirectUrl = `${frontendUrl}?token=${authResponse.access_token}`;

      this.logger.log(`OIDC login successful for ${userInfo.email}, redirecting to frontend`);

      res.redirect(redirectUrl);
    } catch (error) {
      this.logger.error('OIDC callback error:', error.message);

      // Redirect to frontend with error
      const frontendUrl = this.configService.get<string>('FRONTEND_URL', 'http://localhost:8000');
      res.redirect(`${frontendUrl}/login?error=${encodeURIComponent(error.message)}`);
    }
  }

  // ==================== PROTECTED ROUTES ====================

  /**
   * Get current user profile
   * GET /api/auth/me
   * Headers: Authorization: Bearer <token>
   */
  @Get('me')
  async getCurrentUser(@CurrentUser() user: AuthUser) {
    return this.authService.getUserProfile(user.userId);
  }

  /**
   * Logout (revoke current session)
   * POST /api/auth/logout
   * Headers: Authorization: Bearer <token>
   */
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@CurrentUser() user: AuthUser) {
    await this.authService['sessionService'].revokeSession(user.sessionId);
    return { message: 'Logged out successfully' };
  }

  /**
   * Logout from all sessions
   * POST /api/auth/logout-all
   * Headers: Authorization: Bearer <token>
   */
  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  async logoutAll(@CurrentUser() user: AuthUser) {
    await this.authService['sessionService'].revokeAllUserSessions(user.userId);
    return { message: 'All sessions revoked successfully' };
  }

  /**
   * List active sessions
   * GET /api/auth/sessions
   * Headers: Authorization: Bearer <token>
   */
  @Get('sessions')
  async getSessions(@CurrentUser() user: AuthUser) {
    return this.authService.getUserSessions(user.userId);
  }

  /**
   * Revoke specific session
   * DELETE /api/auth/sessions/:sessionId
   * Headers: Authorization: Bearer <token>
   */
  @Delete('sessions/:sessionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeSession(@Param('sessionId') sessionId: string, @CurrentUser() user: AuthUser) {
    await this.authService.revokeUserSession(user.userId, sessionId);
  }

  // ==================== INVITATION ROUTES ====================

  /**
   * Create a new invitation link (owners/admins only)
   * POST /api/auth/invitations
   * Headers: Authorization: Bearer <token>
   * Body: { role?: string, expiresInDays?: number, maxUses?: number }
   */
  @Post('invitations')
  @HttpCode(HttpStatus.CREATED)
  async createInvitation(
    @CurrentUser() user: AuthUser,
    @Body() dto: { role?: string; expiresInDays?: number; maxUses?: number },
  ) {
    const invitation = await this.invitationService.createInvitation(
      user.tenantId,
      user.userId,
      dto.role || 'member',
      dto.expiresInDays || 7,
      dto.maxUses || 1,
    );

    // Return invitation with full URL
    const frontendUrl = this.configService.get<string>('FRONTEND_URL', 'http://localhost:8000');
    const inviteUrl = `${frontendUrl}/register?invite=${invitation.token}`;

    return {
      ...invitation,
      inviteUrl,
    };
  }

  /**
   * Get invitation details (public, for registration page)
   * GET /api/auth/invitations/:token
   */
  @Public()
  @Get('invitations/:token')
  async getInvitation(@Param('token') token: string) {
    const invitation = await this.invitationService.getInvitation(token);

    // Return only safe fields
    return {
      token: invitation.token,
      tenant: invitation.tenant,
      role: invitation.role,
      expiresAt: invitation.expiresAt,
      isValid:
        !invitation.isRevoked &&
        invitation.expiresAt > new Date() &&
        invitation.useCount < invitation.maxUses,
    };
  }

  /**
   * List all invitations for current tenant (owners/admins only)
   * GET /api/auth/invitations
   * Headers: Authorization: Bearer <token>
   */
  @Get('invitations')
  async listInvitations(@CurrentUser() user: AuthUser) {
    return this.invitationService.listInvitations(user.tenantId);
  }

  /**
   * Revoke an invitation (owners/admins only)
   * DELETE /api/auth/invitations/:token
   * Headers: Authorization: Bearer <token>
   */
  @Delete('invitations/:token')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeInvitation(@Param('token') token: string, @CurrentUser() user: AuthUser) {
    await this.invitationService.revokeInvitation(token, user.userId);
  }
}
