import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import githubLogo from '../assets/logos/github.png'
import gitlabLogo from '../assets/logos/gitlab.png'
import kubernetesLogo from '../assets/logos/kubernetes.png'
import DateTimePicker from '../components/DateTimePicker'
import TagsDropdown from '../components/TagsDropdown'
import { isFieldVisible } from '../utils/fieldVisibility'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const connectorLogos = {
  github: githubLogo,
  gitlab: gitlabLogo,
  kubernetes: kubernetesLogo,
}

/**
 * Extensible event type configuration
 *
 * To add a new event type (e.g., Kubernetes Deployment, Terraform, MR):
 *
 * 1. Add a new entry to EVENT_TYPE_CONFIG with:
 *    - titleMatch: String to identify this event type in the title
 *    - sections: Array of section objects, each with:
 *      - title: Section heading
 *      - fields: Array of field objects with:
 *        - key: Unique identifier
 *        - label: Display label
 *        - value: Function that extracts/formats the value from event
 *      - lists: (Optional) Array of list objects for collections like files, with:
 *        - key: Unique identifier
 *        - title: List heading
 *        - getValue: Function to extract array from event
 *        - maxVisible: (Optional) Max items before "...and N more"
 *        - renderItem: (Optional) Custom render function for each item
 *
 * Example for Kubernetes Deployment:
 * 'K8sDeployment': {
 *   titleMatch: '[K8s Deploy]',
 *   sections: [{
 *     title: 'Deployment Details',
 *     fields: [
 *       { key: 'namespace', label: 'Namespace', value: (e) => e.metadata?.namespace },
 *       { key: 'replicas', label: 'Replicas', value: (e) => `${e.metadata?.desired} desired, ${e.metadata?.ready} ready` }
 *     ],
 *     lists: [{
 *       key: 'containers',
 *       title: 'Containers',
 *       getValue: (e) => e.description?.containers,
 *       renderItem: (c, i) => <div key={i}>{c.name}:{c.image}</div>
 *     }]
 *   }]
 * }
 */
