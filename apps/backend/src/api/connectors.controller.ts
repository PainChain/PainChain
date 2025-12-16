import { Controller, Get, Param, Res } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger'
import { Response } from 'express'
import { ConnectorService } from '../connectors/connector.service'
import { join } from 'path'
import { existsSync } from 'fs'

/**
 * Connectors Controller
 *
 * Provides connector metadata and available types.
 * All connectors are auto-discovered from the connectors/ directory.
 */
@ApiTags('connectors')
@Controller('api/connectors')
export class ConnectorsController {
  constructor(private connectorService: ConnectorService) {}

  /**
   * Get all connector metadata
   *
   * This endpoint returns metadata for all auto-discovered connectors.
   * The frontend uses this to dynamically build the connection forms.
   */
  @Get('metadata')
  @ApiOperation({ summary: 'Get metadata for all available connectors' })
  @ApiResponse({ status: 200, description: 'Returns array of connector metadata' })
  async getMetadata() {
    return this.connectorService.getAllMetadata()
  }

  /**
   * Get list of available connector types
   */
  @Get('types')
  @ApiOperation({ summary: 'Get list of available connector types' })
  @ApiResponse({ status: 200, description: 'Returns array of connector type IDs' })
  async getTypes() {
    return this.connectorService.getAvailableTypes()
  }

  /**
   * Get metadata for a specific connector type
   */
  @Get(':type/metadata')
  @ApiOperation({ summary: 'Get metadata for a specific connector type' })
  @ApiResponse({ status: 200, description: 'Returns connector metadata' })
  @ApiResponse({ status: 404, description: 'Connector type not found' })
  async getConnectorMetadata(@Param('type') type: string) {
    const metadata = this.connectorService.getMetadata(type)
    if (!metadata) {
      return { error: 'Connector type not found' }
    }
    return metadata
  }

  /**
   * Get connector logo image
   */
  @Get(':type/logo')
  @ApiOperation({ summary: 'Get connector logo image' })
  @ApiResponse({ status: 200, description: 'Returns logo PNG image' })
  @ApiResponse({ status: 404, description: 'Logo not found' })
  async getLogo(@Param('type') type: string, @Res() res: Response) {
    const logoPath = join(__dirname, '..', 'connectors', type, 'logo.png')

    if (!existsSync(logoPath)) {
      return res.status(404).json({ error: 'Logo not found' })
    }

    return res.sendFile(logoPath)
  }
}
