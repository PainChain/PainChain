/**
 * Kubernetes Connector Event Type Configurations
 *
 * Defines how Kubernetes events are rendered in the timeline
 */

export const kubernetesEventConfig = {
  'K8sDeployment': {
    titleMatch: '[Deployment',
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
              const desired = event.metadata?.desired_replicas
              const ready = event.metadata?.ready_replicas || 0
              const available = event.metadata?.available_replicas || 0
              if (desired === undefined) return null
              const color = ready === desired && available === desired ? '#3fb950' : '#f85149'
              return {
                type: 'html',
                content: <span style={{ color }}>{ready}/{desired} ready, {available} available</span>
              }
            }
          },
          {
            key: 'strategy',
            label: 'Strategy',
            value: (event) => event.eventMetadata?.strategy?.type || null
          }
        ],
        lists: [
          {
            key: 'images',
            title: 'Container Images',
            getValue: (event) => event.eventMetadata?.images,
            renderItem: (img, idx) => (
              <div key={idx} className="item-entry">
                <span style={{ color: '#00E8A0' }}>{img.name}</span>
                <div style={{ fontSize: '0.9em', color: '#a0a0a0', marginTop: '2px' }}>{img.image}</div>
              </div>
            )
          },
          {
            key: 'images_changed',
            title: 'Images Changed',
            getValue: (event) => event.eventMetadata?.images_changed,
            renderItem: (change, idx) => (
              <div key={idx} className="item-entry">
                <div style={{ color: '#00E8A0', fontWeight: 600 }}>{change.name}</div>
                <div style={{ fontSize: '0.85em', color: '#f85149', marginTop: '2px' }}>
                  <span style={{ color: '#808080' }}>Old:</span> {change.old_image}
                </div>
                <div style={{ fontSize: '0.85em', color: '#3fb950' }}>
                  <span style={{ color: '#808080' }}>New:</span> {change.new_image}
                </div>
              </div>
            )
          },
          {
            key: 'conditions',
            title: 'Conditions',
            getValue: (event) => event.eventMetadata?.conditions,
            renderItem: (cond, idx) => {
              const statusColor = cond.status === 'True' ? '#3fb950' : cond.status === 'False' ? '#f85149' : '#f0883e'
              return (
                <div key={idx} className="item-entry">
                  <div>
                    <span style={{ color: '#00E8A0', fontWeight: 600 }}>{cond.type}</span>
                    {' '}
                    <span style={{ color: statusColor }}>●</span>
                    {' '}
                    <span style={{ color: '#808080' }}>{cond.status}</span>
                  </div>
                  {cond.reason && <div style={{ fontSize: '0.85em', color: '#a0a0a0', marginTop: '2px' }}>{cond.reason}</div>}
                  {cond.message && <div style={{ fontSize: '0.85em', color: '#808080', marginTop: '2px' }}>{cond.message}</div>}
                </div>
              )
            }
          },
          {
            key: 'container_specs',
            title: 'Container Specs',
            getValue: (event) => event.eventMetadata?.container_specs,
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
                {spec.liveness_probe && (
                  <div style={{ fontSize: '0.85em', color: '#808080' }}>
                    <strong>Liveness:</strong> {spec.liveness_probe.type} {spec.liveness_probe.path || spec.liveness_probe.port}
                  </div>
                )}
                {spec.readiness_probe && (
                  <div style={{ fontSize: '0.85em', color: '#808080' }}>
                    <strong>Readiness:</strong> {spec.readiness_probe.type} {spec.readiness_probe.path || spec.readiness_probe.port}
                  </div>
                )}
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
              const desired = event.metadata?.desired_replicas
              const ready = event.metadata?.ready_replicas || 0
              const current = event.metadata?.current_replicas || 0
              if (desired === undefined) return null
              const color = ready === desired ? '#3fb950' : '#f85149'
              return {
                type: 'html',
                content: <span style={{ color }}>{ready}/{desired} ready, {current} current</span>
              }
            }
          }
        ],
        lists: [
          {
            key: 'images',
            title: 'Container Images',
            getValue: (event) => event.eventMetadata?.images,
            renderItem: (image, idx) => (
              <div key={idx} className="item-entry">
                <span style={{ color: '#00E8A0', fontWeight: 600 }}>{image.name}</span>
                <div style={{ fontSize: '0.9em', color: '#a0a0a0', marginTop: '2px' }}>{image.image}</div>
              </div>
            )
          },
          {
            key: 'conditions',
            title: 'Conditions',
            getValue: (event) => event.eventMetadata?.conditions,
            renderItem: (cond, idx) => {
              const statusColor = cond.status === 'True' ? '#3fb950' : cond.status === 'False' ? '#f85149' : '#f0883e'
              return (
                <div key={idx} className="item-entry">
                  <div>
                    <span style={{ color: '#00E8A0', fontWeight: 600 }}>{cond.type}</span>
                    {' '}
                    <span style={{ color: statusColor }}>●</span>
                    {' '}
                    <span style={{ color: '#808080' }}>{cond.status}</span>
                  </div>
                  {cond.message && <div style={{ fontSize: '0.85em', color: '#808080', marginTop: '2px' }}>{cond.message}</div>}
                </div>
              )
            }
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
              const desired = event.metadata?.desired_number_scheduled || 0
              const ready = event.metadata?.number_ready || 0
              const available = event.metadata?.number_available || 0
              const color = ready === desired && available === desired ? '#3fb950' : '#f85149'
              return {
                type: 'html',
                content: <span style={{ color }}>{ready}/{desired} ready, {available} available</span>
              }
            }
          }
        ],
        lists: [
          {
            key: 'images',
            title: 'Container Images',
            getValue: (event) => event.eventMetadata?.images,
            renderItem: (image, idx) => (
              <div key={idx} className="item-entry">
                <span style={{ color: '#00E8A0', fontWeight: 600 }}>{image.name}</span>
                <div style={{ fontSize: '0.9em', color: '#a0a0a0', marginTop: '2px' }}>{image.image}</div>
              </div>
            )
          },
          {
            key: 'conditions',
            title: 'Conditions',
            getValue: (event) => event.eventMetadata?.conditions,
            renderItem: (cond, idx) => {
              const statusColor = cond.status === 'True' ? '#3fb950' : cond.status === 'False' ? '#f85149' : '#f0883e'
              return (
                <div key={idx} className="item-entry">
                  <div>
                    <span style={{ color: '#00E8A0', fontWeight: 600 }}>{cond.type}</span>
                    {' '}
                    <span style={{ color: statusColor }}>●</span>
                    {' '}
                    <span style={{ color: '#808080' }}>{cond.status}</span>
                  </div>
                  {cond.message && <div style={{ fontSize: '0.85em', color: '#808080', marginTop: '2px' }}>{cond.message}</div>}
                </div>
              )
            }
          }
        ]
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
            value: (event) => {
              const type = event.metadata?.type
              if (!type) return null
              const typeColors = {
                'ClusterIP': '#00E8A0',
                'NodePort': '#58A6FF',
                'LoadBalancer': '#F0883E',
                'ExternalName': '#A371F7'
              }
              return {
                type: 'html',
                content: <span style={{ color: typeColors[type] || '#808080', fontWeight: 600 }}>{type}</span>
              }
            }
          },
          {
            key: 'cluster_ip',
            label: 'Cluster IP',
            value: (event) => event.metadata?.cluster_ip || null
          },
          {
            key: 'session_affinity',
            label: 'Session Affinity',
            value: (event) => event.metadata?.session_affinity || null
          },
          {
            key: 'external_traffic_policy',
            label: 'External Traffic Policy',
            value: (event) => event.eventMetadata?.external_traffic_policy || null
          }
        ],
        keyValue: {
          key: 'selector',
          title: 'Selector',
          getValue: (event) => event.eventMetadata?.selector,
          maxVisible: 5
        },
        lists: [
          {
            key: 'ports',
            title: 'Port Mappings',
            getValue: (event) => event.eventMetadata?.ports,
            renderItem: (port, idx) => (
              <div key={idx} className="item-entry">
                <div>
                  {port.name && <span style={{ color: '#00E8A0', fontWeight: 600 }}>{port.name}: </span>}
                  <span style={{ color: '#58A6FF' }}>{port.port}</span>
                  {' → '}
                  <span style={{ color: '#F0883E' }}>{port.target_port}</span>
                  <span style={{ color: '#808080', marginLeft: '8px' }}>({port.protocol})</span>
                  {port.node_port && <span style={{ color: '#A371F7', marginLeft: '8px' }}>NodePort: {port.node_port}</span>}
                </div>
              </div>
            )
          },
          {
            key: 'external_ips',
            title: 'External IPs',
            getValue: (event) => event.metadata?.external_ips
          },
          {
            key: 'load_balancer_ingress',
            title: 'Load Balancer Ingress',
            getValue: (event) => event.eventMetadata?.load_balancer_ingress,
            renderItem: (ing, idx) => (
              <div key={idx} className="item-entry">
                {ing.hostname && <span style={{ color: '#00E8A0' }}>{ing.hostname}</span>}
                {ing.ip && <span style={{ color: '#58A6FF' }}>{ing.ip}</span>}
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
        keyValue: {
          key: 'data',
          title: 'Data',
          getValue: (event) => event.eventMetadata?.data,
          maxVisible: 10
        },
        lists: [
          {
            key: 'keys_added',
            title: 'Keys Added',
            getValue: (event) => event.eventMetadata?.keys_added
          },
          {
            key: 'keys_modified',
            title: 'Keys Modified',
            getValue: (event) => event.eventMetadata?.keys_modified
          },
          {
            key: 'keys_removed',
            title: 'Keys Removed',
            getValue: (event) => event.eventMetadata?.keys_removed
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
            getValue: (event) => event.metadata?.keys,
            maxVisible: 10
          },
          {
            key: 'keys_added',
            title: 'Keys Added',
            getValue: (event) => event.eventMetadata?.keys_added
          },
          {
            key: 'keys_removed',
            title: 'Keys Removed',
            getValue: (event) => event.eventMetadata?.keys_removed
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
            value: (event) => event.metadata?.namespace || null
          },
          {
            key: 'cluster',
            label: 'Cluster',
            value: (event) => event.metadata?.cluster || null
          }
        ],
        keyValue: {
          key: 'labels',
          title: 'Labels',
          getValue: (event) => event.metadata?.labels,
          maxVisible: 5
        }
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
            value: (event) => event.metadata?.namespace || null
          },
          {
            key: 'cluster',
            label: 'Cluster',
            value: (event) => event.metadata?.cluster || null
          },
          {
            key: 'node',
            label: 'Node',
            value: (event) => event.metadata?.node || null
          },
          {
            key: 'phase',
            label: 'Phase',
            value: (event) => {
              const phase = event.metadata?.phase
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
            key: 'pod_ip',
            label: 'Pod IP',
            value: (event) => event.metadata?.pod_ip || null
          },
          {
            key: 'qos_class',
            label: 'QoS Class',
            value: (event) => event.metadata?.qos_class || null
          }
        ],
        keyValue: {
          key: 'labels',
          title: 'Labels',
          getValue: (event) => event.metadata?.labels,
          maxVisible: 5
        },
        lists: [
          {
            key: 'containers',
            title: 'Container Status',
            getValue: (event) => event.eventMetadata?.containers,
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
                    {container.fetch_logs_cmd && (
                      <div style={{ fontSize: '0.85em', color: '#00E8A0', marginTop: '4px', fontFamily: 'monospace' }}>
                        {container.fetch_logs_cmd}
                      </div>
                    )}
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
                  {container.last_termination && (
                    <div style={{ fontSize: '0.85em', color: '#f0883e', marginTop: '4px' }}>
                      Last termination: {container.last_termination.reason} (exit {container.last_termination.exit_code})
                    </div>
                  )}
                </div>
              )
            }
          },
          {
            key: 'conditions',
            title: 'Pod Conditions',
            getValue: (event) => event.eventMetadata?.conditions,
            renderItem: (cond, idx) => {
              const statusColor = cond.status === 'True' ? '#3fb950' : cond.status === 'False' ? '#f85149' : '#f0883e'
              return (
                <div key={idx} className="item-entry">
                  <div>
                    <span style={{ color: '#00E8A0', fontWeight: 600 }}>{cond.type}</span>
                    {' '}
                    <span style={{ color: statusColor }}>●</span>
                    {' '}
                    <span style={{ color: '#808080' }}>{cond.status}</span>
                  </div>
                  {cond.reason && <div style={{ fontSize: '0.85em', color: '#a0a0a0', marginTop: '2px' }}>{cond.reason}</div>}
                  {cond.message && <div style={{ fontSize: '0.85em', color: '#808080', marginTop: '2px' }}>{cond.message}</div>}
                </div>
              )
            }
          },
          {
            key: 'container_specs',
            title: 'Container Specs',
            getValue: (event) => event.eventMetadata?.container_specs,
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
            key: 'init_containers',
            title: 'Init Containers',
            getValue: (event) => event.eventMetadata?.init_containers,
            renderItem: (container, idx) => {
              const stateColor = {
                'running': '#3fb950',
                'waiting': '#f0883e',
                'terminated': '#f85149'
              }[container.state] || '#808080'
              return (
                <div key={idx} className="item-entry">
                  <div>
                    <span style={{ color: '#00E8A0', fontWeight: 600 }}>{container.name}</span>
                    {' '}
                    <span style={{ color: stateColor }}>●</span>
                    {' '}
                    <span style={{ color: '#808080' }}>{container.state || 'unknown'}</span>
                  </div>
                  {container.reason && (
                    <div style={{ fontSize: '0.85em', color: '#f85149', marginTop: '2px' }}>
                      {container.reason} {container.exit_code !== undefined && `(exit ${container.exit_code})`}
                    </div>
                  )}
                </div>
              )
            }
          },
          {
            key: 'volumes',
            title: 'Volumes',
            getValue: (event) => event.eventMetadata?.volumes,
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
  'K8sRole': {
    titleMatch: '[Role',
    sections: [
      {
        title: 'Role Details',
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
          }
        ],
        keyValue: {
          key: 'labels',
          title: 'Labels',
          getValue: (event) => event.metadata?.labels,
          maxVisible: 5
        }
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
            value: (event) => event.metadata?.namespace || null
          },
          {
            key: 'cluster',
            label: 'Cluster',
            value: (event) => event.metadata?.cluster || null
          }
        ],
        keyValue: {
          key: 'labels',
          title: 'Labels',
          getValue: (event) => event.metadata?.labels,
          maxVisible: 5
        }
      }
    ]
  },
  'K8sHelmRelease': {
    titleMatch: '[Helm',
    sections: [
      {
        title: 'Helm Release Details',
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
            key: 'release_name',
            label: 'Release Name',
            value: (event) => event.metadata?.release_name || null
          },
          {
            key: 'revision',
            label: 'Revision',
            value: (event) => {
              const revision = event.metadata?.revision
              if (revision === undefined || revision === null) return null
              return `v${revision}`
            }
          },
          {
            key: 'chart',
            label: 'Chart',
            value: (event) => {
              const chartName = event.metadata?.chart_name
              const chartVersion = event.metadata?.chart_version
              if (!chartName) return null
              return chartVersion ? `${chartName}:${chartVersion}` : chartName
            }
          },
          {
            key: 'app_version',
            label: 'App Version',
            value: (event) => event.metadata?.app_version || null
          },
          {
            key: 'status',
            label: 'Status',
            value: (event) => {
              const status = event.eventMetadata?.status || event.status
              if (!status) return null
              const statusColors = {
                'deployed': '#3fb950',
                'superseded': '#808080',
                'failed': '#f85149',
                'uninstalled': '#f85149'
              }
              const color = statusColors[status.toLowerCase()] || '#808080'
              return {
                type: 'html',
                content: <span style={{ color, fontWeight: 600 }}>{status}</span>
              }
            }
          },
          {
            key: 'first_deployed',
            label: 'First Deployed',
            value: (event) => event.metadata?.first_deployed || null
          },
          {
            key: 'last_deployed',
            label: 'Last Deployed',
            value: (event) => event.metadata?.last_deployed || null
          }
        ],
        lists: [
          {
            key: 'resource_types',
            title: 'Resources Created',
            getValue: (event) => event.eventMetadata?.resource_types,
            renderItem: (type, idx) => (
              <div key={idx} className="item-entry">
                <span style={{ color: '#00E8A0' }}>{type}</span>
              </div>
            ),
            maxVisible: 15
          },
          {
            key: 'value_keys',
            title: 'Values (Top Keys)',
            getValue: (event) => event.eventMetadata?.value_keys,
            renderItem: (key, idx) => (
              <div key={idx} className="item-entry">
                <span style={{ color: '#a0a0a0' }}>{key}</span>
              </div>
            ),
            maxVisible: 10
          },
          {
            key: 'debug_commands',
            title: 'Debug Commands',
            getValue: (event) => {
              const cmds = event.eventMetadata?.debug_commands
              if (!cmds) return null
              return Object.entries(cmds)
                .filter(([_, cmd]) => cmd)
                .map(([name, cmd]) => ({ name, cmd }))
            },
            renderItem: (item, idx) => (
              <div key={idx} className="item-entry" style={{ fontFamily: 'monospace', fontSize: '0.85em' }}>
                <div style={{ color: '#00E8A0', marginBottom: '2px' }}>{item.name}:</div>
                <div style={{ color: '#a0a0a0', marginLeft: '8px' }}>{item.cmd}</div>
              </div>
            )
          }
        ]
      }
    ]
  },
  'K8sEvent': {
    titleMatch: '[K8s Event',
    sections: [
      {
        title: 'Event Details',
        fields: [
          {
            key: 'namespace',
            label: 'Namespace',
            value: (event) => event.metadata?.namespace || null
          },
          {
            key: 'reason',
            label: 'Reason',
            value: (event) => event.metadata?.reason || null
          },
          {
            key: 'event_type',
            label: 'Type',
            value: (event) => {
              const type = event.metadata?.event_type
              if (!type) return null
              const color = type === 'Warning' ? '#f85149' : '#00E8A0'
              return {
                type: 'html',
                content: <span style={{ color, fontWeight: 600 }}>{type}</span>
              }
            }
          },
          {
            key: 'count',
            label: 'Count',
            value: (event) => event.eventMetadata?.count || null
          },
          {
            key: 'involved_object',
            label: 'Involved Object',
            value: (event) => {
              const obj = event.metadata?.involved_object
              if (!obj) return null
              return `${obj.kind}/${obj.name}`
            }
          },
          {
            key: 'first_timestamp',
            label: 'First Seen',
            value: (event) => event.eventMetadata?.first_timestamp || null
          },
          {
            key: 'last_timestamp',
            label: 'Last Seen',
            value: (event) => event.eventMetadata?.last_timestamp || null
          },
          {
            key: 'source',
            label: 'Source',
            value: (event) => event.eventMetadata?.source_component || event.eventMetadata?.reporting_component || null
          }
        ]
      }
    ]
  }
}
