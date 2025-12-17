import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import DateTimePicker from '../components/DateTimePicker'
import TagsDropdown from '../components/TagsDropdown'
import Timeline from '../components/Timeline'
import { isFieldVisible, loadFieldVisibilityDefaults } from '../utils/fieldVisibility'
import { getConnectorLogoUrl } from '../utils/connectorMetadata'
import { EVENT_TYPE_CONFIG } from '../utils/eventConfigLoader'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

/**
 * Event type configurations are now auto-discovered from connector plugins!
 *
 * To add a new connector with custom event rendering:
 * 1. Create /connectors/{connector-name}/eventConfig.jsx
 * 2. Export a {connectorName}EventConfig object with event type configs
 * 3. Import and add it to the eventConfigLoader.js
 *
 * Event type config structure:
 * {
 *   'EventType': {
 *     titleMatch: '[Event]',  // String to match in event title
 *     sections: [{
 *       title: 'Section Title',
 *       fields: [
 *         { key: 'field_key', label: 'Display Label', value: (event) => event.metadata?.field }
 *       ],
 *       lists: [
 *         { key: 'list_key', title: 'List Title', getValue: (event) => event.description?.items }
 *       ]
 *     }]
 *   }
 * }
 */

// EVENT_TYPE_CONFIG is now imported from eventConfigLoader
// No need to define it here - it's auto-discovered from connector plugins!

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

  // Load field visibility defaults from connector metadata on mount
  useEffect(() => {
    loadFieldVisibilityDefaults()
  }, [])

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
        <div className="filter-group">
          <label>Tags:</label>
          <TagsDropdown
            availableTags={getAllTags()}
            selectedTags={tagFilter}
            onChange={setTagFilter}
          />
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

                    {change.source === 'kubernetes' && (change.metadata?.cluster || change.metadata?.namespace || change.description?.namespace) && (
                      <div className="change-repo">
                        {change.metadata?.cluster && <span>Cluster: {change.metadata.cluster}</span>}
                        {change.metadata?.cluster && (change.metadata?.namespace || change.description?.namespace) && <span> • </span>}
                        {(change.metadata?.namespace || change.description?.namespace) && (
                          <span>Namespace: {change.metadata.namespace || change.description.namespace}</span>
                        )}
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