const EVENT_TYPE_CONFIG = {
  'PR': {
    titleMatch: '[PR]',
    sections: [
      {
        title: 'Pull Request Details',
        fields: [
          {
            key: 'branches',
            label: 'Branch',
            value: (event) => event.metadata?.head_branch && event.metadata?.base_branch
              ? `${event.metadata.head_branch} → ${event.metadata.base_branch}`
              : null
          },
          {
            key: 'changes',
            label: 'Changes',
            value: (event) => {
              const { additions, deletions, changed_files } = event.metadata || {}
              if (additions === undefined) return null
              return {
                type: 'html',
                content: (
                  <>
                    <span style={{ color: '#3fb950' }}>+{additions}</span>
                    {' / '}
                    <span style={{ color: '#f85149' }}>-{deletions}</span>
                    {' in '}{changed_files} {changed_files === 1 ? 'file' : 'files'}
                  </>
                )
              }
            }
          },
          {
            key: 'reviewers',
            label: 'Reviewers',
            value: (event) => event.metadata?.reviewers?.length > 0
              ? event.metadata.reviewers.join(', ')
              : null
          },
          {
            key: 'approvals',
            label: 'Approvals',
            value: (event) => event.metadata?.approved_count > 0
              ? { type: 'html', content: <span style={{ color: '#3fb950' }}>✓ {event.metadata.approved_count}</span> }
              : null
          },
          {
            key: 'changes_requested',
            label: 'Changes Requested',
            value: (event) => event.metadata?.changes_requested_count > 0
              ? { type: 'html', content: <span style={{ color: '#f85149' }}>{event.metadata.changes_requested_count}</span> }
              : null
          },
          {
            key: 'comments',
            label: 'Comments',
            value: (event) => (event.metadata?.comments > 0 || event.metadata?.review_comments > 0)
              ? `${event.metadata.comments} general, ${event.metadata.review_comments} review`
              : null
          },
          {
            key: 'merged',
            label: 'Status',
            value: (event) => event.metadata?.merged !== undefined
              ? { type: 'html', content: <span style={{ color: event.metadata.merged ? '#a371f7' : '#808080' }}>{event.metadata.merged ? '✓ Merged' : 'Not merged'}</span> }
              : null
          }
        ],
        lists: [
          {
            key: 'files_changed',
            title: 'Files Changed',
            getValue: (event) => event.description?.files_changed,
            maxVisible: 10
          }
        ]
      }
    ]
  },
  'Workflow': {
    titleMatch: '[Workflow]',
    sections: [
      {
        title: 'Workflow Details',
        fields: [
          {
            key: 'status',
            label: 'Status',
            value: (event) => {
              const conclusion = event.metadata?.conclusion
              if (!conclusion) return null
              const color = conclusion === 'success' ? '#3fb950' : conclusion === 'failure' ? '#f85149' : '#808080'
              const icon = conclusion === 'success' ? '✓ ' : conclusion === 'failure' ? '✗ ' : ''
              return { type: 'html', content: <span style={{ color }}>{icon}{conclusion}</span> }
            }
          },
          {
            key: 'duration',
            label: 'Duration',
            value: (event) => {
              const seconds = event.metadata?.duration_seconds
              if (seconds === undefined) return null
              const mins = Math.floor(seconds / 60)
              const secs = Math.floor(seconds % 60)
              return `${mins}m ${secs}s`
            }
          },
          {
            key: 'branch',
            label: 'Branch',
            value: (event) => event.metadata?.branch || null
          },
          {
            key: 'commit',
            label: 'Commit',
            value: (event) => event.metadata?.commit_sha || null
          },
          {
            key: 'trigger',
            label: 'Triggered by',
            value: (event) => event.metadata?.event || null
          },
          {
            key: 'run_number',
            label: 'Run',
            value: (event) => event.metadata?.run_number ? `#${event.metadata.run_number}` : null
          },
          {
            key: 'failed_jobs',
            label: 'Failed Jobs',
            value: (event) => event.metadata?.failed_jobs_count > 0
              ? { type: 'html', content: <span style={{ color: '#f85149' }}>{event.metadata.failed_jobs_count}</span> }
              : null
          }
        ],
        lists: [
          {
            key: 'failed_jobs_detail',
            title: 'Failed Jobs',
            getValue: (event) => event.description?.failed_jobs,
            renderItem: (job, idx) => (
              <div key={idx} className="job-item">
                <span className="job-name">{job.name}</span>
                <span className="job-status" style={{ color: '#f85149' }}>{job.conclusion}</span>
              </div>
            )
          }
        ]
      }
    ]
  },
  'Commit': {
    titleMatch: '[Commit]',
    sections: [
      {
        title: 'Commit Details',
        fields: [
          {
            key: 'branch',
            label: 'Branch',
            value: (event) => event.metadata?.branch || null
          },
          {
            key: 'sha',
            label: 'SHA',
            value: (event) => event.metadata?.sha?.substring(0, 7) || null
          },
          {
            key: 'changes',
            label: 'Changes',
            value: (event) => {
              const { additions, deletions } = event.metadata || {}
              if (additions === undefined) return null
              return {
                type: 'html',
                content: (
                  <>
                    <span style={{ color: '#3fb950' }}>+{additions}</span>
                    {' / '}
                    <span style={{ color: '#f85149' }}>-{deletions}</span>
                  </>
                )
              }
            }
          }
        ],
        lists: [
          {
            key: 'files_changed',
            title: 'Files Changed',
            getValue: (event) => event.description?.files_changed,
            maxVisible: 10
          }
        ]
      }
    ]
  },
  'Release': {
    titleMatch: '[Release]',
    sections: [
      {
        title: 'Release Details',
        fields: [
          {
            key: 'tag',
            label: 'Tag',
            value: (event) => event.metadata?.tag_name || null
          },
          {
            key: 'prerelease',
            label: 'Pre-release',
            value: (event) => event.metadata?.prerelease !== undefined
              ? (event.metadata.prerelease ? 'Yes' : 'No')
              : null
          },
          {
            key: 'draft',
            label: 'Draft',
            value: (event) => event.metadata?.draft !== undefined
              ? (event.metadata.draft ? 'Yes' : 'No')
              : null
          }
        ],
        lists: [
          {
            key: 'assets',
            title: 'Assets',
            getValue: (event) => event.description?.assets,
            maxVisible: 10
          }
        ]
      }
    ]
  },
  'MR': {
    titleMatch: '[MR]',
    sections: [
      {
        title: 'Merge Request Details',
        fields: [
          {
            key: 'branches',
            label: 'Branch',
            value: (event) => event.metadata?.source_branch && event.metadata?.target_branch
              ? `${event.metadata.source_branch} → ${event.metadata.target_branch}`
              : null
          },
          {
            key: 'approved_by',
            label: 'Approved By',
            value: (event) => event.metadata?.approved_by?.length > 0
              ? event.metadata.approved_by.join(', ')
              : null
          },
          {
            key: 'approvals',
            label: 'Approvals',
            value: (event) => event.metadata?.approved_count > 0
              ? { type: 'html', content: <span style={{ color: '#3fb950' }}>✓ {event.metadata.approved_count}</span> }
              : null
          },
          {
            key: 'comments',
            label: 'Comments',
            value: (event) => event.metadata?.user_notes_count > 0
              ? event.metadata.user_notes_count
              : null
          },
          {
            key: 'votes',
            label: 'Votes',
            value: (event) => {
              const upvotes = event.metadata?.upvotes || 0
              const downvotes = event.metadata?.downvotes || 0
              if (upvotes === 0 && downvotes === 0) return null
              return {
                type: 'html',
                content: (
                  <>
                    <span style={{ color: '#3fb950' }}>👍 {upvotes}</span>
                    {' / '}
                    <span style={{ color: '#f85149' }}>👎 {downvotes}</span>
                  </>
                )
              }
            }
          },
          {
            key: 'merged',
            label: 'Status',
            value: (event) => event.metadata?.merged !== undefined
              ? { type: 'html', content: <span style={{ color: event.metadata.merged ? '#a371f7' : '#808080' }}>{event.metadata.merged ? '✓ Merged' : 'Not merged'}</span> }
              : null
          }
        ],
        lists: [
          {
            key: 'files_changed',
            title: 'Files Changed',
            getValue: (event) => event.description?.files_changed,
            maxVisible: 10
          }
        ]
      }
    ]
  },
  'Pipeline': {
    titleMatch: '[Pipeline]',
    sections: [
      {
        title: 'Pipeline Details',
        fields: [
          {
            key: 'status',
            label: 'Status',
            value: (event) => {
              const status = event.metadata?.status || event.status
              if (!status) return null
              const color = status === 'success' ? '#3fb950' : status === 'failed' ? '#f85149' : '#808080'
              const icon = status === 'success' ? '✓ ' : status === 'failed' ? '✗ ' : ''
              return { type: 'html', content: <span style={{ color }}>{icon}{status}</span> }
            }
          },
          {
            key: 'duration',
            label: 'Duration',
            value: (event) => {
              const seconds = event.metadata?.duration_seconds
              if (seconds === undefined || seconds === null) return null
              const mins = Math.floor(seconds / 60)
              const secs = Math.floor(seconds % 60)
              return `${mins}m ${secs}s`
            }
          },
          {
            key: 'ref',
            label: 'Ref',
            value: (event) => event.metadata?.ref || null
          },
          {
            key: 'commit',
            label: 'Commit',
            value: (event) => event.metadata?.sha || null
          },
          {
            key: 'source',
            label: 'Source',
            value: (event) => event.metadata?.source || null
          },
          {
            key: 'pipeline_id',
            label: 'Pipeline ID',
            value: (event) => event.metadata?.pipeline_id ? `#${event.metadata.pipeline_id}` : null
          },
          {
            key: 'failed_jobs',
            label: 'Failed Jobs',
            value: (event) => event.metadata?.failed_jobs_count > 0
              ? { type: 'html', content: <span style={{ color: '#f85149' }}>{event.metadata.failed_jobs_count}</span> }
              : null
          }
        ],
        lists: [
          {
            key: 'failed_jobs_detail',
            title: 'Failed Jobs',
            getValue: (event) => event.description?.failed_jobs,
            renderItem: (job, idx) => (
              <div key={idx} className="job-item">
                <span className="job-name">{job.name}</span>
                <span className="job-status" style={{ color: '#f85149' }}>{job.status}</span>
              </div>
            )
          }
        ]
      }
    ]
  },
  'K8sDeployment': {
    titleMatch: '[K8s Deployment]',
    sections: [
      {
        title: 'Deployment Details',
        fields: [
          {
            key: 'namespace',
            label: 'Namespace',
            value: (event) => event.metadata?.namespace || null
          },
          {
            key: 'cluster',
            label: 'Cluster',
            value: (event) => event.metadata?.cluster || null
          },
          {
            key: 'replicas',
            label: 'Replicas',
            value: (event) => {
              const replicas = event.metadata?.replicas
              const ready = event.metadata?.ready_replicas || 0
              const available = event.metadata?.available_replicas || 0
              if (replicas === undefined) return null
              const color = ready === replicas ? '#3fb950' : '#f85149'
              return {
                type: 'html',
                content: <span style={{ color }}>{ready}/{replicas} ready, {available} available</span>
              }
            }
          },
          {
            key: 'strategy',
            label: 'Strategy',
            value: (event) => event.metadata?.strategy || null
          }
        ],
        lists: [
          {
            key: 'images',
            title: 'Container Images',
            getValue: (event) => event.description?.images,
            renderItem: (image, idx) => (
              <div key={idx} className="item-entry">
                <span style={{ color: '#00E8A0', fontWeight: 600 }}>{image.name}</span>: {image.image}
              </div>
            )
          }
        ]
      }
    ]
  },
  'K8sStatefulSet': {
    titleMatch: '[K8s StatefulSet]',
    sections: [
      {
        title: 'StatefulSet Details',
        fields: [
          {
            key: 'namespace',
            label: 'Namespace',
            value: (event) => event.metadata?.namespace || null
          },
          {
            key: 'cluster',
            label: 'Cluster',
            value: (event) => event.metadata?.cluster || null
          },
          {
            key: 'replicas',
            label: 'Replicas',
            value: (event) => {
              const replicas = event.metadata?.replicas
              const ready = event.metadata?.ready_replicas || 0
              if (replicas === undefined) return null
              const color = ready === replicas ? '#3fb950' : '#f85149'
              return {
                type: 'html',
                content: <span style={{ color }}>{ready}/{replicas} ready</span>
              }
            }
          },
          {
            key: 'service_name',
            label: 'Service',
            value: (event) => event.metadata?.service_name || null
          }
        ],
        lists: [
          {
            key: 'images',
            title: 'Container Images',
            getValue: (event) => event.description?.images,
            renderItem: (image, idx) => (
              <div key={idx} className="item-entry">
                <span style={{ color: '#00E8A0', fontWeight: 600 }}>{image.name}</span>: {image.image}
              </div>
            )
          }
        ]
      }
    ]
  },
  'K8sDaemonSet': {
    titleMatch: '[K8s DaemonSet]',
    sections: [
      {
        title: 'DaemonSet Details',
        fields: [
          {
            key: 'namespace',
            label: 'Namespace',
            value: (event) => event.metadata?.namespace || null
          },
          {
            key: 'cluster',
            label: 'Cluster',
            value: (event) => event.metadata?.cluster || null
          },
          {
            key: 'scheduled',
            label: 'Pods',
            value: (event) => {
              const desired = event.metadata?.desired_scheduled || 0
              const ready = event.metadata?.number_ready || 0
              const color = ready === desired ? '#3fb950' : '#f85149'
              return {
                type: 'html',
                content: <span style={{ color }}>{ready}/{desired} ready</span>
              }
            }
          }
        ],
        lists: [
          {
            key: 'images',
            title: 'Container Images',
            getValue: (event) => event.description?.images,
            renderItem: (image, idx) => (
              <div key={idx} className="item-entry">
                <span style={{ color: '#00E8A0', fontWeight: 600 }}>{image.name}</span>: {image.image}
              </div>
            )
          }
        ]
      }
    ]
  },
  'K8sService': {
    titleMatch: '[K8s Service]',
    sections: [
      {
        title: 'Service Details',
        fields: [
          {
            key: 'namespace',
            label: 'Namespace',
            value: (event) => event.metadata?.namespace || null
          },
          {
            key: 'cluster',
            label: 'Cluster',
            value: (event) => event.metadata?.cluster || null
          },
          {
            key: 'type',
            label: 'Type',
            value: (event) => event.metadata?.type || null
          },
          {
            key: 'cluster_ip',
            label: 'Cluster IP',
            value: (event) => event.metadata?.cluster_ip || null
          }
        ],
        lists: [
          {
            key: 'ports',
            title: 'Ports',
            getValue: (event) => event.description?.ports,
            renderItem: (port, idx) => (
              <div key={idx} className="item-entry">
                {port.port} ({port.protocol}) → {port.target_port}
              </div>
            )
          }
        ]
      }
    ]
  },
  'K8sConfigMap': {
    titleMatch: '[K8s ConfigMap]',
    sections: [
      {
        title: 'ConfigMap Details',
        fields: [
          {
            key: 'namespace',
            label: 'Namespace',
            value: (event) => event.metadata?.namespace || null
          },
          {
            key: 'cluster',
            label: 'Cluster',
            value: (event) => event.metadata?.cluster || null
          },
          {
            key: 'num_keys',
            label: 'Data Keys',
            value: (event) => event.metadata?.num_keys || null
          }
        ],
        lists: [
          {
            key: 'keys',
            title: 'Keys',
            getValue: (event) => event.description?.keys,
            maxVisible: 10
          }
        ]
      }
    ]
  },
  'K8sSecret': {
    titleMatch: '[K8s Secret]',
    sections: [
      {
        title: 'Secret Details',
        fields: [
          {
            key: 'namespace',
            label: 'Namespace',
            value: (event) => event.metadata?.namespace || null
          },
          {
            key: 'cluster',
            label: 'Cluster',
            value: (event) => event.metadata?.cluster || null
          },
          {
            key: 'type',
            label: 'Type',
            value: (event) => event.metadata?.type || null
          },
          {
            key: 'num_keys',
            label: 'Data Keys',
            value: (event) => event.metadata?.num_keys || null
          }
        ],
        lists: [
          {
            key: 'keys',
            title: 'Keys',
            getValue: (event) => event.description?.keys,
            maxVisible: 10
          }
        ]
      }
    ]
  },
  'K8sIngress': {
    titleMatch: '[K8s Ingress]',
    sections: [
      {
        title: 'Ingress Details',
        fields: [
          {
            key: 'namespace',
            label: 'Namespace',
            value: (event) => event.metadata?.namespace || null
          },
          {
            key: 'cluster',
            label: 'Cluster',
            value: (event) => event.metadata?.cluster || null
          },
          {
            key: 'ingress_class',
            label: 'Ingress Class',
            value: (event) => event.metadata?.ingress_class || null
          }
        ],
        lists: [
          {
            key: 'hosts',
            title: 'Hosts',
            getValue: (event) => event.description?.hosts,
            maxVisible: 10
          }
        ]
      }
    ]
  }
}

