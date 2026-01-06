import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { JwtPayload } from '../interfaces/jwt-payload.interface';

@Injectable()
export class JwtTokenService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Generate a JWT token with the provided payload
   * @param payload - The JWT payload containing user information
   * @returns Promise<string> - The signed JWT token
   */
  async generateToken(payload: JwtPayload): Promise<string> {
    return this.jwtService.signAsync({
      sub: payload.userId,
      email: payload.email,
      tenantId: payload.tenantId,
      role: payload.role,
      jti: payload.sessionId, // For session tracking/revocation
    });
  }

  /**
   * Verify and decode a JWT token
   * @param token - The JWT token to verify
   * @returns Promise<JwtPayload> - The decoded payload
   * @throws Error if token is invalid or expired
   */
  async verifyToken(token: string): Promise<JwtPayload> {
    const decoded = await this.jwtService.verifyAsync(token);
    return {
      userId: decoded.sub,
      email: decoded.email,
      tenantId: decoded.tenantId,
      role: decoded.role,
      sessionId: decoded.jti,
    };
  }
}
