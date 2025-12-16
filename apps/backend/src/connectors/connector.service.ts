import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { readdirSync, existsSync, statSync } from 'fs'
import { join } from 'path'
import { ConnectorMetadata } from '@painchain/types'
import { BaseConnector } from './base.connector'
import { PrismaService } from '../database/prisma.service'

/**
 * Connector Service
 *
 * Automatically discovers and manages connector plugins.
 * Each connector lives in its own directory under src/connectors/
 * and is auto-discovered on application startup.
 */
@Injectable()
export class ConnectorService implements OnModuleInit {
  private readonly logger = new Logger(ConnectorService.name)
  private connectors = new Map<string, any>()
  private metadata = new Map<string, ConnectorMetadata>()

  constructor(private prisma: PrismaService) {}

  /**
   * Initialize: Auto-discover all connectors on module startup
   */
  async onModuleInit() {
    await this.discoverConnectors()
  }

  /**
   * Auto-discover all connectors by scanning the connectors directory
   *
   * Looks for directories containing:
   * - {name}.connector.ts file
   * - metadata.json file
   * - logo.png file (optional)
   */
  async discoverConnectors(): Promise<void> {
    const connectorsDir = join(__dirname)
    this.logger.log(`Discovering connectors in: ${connectorsDir}`)

    try {
      const entries = readdirSync(connectorsDir, { withFileTypes: true })

      for (const entry of entries) {
        if (!entry.isDirectory()) continue

        const connectorName = entry.name
        const connectorPath = join(connectorsDir, connectorName)

        // Check if this is a valid connector directory
        const connectorFile = join(connectorPath, `${connectorName}.connector`)
        const metadataFile = join(connectorPath, 'metadata.json')

        const hasConnectorFile =
          existsSync(`${connectorFile}.ts`) ||
          existsSync(`${connectorFile}.js`)

        const hasMetadata = existsSync(metadataFile)

        if (hasConnectorFile && hasMetadata) {
          try {
            // Dynamically import the connector class
            const module = await import(connectorFile)

            // Convention: Class name is {Name}Connector
            const className = this.capitalize(connectorName) + 'Connector'
            const ConnectorClass = module[className]

            if (!ConnectorClass) {
              this.logger.warn(
                `⚠️  Connector ${connectorName}: No export named ${className}`
              )
              continue
            }

            // Load metadata
            const metadata = BaseConnector.getMetadata(connectorPath)

            // Validate connector implements required methods
            if (!this.isValidConnector(ConnectorClass)) {
              this.logger.warn(
                `⚠️  Connector ${connectorName}: Does not implement IConnector interface`
              )
              continue
            }

            // Register connector
            this.connectors.set(connectorName, ConnectorClass)
            this.metadata.set(connectorName, metadata)

            this.logger.log(`✅ Discovered connector: ${connectorName}`)
          } catch (error) {
            this.logger.error(
              `❌ Failed to load connector ${connectorName}:`,
              error.message
            )
          }
        }
      }

      this.logger.log(`🎉 Discovered ${this.connectors.size} connectors`)
    } catch (error) {
      this.logger.error('Failed to discover connectors:', error)
    }
  }

  /**
   * Get all connector metadata (for /api/connectors/metadata endpoint)
   */
  getAllMetadata(): ConnectorMetadata[] {
    return Array.from(this.metadata.values())
  }

  /**
   * Get metadata for a specific connector type
   */
  getMetadata(type: string): ConnectorMetadata | undefined {
    return this.metadata.get(type)
  }

  /**
   * Get list of available connector types
   */
  getAvailableTypes(): string[] {
    return Array.from(this.connectors.keys())
  }

  /**
   * Create a connector instance
   *
   * @param type Connector type (e.g., 'github', 'kubernetes')
   * @param config Configuration for the connector
   * @returns Instantiated connector
   */
  createConnector(type: string, config: Record<string, any>): BaseConnector {
    const ConnectorClass = this.connectors.get(type)

    if (!ConnectorClass) {
      throw new Error(`Connector type "${type}" not found. Available types: ${this.getAvailableTypes().join(', ')}`)
    }

    return new ConnectorClass(config, this.prisma)
  }

  /**
   * Test a connection without saving it
   */
  async testConnection(type: string, config: Record<string, any>): Promise<boolean> {
    const connector = this.createConnector(type, config)
    return await connector.testConnection()
  }

  /**
   * Check if a connector class implements the required interface
   */
  private isValidConnector(ConnectorClass: any): boolean {
    const instance = new ConnectorClass({}, this.prisma)
    return (
      typeof instance.testConnection === 'function' &&
      typeof instance.sync === 'function'
    )
  }

  /**
   * Capitalize first letter of string
   */
  private capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1)
  }
}
