import { useState, useRef, useEffect } from 'react';
import './TagsDropdown.css';

interface SourceDropdownProps {
  selectedSources: string[];
  onChange: (sources: string[]) => void;
}

const CONNECTOR_INFO = {
  github: {
    name: 'GitHub',
    logo: '/api/integrations/types/github/logo',
    color: '#00E8A0',
  },
  gitlab: {
    name: 'GitLab',
    logo: '/api/integrations/types/gitlab/logo',
    color: '#fc6d26',
  },
  kubernetes: {
    name: 'Kubernetes',
    logo: '/api/integrations/types/kubernetes/logo',
    color: '#326ce5',
  },
};

const AVAILABLE_SOURCES = ['github', 'gitlab', 'kubernetes'];

export function SourceDropdown({ selectedSources, onChange }: SourceDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0, width: 0 });
  const dropdownRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Update menu position when opening
  useEffect(() => {
    if (isOpen && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setMenuPosition({
        top: rect.bottom + 4,
        left: rect.left,
        width: rect.width,
      });
    }
  }, [isOpen]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const toggleSource = (source: string) => {
    if (selectedSources.includes(source)) {
      onChange(selectedSources.filter(s => s !== source));
    } else {
      onChange([...selectedSources, source]);
    }
  };

  const clearAll = () => {
    onChange([]);
    setIsOpen(false);
  };

  const getDisplayText = () => {
    if (selectedSources.length === 0) return 'All Sources';
    if (selectedSources.length === 1) return CONNECTOR_INFO[selectedSources[0] as keyof typeof CONNECTOR_INFO]?.name || selectedSources[0];
    return `${selectedSources.length} selected`;
  };

  return (
    <div className="tags-dropdown" ref={dropdownRef}>
      <button
        ref={triggerRef}
        className="tags-dropdown-trigger"
        onClick={() => setIsOpen(!isOpen)}
        type="button"
      >
        <span className={selectedSources.length === 0 ? 'placeholder' : ''}>
          {getDisplayText()}
        </span>
        <svg
          width="12"
          height="8"
          viewBox="0 0 12 8"
          fill="none"
          className={`dropdown-arrow ${isOpen ? 'open' : ''}`}
        >
          <path
            d="M1 1.5L6 6.5L11 1.5"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {isOpen && (
        <div
          className="tags-dropdown-menu"
          style={{
            top: `${menuPosition.top}px`,
            left: `${menuPosition.left}px`,
            width: `${menuPosition.width}px`,
          }}
        >
          <div className="tags-dropdown-list">
            {AVAILABLE_SOURCES.map(source => {
              const info = CONNECTOR_INFO[source as keyof typeof CONNECTOR_INFO];
              return (
                <label key={source} className="tags-dropdown-item">
                  <input
                    type="checkbox"
                    checked={selectedSources.includes(source)}
                    onChange={() => toggleSource(source)}
                  />
                  <span className="checkbox-custom"></span>
                  <span className="tag-label" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <img
                      src={info.logo}
                      alt={`${info.name} logo`}
                      style={{ width: '16px', height: '16px', objectFit: 'contain' }}
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                      }}
                    />
                    <span>{info.name}</span>
                  </span>
                </label>
              );
            })}
          </div>

          {selectedSources.length > 0 && (
            <div className="tags-dropdown-footer">
              <button
                className="clear-all-btn"
                onClick={clearAll}
                type="button"
              >
                Clear all ({selectedSources.length})
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
