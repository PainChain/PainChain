import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import '../Settings.css'
import githubLogo from '../assets/logos/github.png'
import gitlabLogo from '../assets/logos/gitlab.png'
import kubernetesLogo from '../assets/logos/kubernetes.png'
import { getFieldVisibility, toggleField, resetToDefaults, FIELD_LABELS, EVENT_TYPE_NAMES } from '../utils/fieldVisibility'
import { useToast } from '../components/Toast'
import connectorConfigs from '../config/connectorConfigs.json'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const connectorLogos = {
  github: githubLogo,
  gitlab: gitlabLogo,
  kubernetes: kubernetesLogo,
}

const CONNECTOR_TYPES = [
  { id: 'github', name: 'GitHub' },
  { id: 'gitlab', name: 'GitLab' },
  { id: 'kubernetes', name: 'Kubernetes' },
]

// Map connector types to their event types
const CONNECTOR_EVENT_TYPES = {
  github: ['PR', 'Workflow', 'Commit', 'Release'],
  gitlab: ['MR', 'Pipeline', 'Commit', 'Release'],
  kubernetes: ['K8sDeployment', 'K8sStatefulSet', 'K8sDaemonSet', 'K8sService', 'K8sConfigMap', 'K8sSecret', 'K8sIngress']
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
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)

  // Helper to initialize config from connector definition
  const initializeConfig = (connectorType) => {
    const connectorDef = connectorConfigs[connectorType]
    if (!connectorDef) return {}

    const initialConfig = { enabled: false }
    connectorDef.fields.forEach(field => {
      if (field.type === 'checkbox') {
        initialConfig[field.key] = field.default === true || field.default === 'true'
      } else {
        initialConfig[field.key] = field.default || ''
      }
    })
    return initialConfig
  }

  // Helper to load config from connection data
  const loadConfigFromConnection = (connection) => {
    const connectorDef = connectorConfigs[connection.type]
    if (!connectorDef) return {}

    const loadedConfig = { enabled: connection.enabled }
    connectorDef.fields.forEach(field => {
      if (field.key === 'name') {
        loadedConfig[field.key] = connection.name || ''
      } else if (field.key === 'tags') {
        loadedConfig[field.key] = connection.tags || ''
      } else if (field.type === 'checkbox') {
        // Handle boolean values properly
        const value = connection.config?.[field.key]
        loadedConfig[field.key] = value === true || value === 'true' || field.default === true
      } else {
        loadedConfig[field.key] = connection.config?.[field.key] || field.default || ''
      }
    })
    return loadedConfig
  }

  useEffect(() => {
    if (activeMenu === 'connections') {
      fetchConnections()
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
      const connectorDef = connectorConfigs[connectorType]

      // Build config object dynamically (exclude name, tags, enabled as they're top-level)
      const apiConfig = {}
      connectorDef.fields.forEach(field => {
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
      const response = await fetch(`${API_URL}/api/connections/${selectedConnection.id}`, {
        method: 'DELETE'
      })

      if (response.ok) {
        await fetchConnections()
        setSelectedConnection(null)
        showToast('Connection deleted successfully!')
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
    const connectorDef = connectorConfigs[connectorType]

    if (!connectorDef) return

    setTesting(true)
    setTestResult(null)

    try {
      // Build config object for test
      const testConfig = {}
      connectorDef.fields.forEach(field => {
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
  }

  const groupConnectionsByType = () => {
    const grouped = {}
    CONNECTOR_TYPES.forEach(type => {
      const typeConnections = connections.filter(c => c.type === type.id)
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

          {loading ? (
            <p>Loading connections...</p>
          ) : (
            <>
              {CONNECTOR_TYPES.map(connectorType => {
                const typeConnections = groupConnectionsByType()[connectorType.id]
                return (
                  <div key={connectorType.id} className="connector-type-group">
                    <div className="connector-type-header">
                      <div className="connector-type-info">
                        {connectorLogos[connectorType.id] && (
                          <img src={connectorLogos[connectorType.id]} alt={connectorType.name} className="connector-type-logo" />
                        )}
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
                          >
                            <div className="connector-info">
                              <span className="connector-name">{connection.name}</span>
                            </div>
                            <div className="connector-status">
                              <span className={connection.enabled ? "status-enabled-mini" : "status-disabled-mini"}>
                                {connection.enabled ? "Enabled" : "Disabled"}
                              </span>
                              <button
                                className="btn-edit-connection"
                                onClick={() => { setSelectedConnection(connection); setCreatingNew(false); }}
                              >
                                Edit
                              </button>
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
                <h3>{creatingNew ? `New ${CONNECTOR_TYPES.find(t => t.id === newConnectionType)?.name} Connection` : selectedConnection.name}</h3>
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
                  const connectorDef = connectorConfigs[connectorType]

                  if (!connectorDef) return null

                  return connectorDef.fields.map((field) => {
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
