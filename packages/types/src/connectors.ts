/**
 * Connector types and interfaces
 */

export interface Connection {
  id: number
  name: string
  type: string
  config: Record<string, any>
  enabled: boolean
  lastSync: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface ConnectorMetadata {
  id: string
  displayName: string
  color: string
  logo: string
  description: string
  connectionForm: ConnectionForm
  eventTypes: Record<string, EventTypeConfig>
}

export interface ConnectionForm {
  fields: FormField[]
}

export interface FormField {
  key: string
  label: string
  type: 'text' | 'password' | 'number' | 'checkbox'
  placeholder?: string
  default?: string | number | boolean
  required: boolean
  help?: string
  min?: number
  max?: number
  conditionalOn?: string
}

export interface EventTypeConfig {
  displayName: string
  fields: Record<string, FieldConfig>
}

export interface FieldConfig {
  defaultVisibility: boolean
  fieldLabel: string
}

/**
 * Base interface that all connectors must implement
 */
export interface IConnector {
  /**
   * Test if the connection credentials are valid
   */
  testConnection(): Promise<boolean>

  /**
   * Sync events from the external service
   * @param connectionId Database ID of this connection
   * @returns Statistics about the sync operation
   */
  sync(connectionId: number): Promise<SyncResult>
}

export interface SyncResult {
  success: boolean
  eventsStored: number
  errors?: string[]
  details?: Record<string, any>
}

export interface ConnectorConfig {
  [key: string]: any
}

/**
 * DTOs for API requests/responses
 */
export interface CreateConnectionDto {
  name: string
  type: string
  config: Record<string, any>
  enabled?: boolean
}

export interface UpdateConnectionDto {
  name?: string
  config?: Record<string, any>
  enabled?: boolean
}

export interface TestConnectionDto {
  type: string
  config: Record<string, any>
}
