# PainChain Connector Implementation Guide

This guide provides a language-agnostic approach to building new connectors for PainChain. Whether you're using TypeScript, Python, Go, or any other language, this checklist will guide you through the implementation.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Component Responsibilities](#component-responsibilities)
3. [Implementation Checklist](#implementation-checklist)
4. [API Contracts](#api-contracts)
5. [Event Schema](#event-schema)
6. [Best Practices](#best-practices)
7. [Reference Implementations](#reference-implementations)

---

## Architecture Overview

PainChain uses a three-tier architecture:

```
┌─────────────────────────────────────────────────────────────┐
│                        FRONTEND                             │
│  - Displays connector types from backend                    │
│  - Renders integration configuration forms                  │
│  - Shows events in timeline                                 │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ HTTP/JSON
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                         BACKEND                             │
│  - Stores connector type metadata (schema, logo, etc)       │
│  - Manages integrations (user configurations)               │
│  - Receives and deduplicates events                         │
│  - Serves events to frontend                                │
└─────────────────────────────────────────────────────────────┘
                              ↑
                              │ HTTP/JSON
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
┌───────────────┐    ┌────────────────┐    ┌───────────────┐
│   GitHub      │    │    GitLab      │    │  Kubernetes   │
│  Connector    │    │   Connector    │    │   Connector   │
│               │    │                │    │               │
│ - Registers   │    │ - Registers    │    │ - Registers   │
│   metadata    │    │   metadata     │    │   metadata    │
│ - Polls APIs  │    │ - Polls APIs   │    │ - Watches K8s │
│ - Posts events│    │ - Posts events │    │ - Posts events│
└───────────────┘    └────────────────┘    └───────────────┘
```

---

## Component Responsibilities

### Connectors

**Role:** Bridge external systems to PainChain by collecting events and posting them to the backend.

**Responsibilities:**
- Register connector type metadata with backend on startup
- Fetch integrations from the backend
- Poll/watch external systems for events
- Transform external events into PainChain event format
- Post events to the backend API
- Handle errors gracefully
- Auto-retry on failures

**What Connectors Should NOT Do:**
- Store state (backend manages all state)
- Deduplicate events (backend handles this)
- Authenticate users (backend manages authentication)
- Render UI (frontend's job)

### Backend

**Role:** Central hub for connector metadata, integrations, and event storage.

**Responsibilities:**
- Store connector type metadata (schemas, logos, descriptions)
- Provide `/integrations/types` API for frontend
- Manage user integrations (configurations)
- Receive events from connectors via `/events` endpoint
- Deduplicate events using `(integrationId, externalId)` unique constraint
- Serve events to frontend with filtering/pagination

### Frontend

**Role:** User interface for configuring integrations and viewing events.

**Responsibilities:**
- Fetch available connector types from backend
- Render connector logos and descriptions
- Generate dynamic forms based on connector `configSchema`
- Display events in timeline view
- Allow users to create/edit/delete integrations

---

## Implementation Checklist

### Phase 1: Design & Planning

- [ ] **Define Your Connector**
  - What external system are you integrating?
  - What events will you capture?
  - How will you retrieve events (polling vs streaming)?
  - What credentials/configuration do users need?

- [ ] **Design Configuration Schema**
  - What fields do users need to configure? (API keys, URLs, project IDs, etc.)
  - Which fields are required vs optional?
  - What input types do you need? (text, textarea, password)

- [ ] **Choose Collection Pattern**
  - **Polling**: For REST APIs without webhooks (GitHub, GitLab)
  - **Streaming/Watching**: For real-time systems (Kubernetes, WebSockets)

### Phase 2: Metadata Definition

- [ ] **Create `metadata.json`**
  - Must include: `id`, `displayName`, `configSchema`
  - Optional: `color`, `logo`, `description`
  - Ensure `id` is unique (lowercase, no spaces)
  - Include standard fields: `name` and `tags`

**Example:**
```json
{
  "id": "your-connector",
  "displayName": "Your Connector",
  "color": "#326ce5",
  "logo": "",
  "description": "Monitors events from Your System",
  "configSchema": {
    "fields": [
      {
        "key": "name",
        "label": "Integration Name",
        "type": "text",
        "placeholder": "e.g., My Integration",
        "required": true,
        "help": "A friendly name for this integration"
      },
      {
        "key": "tags",
        "label": "Tags",
        "type": "textarea",
        "placeholder": "[\"production\", \"backend\"]",
        "required": true,
        "help": "JSON array of tags (can be empty [])"
      },
      {
        "key": "apiKey",
        "label": "API Key",
        "type": "password",
        "placeholder": "Your API key",
        "required": true,
        "help": "API key for authentication"
      }
    ]
  }
}
```

### Phase 3: Core Implementation

- [ ] **Implement Metadata Registration**
  - Read `metadata.json` from filesystem
  - POST to `/api/integrations/types/register` on startup
  - Retry on failure (5 attempts with delays)
  - Exit if registration fails after retries

- [ ] **Implement Backend API Client**
  - HTTP client for making requests to backend
  - GET `/api/integrations?type={yourConnectorId}` - Fetch integrations
  - POST `/api/events` - Submit events
  - Include `x-tenant-id` header when posting events (if integration has tenantId)
  - Handle 409 Conflict responses (duplicates) - ignore them
  - Handle other errors gracefully

- [ ] **Implement Event Collection Logic**

  **For Polling Pattern:**
  - Fetch integrations from backend
  - For each integration:
    - Use credentials from `integration.config`
    - Poll external API for events
    - Transform to PainChain format
    - Post to backend
  - Wait for polling interval
  - Repeat

  **For Streaming Pattern:**
  - Fetch integrations from backend
  - For each integration:
    - Establish watch/stream connection
    - On each event received:
      - Transform to PainChain format
      - Post to backend
    - Handle connection drops (auto-reconnect)
  - Re-fetch integrations periodically (detect new configurations)

- [ ] **Implement Event Transformation**
  - Convert external event format to PainChain event schema
  - Generate unique `externalId` from external system's ID
  - Set `integrationId` from the integration that produced the event
  - Include relevant `data` fields
  - Filter out non-significant events

- [ ] **Implement Error Handling**
  - Try/catch around event posting
  - Log errors but continue processing
  - Don't crash on single event failure
  - Implement retry logic for critical operations

- [ ] **Implement Graceful Shutdown**
  - Listen for SIGTERM/SIGINT signals
  - Clean up resources (timers, connections)
  - Exit cleanly

### Phase 4: Packaging & Deployment

- [ ] **Create Dockerfile**
  - Multi-stage build (if applicable)
  - Copy metadata.json to container
  - Set environment variables:
    - `BACKEND_API_URL` (default: `http://painchain-app:8000/api`)
    - `POLLING_INTERVAL` (if polling, default: `60`)
  - Run connector as entry point

- [ ] **Add to docker-compose.yml**
  - Build from connector directory
  - Set container name
  - Configure restart policy
  - Set environment variables
  - Add dependency on backend service

- [ ] **Configure Environment Variables**
  - `BACKEND_API_URL` - Backend API endpoint
  - `POLLING_INTERVAL` - Seconds between polls (for polling connectors)
  - Any connector-specific variables

### Phase 5: Documentation

- [ ] **Create README.md**
  - Overview and features
  - Supported event types (with table)
  - Quick start guide
  - How to get credentials for external system
  - How to create integration via API
  - Architecture diagram
  - Configuration schema documentation
  - Events received (detailed descriptions)
  - Multi-tenant support notes
  - Development setup instructions
  - Troubleshooting section

**README Template Structure:**
```markdown
# PainChain [System] Connector

Brief description of what this connector does.

## Features
- Feature 1
- Feature 2

## Supported Event Types
| Event Type | Description | Source |
|------------|-------------|--------|
| Event 1    | ...         | API    |

## Quick Start
### 1. Start the Connector
### 2. Get Credentials
### 3. Register Integration via API
### 4. How It Works

## Architecture
Diagram and explanation

## Configuration
Schema and examples

## Events Received
Detailed event descriptions

## Multi-Tenant Support
Free vs SaaS tier behavior

## Development
Local setup, building, testing

## Troubleshooting
Common issues and solutions
```

### Phase 6: Testing

- [ ] **Test Metadata Registration**
  - Start connector, verify registration logs
  - Check connector appears in frontend UI
  - Verify schema renders correctly in integration form

- [ ] **Test Event Collection**
  - Create test integration via API
  - Trigger events in external system
  - Verify events appear in PainChain timeline
  - Check event data is correct

- [ ] **Test Error Handling**
  - Test with invalid credentials
  - Test with network failures
  - Verify connector recovers gracefully

- [ ] **Test Multi-Tenant Support** (if applicable)
  - Create integrations with different tenantIds
  - Verify events are tagged correctly
  - Verify tenant isolation

---

## API Contracts

### 1. Register Connector Type

**Endpoint:** `POST /api/integrations/types/register`

**Request Body:**
```json
{
  "id": "your-connector",
  "displayName": "Your Connector",
  "color": "#326ce5",
  "logo": "",
  "description": "Brief description",
  "configSchema": {
    "fields": [
      {
        "key": "fieldName",
        "label": "Field Label",
        "type": "text|textarea|password",
        "placeholder": "Example value",
        "required": true|false,
        "help": "Help text"
      }
    ]
  }
}
```

**Response (Success):**
```json
{
  "id": "your-connector",
  "displayName": "Your Connector",
  "registered": true
}
```

**Notes:**
- Call this on connector startup
- Backend uses upsert, so re-registering is safe
- If this fails, connector should retry and eventually exit

### 2. Fetch Integrations

**Endpoint:** `GET /api/integrations?type={connectorId}`

**Response:**
```json
[
  {
    "id": "integration-id-123",
    "name": "My Integration",
    "type": "your-connector",
    "config": {
      "name": "My Integration",
      "tags": ["production"],
      "apiKey": "...",
      // ... your custom config fields
    },
    "tenantId": "tenant-id-456",  // null for free tier
    "createdAt": "2025-01-01T00:00:00Z",
    "updatedAt": "2025-01-01T00:00:00Z"
  }
]
```

**Notes:**
- Returns all integrations of your connector type
- Multi-tenant: Returns integrations from ALL tenants (connector handles all)
- Free tier: `tenantId` is null

### 3. Post Event

**Endpoint:** `POST /api/events`

**Headers:**
```
Content-Type: application/json
x-tenant-id: {tenantId}  # Include if integration.tenantId is not null
```

**Request Body:**
```json
{
  "title": "Event Title",
  "connector": "your-connector",
  "project": "project-identifier",
  "timestamp": "2025-01-01T12:00:00Z",
  "externalId": "external-system-unique-id",
  "integrationId": "integration-id-123",
  "data": {
    "key": "value"
  },
  "tags": ["tag1", "tag2"]
}
```

**Response:**
- **201 Created** - Event created successfully
- **409 Conflict** - Duplicate event (same integrationId + externalId) - **This is OK, ignore it**
- **500 Internal Server Error** - Backend error

**Critical Requirements:**
- `externalId` must be unique and stable for each event from external system
- `integrationId` must match the integration that produced this event
- Include `x-tenant-id` header if `integration.tenantId` is not null
- Backend handles deduplication via `(integrationId, externalId)` unique constraint

---

## Event Schema

### Required Fields

```json
{
  "title": "string",           // Short event description (e.g., "Push to main")
  "connector": "string",       // Connector ID (must match metadata.json id)
  "project": "string",         // Project/repo/namespace/cluster identifier
  "timestamp": "ISO8601",      // When the event occurred
  "externalId": "string",      // Unique ID from external system (for deduplication)
  "integrationId": "string"    // Integration that produced this event
}
```

### Optional Fields

```json
{
  "data": {},                  // Structured event data (any shape)
  "tags": ["string"]          // Event-specific tags (merged with integration tags)
}
```

### External ID Generation

The `externalId` is critical for deduplication. It must be:

- **Unique**: Different events must have different externalIds
- **Stable**: Same event polled multiple times must have same externalId
- **Derived from external system**: Use the external system's unique identifier

**Good Examples:**
```
github-commit-{sha}
github-workflow-{runId}
gitlab-pipeline-{pipelineId}
k8s-pod-{cluster}-{namespace}-{podName}-{resourceVersion}
```

**Bad Examples:**
```
event-{timestamp}           // Changes each poll
event-{random}              // Changes each poll
{externalId}                // Too generic, may collide
```

### Example Events

**GitHub Commit:**
```json
{
  "title": "Push to main",
  "connector": "github",
  "project": "facebook/react",
  "timestamp": "2025-01-01T12:00:00Z",
  "externalId": "github-commit-abc123def456",
  "integrationId": "int-123",
  "data": {
    "author": "Dan Abramov",
    "message": "Fix bug in hooks",
    "sha": "abc123def456",
    "branch": "main"
  },
  "tags": ["frontend", "production"]
}
```

**Kubernetes Pod Failure:**
```json
{
  "title": "Pod CrashLoopBackOff: api-server",
  "connector": "kubernetes",
  "project": "production:default",
  "timestamp": "2025-01-01T12:00:00Z",
  "externalId": "k8s-pod-production-default-api-server-v123",
  "integrationId": "int-456",
  "data": {
    "namespace": "default",
    "podName": "api-server",
    "containerName": "app",
    "exitCode": 1,
    "restartCount": 5,
    "reason": "CrashLoopBackOff"
  }
}
```

---

## Best Practices

### 1. Error Handling

**DO:**
- Wrap event posting in try/catch
- Log errors but continue processing
- Implement retry logic for critical operations
- Suppress 409 Conflict errors (duplicates are expected)

**DON'T:**
- Let unhandled errors crash the connector
- Stop processing all events because one failed
- Retry endlessly without backoff

### 2. External ID Generation

**DO:**
- Use external system's unique identifier
- Include enough context to avoid collisions
- Keep it deterministic (same event = same ID)

**DON'T:**
- Use timestamps (not unique)
- Use random values (not stable)
- Make it too generic

### 3. Event Filtering

**DO:**
- Only post significant events
- Filter out noise (routine updates, non-actionable events)
- Document what events are tracked vs ignored

**Example (Kubernetes):**
```
Track:
- Pod failures, restarts, crashes
- Deployment scaling events
- Warning events

Ignore:
- Routine pod status updates
- Informational Normal events
- Pending pods
```

### 4. Configuration Validation

**DO:**
- Validate configuration before using it
- Provide helpful error messages
- Fail fast if configuration is invalid

**Example:**
```
if (!integration.config.apiKey) {
  console.error('Missing apiKey in integration config');
  return;
}
```

### 5. Logging

**DO:**
- Use structured logging
- Include context (integration ID, project, etc.)
- Use different log levels (info, warn, error)
- Use emojis for visual clarity (optional)

**Example:**
```
✓ Registered connector type: GitHub
📡 Fetching integrations from backend...
ℹ️  Found 3 integrations
⚠️  Rate limit approaching for integration-123
❌ Failed to post event: Network timeout
```

### 6. Graceful Shutdown

**DO:**
- Listen for shutdown signals (SIGTERM, SIGINT)
- Clean up resources (close connections, clear timers)
- Wait for in-flight requests to complete
- Exit with proper status code

### 7. Multi-Tenant Support

**DO:**
- Always include `x-tenant-id` header when posting events (if tenantId exists)
- Handle null tenantIds (free tier)
- Test with multiple tenants

**DON'T:**
- Mix tenant data
- Assume single-tenant deployment

### 8. Polling vs Streaming

**Polling Pattern (REST APIs):**
- Fetch integrations at startup
- Poll external API on interval
- Re-fetch integrations periodically to detect changes
- Use reasonable polling intervals (avoid rate limits)

**Streaming Pattern (Real-time systems):**
- Fetch integrations at startup
- Establish persistent connections (WebSocket, Watch API, etc.)
- Handle connection drops (auto-reconnect with backoff)
- Re-fetch integrations periodically to detect new configurations

### 9. Testing

**DO:**
- Test metadata registration manually
- Test with real external systems
- Test error scenarios (invalid credentials, network failures)
- Test multi-tenant scenarios
- Verify deduplication works

### 10. Security

**DO:**
- Never log sensitive data (tokens, keys, credentials)
- Validate all external inputs
- Use HTTPS for external API calls
- Store credentials securely (environment variables, not hardcoded)

**DON'T:**
- Log full integration configs (may contain secrets)
- Trust external data without validation
- Expose credentials in error messages

---

## Reference Implementations

See these language-specific implementations for guidance:

### TypeScript Examples
- **`connectors/github/`** - Polling pattern, REST API, multiple repositories
- **`connectors/gitlab/`** - Polling pattern, REST API, projects + pipelines
- **`connectors/kubernetes/`** - Streaming pattern, Watch API, multiple clusters

### Implementation Patterns

**Polling Pattern (GitHub, GitLab):**
1. Fetch integrations from backend
2. For each integration:
   - Extract credentials from `integration.config`
   - Poll external API for recent events
   - Transform each event to PainChain format
   - Post events to backend
3. Wait for polling interval
4. Repeat from step 1

**Streaming Pattern (Kubernetes):**
1. Fetch integrations from backend
2. For each integration:
   - Extract credentials from `integration.config`
   - Establish watch/stream connection
   - On each event:
     - Transform to PainChain format
     - Post to backend
   - On connection drop:
     - Log error
     - Wait 10 seconds
     - Re-establish connection
3. Re-fetch integrations every 60 seconds (detect new configs)

---

## Common Patterns

### Directory Structure

```
connectors/
└── your-connector/
    ├── Dockerfile              # Container build instructions
    ├── metadata.json           # Connector metadata (CRITICAL!)
    ├── README.md               # Connector documentation
    ├── src/                    # Source code
    │   ├── main.*              # Entry point
    │   ├── metadata-register.* # Metadata registration logic
    │   ├── backend-client.*    # HTTP client for backend
    │   ├── poller.*            # Polling logic (or watcher.*)
    │   └── transformer.*       # Event transformation
    └── [package manager files] # package.json, requirements.txt, go.mod, etc.
```

### Connector Lifecycle

```
1. Start
   ↓
2. Register metadata with backend
   ↓
3. Fetch integrations
   ↓
4. Start polling/watching
   │
   ├─→ [Poll/Watch loop]
   │   ├─ Collect events
   │   ├─ Transform events
   │   └─ Post to backend
   │
   └─→ [Re-fetch integrations periodically]

5. On shutdown:
   - Clean up resources
   - Exit gracefully
```

### Multi-Instance Configuration

Some connectors support multiple instances per integration:

**Kubernetes (Multiple Clusters):**
```json
{
  "clusters": [
    {"name": "prod-us", "server": "...", "token": "..."},
    {"name": "prod-eu", "server": "...", "token": "..."}
  ]
}
```

**GitHub (Multiple Repositories):**
```json
{
  "token": "...",
  "repositories": [
    {"owner": "org", "repo": "repo1"},
    {"owner": "org", "repo": "repo2"}
  ]
}
```

**Pattern:** Loop through instances and process each independently.

---

## Troubleshooting

### Connector Not Showing in UI

**Check:**
1. Did metadata registration succeed? (check logs for "✓ Registered")
2. Is `metadata.json` valid JSON?
3. Does `id` field exist (not `type`)?
4. Refresh browser (hard refresh)
5. Check backend logs for errors

### Registration Fails (500 Error)

**Check:**
1. Is `metadata.json` schema correct?
2. Is `id` field present and unique?
3. Are all required fields included?
4. Check backend logs for validation errors

### Events Not Appearing

**Check:**
1. Is `integrationId` set correctly?
2. Is `externalId` unique and stable?
3. Are events being posted? (check connector logs)
4. Check backend logs for errors
5. Check frontend filters (date range, connector type, tags)
6. Verify integration is active in database

### Duplicate Events

**Expected:** Backend deduplicates by `(integrationId, externalId)`.

**If seeing true duplicates:**
1. Is `externalId` truly unique?
2. Is it stable across polls?
3. Are you including version/timestamp in externalId?
4. Check backend logs for P2002 errors (unique constraint violations)

### High Resource Usage

**Check:**
1. Polling interval too aggressive?
2. Too many integrations?
3. External API rate limits being hit?
4. Memory leaks in long-running connections?

---

## Questions?

- Review existing connector implementations in `connectors/`
- Check backend API documentation
- Test API endpoints with `curl` before implementing
- Open an issue with `[connector]` tag

---

## Contributing Checklist

When submitting a new connector:

- [ ] Follows this implementation guide
- [ ] Includes complete `metadata.json`
- [ ] Implements metadata registration
- [ ] Uses meaningful `externalId` generation
- [ ] Handles errors gracefully
- [ ] Includes comprehensive README.md
- [ ] Added to `docker-compose.yml`
- [ ] Tested with real external system
- [ ] Tested multi-tenant scenarios (if applicable)
- [ ] No hardcoded credentials
- [ ] No sensitive data in logs
