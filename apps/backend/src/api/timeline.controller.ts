import { Controller, Get, Query } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger'
import { PrismaService } from '../database/prisma.service'

/**
 * Timeline Controller
 *
 * Handles timeline aggregation and visualization endpoints.
 */
@ApiTags('timeline')
@Controller('api/timeline')
export class TimelineController {
  constructor(private prisma: PrismaService) {}

  /**
   * Get timeline data with time-based aggregation
   */
  @Get()
  @ApiOperation({ summary: 'Get aggregated timeline data' })
  @ApiQuery({ name: 'start_date', required: false })
  @ApiQuery({ name: 'end_date', required: false })
  @ApiQuery({ name: 'source', required: false })
  @ApiQuery({ name: 'tag', required: false, type: [String] })
  async getTimeline(
    @Query('start_date') startDate?: string,
    @Query('end_date') endDate?: string,
    @Query('source') source?: string,
    @Query('tag') tags?: string | string[],
  ) {
    // Calculate date range (use rolling 24-hour window if not specified)
    const start = startDate ? new Date(startDate) : new Date(Date.now() - 24 * 60 * 60 * 1000)
    const end = endDate ? new Date(endDate) : new Date()

    const where: any = {}

    // Always apply date filtering
    where.timestamp = {
      gte: start,
      lte: end,
    }

    // Source filtering
    if (source) {
      where.source = source
    }

    // Tag filtering - filter by connection tags OR team membership OR team subscribed tags
    if (tags) {
      const tagArray = Array.isArray(tags) ? tags : [tags]

      // Find teams matching the filter tags to get their subscribed tags
      const teams = await this.prisma.team.findMany({
        where: {
          name: {
            in: tagArray,
          },
        },
        select: {
          tags: true,
        },
      })

      // Collect all subscribed tags from matching teams
      const subscribedTags = teams.flatMap((team) => team.tags)

      // Combine original tags with subscribed tags
      const allTags = [...tagArray, ...subscribedTags]

      where.connection = {
        OR: [
          // Match connections with any of the tags directly (original + subscribed)
          ...allTags.map((tag) => ({
            tags: { contains: tag },
          })),
          // Match connections that belong to a team with matching name
          ...tagArray.map((tag) => ({
            teams: {
              some: {
                team: {
                  name: tag,
                },
              },
            },
          })),
        ],
      }
    }

    // Fetch events
    const events = await this.prisma.changeEvent.findMany({
      where,
      orderBy: { timestamp: 'asc' },
      include: { connection: true },
    })
    const rangeMs = end.getTime() - start.getTime()

    let interval = 'hour'
    let binSizeMs = 60 * 60 * 1000 // 1 hour

    if (rangeMs > 7 * 24 * 60 * 60 * 1000) {
      // More than 7 days
      interval = 'day'
      binSizeMs = 24 * 60 * 60 * 1000
    } else if (rangeMs > 24 * 60 * 60 * 1000) {
      // More than 1 day
      interval = 'hour'
      binSizeMs = 60 * 60 * 1000
    } else {
      // Less than 1 day
      interval = 'minute'
      binSizeMs = 15 * 60 * 1000 // 15 minutes
    }

    // Create time bins with flattened source counts
    const bins: Map<string, Record<string, any>> = new Map()

    for (const event of events) {
      const binTime = Math.floor(event.timestamp.getTime() / binSizeMs) * binSizeMs
      const binKey = new Date(binTime).toISOString()

      if (!bins.has(binKey)) {
        bins.set(binKey, {
          time: binKey,
          total: 0,
        })
      }

      const bin = bins.get(binKey)!
      bin.total++
      bin[event.source] = (bin[event.source] || 0) + 1
    }

    // Round start and end times to bin boundaries to match event binning
    const startBin = Math.floor(start.getTime() / binSizeMs) * binSizeMs
    const endBin = Math.floor(end.getTime() / binSizeMs) * binSizeMs

    // Fill in empty bins
    const filledBins: Array<Record<string, any>> = []
    for (let t = startBin; t <= endBin; t += binSizeMs) {
      const binKey = new Date(t).toISOString()
      filledBins.push(
        bins.get(binKey) || {
          time: binKey,
          total: 0,
        },
      )
    }

    // Calculate total counts by source
    const bySource: Record<string, number> = {}
    for (const event of events) {
      bySource[event.source] = (bySource[event.source] || 0) + 1
    }

    return {
      bins: filledBins,
      by_source: bySource,
      interval,
      total: events.length,
    }
  }
}
