-- Create connections table to track connection configurations
CREATE TABLE IF NOT EXISTS connections (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    type VARCHAR(50) NOT NULL,
    config JSONB NOT NULL,
    enabled BOOLEAN DEFAULT true,
    tags TEXT,
    last_sync TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create index on connection type
CREATE INDEX IF NOT EXISTS idx_connections_type ON connections(type);
CREATE INDEX IF NOT EXISTS idx_connections_enabled ON connections(enabled);

-- Create change_events table
CREATE TABLE IF NOT EXISTS change_events (
    id SERIAL PRIMARY KEY,
    connection_id INTEGER REFERENCES connections(id) ON DELETE CASCADE,
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
    UNIQUE(connection_id, event_id)
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_change_events_connection_id ON change_events(connection_id);
CREATE INDEX IF NOT EXISTS idx_change_events_source ON change_events(source);
CREATE INDEX IF NOT EXISTS idx_change_events_timestamp ON change_events(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_change_events_status ON change_events(status);
CREATE INDEX IF NOT EXISTS idx_change_events_author ON change_events(author);

-- Create teams table to track teams and their tag subscriptions
CREATE TABLE IF NOT EXISTS teams (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    tags JSONB NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create index on team name
CREATE INDEX IF NOT EXISTS idx_teams_name ON teams(name);
