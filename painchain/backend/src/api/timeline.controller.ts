import { Controller, Get, Query, Headers } from '@nestjs/common';
import { TimelineService } from './timeline.service';
import { Public } from '../auth/decorators/public.decorator';

@Public() // Temporary: Allow unauthenticated access during migration
@Controller('timeline')
export class TimelineController {
  constructor(private readonly timelineService: TimelineService) {}

  @Get()
  async getTimeline(
    @Query('connector') connector?: string,
    @Query('project') project?: string,
    @Query('tag') tag?: string | string[],
    @Query('limit') limit?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Headers('x-tenant-id') tenantId?: string,
  ) {
    // Convert single tag string to array
    const tags = tag ? (Array.isArray(tag) ? tag : [tag]) : undefined;

    return this.timelineService.getTimeline({
      tenantId,
      connector,
      project,
      tags,
      limit: limit ? parseInt(limit, 10) : undefined,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
    });
  }
}
