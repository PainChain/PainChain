import { loadConnectorMetadata } from './connectorMetadata'

// Build default field visibility from connector metadata
let DEFAULT_FIELD_VISIBILITY = {
  PR: {
    branches: true,
    changes: true,
    reviewers: true,
    approvals: true,
    changes_requested: true,
    comments: true,
    merged: true,
    files_changed: true
  },
  MR: {
    branches: true,
    approved_by: true,
    approvals: true,
    comments: true,
    votes: true,
    merged: true,
    files_changed: true
  },
  Workflow: {
    status: true,
    duration: true,
    branch: true,
    commit: true,
    trigger: true,
    run_number: true,
    failed_jobs: true,
    failed_jobs_detail: true,
    logs: true
  },
  Pipeline: {
    status: true,
    duration: true,
    ref: true,
    commit: true,
    source: true,
    pipeline_id: true,
    failed_jobs: true,
    failed_jobs_detail: true,
    logs: true
  },
  Commit: {
    branch: true,
    sha: true,
    changes: true,
    files_changed: true
  },
  Release: {
    tag: true,
    prerelease: true,
    draft: true,
    assets: true
  },
  Image: {
    registry: true,
    image: true,
    size: true,
    digest: true,
    package: true,
    repository: true,
    tags: true
  },
  K8sDeployment: {
    namespace: true,
    cluster: true,
    replicas: true,
    strategy: true,
    images: true
  },
  K8sStatefulSet: {
    namespace: true,
    cluster: true,
    replicas: true,
    service_name: true,
    images: true
  },
  K8sDaemonSet: {
    namespace: true,
    cluster: true,
    scheduled: true,
    images: true
  },
  K8sService: {
    namespace: true,
    cluster: true,
    type: true,
    cluster_ip: true,
    ports: true
  },
  K8sConfigMap: {
    namespace: true,
    cluster: true,
    num_keys: true,
    keys: true
  },
  K8sSecret: {
    namespace: true,
    cluster: true,
    type: true,
    num_keys: true,
    keys: true
  },
  K8sIngress: {
    namespace: true,
    cluster: true,
    ingress_class: true,
    hosts: true
  },
  ConnectorCreated: {
    connector_name: true,
    connector_type: true,
    action: true
  },
  ConnectorUpdated: {
    connector_name: true,
    connector_type: true,
    changes: true,
    action: true
  },
  ConnectorDeleted: {
    connector_name: true,
    connector_type: true,
    action: true
  },
  ConnectorEnabled: {
    connector_name: true,
    connector_type: true,
    action: true
  },
  ConnectorDisabled: {
    connector_name: true,
    connector_type: true,
    action: true
  },
  ConfigChanged: {
    connector_name: true,
    field: true,
    old_value: true,
    new_value: true,
    action: true
  },
  FieldVisibilityChanged: {
    event_type: true,
    field: true,
    visible: true,
    action: true
  }
}

const STORAGE_KEY = 'painchain_field_visibility'

// Load defaults from connector metadata (async)
let metadataLoaded = false
export const loadFieldVisibilityDefaults = async () => {
  if (metadataLoaded) return

  try {
    const metadata = await loadConnectorMetadata()
    const newDefaults = {}
    const newLabels = {}
    const newNames = {}

    // Merge eventTypes from all connectors
    metadata.forEach(connector => {
      if (connector.eventTypes) {
        Object.entries(connector.eventTypes).forEach(([eventType, config]) => {
          newDefaults[eventType] = {}
          newLabels[eventType] = {}

          // Parse new fields format: { fieldKey: { defaultVisibility, fieldLabel } }
          if (config.fields) {
            Object.entries(config.fields).forEach(([fieldKey, fieldConfig]) => {
              newDefaults[eventType][fieldKey] = fieldConfig.defaultVisibility ?? true
              newLabels[eventType][fieldKey] = fieldConfig.fieldLabel || fieldKey
            })
          }

          newNames[eventType] = config.displayName || eventType
        })
      }
    })

    // Update global variables
    DEFAULT_FIELD_VISIBILITY = newDefaults
    Object.assign(FIELD_LABELS, newLabels)
    Object.assign(EVENT_TYPE_NAMES, newNames)

    metadataLoaded = true
  } catch (error) {
    console.error('Error loading field visibility defaults from metadata:', error)
  }
}

export const getFieldVisibility = () => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      return JSON.parse(stored)
    }
  } catch (error) {
    console.error('Error loading field visibility:', error)
  }
  return DEFAULT_FIELD_VISIBILITY
}

export const setFieldVisibility = (visibility) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(visibility))
  } catch (error) {
    console.error('Error saving field visibility:', error)
  }
}

export const isFieldVisible = (eventType, fieldKey) => {
  const visibility = getFieldVisibility()
  return visibility[eventType]?.[fieldKey] !== false
}

export const toggleField = (eventType, fieldKey) => {
  const visibility = getFieldVisibility()

  // Create a new object to avoid mutating state
  const newVisibility = {
    ...visibility,
    [eventType]: {
      ...(visibility[eventType] || {}),
      [fieldKey]: !(visibility[eventType]?.[fieldKey] ?? true)
    }
  }

  setFieldVisibility(newVisibility)
  return newVisibility
}

export const resetToDefaults = () => {
  setFieldVisibility(DEFAULT_FIELD_VISIBILITY)
  return DEFAULT_FIELD_VISIBILITY
}

