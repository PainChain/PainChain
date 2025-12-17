import { Controller, Get, Query } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger'
import { PrismaService } from '../database/prisma.service'

/**
 * Changes Controller
 *
 * Handles endpoints for querying change events.
 */
@ApiTags('changes')
@Controller('api/changes')
export class ChangesController {
  constructor(private prisma: PrismaService) {}

  /**
   * Get change events with filters
   */
  @Get()
  @ApiOperation({ summary: 'Get change events with optional filters' })
  @ApiQuery({ name: 'start_date', required: false })
  @ApiQuery({ name: 'end_date', required: false })
  @ApiQuery({ name: 'source', required: false })
  @ApiQuery({ name: 'event_type', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'offset', required: false })
  async getChanges(
    @Query('start_date') startDate?: string,
    @Query('end_date') endDate?: string,
    @Query('source') source?: string,
    @Query('event_type') eventType?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const where: any = {}

    if (startDate || endDate) {
      where.timestamp = {}
      if (startDate) where.timestamp.gte = new Date(startDate)
      if (endDate) where.timestamp.lte = new Date(endDate)
    }

    if (source) where.source = source
    if (eventType) where.eventType = eventType

    const changes = await this.prisma.changeEvent.findMany({
      where,
      orderBy: { timestamp: 'desc' },
      take: limit ? parseInt(limit) : 50,
      skip: offset ? parseInt(offset) : 0,
      include: { connection: true },
    })

    // Transform data to match frontend expectations
    return changes.map((change) => ({
      ...change,
      // Add snake_case connection_id for frontend compatibility
      connection_id: change.connectionId,
      // Merge eventMetadata into metadata for frontend compatibility
      metadata: {
        ...(change.metadata as any),
        ...(change.eventMetadata as any),
      },
      // Extract author to top level
      author: (change.metadata as any)?.author || 'unknown',
    }))
  }
}
