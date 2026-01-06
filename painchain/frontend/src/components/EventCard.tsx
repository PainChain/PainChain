import { useState } from 'react';
import type { Event } from '../types/api';
import { GenericRenderer } from './GenericRenderer';

interface EventCardProps {
  event: Event;
  tags?: string[];
  isHighlighted?: boolean;
  onCopyLink?: () => void;
}

const CONNECTOR_LOGOS: Record<string, string> = {
  github: '/api/integrations/types/github/logo',
  gitlab: '/api/integrations/types/gitlab/logo',
  kubernetes: '/api/integrations/types/kubernetes/logo',
  painchain: '/logos/painchain.png', // PainChain logo stays in public folder
};

export function EventCard({ event, tags = [], isHighlighted = false, onCopyLink }: EventCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const getConnectorColor = (connector: string) => {
    const colors: Record<string, string> = {
      github: '#00E8A0',
      gitlab: '#fc6d26',
      kubernetes: '#326ce5',
      painchain: '#9f7aea',
    };
    return colors[connector] || '#808080';
  };

  const formatDate = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short',
    });
  };

  const handleCopyLink = async () => {
    // Create a shareable URL with event ID and time context
    const eventTime = new Date(event.timestamp);
    // Set time window to 1 hour before and after the event
    const startTime = new Date(eventTime.getTime() - 60 * 60 * 1000);
    const endTime = new Date(eventTime.getTime() + 60 * 60 * 1000);

    const url = new URL(window.location.origin);
    url.searchParams.set('eventId', event.id);
    url.searchParams.set('startDate', startTime.toISOString());
    url.searchParams.set('endDate', endTime.toISOString());

    try {
      await navigator.clipboard.writeText(url.toString());
      if (onCopyLink) {
        onCopyLink();
      }
    } catch (err) {
      console.error('Failed to copy link:', err);
    }
  };

  return (
    <div
      className={`change-card ${isHighlighted ? 'highlighted' : ''}`}
      id={`event-${event.id}`}
    >
      {/* Header with badges and meta */}
      <div className="change-header">
        <div className="change-badges">
          <div className="connector-info">
            <img
              src={CONNECTOR_LOGOS[event.connector] || '/logos/default.png'}
              alt={`${event.connector} logo`}
              className="connector-logo"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
              }}
            />
            <span className="connector-name" style={{ color: getConnectorColor(event.connector) }}>
              {event.connector.charAt(0).toUpperCase() + event.connector.slice(1)}
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div className="change-meta">
            <div>By {event.data.author || event.data.user || 'system'}</div>
            <div>{formatDate(event.timestamp)}</div>
          </div>
          <button
            className="copy-link-btn"
            onClick={handleCopyLink}
            aria-label="Copy link to this event"
            title="Copy link to this event"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
          </button>
        </div>
      </div>

      {/* Title */}
      <h3>
        {event.data.url ? (
          <a
            href={event.data.url as string}
            target="_blank"
            rel="noopener noreferrer"
          >
            {event.title}
          </a>
        ) : (
          event.title
        )}
      </h3>

      {/* Project/Repository */}
      {event.project && (
        <div className="change-repo">
          Repository: {event.project}
        </div>
      )}

      {/* Expanded details */}
      {isExpanded && (
        <div className="change-details">
          <GenericRenderer data={event.data} />
        </div>
      )}

      {/* Footer */}
      <div className="change-footer">
        {tags.length > 0 && (
          <div className="event-tags">
            {tags.map((tag) => (
              <span key={tag} className="label-tag">
                {tag}
              </span>
            ))}
          </div>
        )}
        <button
          className="expand-btn"
          onClick={() => setIsExpanded(!isExpanded)}
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
  );
}
