import { useState, useEffect } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceArea, ReferenceLine } from 'recharts'
import './Timeline.css'
import { getAllConnectorColors } from '../utils/connectorMetadata'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

function Timeline({ sourceFilter, startDate, endDate, tagFilter, onTimeRangeChange }) {
  const [timelineData, setTimelineData] = useState([])
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState(null)
  const [interval, setInterval] = useState('hour')
  const [selectionStart, setSelectionStart] = useState(null)
  const [hoverIndex, setHoverIndex] = useState(null)
  const [showLegend, setShowLegend] = useState(true)
  const [colors, setColors] = useState({
    github: '#00E8A0',
    gitlab: '#fc6d26',
    kubernetes: '#326ce5',
    painchain: '#9f7aea'
  })

  // Load connector colors on mount
  useEffect(() => {
    const loadColors = async () => {
      const connectorColors = await getAllConnectorColors()
      setColors(connectorColors)
    }
    loadColors()
  }, [])

  useEffect(() => {
    const fetchTimeline = async () => {
      try {
        setLoading(true)

        const params = new URLSearchParams()
        if (sourceFilter) params.append('source', sourceFilter)

        // If no dates selected, use rolling 24-hour window (computed at fetch time)
        const effectiveStartDate = startDate || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
        const effectiveEndDate = endDate || new Date().toISOString()

        params.append('start_date', effectiveStartDate)
        params.append('end_date', effectiveEndDate)

        if (tagFilter && tagFilter.length > 0) {
          tagFilter.forEach(tag => params.append('tag', tag))
        }

        const response = await fetch(`${API_URL}/api/timeline?${params}`)
        const data = await response.json()

        setTimelineData(data.bins || [])
        setStats(data.by_source || {})
        setInterval(data.interval || 'hour')
      } catch (err) {
        console.error('Failed to fetch timeline:', err)
      } finally {
        setLoading(false)
      }
    }

    fetchTimeline()

    // Auto-refresh timeline every 30 seconds to keep rolling window current
    const refreshInterval = setInterval(fetchTimeline, 30000)
    return () => clearInterval(refreshInterval)
  }, [sourceFilter, startDate, endDate, tagFilter])

  const handleBarClick = (data, index) => {
    if (!onTimeRangeChange || !data) return

    // Direct bar click - filter to just this bar's time range
    const bin = timelineData[index]
    if (!bin) return

    const startTime = new Date(bin.time)
    const endTime = new Date(bin.time)

    // Add bin width to get end time
    if (timelineData.length > 1) {
      const binWidth = new Date(timelineData[1].time) - new Date(timelineData[0].time)
      endTime.setTime(endTime.getTime() + binWidth)
    }

    setSelectionStart(null)
    onTimeRangeChange(startTime.toISOString(), endTime.toISOString())
  }

  const handleChartClick = (e) => {
    if (!onTimeRangeChange) return

    // Get the index of the clicked position
    const clickedIndex = e?.activeTooltipIndex

    // If we clicked on a specific position
    if (clickedIndex !== undefined && clickedIndex !== null) {
      // If no selection started, this is the first click
      if (selectionStart === null) {
        setSelectionStart(clickedIndex)
        return
      }

      // If selection started, this is the second click - apply the range
      const startIndex = Math.min(selectionStart, clickedIndex)
      const endIndex = Math.max(selectionStart, clickedIndex)

      const startBin = timelineData[startIndex]
      const endBin = timelineData[endIndex]

      if (startBin && endBin) {
        const startTime = new Date(startBin.time)
        const endTime = new Date(endBin.time)

        // For the end time, add the bin width to include the full last bin
        if (timelineData.length > 1) {
          const binWidth = new Date(timelineData[1].time) - new Date(timelineData[0].time)
          endTime.setTime(endTime.getTime() + binWidth)
        }

        setSelectionStart(null)
        onTimeRangeChange(startTime.toISOString(), endTime.toISOString())
      }
    } else {
      // Clicked outside any position - clear selection
      setSelectionStart(null)
    }
  }

  const handleMouseMove = (e) => {
    if (e && e.activeTooltipIndex !== undefined) {
      setHoverIndex(e.activeTooltipIndex)
    }
  }

  const handleMouseLeave = () => {
    setHoverIndex(null)
  }

  const formatXAxis = (timestamp) => {
    const date = new Date(timestamp)

    // Format based on the interval type
    if (interval === 'second' || interval === 'minute') {
      return date.toLocaleString(undefined, {
        hour: '2-digit',
        minute: '2-digit'
      })
    } else if (interval === 'hour') {
      return date.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit'
      })
    } else {
      return date.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric'
      })
    }
  }

  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      return (
        <div className="timeline-tooltip">
          <p className="tooltip-label">{formatXAxis(label)}</p>
          {payload.map((entry, index) => (
            <p key={index} className="tooltip-entry" style={{ color: entry.color }}>
              {entry.name}: {entry.value}
            </p>
          ))}
          <p className="tooltip-total">Total: {payload.reduce((sum, entry) => sum + entry.value, 0)}</p>
        </div>
      )
    }
    return null
  }

  if (loading) {
    return (
      <div className="timeline-container">
        <p className="timeline-loading">Loading timeline...</p>
      </div>
    )
  }

  // Ensure all timeline data has required fields to prevent crashes
  const safeTimelineData = timelineData.filter(bin =>
    bin && bin.time && typeof bin.total === 'number'
  )

  if (safeTimelineData.length === 0) {
    return (
      <div className="timeline-container">
        <div className="timeline-empty">No events to display</div>
      </div>
    )
  }

  return (
    <div className="timeline-container">
      <div className="timeline-header">
        <div className="timeline-title">
          <div className="timeline-title-left">
            <h3>Events Timeline</h3>
            {safeTimelineData.length > 0 && (
              <>
                <span className="timeline-range">
                  {new Date(safeTimelineData[0].time).toLocaleString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                  })}
                  {' → '}
                  {new Date(safeTimelineData[safeTimelineData.length - 1].time).toLocaleString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                  })}
                </span>
                <span className="timeline-info">
                  Showing {interval === 'hour' ? 'hourly' : interval === 'day' ? 'daily' : 'per-minute'} bins • Updates every 30s
                </span>
              </>
            )}
            {selectionStart !== null && (
              <span className="timeline-instruction">
                Click again to set time range (or click outside to cancel)
              </span>
            )}
          </div>
          <button
            className="legend-toggle"
            onClick={() => setShowLegend(!showLegend)}
            title={showLegend ? "Hide legend" : "Show legend"}
          >
            {showLegend ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                <circle cx="12" cy="12" r="3"></circle>
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                <line x1="1" y1="1" x2="23" y2="23"></line>
              </svg>
            )}
          </button>
        </div>
      </div>
      <div className="timeline-content">
        <div className="timeline-chart">
          <ResponsiveContainer width="100%" height={200}>
        <BarChart
          data={safeTimelineData}
          margin={{ top: 10, right: 10, left: 0, bottom: 20 }}
          barCategoryGap="1%"
          onClick={handleChartClick}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#2a3142" />
          <XAxis
            dataKey="time"
            tickFormatter={formatXAxis}
            tick={{ fill: '#808080', fontSize: 11 }}
            stroke="#3a4152"
            angle={-45}
            textAnchor="end"
            height={60}
          />
          <YAxis
            tick={{ fill: '#808080', fontSize: 11 }}
            stroke="#3a4152"
            allowDecimals={false}
          />
          <Tooltip content={<CustomTooltip />} />

          {/* Cursor line */}
          {hoverIndex !== null && selectionStart === null && (
            <ReferenceLine
              x={safeTimelineData[hoverIndex]?.time}
              stroke="#00E8A0"
              strokeWidth={2}
              strokeDasharray="3 3"
            />
          )}

          {/* Selection start line */}
          {selectionStart !== null && (
            <ReferenceLine
              x={safeTimelineData[selectionStart]?.time}
              stroke="#00FF00"
              strokeWidth={2}
            />
          )}

          {/* Highlighted region when selecting */}
          {selectionStart !== null && hoverIndex !== null && (
            <ReferenceArea
              x1={safeTimelineData[Math.min(selectionStart, hoverIndex)]?.time}
              x2={safeTimelineData[Math.max(selectionStart, hoverIndex)]?.time}
              fill="#00E8A0"
              fillOpacity={0.2}
              strokeOpacity={0.8}
              stroke="#00E8A0"
            />
          )}

          {stats.painchain !== undefined && (
            <Bar
              dataKey="painchain"
              stackId="a"
              name="PainChain"
              fill={colors.painchain}
              onClick={(data, index) => {
                if (data && data.painchain > 0) {
                  handleBarClick(data, index)
                }
              }}
              cursor="pointer"
            />
          )}
          {stats.kubernetes !== undefined && (
            <Bar
              dataKey="kubernetes"
              stackId="a"
              name="Kubernetes"
              fill={colors.kubernetes}
              onClick={(data, index) => {
                if (data && data.kubernetes > 0) {
                  handleBarClick(data, index)
                }
              }}
              cursor="pointer"
            />
          )}
          {stats.gitlab !== undefined && (
            <Bar
              dataKey="gitlab"
              stackId="a"
              name="GitLab"
              fill={colors.gitlab}
              onClick={(data, index) => {
                if (data && data.gitlab > 0) {
                  handleBarClick(data, index)
                }
              }}
              cursor="pointer"
            />
          )}
          {stats.github !== undefined && (
            <Bar
              dataKey="github"
              stackId="a"
              name="GitHub"
              fill={colors.github}
              onClick={(data, index) => {
                // Only treat as direct bar click if there's actual data
                if (data && data.github > 0) {
                  handleBarClick(data, index)
                }
              }}
              cursor="pointer"
            />
          )}
        </BarChart>
      </ResponsiveContainer>
        </div>
        {showLegend && (
          <div className="timeline-legend">
            {Object.entries(stats).sort(([a], [b]) => a.localeCompare(b)).map(([source, count]) => (
              <div key={source} className="timeline-stat">
                <span className="stat-dot" style={{ backgroundColor: colors[source] }}></span>
                <span className="stat-label">{source}: {count}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default Timeline
