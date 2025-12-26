import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

interface TimelineFilters {
  tenantId?: string;
  connector?: string;
  project?: string;
  limit?: number;
}

@Injectable()
export class TimelineService {
  constructor(private prisma: PrismaService) {}

  async getTimeline(filters: TimelineFilters) {
    const events = await this.prisma.event.findMany({
      where: {
        ...(filters.tenantId !== undefined ? { tenantId: filters.tenantId } : {}),
        ...(filters.connector ? { connector: filters.connector } : {}),
        ...(filters.project ? { project: filters.project } : {}),
      },
      orderBy: { timestamp: 'desc' },
      take: filters.limit || 50,
    });

    return {
      events,
      total: events.length,
    };
  }
}
