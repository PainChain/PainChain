import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import '../Settings.css'
import { getFieldVisibility, toggleField, resetToDefaults, FIELD_LABELS, EVENT_TYPE_NAMES, loadFieldVisibilityDefaults } from '../utils/fieldVisibility'
import { useToast } from '../components/Toast'
import { getConnectorTypes, getConnectorLogoUrl, loadConnectorMetadata } from '../utils/connectorMetadata'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

// Map connector types to their event types
const CONNECTOR_EVENT_TYPES = {
  github: ['PR', 'Workflow', 'Commit', 'Release', 'Image'],
  gitlab: ['MR', 'Pipeline', 'Commit', 'Release', 'Image'],
  kubernetes: ['K8sDeployment', 'K8sStatefulSet', 'K8sDaemonSet', 'K8sService', 'K8sConfigMap', 'K8sSecret', 'K8sIngress', 'K8sHelmRelease', 'K8sPod', 'K8sRole', 'K8sRoleBinding', 'K8sEvent'],
  painchain: ['ConnectorCreated', 'ConnectorUpdated', 'ConnectorDeleted', 'ConnectorEnabled', 'ConnectorDisabled', 'ConfigChanged', 'FieldVisibilityChanged']
}

function Settings() {
  const navigate = useNavigate()
  const location = useLocation()
  const { showToast } = useToast()
  const [activeMenu, setActiveMenu] = useState('connections')
  const [connections, setConnections] = useState([])
  const [selectedConnection, setSelectedConnection] = useState(null)
  const [teams, setTeams] = useState([])
  const [selectedTeam, setSelectedTeam] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [creatingNew, setCreatingNew] = useState(false)
  const [newConnectionType, setNewConnectionType] = useState('')
  const [config, setConfig] = useState({})
  const [teamConfig, setTeamConfig] = useState({
    name: '',
    tags: ''
  })
  const [fieldVisibility, setFieldVisibility] = useState(getFieldVisibility())
  const [initialFieldVisibility, setInitialFieldVisibility] = useState(getFieldVisibility())
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)
  const [connectorTypes, setConnectorTypes] = useState([])
  const [searchQuery, setSearchQuery] = useState('')
  const [connectorMetadata, setConnectorMetadata] = useState({})

  // Load connector types and metadata on mount
  useEffect(() => {
    const loadTypes = async () => {
      const types = await getConnectorTypes()
      setConnectorTypes(types)

      // Load full metadata for all connectors
      const metadata = await loadConnectorMetadata()
      const metadataMap = {}
      metadata.forEach(m => {
        metadataMap[m.id] = m
      })
      setConnectorMetadata(metadataMap)

      // Load field visibility defaults from metadata
      await loadFieldVisibilityDefaults()
    }
    loadTypes()
  }, [])

  // Helper to initialize config from connector definition
  const initializeConfig = (connectorType) => {
    const connectorDef = connectorMetadata[connectorType]
    if (!connectorDef?.connectionForm?.fields) return {}

    const initialConfig = { enabled: false }
    connectorDef.connectionForm.fields.forEach(field => {
      if (field.type === 'checkbox') {
        initialConfig[field.key] = field.default === true || field.default === 'true'
      } else if (field.type === 'checkbox-group') {
        initialConfig[field.key] = field.default || []
      } else {
        initialConfig[field.key] = field.default || ''
      }
    })
    return initialConfig
  }

  // Helper to load config from connection data
  const loadConfigFromConnection = (connection) => {
    const connectorDef = connectorMetadata[connection.type]
    if (!connectorDef?.connectionForm?.fields) return {}

    const loadedConfig = { enabled: connection.enabled }
    connectorDef.connectionForm.fields.forEach(field => {
      if (field.key === 'name') {
        loadedConfig[field.key] = connection.name || ''
      } else if (field.key === 'tags') {
        loadedConfig[field.key] = connection.tags || ''
      } else if (field.type === 'checkbox') {
        // Handle boolean values properly
        const value = connection.config?.[field.key]
        loadedConfig[field.key] = value === true || value === 'true' || field.default === true
      } else if (field.type === 'checkbox-group') {
        loadedConfig[field.key] = connection.config?.[field.key] || field.default || []
      } else {
        loadedConfig[field.key] = connection.config?.[field.key] || field.default || ''
      }
    })
    return loadedConfig
  }

  useEffect(() => {
    if (activeMenu === 'connections') {
      fetchConnections()
      fetchTeams() // Fetch teams for search functionality
    } else if (activeMenu === 'teams') {
      fetchTeams()
    }
  }, [activeMenu])

  // Auto-select connection when navigating from dashboard
  useEffect(() => {
    if (location.state?.connectionId && connections.length > 0) {
      const connection = connections.find(c => c.id === location.state.connectionId)
      if (connection) {
        setSelectedConnection(connection)
        setConfig(loadConfigFromConnection(connection))
        // Capture initial field visibility state
        setInitialFieldVisibility(getFieldVisibility())
      }
      // Clear the navigation state
      navigate(location.pathname, { replace: true, state: {} })
    }
  }, [location.state, connections, navigate, location.pathname])

  useEffect(() => {
    if (selectedConnection) {
      setConfig(loadConfigFromConnection(selectedConnection))
      setTestResult(null)
    }
  }, [selectedConnection])

  useEffect(() => {
    if (selectedTeam) {
      setTeamConfig({
        name: selectedTeam.name || '',
        tags: selectedTeam.tags?.filter(t => t !== selectedTeam.name).join(', ') || ''
      })
    }
  }, [selectedTeam])

  const fetchConnections = async () => {
    try {
      setLoading(true)
      const response = await fetch(`${API_URL}/api/connections`)
      const data = await response.json()
      setConnections(data)
    } catch (err) {
      console.error('Failed to fetch connections:', err)
      setConnections([])
    } finally {
      setLoading(false)
    }
  }

  const fetchTeams = async () => {
    try {
      setLoading(true)
      const response = await fetch(`${API_URL}/api/teams`)
      const data = await response.json()
      setTeams(data)
    } catch (err) {
      console.error('Failed to fetch teams:', err)
      setTeams([])
    } finally {
      setLoading(false)
    }
  }

  const logPainChainEvent = async (eventType, eventData) => {
    try {
      await fetch(`${API_URL}/api/painchain/log`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          event_type: eventType,
          ...eventData
        })
      })
    } catch (err) {
      console.error('Failed to log PainChain event:', err)
    }
  }

  const handleToggleEnabled = async (connection, enabled) => {
    try {
      const response = await fetch(`${API_URL}/api/connections/${connection.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: connection.name,
          enabled: enabled,
          config: connection.config,
          tags: connection.tags
        })
      })

      if (response.ok) {
        const updatedConnection = await response.json()

        // Update the connections list
        await fetchConnections()

        // Update the selected connection if it's currently open
        if (selectedConnection && selectedConnection.id === connection.id) {
          setSelectedConnection({...selectedConnection, enabled: enabled})
        }

        // Log PainChain event
        await logPainChainEvent(
          enabled ? 'connector_enabled' : 'connector_disabled',
          {
            connector_name: connection.name,
            connector_type: connection.type
          }
        )
      } else {
        showToast('Failed to update connection', 'error')
      }
    } catch (err) {
      console.error('Failed to toggle connection:', err)
      showToast('Failed to update connection', 'error')
    }
  }

  const handleSave = async () => {
    if (!selectedConnection && !creatingNew) return

    try {
      setSaving(true)

      const connectorType = creatingNew ? newConnectionType : selectedConnection.type
      const connectorDef = connectorMetadata[connectorType]

      if (!connectorDef?.connectionForm?.fields) {
        showToast('Connector definition not loaded', 'error')
        return
      }

      // Build config object dynamically (exclude name, tags, enabled as they're top-level)
      const apiConfig = {}
      connectorDef.connectionForm.fields.forEach(field => {
        if (field.key !== 'name' && field.key !== 'tags' && field.key !== 'enabled') {
          let value = config[field.key]

          // Handle special conversions
          if (field.key === 'pollInterval') {
            apiConfig['poll_interval'] = parseInt(value) || 300
          } else if (field.type === 'checkbox') {
            apiConfig[field.key] = value === true || value === 'true'
          } else if (field.type === 'number') {
            apiConfig[field.key] = parseInt(value) || 0
          } else {
            apiConfig[field.key] = value
          }
        }
      })

      if (creatingNew) {
        // Create new connection
        const response = await fetch(`${API_URL}/api/connections`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: config.name,
            type: newConnectionType,
            enabled: config.enabled,
            config: apiConfig,
            tags: config.tags
          })
        })

        if (response.ok) {
          await fetchConnections()
          setCreatingNew(false)
          setNewConnectionType('')
          setConfig({})
          showToast('Connection created successfully!')

          // Log PainChain event
          await logPainChainEvent('connector_created', {
            connector_name: config.name,
            connector_type: newConnectionType
          })
        } else {
          showToast('Failed to create connection', 'error')
        }
      } else {
        // Update existing connection (enabled state is managed by toggle in list)
        const response = await fetch(`${API_URL}/api/connections/${selectedConnection.id}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: config.name,
            enabled: selectedConnection.enabled, // Keep existing enabled state
            config: apiConfig,
            tags: config.tags
          })
        })

        if (response.ok) {
          await fetchConnections()
          showToast('Configuration saved successfully!')

          // Log PainChain event for all connector updates
          // Detect changes
          const changes = {}

          // Helper to compare values (handles arrays)
          const valuesEqual = (a, b) => {
            // Exact match
            if (a === b) return true

            // Treat undefined, null, empty string, and empty array as equivalent
            const isEmpty = (val) =>
              val === undefined ||
              val === null ||
              val === '' ||
              (Array.isArray(val) && val.length === 0)

            if (isEmpty(a) && isEmpty(b)) return true

            // Array comparison
            if (Array.isArray(a) && Array.isArray(b)) {
              if (a.length !== b.length) return false
              return a.every((val, idx) => val === b[idx])
            }

            return false
          }

          if (selectedConnection.name !== config.name) {
            changes.name = { old: selectedConnection.name, new: config.name }
          }
          if (selectedConnection.tags !== config.tags) {
            changes.tags = { old: selectedConnection.tags, new: config.tags }
          }
          // Check config changes
          Object.keys(apiConfig).forEach(key => {
            const oldValue = selectedConnection.config?.[key]
            const newValue = apiConfig[key]

            // Skip if both are undefined/null/empty
            if ((oldValue === undefined || oldValue === null) &&
                (newValue === undefined || newValue === null)) {
              return
            }

            // Skip if old is undefined/null and new matches the default from config
            // (This happens when connection was created before field defaults were added)
            if ((oldValue === undefined || oldValue === null)) {
              const fieldDef = connectorDef.fields.find(f => f.key === key)
              if (fieldDef && valuesEqual(newValue, fieldDef.default)) {
                return
              }
            }

            if (!valuesEqual(oldValue, newValue)) {
              changes[key] = { old: oldValue, new: newValue }
            }
          })

          // Check field visibility changes
          const visibilityChanges = []
          const allEventTypes = new Set([
            ...Object.keys(initialFieldVisibility),
            ...Object.keys(fieldVisibility)
          ])

          allEventTypes.forEach(eventType => {
            const allFieldKeys = new Set([
              ...Object.keys(initialFieldVisibility[eventType] || {}),
              ...Object.keys(fieldVisibility[eventType] || {})
            ])

            allFieldKeys.forEach(fieldKey => {
              const oldVisible = initialFieldVisibility[eventType]?.[fieldKey] !== false
              const newVisible = fieldVisibility[eventType]?.[fieldKey] !== false
              if (oldVisible !== newVisible) {
                visibilityChanges.push({
                  event_type: eventType,
                  field: fieldKey,
                  old: oldVisible,
                  new: newVisible
                })
              }
            })
          })

          // Add visibility changes to the changes object
          if (visibilityChanges.length > 0) {
            changes.field_visibility = {
              old: visibilityChanges.map(v => {
                const eventTypeName = EVENT_TYPE_NAMES[v.event_type] || v.event_type
                const fieldLabel = FIELD_LABELS[v.event_type]?.[v.field] || v.field
                return `${eventTypeName} - ${fieldLabel}: ${v.old ? 'visible' : 'hidden'}`
              }),
              new: visibilityChanges.map(v => {
                const eventTypeName = EVENT_TYPE_NAMES[v.event_type] || v.event_type
                const fieldLabel = FIELD_LABELS[v.event_type]?.[v.field] || v.field
                return `${eventTypeName} - ${fieldLabel}: ${v.new ? 'visible' : 'hidden'}`
              })
            }
          }

          if (Object.keys(changes).length > 0) {
            await logPainChainEvent('connector_updated', {
              connector_name: config.name,
              connector_type: selectedConnection.type,
              changes: changes
            })
          }
        } else {
          showToast('Failed to save configuration', 'error')
        }
      }
    } catch (err) {
      console.error('Failed to save connection:', err)
      showToast('Failed to save configuration', 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!selectedConnection) return
    if (!confirm('Are you sure you want to delete this connection?')) return

    try {
      // Store connection details before deletion
      const connectionName = selectedConnection.name
      const connectionType = selectedConnection.type

      const response = await fetch(`${API_URL}/api/connections/${selectedConnection.id}`, {
        method: 'DELETE'
      })

      if (response.ok) {
        await fetchConnections()
        setSelectedConnection(null)
        showToast('Connection deleted successfully!')

        // Log PainChain event
        await logPainChainEvent('connector_deleted', {
          connector_name: connectionName,
          connector_type: connectionType
        })
      } else {
        showToast('Failed to delete connection', 'error')
      }
    } catch (err) {
      console.error('Failed to delete connection:', err)
      showToast('Failed to delete connection', 'error')
    }
  }

  const handleTestConnection = async () => {
    const connectorType = creatingNew ? newConnectionType : selectedConnection?.type
    const connectorDef = connectorMetadata[connectorType]

    if (!connectorDef?.connectionForm?.fields) return

    setTesting(true)
    setTestResult(null)

    try {
      // Build config object for test
      const testConfig = {}
      connectorDef.connectionForm.fields.forEach(field => {
        if (field.key !== 'name' && field.key !== 'tags') {
          let value = config[field.key]

          if (field.key === 'pollInterval') {
            testConfig['poll_interval'] = parseInt(value) || 300
          } else if (field.type === 'checkbox') {
            testConfig[field.key] = value === true || value === 'true'
          } else if (field.type === 'number') {
            testConfig[field.key] = parseInt(value) || 0
          } else {
            testConfig[field.key] = value
          }
        }
      })

      const response = await fetch(`${API_URL}/api/connections/test`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: connectorType,
          config: testConfig
        })
      })

      const result = await response.json()
      setTestResult(result)

      if (result.success) {
        showToast(result.message, 'success')
      } else {
        showToast(result.message, 'error')
      }
    } catch (err) {
      console.error('Failed to test connection:', err)
      setTestResult({
        success: false,
        message: 'Connection test failed: ' + err.message
      })
      showToast('Connection test failed', 'error')
    } finally {
      setTesting(false)
    }
  }

  const handleTeamSave = async () => {
    try {
      setSaving(true)

      if (selectedTeam) {
        // Update existing team
        const response = await fetch(`${API_URL}/api/teams/${selectedTeam.id}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            tags: teamConfig.tags
          })
        })

        if (response.ok) {
          await fetchTeams()
          setSelectedTeam(null)
          showToast('Team updated successfully!')
        } else {
          showToast('Failed to update team', 'error')
        }
      } else {
        // Create new team
        const response = await fetch(`${API_URL}/api/teams`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: teamConfig.name,
            tags: teamConfig.tags
          })
        })

        if (response.ok) {
          await fetchTeams()
          setTeamConfig({ name: '', tags: '' })
          showToast('Team created successfully!')
        } else {
          showToast('Failed to create team', 'error')
        }
      }
    } catch (err) {
      console.error('Failed to save team:', err)
      showToast('Failed to save team', 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteTeam = async (teamId) => {
    if (!confirm('Are you sure you want to delete this team?')) return

    try {
      const response = await fetch(`${API_URL}/api/teams/${teamId}`, {
        method: 'DELETE'
      })

      if (response.ok) {
        await fetchTeams()
        setSelectedTeam(null)
        showToast('Team deleted successfully!')
      } else {
        showToast('Failed to delete team', 'error')
      }
    } catch (err) {
      console.error('Failed to delete team:', err)
      showToast('Failed to delete team', 'error')
    }
  }

  const handleCreateNew = (type) => {
    setCreatingNew(true)
    setNewConnectionType(type)
    setSelectedConnection(null)
    setConfig(initializeConfig(type))
    setTestResult(null)
    // Capture initial field visibility state
    setInitialFieldVisibility(getFieldVisibility())
  }

  const groupConnectionsByType = () => {
    const grouped = {}
    const query = searchQuery.toLowerCase()

    connectorTypes.forEach(type => {
      let typeConnections = connections.filter(c => c.type === type.id)

      // Apply search filter if query exists
      if (query) {
        typeConnections = typeConnections.filter(c => {
          const matchesName = c.name.toLowerCase().includes(query)
          const matchesType = type.name.toLowerCase().includes(query)

          // Search in tags
          const tags = c.tags ? c.tags.toLowerCase().split(',').map(t => t.trim()) : []
          const matchesTags = tags.some(tag => tag.includes(query))

          // Search in team names and team tags
          const connectionTags = c.tags ? c.tags.split(',').map(t => t.trim()) : []
          const matchesTeam = teams.some(team => {
            // Check if team name matches
            if (team.name.toLowerCase().includes(query)) {
              // Check if this connection has any tag that the team subscribes to
              if (team.tags && Array.isArray(team.tags)) {
                return team.tags.some(teamTag =>
                  connectionTags.some(connTag => connTag.toLowerCase() === teamTag.toLowerCase())
                )
              }
            }
            return false
          })

          return matchesName || matchesType || matchesTags || matchesTeam
        })
      }

      // Sort alphabetically by name
      grouped[type.id] = typeConnections.sort((a, b) => a.name.localeCompare(b.name))
    })
    return grouped
  }

  return (
    <div className="settings-page">
      <div className="settings-page-header">
        <button className="back-to-dashboard" onClick={() => navigate('/')}>
          ← Back to Dashboard
        </button>
        <h1>Settings</h1>
      </div>

      <div className="settings-content">
        <div className="settings-sidebar">
          <div className="settings-section">
            <h3>CONFIGURATION</h3>
            <div className="settings-menu">
              <div
                className={`menu-item ${activeMenu === 'connections' ? 'active' : ''}`}
                onClick={() => {
                  setActiveMenu('connections')
                  setSelectedConnection(null)
                  setSelectedTeam(null)
                  setCreatingNew(false)
                }}
              >
                Connections
              </div>
              <div
                className={`menu-item ${activeMenu === 'teams' ? 'active' : ''}`}
                onClick={() => {
                  setActiveMenu('teams')
                  setSelectedConnection(null)
                  setSelectedTeam(null)
                  setCreatingNew(false)
                }}
              >
                Teams
              </div>
            </div>
          </div>
        </div>

        <div className="settings-main">
          {activeMenu === 'connections' ? (
            <>
              <div className="settings-main-header">
                <h2>Connections</h2>
                <p>Configure your data source connections</p>
              </div>

              <div className="search-container">
                <input
                  type="text"
                  className="search-input"
                  placeholder="Search by connection name, type, tags, or team..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                {searchQuery && (
                  <button
                    className="search-clear-btn"
                    onClick={() => setSearchQuery('')}
                    title="Clear search"
                  >
                    ×
                  </button>
                )}
              </div>

          {loading ? (
            <p>Loading connections...</p>
          ) : (
            <>
              {(() => {
                const hasResults = connectorTypes.some(type => {
                  const typeConnections = groupConnectionsByType()[type.id]
                  return typeConnections.length > 0 || !searchQuery
                })

                if (searchQuery && !hasResults) {
                  return (
                    <div className="no-results">
                      <p>No connections found matching "{searchQuery}"</p>
                      <p className="no-results-hint">Try a different search term or clear the search to see all connections.</p>
                    </div>
                  )
                }

                return null
              })()}

              {connectorTypes.map(connectorType => {
                const typeConnections = groupConnectionsByType()[connectorType.id]

                // Hide connector type groups with no matches when searching
                if (searchQuery && typeConnections.length === 0) {
                  return null
                }

                return (
                  <div key={connectorType.id} className="connector-type-group">
                    <div className="connector-type-header">
                      <div className="connector-type-info">
                        <img src={getConnectorLogoUrl(connectorType.id)} alt={connectorType.name} className="connector-type-logo" />
                        <h3>{connectorType.name}</h3>
                      </div>
                      <button className="btn-add-connection" onClick={() => handleCreateNew(connectorType.id)}>
                        + Add Connection
                      </button>
                    </div>
                    {typeConnections.length > 0 && (
                      <div className="connection-list">
                        {typeConnections.map((connection) => (
                          <div
                            key={connection.id}
                            className={`connector-item ${selectedConnection?.id === connection.id ? 'selected' : ''}`}
                            onClick={() => {
                              setSelectedConnection(connection)
                              setConfig(loadConfigFromConnection(connection))
                              setCreatingNew(false)
                              setTestResult(null)
                              // Capture initial field visibility state
                              setInitialFieldVisibility(getFieldVisibility())
                            }}
                            style={{ cursor: 'pointer' }}
                          >
                            <div className="connector-info">
                              <span className="connector-name">{connection.name}</span>
                            </div>
                            <div className="connector-status">
                              <span className={connection.enabled ? "status-enabled-mini" : "status-disabled-mini"}>
                                {connection.enabled ? "Enabled" : "Disabled"}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </>
          )}

        {(selectedConnection || creatingNew) && (
          <div className="settings-detail">
            <div className="detail-header">
              <button className="back-btn" onClick={() => { setSelectedConnection(null); setCreatingNew(false); }}>×</button>
              <div className="detail-header-content">
                <h3>{creatingNew ? `New ${connectorTypes.find(t => t.id === newConnectionType)?.name} Connection` : selectedConnection.name}</h3>
                {!creatingNew && selectedConnection && (
                  <label className="toggle-inline-header" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selectedConnection.enabled}
                      onChange={(e) => handleToggleEnabled(selectedConnection, e.target.checked)}
                    />
                    <span className="toggle-slider-inline"></span>
                  </label>
                )}
              </div>
            </div>
            <div className="detail-content">
              <div className="config-section">
                <h4>Configuration</h4>
                {(() => {
                  const connectorType = creatingNew ? newConnectionType : selectedConnection?.type
                  const connectorDef = connectorMetadata[connectorType]

                  if (!connectorDef?.connectionForm?.fields) return null

                  return connectorDef.connectionForm.fields.map((field) => {
                    // Handle conditional fields
                    if (field.conditionalOn) {
                      const conditionMet = config[field.conditionalOn] === true || config[field.conditionalOn] === 'true'
                      if (!conditionMet) return null
                    }

                    // Render checkbox fields differently
                    if (field.type === 'checkbox') {
                      return (
                        <div key={field.key} className="form-group">
                          <label className="checkbox-label">
                            <span>{field.label}</span>
                            <input
                              type="checkbox"
                              checked={config[field.key] === true || config[field.key] === 'true'}
                              onChange={(e) => setConfig({...config, [field.key]: e.target.checked})}
                            />
                            <span className="checkbox-toggle"></span>
                          </label>
                          {field.help && <span className="form-help">{field.help}</span>}
                        </div>
                      )
                    }

                    // Render checkbox-group fields
                    if (field.type === 'checkbox-group') {
                      const selectedValues = Array.isArray(config[field.key]) ? config[field.key] : []

                      return (
                        <div key={field.key} className="form-group">
                          <label>{field.label}</label>
                          {field.help && <span className="form-help" style={{ marginBottom: '8px', display: 'block' }}>{field.help}</span>}
                          <div className="checkbox-group">
                            {field.options?.map((option) => (
                              <label key={option.value} className="checkbox-group-item">
                                <input
                                  type="checkbox"
                                  checked={selectedValues.includes(option.value)}
                                  onChange={(e) => {
                                    const newValues = e.target.checked
                                      ? [...selectedValues, option.value]
                                      : selectedValues.filter(v => v !== option.value)
                                    setConfig({...config, [field.key]: newValues})
                                  }}
                                />
                                <span>{option.label}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      )
                    }

                    // Render regular input fields
                    return (
                      <div key={field.key} className="form-group">
                        <label>{field.label}</label>
                        <input
                          type={field.type}
                          placeholder={field.placeholder}
                          className="form-input"
                          value={config[field.key] || ''}
                          onChange={(e) => setConfig({...config, [field.key]: e.target.value})}
                          required={field.required}
                          min={field.min}
                          max={field.max}
                        />
                        {field.help && <span className="form-help">{field.help}</span>}
                      </div>
                    )
                  })
                })()}

                <button
                  className="btn-test-connection"
                  onClick={handleTestConnection}
                  disabled={testing}
                  style={{ marginTop: '16px' }}
                >
                  {testing ? 'Testing...' : 'Test Connection'}
                </button>

                {testResult && (
                  <div className={`test-result ${testResult.success ? 'success' : 'error'}`}>
                    <span className={testResult.success ? 'test-success-icon' : 'test-error-icon'}>
                      {testResult.success ? '✓' : '✗'}
                    </span>
                    {testResult.message}
                    {testResult.details && (
                      <div className="test-details">
                        {Object.entries(testResult.details).map(([key, value]) => (
                          <div key={key}>
                            <strong>{key}:</strong> {value}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {!creatingNew && selectedConnection && (
                <div className="config-section">
                  <h4>Field Visibility</h4>
                  <p className="section-description">Customize which fields appear when expanding events from this connector type</p>
                  <div className="field-visibility-grid">
                    {CONNECTOR_EVENT_TYPES[selectedConnection.type]?.map((eventType) => (
                      <div key={eventType} className="event-type-section">
                        <h5 className="event-type-title">{EVENT_TYPE_NAMES[eventType]}</h5>
                        <div className="field-checkboxes">
                          {Object.keys(FIELD_LABELS[eventType] || {}).map((fieldKey) => (
                            <label key={fieldKey} className="field-checkbox-label">
                              <input
                                type="checkbox"
                                checked={fieldVisibility[eventType]?.[fieldKey] !== false}
                                onChange={() => {
                                  const newVisibility = toggleField(eventType, fieldKey)
                                  setFieldVisibility(newVisibility)
                                }}
                              />
                              <span>{FIELD_LABELS[eventType][fieldKey]}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="detail-footer">
                <button
                  className="btn-save"
                  onClick={handleSave}
                  disabled={saving || !config.name}
                >
                  {saving ? 'Saving...' : (creatingNew ? 'Create Connection' : 'Save Changes')}
                </button>
                {selectedConnection && (
                  <button
                    className="btn-delete"
                    onClick={handleDelete}
                    style={{ marginTop: '8px' }}
                  >
                    Delete Connection
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
          </>
          ) : activeMenu === 'teams' ? (
            <>
              <div className="settings-main-header">
                <h2>Teams</h2>
                <p>Manage teams and their tag subscriptions</p>
              </div>

              {!selectedTeam && (
                <div className="create-team-form">
                  <h3>Create New Team</h3>
                  <div className="form-group">
                    <label>Team Name</label>
                    <input
                      type="text"
                      placeholder="Enter team name"
                      className="form-input"
                      value={teamConfig.name}
                      onChange={(e) => setTeamConfig({...teamConfig, name: e.target.value})}
                    />
                    <span className="form-help">Team name will become the first immutable tag.</span>
                  </div>
                  <div className="form-group">
                    <label>Additional Tags</label>
                    <input
                      type="text"
                      placeholder="tag1,tag2,tag3"
                      className="form-input"
                      value={teamConfig.tags}
                      onChange={(e) => setTeamConfig({...teamConfig, tags: e.target.value})}
                    />
                    <span className="form-help">Comma-separated list of tags to subscribe to.</span>
                  </div>
                  <button className="btn-save" onClick={handleTeamSave} disabled={saving || !teamConfig.name}>
                    {saving ? 'Creating...' : 'Create Team'}
                  </button>
                </div>
              )}

              {loading ? (
                <p>Loading teams...</p>
              ) : (
                <div className="connector-list" style={{ marginTop: '24px' }}>
                  {teams.map((team) => (
                    <div
                      key={team.id}
                      className={`connector-item ${selectedTeam?.id === team.id ? 'selected' : ''}`}
                      onClick={() => setSelectedTeam(team)}
                    >
                      <div className="connector-info">
                        <span className="connector-name">{team.name}</span>
                      </div>
                      <div className="connector-status">
                        <span className="status-enabled">{team.tags?.length || 0} tags</span>
                        <span className="arrow">›</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : null}
        </div>

        {selectedTeam && (
          <div className="settings-detail">
            <div className="detail-header">
              <button className="back-btn" onClick={() => setSelectedTeam(null)}>×</button>
              <h3>{selectedTeam.name}</h3>
            </div>
            <div className="detail-content">
              <div className="config-section">
                <h4>Team Tags</h4>
                <div className="form-group">
                  <label>Base Tag (Immutable)</label>
                  <input
                    type="text"
                    className="form-input"
                    value={selectedTeam.name}
                    disabled
                  />
                  <span className="form-help">The team name is automatically included as the first tag.</span>
                </div>
                <div className="form-group">
                  <label>Additional Tags</label>
                  <input
                    type="text"
                    placeholder="tag1,tag2,tag3"
                    className="form-input"
                    value={teamConfig.tags}
                    onChange={(e) => setTeamConfig({...teamConfig, tags: e.target.value})}
                  />
                  <span className="form-help">Comma-separated list of tags to subscribe to.</span>
                </div>
                <div className="form-group">
                  <label>All Tags</label>
                  <div className="labels-list">
                    {selectedTeam.tags?.map((tag, idx) => (
                      <span key={idx} className="label-tag">{tag}</span>
                    ))}
                  </div>
                </div>
              </div>
              <div className="detail-footer">
                <button
                  className="btn-save"
                  onClick={handleTeamSave}
                  disabled={saving}
                >
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
                <button
                  className="btn-delete"
                  onClick={() => handleDeleteTeam(selectedTeam.id)}
                  style={{ marginTop: '8px' }}
                >
                  Delete Team
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default Settings
