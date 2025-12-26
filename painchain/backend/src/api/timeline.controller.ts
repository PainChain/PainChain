import { Controller, Get, Query, Headers } from '@nestjs/common';
import { TimelineService } from './timeline.service';

@Controller('timeline')
export class TimelineController {
  constructor(private readonly timelineService: TimelineService) {}

  @Get()
  async getTimeline(
    @Query('connector') connector?: string,
    @Query('project') project?: string,
    @Query('limit') limit?: string,
    @Headers('x-tenant-id') tenantId?: string,
  ) {
    return this.timelineService.getTimeline({
      tenantId,
      connector,
      project,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }
}
