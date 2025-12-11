import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import DateTimePicker from '../components/DateTimePicker'
import TagsDropdown from '../components/TagsDropdown'
import Timeline from '../components/Timeline'
import { isFieldVisible } from '../utils/fieldVisibility'
import { getConnectorLogoUrl } from '../utils/connectorMetadata'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

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
              let conclusion = event.metadata?.conclusion

              // If no conclusion but has duration, it's completed (successful)
              if (!conclusion && event.metadata?.duration_seconds !== undefined && event.metadata?.duration_seconds > 0) {
                const hasFailed = event.metadata?.failed_jobs_count > 0
                conclusion = hasFailed ? 'failure' : 'success'
              }

              // Fall back to status field if still no conclusion
              if (!conclusion) {
                conclusion = event.status || event.metadata?.status
              }

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
          },
          {
            key: 'logs',
            label: 'Logs',
            value: (event) => event.url
              ? { type: 'html', content: <a href={event.url} target="_blank" rel="noopener noreferrer" style={{ color: '#00E8A0', textDecoration: 'none' }}>View on GitHub →</a> }
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
              let status = event.metadata?.status

              // If no status but has duration, it's completed (infer from failed jobs)
              if (!status && event.metadata?.duration_seconds !== undefined && event.metadata?.duration_seconds > 0) {
                const hasFailed = event.metadata?.failed_jobs_count > 0
                status = hasFailed ? 'failed' : 'success'
              }

              // Fall back to top-level status field if still no status
              if (!status) {
                status = event.status
              }

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
          },
          {
            key: 'logs',
            label: 'Logs',
            value: (event) => event.url
              ? { type: 'html', content: <a href={event.url} target="_blank" rel="noopener noreferrer" style={{ color: '#00E8A0', textDecoration: 'none' }}>View on GitLab →</a> }
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
  'K8sStatefulSet': {
    titleMatch: '[StatefulSet',
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
    titleMatch: '[DaemonSet',
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
  'K8sSecret': {
    titleMatch: '[Secret',
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
  'K8sPod': {
    titleMatch: '[Pod',
    sections: [
      {
        title: 'Pod Details',
        fields: [
          {
            key: 'namespace',
            label: 'Namespace',
            value: (event) => event.description?.namespace || event.metadata?.namespace || null
          },
          {
            key: 'cluster',
            label: 'Cluster',
            value: (event) => event.metadata?.cluster || null
          },
          {
            key: 'node',
            label: 'Node',
            value: (event) => event.description?.node || null
          },
          {
            key: 'phase',
            label: 'Phase',
            value: (event) => {
              const phase = event.description?.phase
              if (!phase) return null
              const phaseColors = {
                'Running': '#3fb950',
                'Pending': '#f0883e',
                'Failed': '#f85149',
                'Succeeded': '#3fb950',
                'Unknown': '#808080'
              }
              return {
                type: 'html',
                content: <span style={{ color: phaseColors[phase] || '#808080', fontWeight: 600 }}>{phase}</span>
              }
            }
          },
          {
            key: 'event_type',
            label: 'Event',
            value: (event) => {
              const eventType = event.description?.event_type
              if (!eventType) return null
              const eventColors = {
                'ADDED': '#3fb950',
                'MODIFIED': '#f0883e',
                'DELETED': '#f85149'
              }
              return {
                type: 'html',
                content: <span style={{ color: eventColors[eventType] || '#808080' }}>{eventType}</span>
              }
            }
          }
        ],
        keyValue: {
          key: 'labels',
          title: 'Labels',
          getValue: (event) => event.description?.labels,
          maxVisible: 5
        },
        lists: [
          {
            key: 'container_specs',
            title: 'Container Specs',
            getValue: (event) => event.description?.container_specs,
            renderItem: (spec, idx) => (
              <div key={idx} className="item-entry">
                <div>
                  <span style={{ color: '#00E8A0', fontWeight: 600 }}>{spec.name}</span>
                </div>
                <div style={{ fontSize: '0.9em', color: '#a0a0a0', marginTop: '2px' }}>{spec.image}</div>
                {spec.requests && (
                  <div style={{ fontSize: '0.85em', color: '#808080', marginTop: '4px' }}>
                    <strong>Requests:</strong> {Object.entries(spec.requests).map(([k, v]) => `${k}: ${v}`).join(', ')}
                  </div>
                )}
                {spec.limits && (
                  <div style={{ fontSize: '0.85em', color: '#808080' }}>
                    <strong>Limits:</strong> {Object.entries(spec.limits).map(([k, v]) => `${k}: ${v}`).join(', ')}
                  </div>
                )}
                {spec.ports && spec.ports.length > 0 && (
                  <div style={{ fontSize: '0.85em', color: '#808080' }}>
                    <strong>Ports:</strong> {spec.ports.map(p => `${p.container_port}/${p.protocol}`).join(', ')}
                  </div>
                )}
                {spec.env_count > 0 && (
                  <div style={{ fontSize: '0.85em', color: '#808080' }}>
                    <strong>Environment Variables:</strong> {spec.env_count}
                  </div>
                )}
              </div>
            )
          },
          {
            key: 'containers',
            title: 'Container Status',
            getValue: (event) => event.description?.containers,
            renderItem: (container, idx) => {
              const stateColor = {
                'running': '#3fb950',
                'waiting': '#f0883e',
                'terminated': '#f85149'
              }[container.state] || '#808080'

              const restartWarning = container.restart_count > 0
                ? <span style={{ color: '#f85149', marginLeft: '8px' }}>⚠ {container.restart_count} restarts</span>
                : null

              const statusInfo = container.reason
                ? <div style={{ marginTop: '4px', color: '#f85149' }}>
                    {container.reason}
                    {container.exit_code !== undefined && ` (exit code: ${container.exit_code})`}
                    {container.message && <div style={{ fontSize: '0.9em', marginTop: '2px' }}>{container.message}</div>}
                  </div>
                : null

              return (
                <div key={idx} className="item-entry">
                  <div>
                    <span style={{ color: '#00E8A0', fontWeight: 600 }}>{container.name}</span>
                    {' '}
                    <span style={{ color: stateColor }}>●</span>
                    {' '}
                    <span style={{ color: '#808080' }}>{container.state || 'unknown'}</span>
                    {restartWarning}
                  </div>
                  <div style={{ fontSize: '0.9em', color: '#a0a0a0', marginTop: '2px' }}>{container.image}</div>
                  {statusInfo}
                </div>
              )
            }
          },
          {
            key: 'volumes',
            title: 'Volumes',
            getValue: (event) => event.description?.volumes,
            renderItem: (volume, idx) => (
              <div key={idx} className="item-entry">
                <span style={{ color: '#00E8A0' }}>{volume.name}</span>
                <span style={{ color: '#808080', marginLeft: '8px' }}>({volume.type})</span>
              </div>
            )
          }
        ]
      }
    ]
  },
  'K8sConfigMap': {
    titleMatch: '[ConfigMap',
    sections: [
      {
        title: 'ConfigMap Details',
        fields: [
          {
            key: 'namespace',
            label: 'Namespace',
            value: (event) => event.description?.namespace || event.metadata?.namespace || null
          },
          {
            key: 'cluster',
            label: 'Cluster',
            value: (event) => event.metadata?.cluster || null
          },
          {
            key: 'event_type',
            label: 'Event',
            value: (event) => {
              const eventType = event.description?.event_type
              if (!eventType) return null
              const eventColors = {
                'ADDED': '#3fb950',
                'MODIFIED': '#f0883e',
                'DELETED': '#f85149'
              }
              return {
                type: 'html',
                content: <span style={{ color: eventColors[eventType] || '#808080' }}>{eventType}</span>
              }
            }
          }
        ],
        keyValue: {
          key: 'data',
          title: 'Data',
          getValue: (event) => event.description?.data,
          maxVisible: 10
        }
      }
    ]
  },
  'K8sService': {
    titleMatch: '[Service',
    sections: [
      {
        title: 'Service Details',
        fields: [
          {
            key: 'namespace',
            label: 'Namespace',
            value: (event) => event.description?.namespace || null
          },
          {
            key: 'type',
            label: 'Type',
            value: (event) => event.description?.type || null
          },
          {
            key: 'cluster_ip',
            label: 'Cluster IP',
            value: (event) => event.description?.cluster_ip || null
          }
        ],
        keyValue: {
          key: 'selector',
          title: 'Selector',
          getValue: (event) => event.description?.selector
        },
        lists: [
          {
            key: 'ports',
            title: 'Ports',
            getValue: (event) => event.description?.ports,
            renderItem: (port, idx) => (
              <div key={idx} className="item-entry">
                <span>{port.port} → {port.target_port} ({port.protocol})</span>
              </div>
            )
          }
        ]
      }
    ]
  },
  'K8sDeployment': {
    titleMatch: '[Deployment',
    sections: [
      {
        title: 'Deployment Details',
        fields: [
          {
            key: 'namespace',
            label: 'Namespace',
            value: (event) => event.description?.namespace || null
          },
          {
            key: 'replicas',
            label: 'Replicas',
            value: (event) => event.description?.replicas || null
          },
          {
            key: 'strategy',
            label: 'Strategy',
            value: (event) => event.description?.strategy || null
          }
        ],
        lists: [
          {
            key: 'images',
            title: 'Container Images',
            getValue: (event) => event.description?.images,
            renderItem: (img, idx) => (
              <div key={idx} className="item-entry">
                <span style={{ color: '#00E8A0' }}>{img.name}</span>
                <div style={{ fontSize: '0.9em', color: '#a0a0a0', marginTop: '2px' }}>{img.image}</div>
              </div>
            )
          }
        ]
      }
    ]
  },
  'K8sIngress': {
    titleMatch: '[Ingress',
    sections: [
      {
        title: 'Ingress Details',
        fields: [
          {
            key: 'namespace',
            label: 'Namespace',
            value: (event) => event.description?.namespace || null
          }
        ],
        lists: [
          {
            key: 'rules',
            title: 'Rules',
            getValue: (event) => event.description?.rules,
            renderItem: (rule, idx) => (
              <div key={idx} className="item-entry">
                <div style={{ color: '#00E8A0', fontWeight: 600 }}>{rule.host || '*'}</div>
                {rule.paths && rule.paths.map((path, pidx) => (
                  <div key={pidx} style={{ fontSize: '0.9em', color: '#808080', marginTop: '2px', marginLeft: '12px' }}>
                    {path.path} → {path.backend}
                  </div>
                ))}
              </div>
            )
          }
        ]
      }
    ]
  },
  'K8sRole': {
    titleMatch: '[Role',
    sections: [
      {
        title: 'Role Details',
        fields: [
          {
            key: 'namespace',
            label: 'Namespace',
            value: (event) => event.description?.namespace || null
          }
        ],
        lists: [
          {
            key: 'rules',
            title: 'Rules',
            getValue: (event) => event.description?.rules,
            renderItem: (rule, idx) => (
              <div key={idx} className="item-entry">
                <div style={{ fontSize: '0.9em' }}>
                  <strong>Resources:</strong> {rule.resources?.join(', ') || 'none'}
                </div>
                <div style={{ fontSize: '0.9em', marginTop: '2px' }}>
                  <strong>Verbs:</strong> {rule.verbs?.join(', ') || 'none'}
                </div>
                {rule.api_groups && rule.api_groups.length > 0 && (
                  <div style={{ fontSize: '0.85em', color: '#808080', marginTop: '2px' }}>
                    <strong>API Groups:</strong> {rule.api_groups.join(', ')}
                  </div>
                )}
              </div>
            )
          }
        ]
      }
    ]
  },
  'K8sRoleBinding': {
    titleMatch: '[RoleBinding',
    sections: [
      {
        title: 'RoleBinding Details',
        fields: [
          {
            key: 'namespace',
            label: 'Namespace',
            value: (event) => event.description?.namespace || null
          },
          {
            key: 'role_ref',
            label: 'Role',
            value: (event) => {
              const roleRef = event.description?.role_ref
              return roleRef ? `${roleRef.kind}: ${roleRef.name}` : null
            }
          }
        ],
        lists: [
          {
            key: 'subjects',
            title: 'Subjects',
            getValue: (event) => event.description?.subjects,
            renderItem: (subject, idx) => (
              <div key={idx} className="item-entry">
                <span style={{ color: '#00E8A0' }}>{subject.kind}</span>
                <span style={{ marginLeft: '8px' }}>{subject.name}</span>
                {subject.namespace && (
                  <span style={{ color: '#808080', marginLeft: '8px' }}>({subject.namespace})</span>
                )}
              </div>
            )
          }
        ]
      }
    ]
  },
  'ConnectorCreated': {
    titleMatch: '[Connector Created]',
    sections: [
      {
        title: 'Details',
        fields: [
          {
            key: 'connector_name',
            label: 'Connector Name',
            value: (event) => event.description?.connector_name
          },
          {
            key: 'connector_type',
            label: 'Connector Type',
            value: (event) => event.description?.connector_type
          },
          {
            key: 'action',
            label: 'Action',
            value: (event) => event.metadata?.action || 'create'
          }
        ]
      }
    ]
  },
  'ConnectorUpdated': {
    titleMatch: '[Connector Updated]',
    sections: [
      {
        title: 'Details',
        fields: [
          {
            key: 'connector_name',
            label: 'Connector Name',
            value: (event) => event.description?.connector_name
          },
          {
            key: 'connector_type',
            label: 'Connector Type',
            value: (event) => event.description?.connector_type
          },
          {
            key: 'action',
            label: 'Action',
            value: (event) => event.metadata?.action || 'update'
          }
        ],
        lists: [
          {
            key: 'changes',
            title: 'Changes Made',
            getValue: (event) => {
              const changes = event.description?.changes || event.metadata?.changes
              if (!changes || typeof changes !== 'object') return null

              return Object.entries(changes).map(([field, value]) => {
                if (value && typeof value === 'object' && 'old' in value && 'new' in value) {
                  // Format old/new values nicely
                  const formatValue = (val) => {
                    if (Array.isArray(val)) {
                      return val.length > 3 ? `[${val.slice(0, 3).join(', ')}, ...]` : `[${val.join(', ')}]`
                    }
                    if (val === null || val === undefined || val === '') return '(empty)'
                    return String(val)
                  }
                  return `${field}: ${formatValue(value.old)} → ${formatValue(value.new)}`
                }
                return `${field}: ${JSON.stringify(value)}`
              })
            },
            maxVisible: 20
          }
        ]
      }
    ]
  },
  'ConnectorDeleted': {
    titleMatch: '[Connector Deleted]',
    sections: [
      {
        title: 'Details',
        fields: [
          {
            key: 'connector_name',
            label: 'Connector Name',
            value: (event) => event.description?.connector_name
          },
          {
            key: 'connector_type',
            label: 'Connector Type',
            value: (event) => event.description?.connector_type
          },
          {
            key: 'action',
            label: 'Action',
            value: (event) => event.metadata?.action || 'delete'
          }
        ]
      }
    ]
  },
  'ConnectorEnabled': {
    titleMatch: '[Connector Enabled]',
    sections: [
      {
        title: 'Details',
        fields: [
          {
            key: 'connector_name',
            label: 'Connector Name',
            value: (event) => event.description?.connector_name
          },
          {
            key: 'connector_type',
            label: 'Connector Type',
            value: (event) => event.description?.connector_type
          },
          {
            key: 'action',
            label: 'Action',
            value: (event) => event.metadata?.action || 'enable'
          }
        ]
      }
    ]
  },
  'ConnectorDisabled': {
    titleMatch: '[Connector Disabled]',
    sections: [
      {
        title: 'Details',
        fields: [
          {
            key: 'connector_name',
            label: 'Connector Name',
            value: (event) => event.description?.connector_name
          },
          {
            key: 'connector_type',
            label: 'Connector Type',
            value: (event) => event.description?.connector_type
          },
          {
            key: 'action',
            label: 'Action',
            value: (event) => event.metadata?.action || 'disable'
          }
        ]
      }
    ]
  },
  'ConfigChanged': {
    titleMatch: '[Config Changed]',
    sections: [
      {
        title: 'Details',
        fields: [
          {
            key: 'connector_name',
            label: 'Connector Name',
            value: (event) => event.description?.connector_name
          },
          {
            key: 'field',
            label: 'Field Changed',
            value: (event) => event.description?.field
          },
          {
            key: 'old_value',
            label: 'Old Value',
            value: (event) => {
              const val = event.description?.old_value
              if (val === null || val === undefined || val === '') return '(empty)'
              return String(val)
            }
          },
          {
            key: 'new_value',
            label: 'New Value',
            value: (event) => {
              const val = event.description?.new_value
              if (val === null || val === undefined || val === '') return '(empty)'
              return String(val)
            }
          },
          {
            key: 'action',
            label: 'Action',
            value: (event) => event.metadata?.action || 'config_change'
          }
        ]
      }
    ]
  },
  'FieldVisibilityChanged': {
    titleMatch: '[Field Visibility Changed]',
    sections: [
      {
        title: 'Details',
        fields: [
          {
            key: 'event_type',
            label: 'Event Type',
            value: (event) => event.description?.event_type || event.metadata?.event_type
          },
          {
            key: 'field',
            label: 'Field',
            value: (event) => event.description?.field || event.metadata?.field
          },
          {
            key: 'visible',
            label: 'Visible',
            value: (event) => {
              const visible = event.description?.visible ?? event.metadata?.visible
              return visible ? 'Yes' : 'No'
            }
          },
          {
            key: 'action',
            label: 'Action',
            value: (event) => event.metadata?.action || 'field_visibility_change'
          }
        ]
      }
    ]
  },
  'Image': {
    titleMatch: '[Image]',
    sections: [
      {
        title: 'Container Image Details',
        fields: [
          {
            key: 'registry',
            label: 'Registry',
            value: (event) => event.metadata?.registry || null
          },
          {
            key: 'image',
            label: 'Image',
            value: (event) => event.metadata?.image || null
          },
          {
            key: 'size',
            label: 'Size',
            value: (event) => event.description?.metadata?.size || null
          },
          {
            key: 'digest',
            label: 'Digest',
            value: (event) => event.description?.metadata?.digest_short || event.metadata?.digest?.substring(0, 12) || null
          },
          {
            key: 'package',
            label: 'Package',
            value: (event) => event.metadata?.package || null
          },
          {
            key: 'repository',
            label: 'Repository',
            value: (event) => event.metadata?.repository || null
          },
                    {
            key: 'view',
            label: 'View',
            value: (event) => event.url
              ? { type: 'html', content: <a href={event.url} target="_blank" rel="noopener noreferrer" style={{ color: '#00E8A0', textDecoration: 'none' }}>View Package →</a> }
              : null
          }
        ],
        lists: [
          {
            key: 'tags',
            title: 'Tags',
            getValue: (event) => event.description?.labels || event.metadata?.tags,
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
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState(null)
  const [sourceFilter, setSourceFilter] = useState('')
  const [tagFilter, setTagFilter] = useState([])

  // Start with no dates selected - will show rolling 24 hours by default
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [expandedEvents, setExpandedEvents] = useState(new Set())
  const [connectors, setConnectors] = useState([])
  const [teams, setTeams] = useState([])
  const [expandedTags, setExpandedTags] = useState(new Set())
  const [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const limit = 50

  const fetchData = useCallback(async (reset = false, currentOffset = 0, silent = false) => {
    try {
      // Silent refresh: don't show loading spinner or reset view
      if (!silent) {
        if (reset) {
          setLoading(true)
          setOffset(0)
          currentOffset = 0
        } else {
          setLoadingMore(true)
        }
      }

      const params = new URLSearchParams()
      if (sourceFilter) params.append('source', sourceFilter)

      // If no dates selected, use rolling 24-hour window (computed at fetch time)
      const effectiveStartDate = startDate || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      const effectiveEndDate = endDate || new Date().toISOString()

      params.append('start_date', effectiveStartDate)
      params.append('end_date', effectiveEndDate)

      // Append each selected tag separately
      tagFilter.forEach(tag => params.append('tag', tag))
      params.append('limit', limit)
      params.append('offset', currentOffset)

      const changesRes = await fetch(`${API_URL}/api/changes?${params}`)
      const changesData = await changesRes.json()

      if (silent) {
        // Silent update: merge new data, remove duplicates, preserve scroll
        setChanges(prev => {
          const existingIds = new Set(prev.map(c => c.id))
          const newChanges = changesData.filter(c => !existingIds.has(c.id))
          const merged = [...newChanges, ...prev]

          // Filter out events outside the time window (for rolling window mode)
          if (!startDate && !endDate) {
            const windowStart = new Date(Date.now() - 24 * 60 * 60 * 1000)
            return merged.filter(c => new Date(c.timestamp) >= windowStart)
          }

          return merged
        })
      } else if (reset) {
        setChanges(changesData)
      } else {
        setChanges(prev => [...prev, ...changesData])
      }

      // Check if there are more events to load
      if (!silent) {
        setHasMore(changesData.length === limit)
      }

      setError(null)
    } catch (err) {
      setError(err.message)
    } finally {
      if (!silent) {
        setLoading(false)
        setLoadingMore(false)
      }
    }
  }, [sourceFilter, startDate, endDate, tagFilter])

  useEffect(() => {
    // Reset and fetch initial data when filters change
    setOffset(0)
    setChanges([])
    setHasMore(true)
    fetchData(true)
    fetchConnections()
    fetchTeams()
    // Use silent refresh to avoid flashing/scrolling - only fetches offset 0 to get new events
    const interval = setInterval(() => fetchData(false, 0, true), 30000)
    return () => clearInterval(interval)
  }, [sourceFilter, startDate, endDate, tagFilter, fetchData])

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
  }, [loadingMore, hasMore, offset, fetchData])

  const fetchConnections = async () => {
    try {
      const response = await fetch(`${API_URL}/api/connections`)
      const data = await response.json()
      setConnectors(data)  // Keep using setConnectors to avoid changing all references
    } catch (err) {
      console.error('Failed to fetch connections:', err)
    }
  }

  const fetchTeams = async () => {
    try {
      const response = await fetch(`${API_URL}/api/teams`)
      const data = await response.json()
      setTeams(data)
    } catch (err) {
      console.error('Failed to fetch teams:', err)
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
    // Add connection tags
    connectors.forEach(connector => {
      if (connector.tags) {
        connector.tags
          .split(',')
          .map(tag => tag.trim())
          .filter(tag => tag.length > 0)
          .forEach(tag => tags.add(tag))
      }
    })
    // Add team names and team tags
    teams.forEach(team => {
      if (team.name) {
        tags.add(team.name)
      }
      // Also add all tags from the team's tags array
      if (team.tags && Array.isArray(team.tags)) {
        team.tags.forEach(tag => {
          if (tag && tag.trim().length > 0) {
            tags.add(tag.trim())
          }
        })
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

      <Timeline
        sourceFilter={sourceFilter}
        startDate={startDate}
        endDate={endDate}
        tagFilter={tagFilter}
        onTimeRangeChange={(newStart, newEnd) => {
          setStartDate(newStart)
          setEndDate(newEnd)
        }}
      />

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
                        <img
                          src={getConnectorLogoUrl(change.source)}
                          alt={`${change.source} logo`}
                          className="connector-logo clickable"
                          onClick={() => navigateToConnection(change)}
                          style={{ cursor: 'pointer' }}
                          title="Go to connection settings"
                        />
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
                    {(change.metadata?.repository || change.metadata?.project) && (
                      <div className="change-repo">
                        Repository: {change.metadata.repository || change.metadata.project}
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
