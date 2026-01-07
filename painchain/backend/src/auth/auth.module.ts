import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

// Controllers
import { AuthController } from './auth.controller';

// Services
import { AuthService } from './auth.service';
import { PasswordService } from './services/password.service';
import { JwtTokenService } from './services/jwt.service';
import { SessionService } from './services/session.service';
import { OIDCConfigService } from './services/oidc-config.service';
import { OIDCService } from './services/oidc.service';
import { InvitationService } from './services/invitation.service';

// Strategies
import { LocalStrategy } from './strategies/local.strategy';
import { JwtStrategy } from './strategies/jwt.strategy';

// Guards are not registered here - they're used directly in controllers
// or registered globally in app.module.ts

@Module({
  imports: [
    // Passport configuration
    PassportModule.register({ defaultStrategy: 'jwt' }),

    // JWT configuration
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const expiresIn = configService.get('JWT_EXPIRES_IN', '7d');
        return {
          secret: configService.get<string>('JWT_SECRET'),
          signOptions: {
            expiresIn: expiresIn as any, // '7d' is valid for jsonwebtoken
            issuer: 'painchain',
            audience: 'painchain-api',
          },
        };
      },
    }),
  ],

  controllers: [
    AuthController,
  ],

  providers: [
    // Core auth service
    AuthService,

    // Service layer
    PasswordService,
    JwtTokenService,
    SessionService,
    OIDCConfigService,
    OIDCService,
    InvitationService,

    // Passport strategies
    LocalStrategy,
    JwtStrategy,
  ],

  exports: [
    // Export services that other modules might need
    AuthService,
    JwtTokenService,
    SessionService,
    OIDCConfigService,

    // Export PassportModule so other modules can use guards
    PassportModule,
  ],
})
export class AuthModule {}
