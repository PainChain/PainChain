import { Injectable } from '@nestjs/common'
import { BaseConnector } from '../base.connector'
import { SyncResult, CreateChangeEventDto } from '@painchain/types'
import { PrismaService } from '../../database/prisma.service'

/**
 * PainChain Internal Connector
 *
 * This connector tracks PainChain's own configuration changes:
 * - Connector creation/updates/deletion
 * - Connection enable/disable events
 * - Configuration changes
 * - Field visibility changes
 *
 * Unlike other connectors, this one doesn't poll external APIs.
 * Instead, it's triggered directly from the application code when
 * configuration changes occur.
 */
@Injectable()
export class PainchainConnector extends BaseConnector {
  constructor(
    config: Record<string, any>,
    private prisma: PrismaService
  ) {
    super(config)
  }

  /**
   * Test connection - Always succeeds since it's internal
   */
  async testConnection(): Promise<boolean> {
    return true
  }

  /**
   * Sync is not applicable for PainChain connector
   * Events are created directly from application code
   */
  async sync(connectionId: number): Promise<SyncResult> {
    // No polling needed - events are pushed, not pulled
    return {
      success: true,
      eventsStored: 0,
      details: {
        message: 'PainChain connector does not poll - events are created directly'
      }
    }
  }

  /**
   * Log a connector creation event
   */
  async logConnectorCreated(
    connectionId: number,
    connectorName: string,
    connectorType: string
  ): Promise<void> {
    await this.createEvent(connectionId, {
      eventType: 'ConnectorCreated',
      title: `[Connector Created] ${connectorName}`,
      description: `New ${connectorType} connector was created`,
      metadata: {
        action: 'create'
      },
      eventMetadata: {
        connector_name: connectorName,
        connector_type: connectorType
      }
    })
  }

  /**
   * Log a connector update event
   */
  async logConnectorUpdated(
    connectionId: number,
    connectorName: string,
    connectorType: string,
    changes: Record<string, any>
  ): Promise<void> {
    await this.createEvent(connectionId, {
      eventType: 'ConnectorUpdated',
      title: `[Connector Updated] ${connectorName}`,
      description: `${connectorType} connector configuration was updated`,
      metadata: {
        action: 'update',
        changes
      },
      eventMetadata: {
        connector_name: connectorName,
        connector_type: connectorType,
        changes
      }
    })
  }

  /**
   * Log a connector deletion event
   */
  async logConnectorDeleted(
    connectionId: number,
    connectorName: string,
    connectorType: string
  ): Promise<void> {
    await this.createEvent(connectionId, {
      eventType: 'ConnectorDeleted',
      title: `[Connector Deleted] ${connectorName}`,
      description: `${connectorType} connector was deleted`,
      metadata: {
        action: 'delete'
      },
      eventMetadata: {
        connector_name: connectorName,
        connector_type: connectorType
      }
    })
  }

  /**
   * Log a connector enable event
   */
  async logConnectorEnabled(
    connectionId: number,
    connectorName: string,
    connectorType: string
  ): Promise<void> {
    await this.createEvent(connectionId, {
      eventType: 'ConnectorEnabled',
      title: `[Connector Enabled] ${connectorName}`,
      description: `${connectorType} connector was enabled`,
      metadata: {
        action: 'enable'
      },
      eventMetadata: {
        connector_name: connectorName,
        connector_type: connectorType
      }
    })
  }

  /**
   * Log a connector disable event
   */
  async logConnectorDisabled(
    connectionId: number,
    connectorName: string,
    connectorType: string
  ): Promise<void> {
    await this.createEvent(connectionId, {
      eventType: 'ConnectorDisabled',
      title: `[Connector Disabled] ${connectorName}`,
      description: `${connectorType} connector was disabled`,
      metadata: {
        action: 'disable'
      },
      eventMetadata: {
        connector_name: connectorName,
        connector_type: connectorType
      }
    })
  }

  /**
   * Log a configuration change event
   */
  async logConfigChanged(
    connectionId: number,
    connectorName: string,
    field: string,
    oldValue: any,
    newValue: any
  ): Promise<void> {
    await this.createEvent(connectionId, {
      eventType: 'ConfigChanged',
      title: `[Config Changed] ${connectorName} - ${field}`,
      description: `Configuration field "${field}" was changed`,
      metadata: {
        action: 'config_change'
      },
      eventMetadata: {
        connector_name: connectorName,
        field,
        old_value: oldValue,
        new_value: newValue
      }
    })
  }

  /**
   * Log a field visibility change event
   */
  async logFieldVisibilityChanged(
    connectionId: number,
    eventType: string,
    field: string,
    visible: boolean
  ): Promise<void> {
    await this.createEvent(connectionId, {
      eventType: 'FieldVisibilityChanged',
      title: `[Field Visibility Changed] ${eventType}.${field}`,
      description: `Field visibility changed to ${visible ? 'visible' : 'hidden'}`,
      metadata: {
        action: 'field_visibility_change'
      },
      eventMetadata: {
        event_type: eventType,
        field,
        visible
      }
    })
  }

  /**
   * Helper method to create an event
   */
  private async createEvent(
    connectionId: number,
    eventData: Partial<CreateChangeEventDto>
  ): Promise<void> {
    await this.prisma.changeEvent.create({
      data: {
        connectionId,
        source: 'painchain',
        timestamp: new Date(),
        metadata: {},
        eventMetadata: {},
        ...eventData,
      } as any
    })
  }
}
