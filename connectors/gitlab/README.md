# PainChain GitLab Connector

The GitLab connector polls GitLab projects for events and pipelines, transforming them into PainChain events and forwarding them to the backend.

## Features

- **API-driven configuration** - Configure integrations via PainChain backend API or UI
- **Multi-project support** - Monitor multiple projects from a single integration
- **Event & pipeline tracking** - Captures code events AND CI/CD pipeline runs
- **Self-hosted GitLab support** - Works with both gitlab.com and self-hosted GitLab instances
- **Multi-tenant aware** - Works seamlessly with both free and SaaS tiers
- **Configurable polling** - Adjust polling interval based on your needs
- **Automatic deduplication** - Backend handles deduplication of events

## Supported Event Types

| Event Type | Description | Source |
|------------|-------------|--------|
| **Push** | Commits pushed to branches (with file changes) | Events API + Commits API |
| **Merge Request** | MRs opened, closed, merged, updated (with file changes) | Events API + MR Changes API |
| **Pipeline** | GitLab CI/CD pipeline executions | Pipelines API |
| **Job** | Individual CI job status | Jobs API |
| **Deployment** | Deployments to environments | Deployments API |
| **Tag** | Tags created | Tags API |
| **Release** | Releases created | Releases API |

## Quick Start

### 1. Start the Connector

The connector runs as a service and polls the backend API for integration configurations:

```bash
# Using Docker Compose (recommended)
docker-compose up -d gitlab-connector

# Or standalone Docker
docker run \
  -e BACKEND_API_URL=http://backend:8000/api \
  -e POLLING_INTERVAL=60 \
  painchain-gitlab-connector
```

### 2. Get a GitLab Personal Access Token

1. Go to GitLab Settings → Access Tokens
2. Create a new token with:
   - **Name**: "PainChain Connector"
   - **Scopes**:
     - `read_api` (Read API) - **Required**
     - `read_repository` (Read repository) - **Required for pipeline events**
3. Click "Create personal access token" and **copy the token immediately**

For self-hosted GitLab, go to your GitLab instance's user settings.

### 3. Register an Integration via API

Create integrations through the PainChain backend API (or later, through the UI):

```bash
curl -X POST http://localhost:8000/api/integrations \
  -H "Content-Type: application/json" \
  -d '{
    "type": "gitlab",
    "name": "My GitLab Projects",
    "config": {
      "token": "glpat-YOUR_TOKEN_HERE",
      "url": "https://gitlab.com",
      "repositories": [
        {
          "project": "your-org/your-project",
          "tags": ["backend", "production"]
        }
      ]
    }
  }'
```

**For self-hosted GitLab instances**, specify the custom URL:

```bash
curl -X POST http://localhost:8000/api/integrations \
  -H "Content-Type: application/json" \
  -d '{
    "type": "gitlab",
    "name": "Internal GitLab",
    "config": {
      "token": "glpat-YOUR_TOKEN_HERE",
      "url": "https://gitlab.mycompany.com",
      "repositories": [
        {
          "project": "team/api-server",
          "tags": ["backend"]
        }
      ]
    }
  }'
```

**For multi-tenant (SaaS) deployments**, include the tenant ID:

```bash
curl -X POST http://localhost:8000/api/integrations \
  -H "Content-Type: application/json" \
  -H "x-tenant-id: your-tenant-id" \
  -d '{
    "type": "gitlab",
    "name": "My GitLab Projects",
    "config": {
      "token": "glpat-YOUR_TOKEN_HERE",
      "url": "https://gitlab.com",
      "repositories": [
        {
          "project": "your-org/your-project",
          "tags": ["backend"]
        }
      ]
    }
  }'
```

### 4. How It Works

**On startup, the connector:**
1. Connects to the PainChain backend
2. Fetches all active GitLab integrations from `/api/integrations?type=gitlab`
3. Starts polling each project for events and pipelines
4. Repeats every 60 seconds (configurable via `POLLING_INTERVAL`)

**The backend API is the single source of truth** - all integration configuration is managed through the API (and eventually the UI). The connector simply fetches and executes the configuration.

## Configuration

### Integration Configuration Schema

```typescript
{
  "type": "gitlab",                    // Connector type (must be "gitlab")
  "name": "My Integration Name",       // Human-readable name
  "config": {
    "token": "glpat-...",              // GitLab Personal Access Token
    "url": "https://gitlab.com",       // GitLab instance URL (defaults to gitlab.com)
    "repositories": [                  // Array of projects to monitor
      {
        "project": "namespace/project", // Project path (namespace/project-name)
        "tags": ["backend", "critical"] // Optional tags for filtering
      }
    ]
  }
}
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `BACKEND_API_URL` | PainChain backend API URL | `http://localhost:8000/api` |
| `POLLING_INTERVAL` | Polling interval in seconds | `60` |

### Example Configurations

#### Single Project

```json
{
  "type": "gitlab",
  "name": "Backend API Monitor",
  "config": {
    "token": "glpat-xxxxx",
    "url": "https://gitlab.com",
    "repositories": [
      {
        "project": "acme/backend-api",
        "tags": ["backend", "critical"]
      }
    ]
  }
}
```

#### Multiple Projects (Team Monitoring)

```json
{
  "type": "gitlab",
  "name": "Platform Team Projects",
  "config": {
    "token": "glpat-xxxxx",
    "url": "https://gitlab.com",
    "repositories": [
      {
        "project": "acme/api-gateway",
        "tags": ["backend", "platform"]
      },
      {
        "project": "acme/auth-service",
        "tags": ["backend", "platform"]
      },
      {
        "project": "acme/notification-service",
        "tags": ["backend", "platform"]
      }
    ]
  }
}
```

