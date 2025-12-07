import { useState, useEffect } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import './Timeline.css'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

// Color scheme matching the app theme
const COLORS = {
  github: '#00E8A0',
  gitlab: '#fc6d26',
  kubernetes: '#326ce5'
}

function Timeline({ sourceFilter, startDate, endDate, tagFilter, onTimeRangeChange }) {
  const [timelineData, setTimelineData] = useState([])
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState(null)
  const [interval, setInterval] = useState('hour')

  useEffect(() => {
    const fetchTimeline = async () => {
      try {
        setLoading(true)

        const params = new URLSearchParams()
        if (sourceFilter) params.append('source', sourceFilter)
        if (startDate) params.append('start_date', startDate)
        if (endDate) params.append('end_date', endDate)
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
  }, [sourceFilter, startDate, endDate, tagFilter])

  const handleBarClick = (data) => {
    if (!data || !onTimeRangeChange) return

    const clickedTime = new Date(data.time)

    // Calculate bin width
    let binWidth = 60000 // default 1 minute
    if (timelineData.length > 1) {
      binWidth = new Date(timelineData[1].time) - new Date(timelineData[0].time)
    }

    // Set time range to just this bin
    const startTime = new Date(clickedTime)
    const endTime = new Date(clickedTime.getTime() + binWidth)

    onTimeRangeChange(startTime.toISOString(), endTime.toISOString())
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
        <h3>Events Timeline</h3>
        <div className="timeline-stats">
          {Object.entries(stats).sort(([a], [b]) => a.localeCompare(b)).map(([source, count]) => (
            <div key={source} className="timeline-stat">
              <span className="stat-dot" style={{ backgroundColor: COLORS[source] }}></span>
              <span className="stat-label">{source}: {count}</span>
            </div>
          ))}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart
          data={safeTimelineData}
          margin={{ top: 10, right: 10, left: 0, bottom: 20 }}
          barSize={20}
          barCategoryGap={1}
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
          {stats.github !== undefined && (
            <Bar
              dataKey="github"
              stackId="a"
              fill={COLORS.github}
              name="GitHub"
              radius={[8, 8, 0, 0]}
              onClick={handleBarClick}
              cursor="pointer"
            />
          )}
          {stats.gitlab !== undefined && (
            <Bar
              dataKey="gitlab"
              stackId="a"
              fill={COLORS.gitlab}
              name="GitLab"
              radius={[8, 8, 0, 0]}
              onClick={handleBarClick}
              cursor="pointer"
            />
          )}
          {stats.kubernetes !== undefined && (
            <Bar
              dataKey="kubernetes"
              stackId="a"
              fill={COLORS.kubernetes}
              name="Kubernetes"
              radius={[8, 8, 0, 0]}
              onClick={handleBarClick}
              cursor="pointer"
            />
          )}
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

export default Timeline
