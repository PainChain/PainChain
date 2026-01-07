import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { TenantInvitation } from '@prisma/client';

@Injectable()
export class InvitationService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a new invitation link
   * @param tenantId - Tenant to invite to
   * @param createdBy - User ID creating the invite
   * @param role - Role for invited user
   * @param expiresInDays - Days until expiration (default 7)
   * @param maxUses - Max number of uses (default 1)
   */
  async createInvitation(
    tenantId: string,
    createdBy: string,
    role: string = 'member',
    expiresInDays: number = 7,
    maxUses: number = 1,
  ): Promise<TenantInvitation> {
    // Verify creator has permission (owner or admin)
    const creator = await this.prisma.user.findUnique({
      where: { id: createdBy },
    });

    if (!creator || creator.tenantId !== tenantId) {
      throw new BadRequestException('Invalid creator');
    }

    if (!['owner', 'admin'].includes(creator.role)) {
      throw new BadRequestException('Only owners and admins can create invitations');
    }

    // Validate role
    if (!['owner', 'admin', 'member', 'viewer'].includes(role)) {
      throw new BadRequestException('Invalid role');
    }

    // Calculate expiration
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expiresInDays);

    return this.prisma.tenantInvitation.create({
      data: {
        tenantId,
        createdBy,
        role,
        expiresAt,
        maxUses,
      },
    });
  }

  /**
   * Get invitation by token
   * @param token - Invitation token
   */
  async getInvitation(token: string): Promise<TenantInvitation & { tenant: any }> {
    const invitation = await this.prisma.tenantInvitation.findUnique({
      where: { token },
      include: {
        tenant: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
      },
    });

    if (!invitation) {
      throw new NotFoundException('Invitation not found');
    }

    return invitation;
  }

  /**
   * Validate invitation is still usable
   * @param token - Invitation token
   */
  async validateInvitation(token: string): Promise<TenantInvitation> {
    const invitation = await this.getInvitation(token);

    if (invitation.isRevoked) {
      throw new BadRequestException('This invitation has been revoked');
    }

    if (invitation.expiresAt < new Date()) {
      throw new BadRequestException('This invitation has expired');
    }

    if (invitation.useCount >= invitation.maxUses) {
      throw new BadRequestException('This invitation has reached its maximum uses');
    }

    return invitation;
  }

  /**
   * Mark invitation as used
   * @param token - Invitation token
   * @param userId - User who used the invitation
   */
  async useInvitation(token: string, userId: string): Promise<void> {
    const invitation = await this.validateInvitation(token);

    await this.prisma.tenantInvitation.update({
      where: { id: invitation.id },
      data: {
        useCount: { increment: 1 },
        usedBy: userId,
        usedAt: new Date(),
      },
    });
  }

  /**
   * Revoke an invitation
   * @param token - Invitation token
   * @param revokedBy - User ID revoking the invite
   */
  async revokeInvitation(token: string, revokedBy: string): Promise<void> {
    const invitation = await this.getInvitation(token);

    // Verify revoker has permission
    const revoker = await this.prisma.user.findUnique({
      where: { id: revokedBy },
    });

    if (!revoker || revoker.tenantId !== invitation.tenantId) {
      throw new BadRequestException('Invalid permission');
    }

    if (!['owner', 'admin'].includes(revoker.role)) {
      throw new BadRequestException('Only owners and admins can revoke invitations');
    }

    await this.prisma.tenantInvitation.update({
      where: { id: invitation.id },
      data: {
        isRevoked: true,
        revokedAt: new Date(),
        revokedBy,
      },
    });
  }

  /**
   * List all invitations for a tenant
   * @param tenantId - Tenant ID
   */
  async listInvitations(tenantId: string): Promise<TenantInvitation[]> {
    return this.prisma.tenantInvitation.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