#### Self-Hosted GitLab

```json
{
  "type": "gitlab",
  "name": "Internal GitLab Projects",
  "config": {
    "token": "glpat-xxxxx",
    "url": "https://gitlab.mycompany.com",
    "repositories": [
      {
        "project": "engineering/web-app",
        "tags": ["frontend"]
      },
      {
        "project": "engineering/api-server",
        "tags": ["backend"]
      }
    ]
  }
}
```

## Architecture

The GitLab connector uses a polling-based architecture:

1. **Startup**: Connector connects to PainChain backend
2. **Integration Fetching**: Queries `/api/integrations?type=gitlab` for all GitLab integrations
3. **Project Polling**: For each project in each integration:
   - Fetches recent events via GitLab Events API (last 20 events)
   - Fetches recent pipeline runs via GitLab Pipelines API (last 10 pipelines)
   - Backend handles deduplication based on event IDs
4. **Transformation**: Converts GitLab data to PainChain event format
5. **Forwarding**: Posts events to backend via `/api/events` with proper tenant isolation
6. **Repeat**: Waits for configured interval and repeats

```
┌─────────────────┐
│ GitLab Projects │
│  - Events API   │
│  - Pipelines API│
└────────┬────────┘
         │ Poll (60s)
         ↓
┌─────────────────┐
│ GitLab          │
│ Connector       │
│  - Transform    │
│  - Forward      │
└────────┬────────┘
         │ POST /api/events
         ↓
┌─────────────────┐
│ PainChain       │
│ Backend         │
│  - Deduplicate  │
└─────────────────┘
```

## Events Received

### Push Events

Triggered when commits are pushed to a branch.

**Event data includes:**
- Branch name
- Commit count
- **File changes** (names and count, up to 50 files)
- Author username, ID, and email
- Commit SHA
- Web URL

### Merge Request Events

Triggered when merge requests are opened, closed, merged, or updated.

**Event data includes:**
- MR title and IID
- Action (opened, closed, merged, updated)
- **File changes** (names and count, up to 50 files)
- Author username, ID, and email
- State
- Source and target branches
- Web URL

### Pipeline Events

Triggered when CI/CD pipelines run.

**Event data includes:**
- Pipeline ID and status
- Branch/ref and commit SHA
- Author username, ID, and email
- Duration in seconds
- Web URL

### Job Events

Triggered when individual CI jobs within pipelines execute.

**Event data includes:**
- Job name and ID
- Status (created, pending, running, success, failed, canceled, skipped, manual)
- Stage name
- Branch/ref and commit SHA
- Pipeline ID
- Duration and queued duration
- Runner ID and description
- Failure reason (if failed)
- Allow failure flag
- Artifacts presence
- Coverage percentage
- User who triggered, ID
- Web URL

### Deployment Events

Triggered when deployments are created or updated.

**Event data includes:**
- Deployment ID and status
- Environment name and ID
- Branch/ref and commit SHA
- Deployer username, ID, and email
- Web URL

### Tag Events

Triggered when tags are created.

**Event data includes:**
- Tag name
- Commit SHA and message
- Tag message/annotation
- Author name
- Web URL

### Release Events

Triggered when releases are created.

**Event data includes:**
- Release name and tag name
- Description
- Author username, ID, and email
- Commit SHA
- Upcoming release flag
- Assets count
- Web URL

## Multi-Tenant Support

The connector seamlessly handles both deployment models:

### Free Tier (Self-Hosted)
- `tenantId` is `null` for all integrations
- Single-tenant mode
- All events belong to the single user

### SaaS Tier (Managed)
- Each integration has a unique `tenantId`
- Connector polls for ALL tenants from shared instance
- Events are tagged with correct `tenantId` for isolation
- Users only see their own events via backend API

## Development

### Local Development Setup

```bash
# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Edit .env
# Set BACKEND_API_URL=http://localhost:8000/api

# Run in development mode (with hot reload)
npm run dev
```

### Building

```bash
# TypeScript compilation
npm run build

# Output: dist/index.js
```

### Docker Build

```bash
# Build image
docker build -t painchain-gitlab-connector .

# Run container
docker run \
  -e BACKEND_API_URL=http://backend:8000/api \
  -e POLLING_INTERVAL=30 \
  painchain-gitlab-connector
```

## Troubleshooting

### "Authentication failed" errors

**Problem**: `401 Unauthorized` errors when polling
**Solution**:
- Verify your GitLab token is valid
- Ensure token has `read_api` and `read_repository` scopes
- Check if token has expired
- For self-hosted GitLab, ensure the URL is correct

### No pipeline events appearing

**Problem**: Pipeline runs not showing in timeline
**Solution**:
- Verify GitLab token has `read_repository` scope
- Check that project actually has GitLab CI/CD pipelines
- Confirm pipelines have run recently (connector only fetches last 10 runs)

### "Project not found" errors

**Problem**: `404 Not Found` errors
**Solution**:
- Verify project path is correct (format: `namespace/project-name`)
- Ensure token has access to the project (especially for private projects)
- Check project hasn't been renamed, moved, or deleted

### Self-hosted GitLab connection issues

**Problem**: Cannot connect to self-hosted GitLab instance
**Solution**:
- Verify the `url` field in config points to your GitLab instance
- Ensure the connector can reach the GitLab instance (network/firewall)
- Check SSL/TLS certificate issues
- Verify the GitLab instance is running and accessible

### High API rate limiting

**Problem**: GitLab API rate limit errors
**Solution**:
- Increase polling interval (e.g., from 60s to 120s)
- Reduce number of projects being monitored
- Check your GitLab plan's API rate limits

## License

Apache 2.0
