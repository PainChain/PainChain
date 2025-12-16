import { Injectable, Logger } from '@nestjs/common'
import { InjectQueue } from '@nestjs/bull'
import { Queue } from 'bull'
import { Cron, CronExpression } from '@nestjs/schedule'
import { PrismaService } from '../database/prisma.service'

/**
 * Queue Service
 *
 * Manages the BullMQ queue for connector polling.
 * Schedules periodic polls based on each connection's pollInterval.
 */
@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name)

  constructor(
    @InjectQueue('connectors') private connectorsQueue: Queue,
    private prisma: PrismaService,
  ) {}

  /**
   * Add a connector poll job to the queue
   *
   * @param connectionId Database ID of the connection to poll
   * @param priority Job priority (lower number = higher priority)
   */
  async queueConnectorPoll(
    connectionId: number,
    priority: number = 10,
  ): Promise<void> {
    await this.connectorsQueue.add(
      'poll',
      { connectionId },
      {
        priority,
        removeOnComplete: 100, // Keep last 100 completed jobs
        removeOnFail: 500, // Keep last 500 failed jobs
        attempts: 3, // Retry failed jobs up to 3 times
        backoff: {
          type: 'exponential',
          delay: 2000, // Start with 2 second delay
        },
      },
    )

    this.logger.log(`Queued poll job for connection ${connectionId}`)
  }

  /**
   * Schedule all enabled connections for polling
   *
   * This method is called periodically (every minute) and queues
   * polls for connections based on their individual pollInterval.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async schedulePolls(): Promise<void> {
    this.logger.debug('Checking connections for scheduled polls')

    try {
      const connections = await this.prisma.connection.findMany({
        where: { enabled: true },
      })

      const now = new Date()

      for (const connection of connections) {
        const config = connection.config as Record<string, any>
        const pollInterval = config.pollInterval || 300 // Default 5 minutes
        const lastSync = connection.lastSync || new Date(0) // Epoch if never synced

        const timeSinceLastSync = (now.getTime() - lastSync.getTime()) / 1000 // seconds

        if (timeSinceLastSync >= pollInterval) {
          await this.queueConnectorPoll(connection.id)
        }
      }
    } catch (error) {
      this.logger.error('Error scheduling polls:', error)
    }
  }

  /**
   * Get queue statistics
   */
  async getQueueStats() {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      this.connectorsQueue.getWaitingCount(),
      this.connectorsQueue.getActiveCount(),
      this.connectorsQueue.getCompletedCount(),
      this.connectorsQueue.getFailedCount(),
      this.connectorsQueue.getDelayedCount(),
    ])

    return {
      waiting,
      active,
      completed,
      failed,
      delayed,
      total: waiting + active + delayed,
    }
  }

  /**
   * Clear all jobs from the queue
   */
  async clearQueue(): Promise<void> {
    await this.connectorsQueue.empty()
    this.logger.log('Queue cleared')
  }
}
