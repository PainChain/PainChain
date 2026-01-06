import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { SessionService } from '../services/session.service';
import { AuthUser } from '../interfaces/auth-user.interface';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly sessionService: SessionService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET'),
      issuer: 'painchain',
      audience: 'painchain-api',
    });
  }

  /**
   * Validate JWT payload and load user
   * Called automatically by Passport after JWT signature verification
   * @param payload - Decoded JWT payload
   * @returns AuthUser object
   * @throws UnauthorizedException if session invalid or user not found
   */
  async validate(payload: any): Promise<AuthUser> {
    // Check if session is still valid (not revoked)
    const isValid = await this.sessionService.isSessionValid(payload.jti);
    if (!isValid) {
      throw new UnauthorizedException('Session expired or revoked');
    }

    // Load user from database
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: { tenant: true },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('User not found or inactive');
    }

    // Return user object that will be attached to request.user
    return {
      userId: user.id,
      email: user.email,
      tenantId: user.tenantId,
      role: user.role,
      sessionId: payload.jti,
      tenant: user.tenant,
    };
  }
}
