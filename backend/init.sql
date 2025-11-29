-- Create change_events table
CREATE TABLE IF NOT EXISTS change_events (
    id SERIAL PRIMARY KEY,
    source VARCHAR(50) NOT NULL,
    event_id VARCHAR(255) NOT NULL,
    title TEXT NOT NULL,
    description JSONB,
    author VARCHAR(255) NOT NULL,
    timestamp TIMESTAMP NOT NULL,
    url TEXT NOT NULL,
    status VARCHAR(50) NOT NULL,
    metadata JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(source, event_id)
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_change_events_source ON change_events(source);
CREATE INDEX IF NOT EXISTS idx_change_events_timestamp ON change_events(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_change_events_status ON change_events(status);
CREATE INDEX IF NOT EXISTS idx_change_events_author ON change_events(author);

-- Create connectors table to track connector configurations
CREATE TABLE IF NOT EXISTS connectors (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    type VARCHAR(50) NOT NULL,
    config JSONB NOT NULL,
    enabled BOOLEAN DEFAULT true,
    last_sync TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create index on connector type
CREATE INDEX IF NOT EXISTS idx_connectors_type ON connectors(type);
CREATE INDEX IF NOT EXISTS idx_connectors_enabled ON connectors(enabled);
