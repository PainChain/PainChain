import { Controller, Get, Post, Put, Delete, Body, Param, ParseIntPipe } from '@nestjs/common'
import { ApiTags, ApiOperation } from '@nestjs/swagger'
import { PrismaService } from '../database/prisma.service'
import { ConnectorService } from '../connectors/connector.service'
import { QueueService } from '../queue/queue.service'
import { CreateConnectionDto, UpdateConnectionDto, TestConnectionDto } from '@painchain/types'

/**
 * Connections Controller
 *
 * Handles CRUD operations for connector connections.
 */
@ApiTags('connections')
@Controller('api/connections')
export class ConnectionsController {
  constructor(
    private prisma: PrismaService,
    private connectorService: ConnectorService,
    private queueService: QueueService,
  ) {}

  /**
   * Get all connections
   */
  @Get()
  @ApiOperation({ summary: 'Get all connections' })
  async getConnections() {
    return await this.prisma.connection.findMany({
      orderBy: { createdAt: 'desc' },
    })
  }

  /**
   * Get a single connection by ID
   */
  @Get(':id')
  @ApiOperation({ summary: 'Get connection by ID' })
  async getConnection(@Param('id', ParseIntPipe) id: number) {
    return await this.prisma.connection.findUnique({
      where: { id },
      include: { teams: true },
    })
  }

  /**
   * Create a new connection
   */
  @Post()
  @ApiOperation({ summary: 'Create a new connection' })
  async createConnection(@Body() dto: CreateConnectionDto) {
    const connection = await this.prisma.connection.create({
      data: {
        name: dto.name,
        type: dto.type,
        config: dto.config,
        enabled: dto.enabled ?? true,
      },
    })

    // Queue initial poll if enabled
    if (connection.enabled) {
      await this.queueService.queueConnectorPoll(connection.id)
    }

    return connection
  }

  /**
   * Update a connection
   */
  @Put(':id')
  @ApiOperation({ summary: 'Update a connection' })
  async updateConnection(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateConnectionDto,
  ) {
    return await this.prisma.connection.update({
      where: { id },
      data: dto,
    })
  }

  /**
   * Delete a connection
   */
  @Delete(':id')
  @ApiOperation({ summary: 'Delete a connection' })
  async deleteConnection(@Param('id', ParseIntPipe) id: number) {
    return await this.prisma.connection.delete({
      where: { id },
    })
  }

  /**
   * Test a connection without saving it
   */
  @Post('test')
  @ApiOperation({ summary: 'Test connection credentials' })
  async testConnection(@Body() dto: TestConnectionDto) {
    try {
      const success = await this.connectorService.testConnection(dto.type, dto.config)
      return { success, message: success ? 'Connection successful' : 'Connection failed' }
    } catch (error) {
      return { success: false, message: error.message }
    }
  }

  /**
   * Manually trigger a sync for a connection
   */
  @Post(':id/sync')
  @ApiOperation({ summary: 'Manually trigger connector sync' })
  async syncConnection(@Param('id', ParseIntPipe) id: number) {
    await this.queueService.queueConnectorPoll(id, 1) // High priority
    return { message: 'Sync queued' }
  }
}
