import { Controller, Post, Body } from '@nestjs/common'
import { ApiTags, ApiOperation } from '@nestjs/swagger'
import { PrismaService } from '../database/prisma.service'

/**
 * PainChain Controller
 *
 * Handles endpoints for PainChain system events logging.
 */
@ApiTags('painchain')
@Controller('api/painchain')
export class PainchainController {
  constructor(private prisma: PrismaService) {}

  /**
   * Log a PainChain system event
   */
  @Post('log')
  @ApiOperation({ summary: 'Log a PainChain system event' })
  async logEvent(@Body() body: any) {
    const { event_type, title, description, metadata, connector_name, connector_type } = body

    // Find or create the PainChain connection (system connection)
    let painchainConnection = await this.prisma.connection.findFirst({
      where: { type: 'painchain' },
    })

    if (!painchainConnection) {
      painchainConnection = await this.prisma.connection.create({
        data: {
          name: 'PainChain System',
          type: 'painchain',
          config: {},
          enabled: true,
        },
      })
    }

    // Generate a descriptive title if not provided
    let eventTitle = title
    let eventDescription = description

    if (!eventTitle) {
      if (connector_name) {
        // Generate title with connector name
        const eventTypeFormatted = event_type?.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) || 'Event'
        eventTitle = `[${eventTypeFormatted}] ${connector_name}`
        // Add type to description
        if (connector_type && !eventDescription) {
          eventDescription = `Type: ${connector_type}`
        }
      } else {
        eventTitle = `System event: ${event_type}`
      }
    }

    // Create the change event
    const event = await this.prisma.changeEvent.create({
      data: {
        connectionId: painchainConnection.id,
        externalId: `painchain-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        source: 'painchain',
        eventType: event_type || 'system',
        title: eventTitle,
        description: eventDescription || '',
        timestamp: new Date(),
        status: 'completed',
        metadata: metadata || {},
        eventMetadata: body,
      },
    })

    return { success: true, event }
  }
}
