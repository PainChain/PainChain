import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { OIDCProvider } from '@prisma/client';

interface OIDCProviderConfig {
  id: string;
  name: string;
  iconUrl?: string;
  issuer: string;
  clientId: string;
  clientSecret: string;
  authorizationUrl: string;
  tokenUrl: string;
  userinfoUrl: string;
  scopes: string[];
  tenantClaimPath: string;
  displayOrder: number;
}

@Injectable()
export class OIDCConfigService implements OnModuleInit {
  private readonly logger = new Logger(OIDCConfigService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Load OIDC providers from environment and sync to database on module init
   */
  async onModuleInit() {
    await this.syncProvidersFromEnv();
  }

  /**
   * Parse OIDC_PROVIDERS JSON from environment and sync to database
   */
  private async syncProvidersFromEnv(): Promise<void> {
    const providersJson = this.configService.get<string>('OIDC_PROVIDERS');

    if (!providersJson) {
      this.logger.log('ℹ️  No OIDC providers configured (OIDC_PROVIDERS not set)');
      return;
    }

    try {
      const providers: OIDCProviderConfig[] = JSON.parse(providersJson);

      if (!Array.isArray(providers) || providers.length === 0) {
        this.logger.warn('⚠️  OIDC_PROVIDERS is not an array or is empty');
        return;
      }

      for (const provider of providers) {
        await this.prisma.oIDCProvider.upsert({
          where: { id: provider.id },
          create: {
            id: provider.id,
            name: provider.name,
            iconUrl: provider.iconUrl,
            issuer: provider.issuer,
            clientId: provider.clientId,
            clientSecret: provider.clientSecret,
            authorizationUrl: provider.authorizationUrl,
            tokenUrl: provider.tokenUrl,
            userinfoUrl: provider.userinfoUrl,
            scopes: provider.scopes,
            tenantClaimPath: provider.tenantClaimPath,
            displayOrder: provider.displayOrder,
          },
          update: {
            name: provider.name,
            iconUrl: provider.iconUrl,
            issuer: provider.issuer,
            clientId: provider.clientId,
            clientSecret: provider.clientSecret,
            authorizationUrl: provider.authorizationUrl,
            tokenUrl: provider.tokenUrl,
            userinfoUrl: provider.userinfoUrl,
            scopes: provider.scopes,
            tenantClaimPath: provider.tenantClaimPath,
            displayOrder: provider.displayOrder,
          },
        });
      }

      this.logger.log(`✓ Synced ${providers.length} OIDC provider(s)`);
    } catch (error) {
      this.logger.error('❌ Failed to sync OIDC providers:', error.message);
      if (error instanceof SyntaxError) {
        this.logger.error('   Invalid JSON in OIDC_PROVIDERS environment variable');
      }
    }
  }

  /**
   * Get all enabled OIDC providers
   * @returns Promise<OIDCProvider[]> - Array of enabled providers
   */
  async getEnabledProviders(): Promise<OIDCProvider[]> {
    return this.prisma.oIDCProvider.findMany({
      where: { isEnabled: true },
      orderBy: { displayOrder: 'asc' },
    });
  }

  /**
   * Get a specific OIDC provider by ID
   * @param id - The provider ID
   * @returns Promise<OIDCProvider | null> - The provider or null if not found
   */
  async getProvider(id: string): Promise<OIDCProvider | null> {
    return this.prisma.oIDCProvider.findUnique({
      where: { id },
    });
  }

  /**
   * Check if basic auth is enabled
   * @returns boolean
   */
  isBasicAuthEnabled(): boolean {
    return this.configService.get<string>('BASIC_AUTH_ENABLED', 'true') === 'true';
  }

  /**
   * Check if user registration is allowed
   * @returns boolean
   */
  isRegistrationAllowed(): boolean {
    return this.configService.get<string>('ALLOW_REGISTRATION', 'true') === 'true';
  }

  /**
   * Get minimum password length requirement
   * @returns number
   */
  getMinPasswordLength(): number {
    return parseInt(this.configService.get<string>('MIN_PASSWORD_LENGTH', '12'), 10);
  }
}
