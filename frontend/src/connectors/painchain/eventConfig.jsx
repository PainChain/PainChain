/**
 * PainChain Connector Event Type Configurations
 *
 * Defines how PainChain internal system events are rendered in the timeline
 */

export const painchainEventConfig = {
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
            value: (event) => event.metadata?.connector_name || event.description?.connector_name
          },
          {
            key: 'connector_type',
            label: 'Connector Type',
            value: (event) => event.metadata?.connector_type || event.description?.connector_type
          },
          {
            key: 'status',
            label: 'Status',
            value: (event) => 'Enabled'
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
            value: (event) => event.metadata?.connector_name || event.description?.connector_name
          },
          {
            key: 'connector_type',
            label: 'Connector Type',
            value: (event) => event.metadata?.connector_type || event.description?.connector_type
          },
          {
            key: 'status',
            label: 'Status',
            value: (event) => 'Disabled'
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
  'System': {
    titleMatch: 'Test',  // Matches "Test event" and other system events
    sections: [
      {
        title: 'Event Details',
        fields: [
          {
            key: 'event_type',
            label: 'Event Type',
            value: (event) => event.metadata?.event_type || event.eventType || 'system'
          },
          {
            key: 'description',
            label: 'Description',
            value: (event) => event.description || event.metadata?.description
          },
          {
            key: 'status',
            label: 'Status',
            value: (event) => event.status || event.metadata?.status
          }
        ]
      }
    ]
  }
}
