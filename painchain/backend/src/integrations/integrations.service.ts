import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { Integration, Prisma } from '@prisma/client';

@Injectable()
export class IntegrationsService {
  constructor(private prisma: PrismaService) {}

  async create(data: Prisma.IntegrationCreateInput): Promise<Integration> {
    return this.prisma.integration.create({ data });
  }

  async findAll(tenantId?: string): Promise<Integration[]> {
    return this.prisma.integration.findMany({
      where: tenantId ? { tenantId } : {},
      orderBy: { registeredAt: 'desc' },
    });
  }

  async findOne(id: string, tenantId?: string): Promise<Integration | null> {
    return this.prisma.integration.findFirst({
      where: {
        id,
        ...(tenantId ? { tenantId } : {}),
      },
    });
  }

  async update(
    id: string,
    data: Prisma.IntegrationUpdateInput,
    tenantId?: string,
  ): Promise<Integration> {
    return this.prisma.integration.update({
      where: { id },
      data,
    });
  }

  async remove(id: string, tenantId?: string): Promise<Integration> {
    return this.prisma.integration.delete({
      where: { id },
    });
  }

  async updateLastSync(id: string): Promise<void> {
    await this.prisma.integration.update({
      where: { id },
      data: { lastSync: new Date() },
    });
  }
}
