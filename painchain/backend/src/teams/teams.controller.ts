import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Headers,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { TeamsService } from './teams.service';
import { Prisma } from '@prisma/client';
import { Public } from '../auth/decorators/public.decorator';

@Public() // Temporary: Allow unauthenticated access during migration
@Controller('teams')
export class TeamsController {
  constructor(private readonly teamsService: TeamsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() createDto: Prisma.TeamCreateInput,
    @Headers('x-tenant-id') tenantId?: string,
  ) {
    const team = await this.teamsService.create({
      ...createDto,
      ...(tenantId ? { tenant: { connect: { id: tenantId } } } : {}),
    });

    return team;
  }

  @Get()
  async findAll(@Headers('x-tenant-id') tenantId?: string) {
    return this.teamsService.findAll(tenantId);
  }

  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @Headers('x-tenant-id') tenantId?: string,
  ) {
    return this.teamsService.findOne(id, tenantId);
  }

  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() updateDto: Prisma.TeamUpdateInput,
    @Headers('x-tenant-id') tenantId?: string,
  ) {
    return this.teamsService.update(id, updateDto, tenantId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('id') id: string,
    @Headers('x-tenant-id') tenantId?: string,
  ) {
    await this.teamsService.remove(id, tenantId);
  }
}
