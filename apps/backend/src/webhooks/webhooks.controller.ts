import {
  Controller,
  Post,
  Param,
  Headers,
  Body,
  NotFoundException,
  BadRequestException,
  HttpCode,
  HttpStatus,
  Logger,
  Req,
} from '@nestjs/common'
import { Request } from 'express'
import { WebhookVerificationService } from './webhook-verification.service'
import { GitHubWebhookTransformer } from './transformers/github.transformer'
import { GitLabWebhookTransformer } from './transformers/gitlab.transformer'
import { EventsService } from '../events/events.service'
import { PrismaService } from '../database/prisma.service'

@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name)

  constructor(
    private readonly verification: WebhookVerificationService,
    private readonly githubTransformer: GitHubWebhookTransformer,
    private readonly gitlabTransformer: GitLabWebhookTransformer,
    private readonly eventsService: EventsService,
    private readonly prisma: PrismaService
  ) {}

  @Post('github/:webhookId')
  @HttpCode(HttpStatus.OK)
  async handleGitHub(
    @Param('webhookId') webhookId: string,
    @Headers('x-hub-signature-256') signature: string | undefined,
    @Headers('x-github-event') eventType: string | undefined,
    @Body() payload: any,
    @Req() req: Request & { rawBody?: Buffer }
  ) {
    this.logger.log(`Received GitHub ${eventType} webhook for webhookId ${webhookId}`)

    // 1. Load connection and verify signature
    const connection = await this.prisma.connection.findUnique({
      where: { webhookId },
    })

    if (!connection) {
      throw new NotFoundException('Connection not found')
    }

    if (connection.type !== 'github') {
      throw new BadRequestException('Connection is not a GitHub connection')
    }

    if (!connection.webhookSecret) {
      throw new BadRequestException('Connection has no webhook secret configured')
    }

    if (!connection.enabled) {
      this.logger.warn(`Webhook received for disabled connection ${connection.id}`)
      return { success: true, message: 'Connection is disabled' }
    }

    // Verify signature using raw body
    const rawBody = req.rawBody || Buffer.from(JSON.stringify(payload))
    this.verification.verifyGitHubSignature(rawBody, signature, connection.webhookSecret)

    // 2. Transform webhook → ProcessorEvent
    if (!eventType) {
      throw new BadRequestException('Missing X-GitHub-Event header')
    }

    const event = this.githubTransformer.transform(payload, eventType, connection.id)

    if (!event) {
      this.logger.debug(`Skipping unsupported GitHub event type: ${eventType}`)
      return { success: true, message: 'Event type not supported' }
    }

    // 3. Call eventsService.processEvent(event)
    const result = await this.eventsService.processEvent(event)

    // 4. Update connection.lastWebhook
    await this.prisma.connection.update({
      where: { id: connection.id },
      data: { lastWebhook: new Date() },
    })

    this.logger.log(
      `GitHub webhook processed: connectionId=${connection.id}, eventId=${result.eventId}, duplicate=${result.duplicate}`
    )

    // 5. Return 200 OK
    return {
      success: true,
      eventId: result.eventId,
      duplicate: result.duplicate,
    }
  }

  @Post('gitlab/:webhookId')
  @HttpCode(HttpStatus.OK)
  async handleGitLab(
    @Param('webhookId') webhookId: string,
    @Headers('x-gitlab-token') token: string | undefined,
    @Headers('x-gitlab-event') eventType: string | undefined,
    @Body() payload: any
  ) {
    this.logger.log(`Received GitLab ${eventType} webhook for webhookId ${webhookId}`)

    // 1. Load connection and verify token
    const connection = await this.prisma.connection.findUnique({
      where: { webhookId },
    })

    if (!connection) {
      throw new NotFoundException('Connection not found')
    }

    if (connection.type !== 'gitlab') {
      throw new BadRequestException('Connection is not a GitLab connection')
    }

    if (!connection.webhookSecret) {
      throw new BadRequestException('Connection has no webhook secret configured')
    }

    if (!connection.enabled) {
      this.logger.warn(`Webhook received for disabled connection ${connection.id}`)
      return { success: true, message: 'Connection is disabled' }
    }

    // Verify token
    this.verification.verifyGitLabToken(token, connection.webhookSecret)

    // 2. Transform webhook → ProcessorEvent
    if (!eventType) {
      throw new BadRequestException('Missing X-Gitlab-Event header')
    }

    const event = this.gitlabTransformer.transform(payload, eventType, connection.id)

    if (!event) {
      this.logger.debug(`Skipping unsupported GitLab event type: ${eventType}`)
      return { success: true, message: 'Event type not supported' }
    }

    // 3. Call eventsService.processEvent(event)
    const result = await this.eventsService.processEvent(event)

    // 4. Update connection.lastWebhook
    await this.prisma.connection.update({
      where: { id: connection.id },
      data: { lastWebhook: new Date() },
    })

    this.logger.log(
      `GitLab webhook processed: connectionId=${connection.id}, eventId=${result.eventId}, duplicate=${result.duplicate}`
    )

    // 5. Return 200 OK
    return {
      success: true,
      eventId: result.eventId,
      duplicate: result.duplicate,
    }
  }
}