function Dashboard() {
  const navigate = useNavigate()
  const [changes, setChanges] = useState([])
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState(null)
  const [sourceFilter, setSourceFilter] = useState('')
  const [tagFilter, setTagFilter] = useState([])

  // Set default dates to today
  const getDefaultStartDate = () => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    return today.toISOString()
  }

  const getDefaultEndDate = () => {
    const today = new Date()
    today.setHours(23, 59, 59, 999)
    return today.toISOString()
  }

  const [startDate, setStartDate] = useState(getDefaultStartDate())
  const [endDate, setEndDate] = useState(getDefaultEndDate())
  const [expandedEvents, setExpandedEvents] = useState(new Set())
  const [connectors, setConnectors] = useState([])
  const [expandedTags, setExpandedTags] = useState(new Set())
  const [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const limit = 50

  useEffect(() => {
    // Reset and fetch initial data when filters change
    setOffset(0)
    setChanges([])
    setHasMore(true)
    fetchData(true)
    fetchConnections()
    const interval = setInterval(() => fetchData(true), 30000)
    return () => clearInterval(interval)
  }, [sourceFilter, startDate, endDate, tagFilter])

  useEffect(() => {
    // Add scroll listener for infinite scroll
    const handleScroll = () => {
      if (loadingMore || !hasMore) return

      const scrollHeight = document.documentElement.scrollHeight
      const scrollTop = document.documentElement.scrollTop
      const clientHeight = document.documentElement.clientHeight

      // Load more when user is 200px from bottom
      if (scrollHeight - scrollTop - clientHeight < 200) {
        const newOffset = offset + limit
        setOffset(newOffset)
        fetchData(false, newOffset)
      }
    }

    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [loadingMore, hasMore, offset])

  const fetchData = async (reset = false, currentOffset = offset) => {
    try {
      if (reset) {
        setLoading(true)
        setOffset(0)
        currentOffset = 0
      } else {
        setLoadingMore(true)
      }

      const params = new URLSearchParams()
      if (sourceFilter) params.append('source', sourceFilter)
      if (startDate) params.append('start_date', startDate)
      if (endDate) params.append('end_date', endDate)
      // Append each selected tag separately
      tagFilter.forEach(tag => params.append('tag', tag))
      params.append('limit', limit)
      params.append('offset', currentOffset)

      const changesRes = await fetch(`${API_URL}/api/changes?${params}`)
      const changesData = await changesRes.json()

      if (reset) {
        setChanges(changesData)
      } else {
        setChanges(prev => [...prev, ...changesData])
      }

      // Check if there are more events to load
      setHasMore(changesData.length === limit)

      // Fetch stats from backend (shows total matching filters, not just loaded)
      const statsParams = new URLSearchParams()
      if (sourceFilter) statsParams.append('source', sourceFilter)
      if (startDate) statsParams.append('start_date', startDate)
      if (endDate) statsParams.append('end_date', endDate)
      // Append each selected tag separately
      tagFilter.forEach(tag => statsParams.append('tag', tag))

      const statsRes = await fetch(`${API_URL}/api/stats?${statsParams}`, {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache'
        }
      })
      const statsData = await statsRes.json()
      setStats(statsData)

      setError(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }


  const fetchConnections = async () => {
    try {
      const response = await fetch(`${API_URL}/api/connections`)
      const data = await response.json()
      setConnectors(data)  // Keep using setConnectors to avoid changing all references
    } catch (err) {
      console.error('Failed to fetch connections:', err)
    }
  }

  const getTagsForEvent = (event) => {
    // Match by connection_id first, fallback to source type for backwards compatibility
    const connector = event.connection_id
      ? connectors.find(c => c.id === event.connection_id)
      : connectors.find(c => c.type === event.source)

    if (!connector) return []

    // Get tags from connection's tags field (comma-separated)
    const tags = connector.tags || ''
    return tags
      .split(',')
      .map(tag => tag.trim())
      .filter(tag => tag.length > 0)
  }

  const getAllTags = () => {
    const tags = new Set()
    connectors.forEach(connector => {
      if (connector.tags) {
        connector.tags
          .split(',')
          .map(tag => tag.trim())
          .filter(tag => tag.length > 0)
          .forEach(tag => tags.add(tag))
      }
    })
    return Array.from(tags).sort()
  }


  const formatDate = (dateString) => {
    // Parse as UTC and convert to local timezone
    const date = new Date(dateString)
    return date.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short'
    })
  }

  const getTimeGroup = (timestamp) => {
    const now = new Date()
    const date = new Date(timestamp)
    const diffMs = now - date
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 5) {
      return 'Last 5 minutes'
    } else if (diffHours < 1) {
      return 'Last hour'
    } else if (diffDays === 0) {
      return 'Today'
    } else if (diffDays === 1) {
      return 'Yesterday'
    } else if (diffDays < 7) {
      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
      return dayNames[date.getDay()]
    } else {
      return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    }
  }

  const groupChangesByTime = (changes) => {
    const groups = []
    let currentGroup = null

    changes.forEach((change) => {
      const timeGroup = getTimeGroup(change.timestamp)

      if (!currentGroup || currentGroup.label !== timeGroup) {
        currentGroup = {
          label: timeGroup,
          changes: []
        }
        groups.push(currentGroup)
      }

      currentGroup.changes.push(change)
    })

    return groups
  }

  const toggleExpand = (eventId) => {
    setExpandedEvents(prev => {
      const newSet = new Set(prev)
      if (newSet.has(eventId)) {
        newSet.delete(eventId)
      } else {
        newSet.add(eventId)
      }
      return newSet
    })
  }

  const toggleTags = (eventId) => {
    setExpandedTags(prev => {
      const newSet = new Set(prev)
      if (newSet.has(eventId)) {
        newSet.delete(eventId)
      } else {
        newSet.add(eventId)
      }
      return newSet
    })
  }

  const navigateToConnection = (event) => {
    if (event.connection_id) {
      navigate('/settings', { state: { connectionId: event.connection_id } })
    }
  }

  const getEventTypeConfig = (event) => {
    for (const [eventType, config] of Object.entries(EVENT_TYPE_CONFIG)) {
      if (event.title?.includes(config.titleMatch)) {
        return { eventType, config }
      }
    }
    return null
  }

  const renderEnrichedData = (event) => {
    const result = getEventTypeConfig(event)
    if (!result) return null

    const { eventType, config } = result

    return (
      <div className="change-details">
        {/* Show description if available */}
        {event.description?.text && (
          <div className="enriched-section">
            <h4>Description</h4>
            <div className="description-content">
              {event.description.text}
            </div>
          </div>
        )}

        {config.sections.map((section, sectionIdx) => (
          <div key={sectionIdx} className="enriched-section">
            <h4>{section.title}</h4>

            {/* Render fields */}
            <div className="enriched-grid">
              {section.fields.map((field) => {
                // Check field visibility
                if (!isFieldVisible(eventType, field.key)) return null

                const fieldValue = field.value(event)
                if (!fieldValue) return null

                return (
                  <div key={field.key} className="enriched-item">
                    <span className="enriched-key">{field.label}:</span>
                    <span className="enriched-value">
                      {fieldValue.type === 'html' ? fieldValue.content : fieldValue}
                    </span>
                  </div>
                )
              })}
            </div>

            {/* Render lists */}
            {section.lists?.map((list) => {
              // Check list visibility
              if (!isFieldVisible(eventType, list.key)) return null

              const items = list.getValue(event)
              if (!items || items.length === 0) return null

              return (
                <div key={list.key} className="list-section">
                  <h5>{list.title} ({items.length})</h5>
                  <div className="items-list">
                    {list.renderItem ? (
                      items.map((item, idx) => list.renderItem(item, idx))
                    ) : (
                      <>
                        {items.slice(0, list.maxVisible || items.length).map((item, idx) => (
                          <div key={idx} className="item-entry">{item}</div>
                        ))}
                        {list.maxVisible && items.length > list.maxVisible && (
                          <div className="item-entry" style={{ fontStyle: 'italic', color: '#808080' }}>
                            ...and {items.length - list.maxVisible} more
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        ))}

        {/* Labels (common to all types) */}
        {event.description?.labels && event.description.labels.length > 0 && (
          <div className="labels-section">
            <h4>Labels</h4>
            <div className="labels-list">
              {event.description.labels.map((label, idx) => (
                <span key={idx} className="label-tag">{label}</span>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="content">
      {error && (
        <div className="error">
          Error: {error}
        </div>
      )}

      {stats && (
        <div className="stats">
          <div className="stat-card">
            <h3>Total Events</h3>
            <p className="stat-number">{stats.total_events}</p>
          </div>
          {Object.entries(stats.by_source).sort(([a], [b]) => a.localeCompare(b)).map(([source, count]) => (
            <div key={source} className="stat-card">
              <h3>{source}</h3>
              <p className="stat-number">{count}</p>
            </div>
          ))}
        </div>
      )}

      <div className="filters">
        <div className="filter-group">
          <label>Source:</label>
          <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}>
            <option value="">All</option>
            <option value="github">GitHub</option>
            <option value="gitlab">GitLab</option>
            <option value="kubernetes">Kubernetes</option>
          </select>
        </div>
        <DateTimePicker
          value={startDate}
          onChange={setStartDate}
          label="Start Date"
          isEndOfDay={false}
        />
        <DateTimePicker
          value={endDate}
          onChange={setEndDate}
          label="End Date"
          isEndOfDay={true}
        />
        <div className="filter-group">
          <label>Tags:</label>
          <TagsDropdown
            availableTags={getAllTags()}
            selectedTags={tagFilter}
            onChange={setTagFilter}
          />
        </div>
      </div>

      <div className="changes-list">
        {loading ? (
          <p>Loading...</p>
        ) : changes.length === 0 ? (
          <p>No changes found. Make sure connectors are running.</p>
        ) : (
          groupChangesByTime(changes).map((group, groupIndex) => (
            <div key={groupIndex} className="time-group">
              <div className="time-separator">
                <span className="time-label">{group.label}</span>
              </div>
              {group.changes.map((change) => {
                const isExpanded = expandedEvents.has(change.id)
                return (
                  <div key={change.id} className="change-card">
                    <div className="change-header">
                      <div className="change-badges">
                        {connectorLogos[change.source] && (
                          <img
                            src={connectorLogos[change.source]}
                            alt={`${change.source} logo`}
                            className="connector-logo clickable"
                            onClick={() => navigateToConnection(change)}
                            style={{ cursor: 'pointer' }}
                            title="Go to connection settings"
                          />
                        )}
                        <span className={`source-badge ${change.source}`}>{change.source}</span>
                      </div>
                      <div className="change-meta">
                        <div>By {change.author}</div>
                        <div>{formatDate(change.timestamp)}</div>
                      </div>
                    </div>
                    <h3>
                      <a href={change.url} target="_blank" rel="noopener noreferrer">
                        {change.title}
                      </a>
                    </h3>
                    {change.metadata?.repository && (
                      <div className="change-repo">
                        Repository: {change.metadata.repository}
                      </div>
                    )}

                    {isExpanded && renderEnrichedData(change)}

                    <div className="change-footer">
                      <div className="footer-left">
                        {(() => {
                          const tags = getTagsForEvent(change)
                          const tagsExpanded = expandedTags.has(change.id)
                          const maxVisibleTags = 3

                          if (tags.length === 0) return null

                          return (
                            <div className="event-tags">
                              <span className="tags-label">Tags:</span>
                              {(tagsExpanded ? tags : tags.slice(0, maxVisibleTags)).map((tag, idx) => (
                                <span key={idx} className="label-tag">{tag}</span>
                              ))}
                              {tags.length > maxVisibleTags && (
                                <button
                                  className="tags-more-btn"
                                  onClick={() => toggleTags(change.id)}
                                >
                                  {tagsExpanded ? 'less' : '...'}
                                </button>
                              )}
                            </div>
                          )
                        })()}
                      </div>
                      <div className="footer-right">
                        <div className="correlation-icon-wrapper">
                          <svg className="correlation-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
                          </svg>
                          <div className="correlation-tooltip">
                            Correlation is a Premium feature, upgrade to see how events relate.
                          </div>
                        </div>
                        <button
                          className="expand-btn"
                          onClick={() => toggleExpand(change.id)}
                          aria-label={isExpanded ? 'Collapse' : 'Expand'}
                        >
                          <svg
                            className={`expand-icon ${isExpanded ? 'expanded' : ''}`}
                            width="20"
                            height="20"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                          >
                            <polyline points="6 9 12 15 18 9"></polyline>
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          ))
        )}
        {loadingMore && (
          <div style={{ textAlign: 'center', padding: '20px', color: '#808080' }}>
            Loading more events...
          </div>
        )}
        {!loading && !loadingMore && !hasMore && changes.length > 0 && (
          <div style={{ textAlign: 'center', padding: '20px', color: '#808080' }}>
            No more events to load
          </div>
        )}
      </div>
    </div>
  )
}

export default Dashboard
