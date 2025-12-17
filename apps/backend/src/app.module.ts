import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { ScheduleModule } from '@nestjs/schedule'
import { DatabaseModule } from './database/database.module'
import { ApiModule } from './api/api.module'
import { ConnectorsModule } from './connectors/connectors.module'
import { QueueModule } from './queue/queue.module'

@Module({
  imports: [
    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    // Scheduling (for cron jobs)
    ScheduleModule.forRoot(),

    // Database (Prisma)
    DatabaseModule,

    // Connectors (auto-discovery)
    ConnectorsModule,

    // Queue (BullMQ)
    QueueModule,

    // API Controllers
    ApiModule,
  ],
})
export class AppModule {}
