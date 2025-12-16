import { Process, Processor } from '@nestjs/bull'
import { Logger } from '@nestjs/common'
import { Job } from 'bull'
import { ConnectorService } from '../connectors/connector.service'
import { PrismaService } from '../database/prisma.service'

/**
 * Connectors Processor
 *
 * Handles background jobs for connector polling.
 * When a 'poll' job is added to the queue, this processor
 * loads the connection, creates the appropriate connector,
 * and executes the sync operation.
 */
@Processor('connectors')
export class ConnectorsProcessor {
  private readonly logger = new Logger(ConnectorsProcessor.name)

  constructor(
    private connectorService: ConnectorService,
    private prisma: PrismaService,
  ) {}

  /**
   * Process a connector poll job
   *
   * @param job BullMQ job containing connectionId
   */
  @Process('poll')
  async handlePoll(job: Job<{ connectionId: number }>) {
    const { connectionId } = job.data
    const startTime = Date.now()

    this.logger.log(`[Job ${job.id}] Starting poll for connection ${connectionId}`)

    try {
      // Load connection from database
      const connection = await this.prisma.connection.findUnique({
        where: { id: connectionId },
      })

      if (!connection) {
        this.logger.warn(`[Job ${job.id}] Connection ${connectionId} not found`)
        return { status: 'skipped', reason: 'not found' }
      }

      if (!connection.enabled) {
        this.logger.warn(`[Job ${job.id}] Connection ${connectionId} is disabled`)
        return { status: 'skipped', reason: 'disabled' }
      }

      // Create connector instance
      const connector = this.connectorService.createConnector(
        connection.type,
        connection.config as Record<string, any>,
      )

      // Execute sync
      const result = await connector.sync(connectionId)

      // Update last_sync timestamp
      await this.prisma.connection.update({
        where: { id: connectionId },
        data: { lastSync: new Date() },
      })

      const duration = Date.now() - startTime

      this.logger.log(
        `[Job ${job.id}] ✅ Completed poll for connection ${connectionId} ` +
        `(${connection.name}): ${result.eventsStored} events in ${duration}ms`
      )

      return {
        status: 'success',
        result,
        duration,
      }
    } catch (error) {
      const duration = Date.now() - startTime

      this.logger.error(
        `[Job ${job.id}] ❌ Error polling connection ${connectionId}:`,
        error.message,
      )

      // Don't throw - let BullMQ handle retries
      return {
        status: 'error',
        error: error.message,
        duration,
      }
    }
  }
}
