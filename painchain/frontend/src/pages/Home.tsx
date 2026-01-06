import { useState, useEffect, useMemo } from 'react';
import { useEvents } from '../hooks/useEvents';
import { useIntegrations } from '../hooks/useIntegrations';
import { useTeams } from '../hooks/useTeams';
import { EventCard } from '../components/EventCard';
import Timeline from '../components/Timeline';
import { TagsDropdown } from '../components/TagsDropdown';
import { SourceDropdown } from '../components/SourceDropdown';
import { DateTimePicker } from '../components/DateTimePicker';
import type { Event } from '../types/api';

export function Home() {
  // Check for eventId in URL parameters
  const urlParams = new URLSearchParams(window.location.search);
  const eventIdFromUrl = urlParams.get('eventId');
  const startDateFromUrl = urlParams.get('startDate');
  const endDateFromUrl = urlParams.get('endDate');

  const [sourceFilter, setSourceFilter] = useState<string[]>([]);
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [showCopyToast, setShowCopyToast] = useState(false);
  const highlightedEventId = eventIdFromUrl;

  const handleCopyLink = () => {
    setShowCopyToast(true);
    setTimeout(() => setShowCopyToast(false), 3000);
  };

  // Default to last 24 hours, or use URL parameters if provided
  const [startDate, setStartDate] = useState(() => {
    if (startDateFromUrl) return startDateFromUrl;
    const date = new Date();
    date.setDate(date.getDate() - 1);
    return date.toISOString();
  });
  const [endDate, setEndDate] = useState(() => {
    if (endDateFromUrl) return endDateFromUrl;
    return new Date().toISOString();
  });

  const { integrations } = useIntegrations();
  const { teams } = useTeams();

  // Expand team selections to their tags
  const expandedTags = useMemo(() => {
    const expanded: string[] = [];

    tagFilter.forEach(selection => {
      if (selection.startsWith('Team: ')) {
        // This is a team - find the team and add all its tags
        const teamName = selection.replace('Team: ', '');
        const team = teams.find(t => t.name === teamName);
        if (team) {
          expanded.push(...team.tags);
        }
      } else {
        // This is a regular tag
        expanded.push(selection);
      }
    });

    // Remove duplicates
    return Array.from(new Set(expanded));
  }, [tagFilter, teams]);

  // Memoize the dates to prevent infinite re-renders
  const startDateObj = useMemo(() => new Date(startDate), [startDate]);
  const endDateObj = useMemo(() => new Date(endDate), [endDate]);

  const { events, loading, error, refetch } = useEvents({
    tags: expandedTags.length > 0 ? expandedTags : undefined,
    limit: 100,
    startDate: startDateObj,
    endDate: endDateObj,
  });

  // Extract all unique tags from integration configurations and teams
  const availableTags = useMemo(() => {
    // Get tags from integrations (normalized to top-level tags field)
    const integrationTags = integrations.flatMap(integration => {
      return integration.config?.tags || [];
    });

    // Get teams with "Team: " prefix
    const teamItems = teams.map(team => `Team: ${team.name}`);

    // Combine and sort - teams first, then tags
    const allItems = [...teamItems, ...Array.from(new Set(integrationTags))];
    return allItems.sort((a, b) => {
      // Teams come first
      const aIsTeam = a.startsWith('Team: ');
      const bIsTeam = b.startsWith('Team: ');
      if (aIsTeam && !bIsTeam) return -1;
      if (!aIsTeam && bIsTeam) return 1;
      return a.localeCompare(b);
    });
  }, [integrations, teams]);

  // Helper to get tags for an event based on its integration
  const getTagsForEvent = (event: Event): string[] => {
    if (!event.integrationId) {
      return [];
    }

    // Find the integration that created this event
    const integration = integrations.find(i => i.id === event.integrationId);
    if (!integration) {
      return [];
    }

    // Return the integration's tags
    return integration.config?.tags || [];
  };

  // Auto-refresh every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      refetch();
    }, 30000);
    return () => clearInterval(interval);
  }, []); // Empty deps - refetch is stable from useEvents

  // Scroll to highlighted event when events are loaded
  useEffect(() => {
    if (highlightedEventId && events.length > 0) {
      // Small delay to ensure DOM is rendered
      setTimeout(() => {
        const element = document.getElementById(`event-${highlightedEventId}`);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 500);
    }
  }, [highlightedEventId, events]);

  const getTimeGroup = (timestamp: string) => {
    const now = new Date();
    const date = new Date(timestamp);
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 5) {
      return 'LAST 5 MINUTES';
    } else if (diffHours < 1) {
      return 'LAST HOUR';
    } else if (diffDays === 0) {
      return 'TODAY';
    } else if (diffDays === 1) {
      return 'YESTERDAY';
    } else if (diffDays < 7) {
      const dayNames = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
      return dayNames[date.getDay()];
    } else {
      return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }).toUpperCase();
    }
  };

  const groupEventsByTime = (events: Event[]) => {
    const groups: Array<{ label: string; events: Event[] }> = [];
    let currentGroup: { label: string; events: Event[] } | null = null;

    events.forEach((event) => {
      const timeGroup = getTimeGroup(event.timestamp);

      if (!currentGroup || currentGroup.label !== timeGroup) {
        currentGroup = {
          label: timeGroup,
          events: [],
        };
        groups.push(currentGroup);
      }

      currentGroup.events.push(event);
    });

    return groups;
  };

  const handleTimeRangeChange = (start: string, end: string) => {
    setStartDate(start);
    setEndDate(end);
  };

  // Filter events by selected sources (frontend filtering)
  const filteredEvents = useMemo(() => {
    if (sourceFilter.length === 0) {
      return events;
    }
    return events.filter(event => sourceFilter.includes(event.connector));
  }, [events, sourceFilter]);

  if (loading && events.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-text-muted">Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-error">Error: {error.message}</div>
      </div>
    );
  }

  const groupedEvents = groupEventsByTime(filteredEvents);

  return (
    <div className="content">
      {/* Copy Toast Notification */}
      {showCopyToast && (
        <div className="toast-notification">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            style={{ flexShrink: 0 }}
          >
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
          <span>Event link copied to clipboard</span>
        </div>
      )}

      {/* Timeline Chart */}
      <Timeline
        events={filteredEvents}
        onTimeRangeChange={handleTimeRangeChange}
        startDate={startDate}
        endDate={endDate}
      />

      {/* Filters */}
      <div className="filters">
        <div className="filter-group tags-filter">
          <label>Source:</label>
          <SourceDropdown
            selectedSources={sourceFilter}
            onChange={setSourceFilter}
          />
        </div>

        <div className="filter-group tags-filter">
          <label>Tags & Teams:</label>
          <TagsDropdown
            availableTags={availableTags}
            selectedTags={tagFilter}
            onChange={setTagFilter}
          />
        </div>

        <DateTimePicker
          label="Start Date"
          value={startDate}
          onChange={setStartDate}
        />

        <DateTimePicker
          label="End Date"
          value={endDate}
          onChange={setEndDate}
          isEndOfDay={true}
        />
      </div>

      {/* Events list with time groups */}
      {filteredEvents.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 px-4">
          <div className="text-text-muted text-center space-y-2">
            <p className="text-lg font-medium">No changes found.</p>
            <p className="text-xs mt-4">Try adjusting your filters or time range to see more results.</p>
          </div>
        </div>
      ) : (
        groupedEvents.map((group, groupIndex) => (
          <div key={groupIndex}>
            {/* Time Separator */}
            <div className="time-separator">
              <span className="time-label">{group.label}</span>
            </div>

            {/* Events in this time group */}
            {group.events.map((event) => (
              <EventCard
                key={event.id}
                event={event}
                tags={getTagsForEvent(event)}
                isHighlighted={event.id === highlightedEventId}
                onCopyLink={handleCopyLink}
              />
            ))}
          </div>
        ))
      )}

      {loading && events.length > 0 && (
        <p style={{ textAlign: 'center', padding: '20px', color: '#808080' }}>
          Loading more events...
        </p>
      )}
    </div>
  );
}
