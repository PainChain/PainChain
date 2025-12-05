// Default field visibility configuration
// All fields are visible by default
const DEFAULT_FIELD_VISIBILITY = {
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
    failed_jobs_detail: true
  },
  Pipeline: {
    status: true,
    duration: true,
    ref: true,
    commit: true,
    source: true,
    pipeline_id: true,
    failed_jobs: true,
    failed_jobs_detail: true
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
  }
}

const STORAGE_KEY = 'painchain_field_visibility'

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
    failed_jobs_detail: 'Failed Jobs Details'
  },
  Pipeline: {
    status: 'Status',
    duration: 'Duration',
    ref: 'Reference',
    commit: 'Commit SHA',
    source: 'Source',
    pipeline_id: 'Pipeline ID',
    failed_jobs: 'Failed Jobs Count',
    failed_jobs_detail: 'Failed Jobs Details'
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
  }
}

export const EVENT_TYPE_NAMES = {
  PR: 'Pull Requests (GitHub)',
  MR: 'Merge Requests (GitLab)',
  Workflow: 'Workflows (GitHub Actions)',
  Pipeline: 'Pipelines (GitLab CI)',
  Commit: 'Commits',
  Release: 'Releases',
  K8sDeployment: 'Kubernetes Deployments',
  K8sStatefulSet: 'Kubernetes StatefulSets',
  K8sDaemonSet: 'Kubernetes DaemonSets',
  K8sService: 'Kubernetes Services',
  K8sConfigMap: 'Kubernetes ConfigMaps',
  K8sSecret: 'Kubernetes Secrets',
  K8sIngress: 'Kubernetes Ingresses'
}
