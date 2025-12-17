import { Controller, Get, Post, Put, Delete, Body, Param, ParseIntPipe } from '@nestjs/common'
import { ApiTags, ApiOperation } from '@nestjs/swagger'
import { PrismaService } from '../database/prisma.service'
import { CreateTeamDto, UpdateTeamDto } from '@painchain/types'

/**
 * Teams Controller
 *
 * Handles CRUD operations for teams.
 */
@ApiTags('teams')
@Controller('api/teams')
export class TeamsController {
  constructor(private prisma: PrismaService) {}

  /**
   * Get all teams
   */
  @Get()
  @ApiOperation({ summary: 'Get all teams' })
  async getTeams() {
    return await this.prisma.team.findMany({
      include: { connections: { include: { connection: true } } },
    })
  }

  /**
   * Get a single team by ID
   */
  @Get(':id')
  @ApiOperation({ summary: 'Get team by ID' })
  async getTeam(@Param('id', ParseIntPipe) id: number) {
    return await this.prisma.team.findUnique({
      where: { id },
      include: { connections: { include: { connection: true } } },
    })
  }

  /**
   * Create a new team
   */
  @Post()
  @ApiOperation({ summary: 'Create a new team' })
  async createTeam(@Body() dto: CreateTeamDto) {
    // Convert tags to array if it's a string (comma-separated)
    const data: any = { ...dto }
    if (typeof data.tags === 'string') {
      data.tags = data.tags.split(',').map((tag: string) => tag.trim()).filter((tag: string) => tag.length > 0)
    }

    return await this.prisma.team.create({
      data,
    })
  }

  /**
   * Update a team
   */
  @Put(':id')
  @ApiOperation({ summary: 'Update a team' })
  async updateTeam(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateTeamDto,
  ) {
    // Convert tags to array if it's a string (comma-separated)
    const data: any = { ...dto }
    if (typeof data.tags === 'string') {
      data.tags = data.tags.split(',').map((tag: string) => tag.trim()).filter((tag: string) => tag.length > 0)
    }

    return await this.prisma.team.update({
      where: { id },
      data,
    })
  }

  /**
   * Delete a team
   */
  @Delete(':id')
  @ApiOperation({ summary: 'Delete a team' })
  async deleteTeam(@Param('id', ParseIntPipe) id: number) {
    return await this.prisma.team.delete({
      where: { id },
    })
  }
}
