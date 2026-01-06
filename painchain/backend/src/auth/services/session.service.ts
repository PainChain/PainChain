import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { Session } from '@prisma/client';

interface SessionMetadata {
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class SessionService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a new session in the database
   * @param userId - The user ID
   * @param tokenId - The JWT token ID (jti claim)
   * @param expiresAt - When the session expires
   * @param metadata - Optional IP address and user agent
   * @returns Promise<Session> - The created session
   */
  async createSession(
    userId: string,
    tokenId: string,
    expiresAt: Date,
    metadata?: SessionMetadata,
  ): Promise<Session> {
    return this.prisma.session.create({
      data: {
        userId,
        token: tokenId,
        expiresAt,
        ipAddress: metadata?.ipAddress,
        userAgent: metadata?.userAgent,
      },
    });
  }

  /**
   * Check if a session is valid (not revoked, not expired)
   * @param tokenId - The JWT token ID (jti claim)
   * @returns Promise<boolean> - True if session is valid
   */
  async isSessionValid(tokenId: string): Promise<boolean> {
    const session = await this.prisma.session.findUnique({
      where: { token: tokenId },
    });

    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      return false;
    }

    // Update last activity timestamp
    await this.prisma.session.update({
      where: { id: session.id },
      data: { lastActivityAt: new Date() },
    });

    return true;
  }

  /**
   * Revoke a specific session
   * @param tokenId - The JWT token ID (jti claim)
   */
  async revokeSession(tokenId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { token: tokenId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * Revoke all sessions for a user
   * @param userId - The user ID
   */
  async revokeAllUserSessions(userId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * Get all active sessions for a user
   * @param userId - The user ID
   * @returns Promise<Session[]> - Array of active sessions
   */
  async getUserSessions(userId: string): Promise<Session[]> {
    return this.prisma.session.findMany({
      where: {
        userId,
        revokedAt: null,
        expiresAt: { gte: new Date() },
      },
      orderBy: { lastActivityAt: 'desc' },
    });
  }

  /**
   * Delete expired sessions (cleanup job)
   * @returns Promise<number> - Number of sessions deleted
   */
  async cleanupExpiredSessions(): Promise<number> {
    const result = await this.prisma.session.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    return result.count;
  }
}
