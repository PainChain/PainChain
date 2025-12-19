import { Module } from '@nestjs/common'
import { ConnectorService } from './connector.service'
import { DatabaseModule } from '../database/database.module'

@Module({
  imports: [DatabaseModule],
  providers: [ConnectorService],
  exports: [ConnectorService],
})
export class ConnectorsModule {}
