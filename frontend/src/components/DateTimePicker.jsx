import { useState, useEffect, useRef } from 'react'
import './DateTimePicker.css'

function DateTimePicker({ value, onChange, label, isEndOfDay = false }) {
  const [date, setDate] = useState(null) // Date object instead of string
  const [hour, setHour] = useState(isEndOfDay ? '23' : '00')
  const [minute, setMinute] = useState(isEndOfDay ? '59' : '00')
  const [showCalendar, setShowCalendar] = useState(false)
  const [viewMonth, setViewMonth] = useState(new Date().getMonth())
  const [viewYear, setViewYear] = useState(new Date().getFullYear())
  const calendarRef = useRef(null)

  // Parse initial value if provided
  useEffect(() => {
    if (value) {
      const dt = new Date(value)
      if (!isNaN(dt.getTime())) {
        setDate(dt)
        setHour(String(dt.getHours()).padStart(2, '0'))
        setMinute(String(dt.getMinutes()).padStart(2, '0'))
        setViewMonth(dt.getMonth())
        setViewYear(dt.getFullYear())
      }
    } else {
      // When value is cleared, set date to null but keep time selects enabled
      setDate(null)
      const now = new Date()
      setViewMonth(now.getMonth())
      setViewYear(now.getFullYear())
    }
  }, [value])

  // Close calendar when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (calendarRef.current && !calendarRef.current.contains(event.target)) {
        setShowCalendar(false)
      }
    }

    if (showCalendar) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showCalendar])

  const handleChange = (newDate, newHour, newMinute) => {
    if (!newDate) {
      onChange('')
      return
    }

    // Create ISO string from date and time
    const dt = new Date(newDate)
    dt.setHours(parseInt(newHour), parseInt(newMinute), 0, 0)
    onChange(dt.toISOString())
  }

  const handleDateSelect = (day) => {
    const newDate = new Date(viewYear, viewMonth, day)
    setDate(newDate)
    setShowCalendar(false)
    handleChange(newDate, hour, minute)
  }

  const handleHourChange = (e) => {
    const newHour = e.target.value
    setHour(newHour)
    if (date) {
      handleChange(date, newHour, minute)
    }
  }

  const handleMinuteChange = (e) => {
    const newMinute = e.target.value
    setMinute(newMinute)
    if (date) {
      handleChange(date, hour, newMinute)
    }
  }

  const handleClear = () => {
    setDate(null)
    setHour(isEndOfDay ? '23' : '00')
    setMinute(isEndOfDay ? '59' : '00')
    // Reset calendar view to current month/year
    const now = new Date()
    setViewMonth(now.getMonth())
    setViewYear(now.getFullYear())
    onChange('')
  }

  const previousMonth = () => {
    if (viewMonth === 0) {
      setViewMonth(11)
      setViewYear(viewYear - 1)
    } else {
      setViewMonth(viewMonth - 1)
    }
  }

  const nextMonth = () => {
    if (viewMonth === 11) {
      setViewMonth(0)
      setViewYear(viewYear + 1)
    } else {
      setViewMonth(viewMonth + 1)
    }
  }

  const formatDateDisplay = () => {
    if (!date) return 'Select date...'
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  const renderCalendar = () => {
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
    const firstDayOfMonth = new Date(viewYear, viewMonth, 1).getDay()
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                       'July', 'August', 'September', 'October', 'November', 'December']

    const days = []
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    // Add empty cells for days before month starts
    for (let i = 0; i < firstDayOfMonth; i++) {
      days.push(<div key={`empty-${i}`} className="calendar-day empty"></div>)
    }

    // Add days of the month
    for (let day = 1; day <= daysInMonth; day++) {
      const dayDate = new Date(viewYear, viewMonth, day)
      dayDate.setHours(0, 0, 0, 0)
      const isSelected = date && date.getDate() === day &&
                        date.getMonth() === viewMonth &&
                        date.getFullYear() === viewYear
      const isToday = dayDate.getTime() === today.getTime()

      days.push(
        <div
          key={day}
          className={`calendar-day ${isSelected ? 'selected' : ''} ${isToday ? 'today' : ''}`}
          onClick={() => handleDateSelect(day)}
        >
          {day}
        </div>
      )
    }

    return (
      <div className="calendar-dropdown" ref={calendarRef}>
        <div className="calendar-header">
          <button type="button" onClick={previousMonth} className="calendar-nav">‹</button>
          <div className="calendar-title">{monthNames[viewMonth]} {viewYear}</div>
          <button type="button" onClick={nextMonth} className="calendar-nav">›</button>
        </div>
        <div className="calendar-weekdays">
          <div>Su</div>
          <div>Mo</div>
          <div>Tu</div>
          <div>We</div>
          <div>Th</div>
          <div>Fr</div>
          <div>Sa</div>
        </div>
        <div className="calendar-days">
          {days}
        </div>
      </div>
    )
  }

  // Generate hour options (00-23)
  const hours = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'))

  // Generate minute options (00-59)
  const minutes = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'))

  const handleToggleCalendar = () => {
    // When opening calendar without a selected date, show current month
    if (!showCalendar && !date) {
      const now = new Date()
      setViewMonth(now.getMonth())
      setViewYear(now.getFullYear())
    }
    setShowCalendar(!showCalendar)
  }

  return (
    <div className="datetime-picker">
      <label className="datetime-label">{label}</label>
      <div className="datetime-inputs">
        <div className="datetime-date-wrapper">
          <div
            className="datetime-date-display"
            onClick={handleToggleCalendar}
          >
            {formatDateDisplay()}
          </div>
          {showCalendar && renderCalendar()}
        </div>
        <div className="datetime-time">
          <select
            value={hour}
            onChange={handleHourChange}
            disabled={!date}
            className="datetime-hour"
          >
            {hours.map(h => (
              <option key={h} value={h}>{h}</option>
            ))}
          </select>
          <span className="datetime-separator">:</span>
          <select
            value={minute}
            onChange={handleMinuteChange}
            disabled={!date}
            className="datetime-minute"
          >
            {minutes.map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>
        {date && (
          <button
            type="button"
            onClick={handleClear}
            className="datetime-clear"
            title="Clear"
          >
            ×
          </button>
        )}
      </div>
    </div>
  )
}

export default DateTimePicker
