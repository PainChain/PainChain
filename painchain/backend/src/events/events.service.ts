import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { Event, Prisma } from '@prisma/client';

interface EventFilters {
  tenantId?: string;
  connector?: string;
  project?: string;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}

@Injectable()
export class EventsService {
  constructor(private prisma: PrismaService) {}

  async create(data: Prisma.EventCreateInput): Promise<Event> {
    return this.prisma.event.create({ data });
  }

  async findAll(filters: EventFilters): Promise<Event[]> {
    const where: Prisma.EventWhereInput = {};

    if (filters.tenantId !== undefined) {
      where.tenantId = filters.tenantId;
    }

    if (filters.connector) {
      where.connector = filters.connector;
    }

    if (filters.project) {
      where.project = filters.project;
    }

    if (filters.startDate || filters.endDate) {
      where.timestamp = {};
      if (filters.startDate) {
        where.timestamp.gte = filters.startDate;
      }
      if (filters.endDate) {
        where.timestamp.lte = filters.endDate;
      }
    }

    return this.prisma.event.findMany({
      where,
      orderBy: { timestamp: 'desc' },
      take: filters.limit || 100,
      skip: filters.offset || 0,
    });
  }

  async findOne(id: string, tenantId?: string): Promise<Event | null> {
    return this.prisma.event.findFirst({
      where: {
        id,
        ...(tenantId !== undefined ? { tenantId } : {}),
      },
    });
  }
}
