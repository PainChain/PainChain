import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OIDCProvider } from '@prisma/client';
import * as crypto from 'crypto';

interface OIDCState {
  providerId: string;
  nonce: string;
  timestamp: number;
}

interface OIDCTokenResponse {
  access_token: string;
  id_token?: string;
  token_type: string;
  expires_in?: number;
}

interface OIDCUserInfo {
  sub: string;
  email: string;
  email_verified?: boolean;
  name?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
  [key: string]: any; // Allow additional OIDC claims
}

@Injectable()
export class OIDCService {
  private readonly logger = new Logger(OIDCService.name);
  private readonly stateSecret: string;

  constructor(private readonly configService: ConfigService) {
    this.stateSecret = this.configService.get<string>('JWT_SECRET') || 'fallback-secret';
  }

  /**
   * Generate OIDC authorization URL
   * @param provider - OIDC provider configuration
   * @returns Authorization URL with state parameter
   */
  generateAuthUrl(provider: OIDCProvider): string {
    const state = this.encryptState({
      providerId: provider.id,
      nonce: crypto.randomBytes(16).toString('hex'),
      timestamp: Date.now(),
    });

    const params = new URLSearchParams({
      client_id: provider.clientId,
      redirect_uri: this.getCallbackUrl(),
      response_type: 'code',
      scope: provider.scopes.join(' '),
      state,
    });

    return `${provider.authorizationUrl}?${params.toString()}`;
  }

  /**
   * Exchange authorization code for tokens
   * @param code - Authorization code from provider
   * @param provider - OIDC provider configuration
   * @returns Token response with access_token and optional id_token
   */
  async exchangeCodeForTokens(
    code: string,
    provider: OIDCProvider,
  ): Promise<OIDCTokenResponse> {
    const response = await fetch(provider.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: this.getCallbackUrl(),
        client_id: provider.clientId,
        client_secret: provider.clientSecret,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      this.logger.error(`Token exchange failed: ${response.status} ${errorText}`);
      throw new BadRequestException('Failed to exchange authorization code for tokens');
    }

    return response.json();
  }

  /**
   * Fetch user information from OIDC provider
   * @param accessToken - Access token from token exchange
   * @param provider - OIDC provider configuration
   * @returns User information from provider
   */
  async getUserInfo(
    accessToken: string,
    provider: OIDCProvider,
  ): Promise<OIDCUserInfo> {
    const response = await fetch(provider.userinfoUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      this.logger.error(`UserInfo fetch failed: ${response.status} ${errorText}`);
      throw new BadRequestException('Failed to fetch user information from provider');
    }

    return response.json();
  }

  /**
   * Extract tenant ID from OIDC claims using provider's tenantClaimPath
   * @param claims - OIDC claims object
   * @param claimPath - JSON path to tenant claim (e.g., "hd", "tenant_id", "tid")
   * @returns Tenant ID or null if not found
   */
  extractTenantFromClaims(claims: any, claimPath: string): string | null {
    // Simple JSON path extraction (supports dot notation)
    const parts = claimPath.split('.');
    let value = claims;

    for (const part of parts) {
      if (value && typeof value === 'object' && part in value) {
        value = value[part];
      } else {
        return null;
      }
    }

    return typeof value === 'string' ? value : null;
  }

  /**
   * Encrypt state parameter
   * @param state - State object to encrypt
   * @returns Encrypted state string
   */
  private encryptState(state: OIDCState): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(
      'aes-256-cbc',
      crypto.createHash('sha256').update(this.stateSecret).digest(),
      iv,
    );

    let encrypted = cipher.update(JSON.stringify(state), 'utf8', 'hex');
    encrypted += cipher.final('hex');

    return `${iv.toString('hex')}:${encrypted}`;
  }

  /**
   * Decrypt state parameter
   * @param encryptedState - Encrypted state string
   * @returns Decrypted state object
   */
  decryptState(encryptedState: string): OIDCState {
    try {
      const [ivHex, encrypted] = encryptedState.split(':');
      const iv = Buffer.from(ivHex, 'hex');

      const decipher = crypto.createDecipheriv(
        'aes-256-cbc',
        crypto.createHash('sha256').update(this.stateSecret).digest(),
        iv,
      );

      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      const state = JSON.parse(decrypted) as OIDCState;

      // Validate state timestamp (max 10 minutes old)
      if (Date.now() - state.timestamp > 10 * 60 * 1000) {
        throw new Error('State expired');
      }

      return state;
    } catch (error) {
      this.logger.error('Failed to decrypt state:', error.message);
      throw new BadRequestException('Invalid state parameter');
    }
  }

  /**
   * Get callback URL for OIDC redirects
   * @returns Full callback URL
   */
  private getCallbackUrl(): string {
    const appUrl = this.configService.get<string>('APP_URL', 'http://localhost:8000');
    return `${appUrl}/api/auth/callback`;
  }
}
