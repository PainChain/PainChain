import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Headers,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { EventsService } from './events.service';
import { Prisma } from '@prisma/client';

interface CreateEventDto {
  title: string;
  connector: string;
  project: string;
  timestamp: string | Date;
  data: Record<string, any>;
}

@Controller('events')
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() createDto: CreateEventDto,
    @Headers('x-tenant-id') tenantId?: string,
  ) {
    const event = await this.eventsService.create({
      title: createDto.title,
      connector: createDto.connector,
      project: createDto.project,
      timestamp: new Date(createDto.timestamp),
      data: createDto.data as Prisma.JsonValue,
      ...(tenantId ? { tenant: { connect: { id: tenantId } } } : {}),
    });

    return {
      event_id: event.id,
      stored_at: event.createdAt,
    };
  }

  @Get()
  async findAll(
    @Query('connector') connector?: string,
    @Query('project') project?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Headers('x-tenant-id') tenantId?: string,
  ) {
    return this.eventsService.findAll({
      tenantId,
      connector,
      project,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @Headers('x-tenant-id') tenantId?: string,
  ) {
    return this.eventsService.findOne(id, tenantId);
  }
}
