import { useState, useEffect } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, ReferenceArea } from 'recharts'
import type { Event } from '../types/api'

interface TimelineBin {
  time: string
  total: number
  [key: string]: any // Dynamic connector counts
}

interface TimelineProps {
  events: Event[]
  onTimeRangeChange?: (start: string, end: string) => void
  startDate?: string
  endDate?: string
}

const CONNECTOR_COLORS: Record<string, string> = {
  github: '#00E8A0',
  gitlab: '#fc6d26',
  kubernetes: '#326ce5',
  painchain: '#9f7aea',
}

const CONNECTOR_DISPLAY_NAMES: Record<string, string> = {
  github: 'GitHub',
  gitlab: 'GitLab',
  kubernetes: 'Kubernetes',
  painchain: 'PainChain',
}

const getConnectorDisplayName = (connector: string): string => {
  return CONNECTOR_DISPLAY_NAMES[connector.toLowerCase()] ||
    connector.charAt(0).toUpperCase() + connector.slice(1)
}

export default function Timeline({ events, onTimeRangeChange, startDate, endDate }: TimelineProps) {
  const [timelineData, setTimelineData] = useState<TimelineBin[]>([])
  const [stats, setStats] = useState<Record<string, number>>({})
  const [selectionStart, setSelectionStart] = useState<number | null>(null)
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const [showLegend, setShowLegend] = useState(true)

  useEffect(() => {
    const startTime = performance.now()
    const connectorStats: Record<string, number> = {}

    // Find time range - use provided dates if available, otherwise derive from events
    let minTime: number
    let maxTime: number

    if (events.length === 0) {
      // Create empty buckets for the last 24 hours
      const now = new Date()
      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)
      minTime = oneDayAgo.getTime()
      maxTime = now.getTime()
    } else if (startDate && endDate) {
      minTime = new Date(startDate).getTime()
      maxTime = new Date(endDate).getTime()
    } else {
      const timestamps = events.map(e => new Date(e.timestamp).getTime())
      minTime = Math.min(...timestamps)
      maxTime = Math.max(...timestamps)
    }

    // Calculate time range
    let timeRange = maxTime - minTime

    // Handle edge case: all events at same time or very close together
    if (timeRange === 0) {
      timeRange = 60 * 60 * 1000 // 1 hour in milliseconds
    }

    // Always use 60 buckets regardless of time range
    const NUM_BUCKETS = 60
    const bucketSize = timeRange / NUM_BUCKETS

    // Create empty buckets
    const buckets: TimelineBin[] = []
    for (let i = 0; i < NUM_BUCKETS; i++) {
      const bucketTime = new Date(minTime + (i * bucketSize))
      buckets.push({
        time: bucketTime.toISOString(),
        total: 0
      })
    }

    // Assign events to buckets
    events.forEach(event => {
      const eventTime = new Date(event.timestamp).getTime()
      const bucketIndex = Math.min(
        Math.floor((eventTime - minTime) / bucketSize),
        NUM_BUCKETS - 1
      )

      if (buckets[bucketIndex]) {
        buckets[bucketIndex].total++
        buckets[bucketIndex][event.connector] = (buckets[bucketIndex][event.connector] || 0) + 1
      }
      connectorStats[event.connector] = (connectorStats[event.connector] || 0) + 1
    })

    // Debug: log bucket stats and timing
    const endTime = performance.now()
    const totalInBuckets = buckets.reduce((sum, b) => sum + b.total, 0)
    console.log('Timeline Processing:', {
      duration: `${(endTime - startTime).toFixed(2)}ms`,
      totalEvents: events.length,
      totalInBuckets,
      numBuckets: buckets.length,
      bucketSize: `${(bucketSize / (60 * 1000)).toFixed(1)} minutes`,
      timeRange: `${((maxTime - minTime) / (24 * 60 * 60 * 1000)).toFixed(2)} days`
    })

    setTimelineData(buckets)
    setStats(connectorStats)
  }, [events, startDate, endDate])

  const formatXAxis = (timestamp: string) => {
    const date = new Date(timestamp)
    return date.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const handleBarClick = (data: any, index: number) => {
    if (!onTimeRangeChange || !data) return

    const bin = timelineData[index]
    if (!bin || index >= timelineData.length - 1) return

    const startTime = new Date(bin.time)
    const nextBin = timelineData[index + 1]
    const endTime = nextBin ? new Date(nextBin.time) : new Date(bin.time)

    setSelectionStart(null)
    onTimeRangeChange(startTime.toISOString(), endTime.toISOString())
  }

  const handleChartClick = (e: any) => {
    if (!onTimeRangeChange) return

    const clickedIndex = e?.activeTooltipIndex

    if (clickedIndex !== undefined && clickedIndex !== null) {
      if (selectionStart === null) {
        setSelectionStart(clickedIndex)
        return
      }

      const startIndex = Math.min(selectionStart, clickedIndex)
      const endIndex = Math.max(selectionStart, clickedIndex)

      const startBin = timelineData[startIndex]
      const endBin = timelineData[endIndex]

      if (startBin && endBin) {
        const startTime = new Date(startBin.time)
        const nextBin = timelineData[endIndex + 1]
        const endTime = nextBin ? new Date(nextBin.time) : new Date(endBin.time)

        setSelectionStart(null)
        onTimeRangeChange(startTime.toISOString(), endTime.toISOString())
      }
    } else {
      setSelectionStart(null)
    }
  }

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const total = payload.reduce((sum: number, entry: any) => sum + entry.value, 0)

      return (
        <div style={{
          backgroundColor: 'rgba(26, 31, 46, 0.95)',
          border: '1px solid rgba(42, 49, 66, 0.8)',
          borderRadius: '8px',
          padding: '12px',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)'
        }}>
          <p style={{
            fontSize: '11px',
            fontWeight: '600',
            color: '#e1e4e8',
            borderBottom: '1px solid rgba(42, 49, 66, 0.8)',
            paddingBottom: '8px',
            marginBottom: '8px'
          }}>
            {new Date(label).toLocaleString(undefined, {
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit'
            })}
          </p>
          {total > 0 ? (
            <>
              {payload.map((entry: any, index: number) => (
                entry.value > 0 && (
                  <p key={index} style={{
                    fontSize: '11px',
                    fontWeight: '500',
                    margin: '4px 0',
                    color: entry.color
                  }}>
                    {entry.name}: {entry.value}
                  </p>
                )
              ))}
              <p style={{
                fontSize: '11px',
                fontWeight: '600',
                color: '#e1e4e8',
                borderTop: '1px solid rgba(42, 49, 66, 0.8)',
                paddingTop: '8px',
                marginTop: '8px'
              }}>
                Total: {total}
              </p>
            </>
          ) : (
            <p style={{ fontSize: '11px', color: '#808080' }}>No events</p>
          )}
        </div>
      )
    }
    return null
  }

  return (
    <div className="timeline-container">
      <div className="timeline-header">
        <div className="timeline-title">
          <div className="timeline-title-left">
            <h3>Events Timeline</h3>
            {timelineData.length > 0 && (
              <>
                <span className="timeline-range">
                  {new Date(timelineData[0].time).toLocaleString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                  })}
                  {' → '}
                  {new Date(timelineData[timelineData.length - 1].time).toLocaleString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                  })}
                </span>
              </>
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
              data={timelineData}
              margin={{ top: 10, right: 10, left: 0, bottom: 20 }}
              barCategoryGap="1%"
              onClick={handleChartClick}
              onMouseMove={(e) => {
                if (e && e.activeTooltipIndex !== undefined && typeof e.activeTooltipIndex === 'number') {
                  setHoverIndex(e.activeTooltipIndex)
                }
              }}
              onMouseLeave={() => setHoverIndex(null)}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#2a3142" />
              <XAxis
                dataKey="time"
                tickFormatter={formatXAxis}
                tick={{ fill: '#808080', fontSize: 10 }}
                stroke="#3a4152"
                angle={-45}
                textAnchor="end"
                height={60}
                interval="preserveStartEnd"
                minTickGap={50}
              />
              <YAxis
                tick={{ fill: '#808080', fontSize: 11 }}
                stroke="#3a4152"
                allowDecimals={false}
              />
              <Tooltip content={<CustomTooltip />} />

              {hoverIndex !== null && selectionStart === null && (
                <ReferenceLine
                  x={timelineData[hoverIndex]?.time}
                  stroke="#00E8A0"
                  strokeWidth={2}
                  strokeDasharray="3 3"
                />
              )}

              {selectionStart !== null && (
                <ReferenceLine
                  x={timelineData[selectionStart]?.time}
                  stroke="#00FF00"
                  strokeWidth={2}
                />
              )}

              {selectionStart !== null && hoverIndex !== null && (
                <ReferenceArea
                  x1={timelineData[Math.min(selectionStart, hoverIndex)]?.time}
                  x2={timelineData[Math.max(selectionStart, hoverIndex)]?.time}
                  fill="#00E8A0"
                  fillOpacity={0.2}
                  strokeOpacity={0.8}
                  stroke="#00E8A0"
                />
              )}

              {Object.keys(stats).sort().map((connector) => (
                <Bar
                  key={connector}
                  dataKey={connector}
                  stackId="a"
                  name={getConnectorDisplayName(connector)}
                  fill={CONNECTOR_COLORS[connector] || '#808080'}
                  onClick={(data: any, index: number) => {
                    if (data && data[connector] > 0) {
                      handleBarClick(data, index)
                    }
                  }}
                  cursor="pointer"
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>

        {showLegend && (
          <div className="timeline-legend">
            {Object.entries(stats).sort(([a], [b]) => a.localeCompare(b)).map(([connector, count]) => (
              <div key={connector} className="timeline-stat">
                <span
                  className="stat-dot"
                  style={{ backgroundColor: CONNECTOR_COLORS[connector] || '#808080' }}
                ></span>
                <span className="stat-label">
                  {getConnectorDisplayName(connector)}: {count}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
