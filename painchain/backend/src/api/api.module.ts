import { Module } from '@nestjs/common';
import { TimelineController } from './timeline.controller';
import { ProjectsController } from './projects.controller';
import { TimelineService } from './timeline.service';
import { ProjectsService } from './projects.service';

@Module({
  controllers: [TimelineController, ProjectsController],
  providers: [TimelineService, ProjectsService],
})
export class ApiModule {}
