import { Module } from '@nestjs/common'
import { BullModule } from '@nestjs/bull'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { ConnectorsProcessor } from './connectors.processor'
import { QueueService } from './queue.service'
import { ConnectorsModule } from '../connectors/connectors.module'

@Module({
  imports: [
    // Configure BullMQ with Redis
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        redis: {
          host: config.get('REDIS_HOST', 'localhost'),
          port: config.get('REDIS_PORT', 6379),
        },
      }),
      inject: [ConfigService],
    }),

    // Register the 'connectors' queue
    BullModule.registerQueue({
      name: 'connectors',
    }),

    // Import ConnectorsModule for connector access
    ConnectorsModule,
  ],
  providers: [QueueService, ConnectorsProcessor],
  exports: [QueueService, BullModule],
})
export class QueueModule {}
