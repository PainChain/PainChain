import { IConnector, ConnectorMetadata, SyncResult } from '@painchain/types'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * Base connector class that all connectors must extend
 *
 * Provides common functionality like metadata loading and
 * enforces the IConnector interface.
 */
export abstract class BaseConnector implements IConnector {
  constructor(protected config: Record<string, any>) {}

  /**
   * Test if the connection credentials are valid
   * Must be implemented by each connector
   */
  abstract testConnection(): Promise<boolean>

  /**
   * Sync events from the external service
   * Must be implemented by each connector
   *
   * @param connectionId Database ID of this connection
   * @returns Statistics about the sync operation
   */
  abstract sync(connectionId: number): Promise<SyncResult>

  /**
   * Get metadata for this connector type
   * Reads metadata.json from the connector's directory
   *
   * This is a static method that can be called without instantiating
   * the connector class.
   */
  static getMetadata(connectorPath: string): ConnectorMetadata {
    try {
      const metadataPath = join(connectorPath, 'metadata.json')
      const metadataContent = readFileSync(metadataPath, 'utf-8')
      return JSON.parse(metadataContent)
    } catch (error) {
      throw new Error(`Failed to load metadata from ${connectorPath}: ${error.message}`)
    }
  }

  /**
   * Helper method to get logo path
   */
  static getLogoPath(connectorPath: string): string {
    return join(connectorPath, 'logo.png')
  }
}
