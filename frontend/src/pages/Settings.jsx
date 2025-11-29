import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import '../Settings.css'
import githubLogo from '../assets/logos/github.svg'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const connectorLogos = {
  github: githubLogo,
}

function Settings() {
  const navigate = useNavigate()
  const [activeMenu, setActiveMenu] = useState('connectors')
  const [connectors, setConnectors] = useState([])
  const [selectedConnector, setSelectedConnector] = useState(null)
  const [teams, setTeams] = useState([])
  const [selectedTeam, setSelectedTeam] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [config, setConfig] = useState({
    enabled: false,
    token: '',
    pollInterval: '300',
    repos: '',
    tags: ''
  })
  const [teamConfig, setTeamConfig] = useState({
    name: '',
    tags: ''
  })

  useEffect(() => {
    if (activeMenu === 'connectors') {
      fetchConnectors()
    } else if (activeMenu === 'teams') {
      fetchTeams()
    }
  }, [activeMenu])

  useEffect(() => {
    if (selectedConnector) {
      setConfig({
        enabled: selectedConnector.enabled || false,
        token: selectedConnector.config?.token || '',
        pollInterval: selectedConnector.config?.poll_interval || '300',
        repos: selectedConnector.config?.repos || '',
        tags: selectedConnector.config?.tags || ''
      })
    }
  }, [selectedConnector])

  useEffect(() => {
    if (selectedTeam) {
      setTeamConfig({
        name: selectedTeam.name || '',
        tags: selectedTeam.tags?.filter(t => t !== selectedTeam.name).join(', ') || ''
      })
    }
  }, [selectedTeam])

  const fetchConnectors = async () => {
    try {
      setLoading(true)
      const response = await fetch(`${API_URL}/api/connectors`)
      const data = await response.json()
      setConnectors(data)
    } catch (err) {
      console.error('Failed to fetch connectors:', err)
      // Fallback to default connectors if API fails
      setConnectors([
        { id: 'github', name: 'GitHub', enabled: false, type: 'github' },
        { id: 'jira', name: 'Jira', enabled: false, type: 'jira' },
        { id: 'gitlab', name: 'GitLab', enabled: false, type: 'gitlab' },
      ])
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

  const handleSave = async () => {
    if (!selectedConnector) return

    try {
      setSaving(true)
      const response = await fetch(`${API_URL}/api/connectors/${selectedConnector.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          enabled: config.enabled,
          config: {
            token: config.token,
            poll_interval: parseInt(config.pollInterval),
            repos: config.repos,
            tags: config.tags
          }
        })
      })

      if (response.ok) {
        await fetchConnectors()
        alert('Configuration saved successfully!')
      } else {
        alert('Failed to save configuration')
      }
    } catch (err) {
      console.error('Failed to save connector config:', err)
      alert('Failed to save configuration')
    } finally {
      setSaving(false)
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
          alert('Team updated successfully!')
        } else {
          alert('Failed to update team')
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
          alert('Team created successfully!')
        } else {
          alert('Failed to create team')
        }
      }
    } catch (err) {
      console.error('Failed to save team:', err)
      alert('Failed to save team')
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
        alert('Team deleted successfully!')
      } else {
        alert('Failed to delete team')
      }
    } catch (err) {
      console.error('Failed to delete team:', err)
      alert('Failed to delete team')
    }
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
                className={`menu-item ${activeMenu === 'connectors' ? 'active' : ''}`}
                onClick={() => {
                  setActiveMenu('connectors')
                  setSelectedConnector(null)
                  setSelectedTeam(null)
                }}
              >
                Connectors
              </div>
              <div
                className={`menu-item ${activeMenu === 'teams' ? 'active' : ''}`}
                onClick={() => {
                  setActiveMenu('teams')
                  setSelectedConnector(null)
                  setSelectedTeam(null)
                }}
              >
                Teams
              </div>
            </div>
          </div>
        </div>

        <div className="settings-main">
          {activeMenu === 'connectors' ? (
            <>
              <div className="settings-main-header">
                <h2>Connectors</h2>
                <p>Configure your data source connectors</p>
              </div>

          {loading ? (
            <p>Loading connectors...</p>
          ) : (
            <div className="connector-list">
              {connectors.map((connector) => (
                <div
                  key={connector.id}
                  className={`connector-item ${selectedConnector?.id === connector.id ? 'selected' : ''}`}
                  onClick={() => setSelectedConnector(connector)}
                >
                  <div className="connector-info">
                    <div className="connector-icon">
                      {connectorLogos[connector.id] && (
                        <img src={connectorLogos[connector.id]} alt={connector.name} />
                      )}
                    </div>
                    <span className="connector-name">{connector.name}</span>
                  </div>
                  <div className="connector-status">
                    {connector.enabled ? (
                      <span className="status-enabled">Enabled</span>
                    ) : (
                      <span className="status-disabled">Disabled</span>
                    )}
                    <span className="arrow">›</span>
                  </div>
                </div>
              ))}
            </div>
          )}

        {selectedConnector && (
          <div className="settings-detail">
            <div className="detail-header">
              <button className="back-btn" onClick={() => setSelectedConnector(null)}>×</button>
              <h3>{selectedConnector.name}</h3>
            </div>
            <div className="detail-content">
              <div className="toggle-group">
                <div className="toggle-item">
                  <div className="toggle-info">
                    <h4>Enable {selectedConnector.name}</h4>
                    <p>Activate this connector to start syncing data</p>
                  </div>
                  <label className="toggle">
                    <input
                      type="checkbox"
                      checked={config.enabled}
                      onChange={(e) => setConfig({...config, enabled: e.target.checked})}
                    />
                    <span className="toggle-slider"></span>
                  </label>
                </div>
              </div>
              <div className="config-section">
                <h4>Configuration</h4>
                <div className="form-group">
                  <label>Token</label>
                  <input
                    type="password"
                    placeholder="Enter API token"
                    className="form-input"
                    value={config.token}
                    onChange={(e) => setConfig({...config, token: e.target.value})}
                  />
                </div>
                <div className="form-group">
                  <label>Poll Interval (seconds)</label>
                  <input
                    type="number"
                    placeholder="300"
                    className="form-input"
                    value={config.pollInterval}
                    onChange={(e) => setConfig({...config, pollInterval: e.target.value})}
                  />
                </div>
                <div className="form-group">
                  <label>Repositories</label>
                  <input
                    type="text"
                    placeholder="owner/repo1,owner/repo2"
                    className="form-input"
                    value={config.repos}
                    onChange={(e) => setConfig({...config, repos: e.target.value})}
                  />
                  <span className="form-help">Comma-separated list. Leave empty for all repos.</span>
                </div>
                <div className="form-group">
                  <label>Tags</label>
                  <input
                    type="text"
                    placeholder="tag1,tag2,tag3"
                    className="form-input"
                    value={config.tags}
                    onChange={(e) => setConfig({...config, tags: e.target.value})}
                  />
                  <span className="form-help">Comma-separated tags for filtering events by team.</span>
                </div>
              </div>
              <div className="detail-footer">
                <button
                  className="btn-save"
                  onClick={handleSave}
                  disabled={saving}
                >
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
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
