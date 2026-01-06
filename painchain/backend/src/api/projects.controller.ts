import { Controller, Get, Headers } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { Public } from '../auth/decorators/public.decorator';

@Public() // Temporary: Allow unauthenticated access during migration
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Get()
  async findAll(@Headers('x-tenant-id') tenantId?: string) {
    return this.projectsService.findAll(tenantId);
  }
}
