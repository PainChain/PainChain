import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class ProjectsService {
  constructor(private prisma: PrismaService) {}

  async findAll(tenantId?: string) {
    return this.prisma.project.findMany({
      where: tenantId !== undefined ? { tenantId } : {},
      orderBy: { createdAt: 'desc' },
    });
  }

  async upsertProject(
    name: string,
    connector: string,
    tags: string[],
    tenantId?: string,
  ) {
    return this.prisma.project.upsert({
      where: {
        tenantId_name_connector: {
          tenantId: tenantId || null,
          name,
          connector,
        },
      },
      update: {
        tags,
      },
      create: {
        name,
        connector,
        tags,
        ...(tenantId ? { tenant: { connect: { id: tenantId } } } : {}),
      },
    });
  }
}
