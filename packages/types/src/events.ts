/**
 * Core event types for PainChain
 */

export interface ChangeEvent {
  id: number
  connectionId: number
  externalId: string | null
  source: string
  eventType: EventType
  title: string
  description: string | null
  timestamp: Date
  url: string | null
  status: string | null
  metadata: Record<string, any>
  eventMetadata: Record<string, any>
  createdAt: Date
  updatedAt: Date
}

export type EventType =
  // GitHub
  | 'PR'
  | 'Workflow'
  | 'Commit'
  | 'Release'
  | 'Image'
  // GitLab
  | 'MR'
  | 'Pipeline'
  // Kubernetes
  | 'K8sDeployment'
  | 'K8sStatefulSet'
  | 'K8sDaemonSet'
  | 'K8sService'
  | 'K8sConfigMap'
  | 'K8sSecret'
  | 'K8sIngress'
  | 'K8sPod'
  | 'K8sRole'
  | 'K8sRoleBinding'
  | 'K8sHelmRelease'
  | 'K8sEvent'
  // PainChain internal
  | 'ConnectorCreated'
  | 'ConnectorUpdated'
  | 'ConnectorDeleted'
  | 'ConnectorEnabled'
  | 'ConnectorDisabled'
  | 'ConfigChanged'
  | 'FieldVisibilityChanged'

export interface CreateChangeEventDto {
  connectionId: number
  externalId?: string
  source: string
  eventType: EventType
  title: string
  description?: string
  timestamp: Date
  url?: string
  status?: string
  metadata?: Record<string, any>
  eventMetadata?: Record<string, any>
}