// Human-readable field labels
export const FIELD_LABELS = {
  PR: {
    branches: 'Branch Information',
    changes: 'Code Changes',
    reviewers: 'Reviewers',
    approvals: 'Approval Count',
    changes_requested: 'Changes Requested',
    comments: 'Comment Counts',
    merged: 'Merge Status',
    files_changed: 'Files Changed List'
  },
  MR: {
    branches: 'Branch Information',
    approved_by: 'Approved By',
    approvals: 'Approval Count',
    comments: 'Comments Count',
    votes: 'Votes (Up/Down)',
    merged: 'Merge Status',
    files_changed: 'Files Changed List'
  },
  Workflow: {
    status: 'Status',
    duration: 'Duration',
    branch: 'Branch',
    commit: 'Commit SHA',
    trigger: 'Trigger Event',
    run_number: 'Run Number',
    failed_jobs: 'Failed Jobs Count',
    failed_jobs_detail: 'Failed Jobs Details',
    logs: 'View Logs Link'
  },
  Pipeline: {
    status: 'Status',
    duration: 'Duration',
    ref: 'Reference',
    commit: 'Commit SHA',
    source: 'Source',
    pipeline_id: 'Pipeline ID',
    failed_jobs: 'Failed Jobs Count',
    failed_jobs_detail: 'Failed Jobs Details',
    logs: 'View Logs Link'
  },
  Commit: {
    branch: 'Branch',
    sha: 'Commit SHA',
    changes: 'Code Changes',
    files_changed: 'Files Changed List'
  },
  Release: {
    tag: 'Tag Name',
    prerelease: 'Pre-release Flag',
    draft: 'Draft Flag',
    assets: 'Release Assets'
  },
  Image: {
    registry: 'Registry',
    image: 'Image Path',
    size: 'Image Size',
    digest: 'Digest (SHA)',
    package: 'Package Name',
    repository: 'Repository',
    tags: 'Image Tags'
  },
  K8sDeployment: {
    namespace: 'Namespace',
    cluster: 'Cluster',
    replicas: 'Replicas Status',
    strategy: 'Deployment Strategy',
    images: 'Container Images'
  },
  K8sStatefulSet: {
    namespace: 'Namespace',
    cluster: 'Cluster',
    replicas: 'Replicas Status',
    service_name: 'Service Name',
    images: 'Container Images'
  },
  K8sDaemonSet: {
    namespace: 'Namespace',
    cluster: 'Cluster',
    scheduled: 'Pods Status',
    images: 'Container Images'
  },
  K8sService: {
    namespace: 'Namespace',
    cluster: 'Cluster',
    type: 'Service Type',
    cluster_ip: 'Cluster IP',
    ports: 'Ports'
  },
  K8sConfigMap: {
    namespace: 'Namespace',
    cluster: 'Cluster',
    num_keys: 'Number of Keys',
    keys: 'Keys List'
  },
  K8sSecret: {
    namespace: 'Namespace',
    cluster: 'Cluster',
    type: 'Secret Type',
    num_keys: 'Number of Keys',
    keys: 'Keys List'
  },
  K8sIngress: {
    namespace: 'Namespace',
    cluster: 'Cluster',
    ingress_class: 'Ingress Class',
    hosts: 'Hosts'
  },
  ConnectorCreated: {
    connector_name: 'Connector Name',
    connector_type: 'Connector Type',
    action: 'Action'
  },
  ConnectorUpdated: {
    connector_name: 'Connector Name',
    connector_type: 'Connector Type',
    changes: 'Changes Made',
    action: 'Action'
  },
  ConnectorDeleted: {
    connector_name: 'Connector Name',
    connector_type: 'Connector Type',
    action: 'Action'
  },
  ConnectorEnabled: {
    connector_name: 'Connector Name',
    connector_type: 'Connector Type',
    action: 'Action'
  },
  ConnectorDisabled: {
    connector_name: 'Connector Name',
    connector_type: 'Connector Type',
    action: 'Action'
  },
  ConfigChanged: {
    connector_name: 'Connector Name',
    field: 'Field Changed',
    old_value: 'Old Value',
    new_value: 'New Value',
    action: 'Action'
  },
  FieldVisibilityChanged: {
    event_type: 'Event Type',
    field: 'Field',
    visible: 'Visible',
    action: 'Action'
  }
}

export const EVENT_TYPE_NAMES = {
  PR: 'Pull Requests (GitHub)',
  MR: 'Merge Requests (GitLab)',
  Workflow: 'Workflows (GitHub Actions)',
  Pipeline: 'Pipelines (GitLab CI)',
  Commit: 'Commits',
  Release: 'Releases',
  Image: 'Container Images (Registry)',
  K8sDeployment: 'Kubernetes Deployments',
  K8sStatefulSet: 'Kubernetes StatefulSets',
  K8sDaemonSet: 'Kubernetes DaemonSets',
  K8sService: 'Kubernetes Services',
  K8sConfigMap: 'Kubernetes ConfigMaps',
  K8sSecret: 'Kubernetes Secrets',
  K8sIngress: 'Kubernetes Ingresses',
  K8sHelmRelease: 'Helm Releases',
  K8sPod: 'Kubernetes Pods',
  K8sRole: 'Kubernetes Roles',
  K8sRoleBinding: 'Kubernetes RoleBindings',
  K8sEvent: 'Kubernetes Events',
  ConnectorCreated: 'Connector Created (PainChain)',
  ConnectorUpdated: 'Connector Updated (PainChain)',
  ConnectorDeleted: 'Connector Deleted (PainChain)',
  ConnectorEnabled: 'Connector Enabled (PainChain)',
  ConnectorDisabled: 'Connector Disabled (PainChain)',
  ConfigChanged: 'Config Changed (PainChain)',
  FieldVisibilityChanged: 'Field Visibility Changed (PainChain)'
}
