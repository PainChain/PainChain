import { useState, useEffect } from 'react'
import githubLogo from '../assets/logos/github.svg'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const connectorLogos = {
  github: githubLogo,
}

function Dashboard() {
  const [changes, setChanges] = useState([])
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [sourceFilter, setSourceFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [expandedEvents, setExpandedEvents] = useState(new Set())

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 30000)
    return () => clearInterval(interval)
  }, [sourceFilter, statusFilter])

  const fetchData = async () => {
    try {
      setLoading(true)

      const params = new URLSearchParams()
      if (sourceFilter) params.append('source', sourceFilter)
      if (statusFilter) params.append('status', statusFilter)

      const changesRes = await fetch(`${API_URL}/api/changes?${params}`)
      const changesData = await changesRes.json()
      setChanges(changesData)

      const statsRes = await fetch(`${API_URL}/api/stats`)
      const statsData = await statsRes.json()
      setStats(statsData)

      setError(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleString()
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
          {Object.entries(stats.by_source).map(([source, count]) => (
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
          </select>
        </div>
        <div className="filter-group">
          <label>Status:</label>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All</option>
            <option value="open">Open</option>
            <option value="closed">Closed</option>
            <option value="merged">Merged</option>
            <option value="published">Published</option>
          </select>
        </div>
        <button onClick={fetchData} className="refresh-btn">
          Refresh
        </button>
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
                            className="connector-logo"
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
                    {change.description?.text && (
                      <p className="change-description">
                        {isExpanded
                          ? change.description.text
                          : `${change.description.text.substring(0, 200)}${change.description.text.length > 200 ? '...' : ''}`
                        }
                      </p>
                    )}
                    {change.metadata?.repository && (
                      <div className="change-repo">
                        Repository: {change.metadata.repository}
                      </div>
                    )}

                    {isExpanded && (
                      <div className="change-details">
                        {change.metadata && (
                          <div className="metadata-section">
                            <h4>Metadata</h4>
                            <div className="metadata-grid">
                              {Object.entries(change.metadata).map(([key, value]) => (
                                <div key={key} className="metadata-item">
                                  <span className="metadata-key">{key}:</span>
                                  <span className="metadata-value">
                                    {typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {change.description?.labels && change.description.labels.length > 0 && (
                          <div className="labels-section">
                            <h4>Labels</h4>
                            <div className="labels-list">
                              {change.description.labels.map((label, idx) => (
                                <span key={idx} className="label-tag">{label}</span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    <div className="change-footer">
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
                )
              })}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export default Dashboard
