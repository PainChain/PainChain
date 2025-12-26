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
import { IntegrationsService } from './integrations.service';
import { Prisma } from '@prisma/client';

@Controller('integrations')
export class IntegrationsController {
  constructor(private readonly integrationsService: IntegrationsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() createDto: Prisma.IntegrationCreateInput,
    @Headers('x-tenant-id') tenantId?: string,
  ) {
    const integration = await this.integrationsService.create({
      ...createDto,
      ...(tenantId ? { tenant: { connect: { id: tenantId } } } : {}),
    });

    return {
      id: integration.id,
      tenant_id: integration.tenantId,
      registered_at: integration.registeredAt,
    };
  }

  @Get()
  async findAll(@Headers('x-tenant-id') tenantId?: string) {
    return this.integrationsService.findAll(tenantId);
  }

  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @Headers('x-tenant-id') tenantId?: string,
  ) {
    return this.integrationsService.findOne(id, tenantId);
  }

  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() updateDto: Prisma.IntegrationUpdateInput,
    @Headers('x-tenant-id') tenantId?: string,
  ) {
    return this.integrationsService.update(id, updateDto, tenantId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('id') id: string,
    @Headers('x-tenant-id') tenantId?: string,
  ) {
    await this.integrationsService.remove(id, tenantId);
  }
}
