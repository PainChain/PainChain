import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

interface TimelineFilters {
  tenantId?: string;
  connector?: string;
  project?: string;
  tags?: string[];
  limit?: number;
  startDate?: Date;
  endDate?: Date;
}

@Injectable()
export class TimelineService {
  constructor(private prisma: PrismaService) {}

  async getTimeline(filters: TimelineFilters) {
    const startTime = Date.now();

    // If tags are specified, find integrations with matching tags
    let integrationIds: string[] | undefined;
    if (filters.tags && filters.tags.length > 0) {
      // Get integrations that have any of the specified tags
      const integrations = await this.prisma.integration.findMany({
        where: filters.connector ? { type: filters.connector } : {},
      });

      // Filter integrations that have matching tags
      const matchingIntegrations = integrations.filter(integration => {
        const config = integration.config as any;
        if (!config?.tags || !Array.isArray(config.tags)) {
          return false;
        }
        // Check if integration has any of the specified tags
        return filters.tags.some(tag => config.tags.includes(tag));
      });

      integrationIds = matchingIntegrations.map(i => i.id);

      // If no integrations match the tags, return empty results
      if (integrationIds.length === 0) {
        return {
          events: [],
          total: 0,
        };
      }
    }

    // Calculate appropriate limit based on time range
    let eventLimit = filters.limit || 50;
    if (filters.startDate && filters.endDate) {
      const timeRangeMs = filters.endDate.getTime() - filters.startDate.getTime();
      const days = timeRangeMs / (24 * 60 * 60 * 1000);

      // Scale limit with time range: ~50 events per day, capped at 2000
      eventLimit = Math.min(2000, Math.ceil(days * 50));
    }

    const events = await this.prisma.event.findMany({
      where: {
        ...(filters.tenantId !== undefined
          ? { tenantId: filters.tenantId }
          : {}),
        ...(filters.connector ? { connector: filters.connector } : {}),
        ...(filters.project ? { project: filters.project } : {}),
        ...(integrationIds ? { integrationId: { in: integrationIds } } : {}),
        ...(filters.startDate || filters.endDate
          ? {
              timestamp: {
                ...(filters.startDate ? { gte: filters.startDate } : {}),
                ...(filters.endDate ? { lte: filters.endDate } : {}),
              },
            }
          : {}),
      },
      orderBy: { timestamp: 'desc' },
      take: eventLimit,
    });

    const duration = Date.now() - startTime;
    console.log(`Timeline query: ${duration}ms - ${events.length} events - filters:`, {
      connector: filters.connector,
      project: filters.project,
      tags: filters.tags,
      limit: eventLimit
    });

    return {
      events,
      total: events.length,
    };
  }
}
