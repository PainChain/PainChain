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
  const [connectors, setConnectors] = useState([])
  const [selectedConnector, setSelectedConnector] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [config, setConfig] = useState({
    enabled: false,
    token: '',
    pollInterval: '300',
    repos: ''
  })

  useEffect(() => {
    fetchConnectors()
  }, [])

  useEffect(() => {
    if (selectedConnector) {
      setConfig({
        enabled: selectedConnector.enabled || false,
        token: selectedConnector.config?.token || '',
        pollInterval: selectedConnector.config?.poll_interval || '300',
        repos: selectedConnector.config?.repos || ''
      })
    }
  }, [selectedConnector])

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
            repos: config.repos
          }
        })
      })

      if (response.ok) {
        // Refresh connectors list
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
              <div className="menu-item active">Connectors</div>
            </div>
          </div>
        </div>

        <div className="settings-main">
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
        </div>

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
      </div>
    </div>
  )
}

export default Settings
