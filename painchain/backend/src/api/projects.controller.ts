import { Controller, Get, Headers } from '@nestjs/common';
import { ProjectsService } from './projects.service';

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Get()
  async findAll(@Headers('x-tenant-id') tenantId?: string) {
    return this.projectsService.findAll(tenantId);
  }
}
