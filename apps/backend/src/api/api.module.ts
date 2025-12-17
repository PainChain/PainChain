import { Module } from '@nestjs/common'
import { ConnectorsModule } from '../connectors/connectors.module'
import { QueueModule } from '../queue/queue.module'
import { ConnectorsController } from './connectors.controller'
import { ConnectionsController } from './connections.controller'
import { ChangesController } from './changes.controller'
import { TeamsController } from './teams.controller'
import { PainchainController } from './painchain.controller'
import { TimelineController } from './timeline.controller'

@Module({
  imports: [ConnectorsModule, QueueModule],
  controllers: [
    ConnectorsController,
    ConnectionsController,
    ChangesController,
    TeamsController,
    PainchainController,
    TimelineController,
  ],
})
export class ApiModule {}
