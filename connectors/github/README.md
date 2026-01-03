# PainChain GitHub Connector

The GitHub connector polls GitHub repositories for events and workflows, transforming them into PainChain events and forwarding them to the backend.

## Features

- ✅ **API-driven configuration** - Configure integrations via PainChain backend API or UI
- ✅ **Multi-repository support** - Monitor multiple repos from a single integration
- ✅ **Event & workflow tracking** - Captures code events AND CI/CD pipeline runs
- ✅ **Multi-tenant aware** - Works seamlessly with both free and SaaS tiers
- ✅ **Configurable polling** - Adjust polling interval based on your needs
- ✅ **Automatic deduplication** - Only processes new events since last poll

## Supported Event Types

| Event Type | Description | Source |
|------------|-------------|--------|
| **Push** | Commits pushed to branches (with file changes) | Events API |
| **Pull Request** | PRs merged (with file changes) | Events API + PR Files API |
| **Release** | New releases published (with commit SHA) | Events API |
| **Workflow Run** | GitHub Actions CI/CD pipeline executions | Actions API |
| **Deployment** | Deployments created to environments | Events API |
| **Deployment Status** | Deployment status updates (success, failure, etc.) | Events API |

## Quick Start

### 1. Start the Connector

The connector runs as a service and polls the backend API for integration configurations:

```bash
# Using Docker Compose (recommended)
docker-compose up -d github-connector

# Or standalone Docker
docker run \
  -e BACKEND_API_URL=http://backend:8000/api \
  -e POLLING_INTERVAL=60 \
  painchain-github-connector
```

### 2. Get a GitHub Personal Access Token

1. Go to GitHub Settings → Developer settings → Personal access tokens → Tokens (classic)
2. Click "Generate new token (classic)"
3. Give it a descriptive name (e.g., "PainChain Connector")
4. Select scopes:
   - `repo` (Full control of private repositories) - **Required**
   - `workflow` (Update GitHub Action workflows) - **Required for workflow events**
   - `read:org` (Read org data) - Optional, for organization repos
5. Click "Generate token" and **copy the token immediately** (you won't see it again!)

### 3. Register an Integration via API

Create integrations through the PainChain backend API (or later, through the UI):

```bash
curl -X POST http://localhost:8000/api/integrations \
  -H "Content-Type: application/json" \
  -d '{
    "type": "github",
    "name": "My GitHub Repos",
    "config": {
      "token": "ghp_YOUR_TOKEN_HERE",
      "repositories": [
        {
          "owner": "your-org",
          "repo": "your-repo",
          "tags": ["backend", "production"]
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
    "type": "github",
    "name": "My GitHub Repos",
    "config": {
      "token": "ghp_YOUR_TOKEN_HERE",
      "repositories": [
        {
          "owner": "your-org",
          "repo": "your-repo",
          "tags": ["backend", "production"]
        }
      ]
    }
  }'
```

### 4. How It Works

**On startup, the connector:**
1. Connects to the PainChain backend
2. Fetches all active GitHub integrations from `/api/integrations?type=github`
3. Starts polling each repository for events and workflows
4. Repeats every 60 seconds (configurable via `POLLING_INTERVAL`)

**The backend API is the single source of truth** - all integration configuration is managed through the API (and eventually the UI). The connector simply fetches and executes the configuration

## Architecture

The GitHub connector uses a polling-based architecture:

1. **Startup**: Connector connects to PainChain backend
2. **Integration Fetching**: Queries `/api/integrations?type=github` for all GitHub integrations
3. **Repository Polling**: For each repository in each integration:
   - Fetches recent events via GitHub Events API (last 30 events)
   - Fetches recent workflow runs via GitHub Actions API (last 20 runs)
   - Backend handles deduplication based on event IDs
4. **Transformation**: Converts GitHub data to PainChain event format
5. **Forwarding**: Posts events to backend via `/api/events` with proper tenant isolation
6. **Repeat**: Waits for configured interval and repeats

```
┌─────────────────┐
│ GitHub Repos    │
│  - Events API   │
│  - Actions API  │
└────────┬────────┘
         │ Poll (60s)
         ↓
┌─────────────────┐
│ GitHub          │
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

## Configuration

### Integration Configuration Schema

```typescript
{
  "type": "github",                    // Connector type (must be "github")
  "name": "My Integration Name",       // Human-readable name
  "config": {
    "token": "ghp_...",                // GitHub Personal Access Token
    "repositories": [                  // Array of repositories to monitor
      {
        "owner": "facebook",           // Repository owner (org or user)
        "repo": "react",               // Repository name
        "tags": ["frontend", "oss"]    // Optional tags for filtering
      },
      {
        "owner": "microsoft",
        "repo": "typescript",
        "tags": ["language", "compiler"]
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

#### Single Repository

```json
{
  "type": "github",
  "name": "Backend API Monitor",
  "config": {
    "token": "ghp_xxxxx",
    "repositories": [
      {
        "owner": "acme",
        "repo": "backend-api",
        "tags": ["backend", "critical"]
      }
    ]
  }
}
```

#### Multiple Repositories (Team Monitoring)

```json
{
  "type": "github",
  "name": "Platform Team Repos",
  "config": {
    "token": "ghp_xxxxx",
    "repositories": [
      {
        "owner": "acme",
        "repo": "api-gateway",
        "tags": ["backend", "platform"]
      },
      {
        "owner": "acme",
        "repo": "auth-service",
        "tags": ["backend", "platform"]
      },
      {
        "owner": "acme",
        "repo": "notification-service",
        "tags": ["backend", "platform"]
      }
    ]
  }
}
```

#### Organization-wide Monitoring

```json
{
  "type": "github",
  "name": "All Engineering Repos",
  "config": {
    "token": "ghp_xxxxx",
    "repositories": [
      { "owner": "acme", "repo": "web-app", "tags": ["frontend"] },
      { "owner": "acme", "repo": "mobile-app", "tags": ["mobile"] },
      { "owner": "acme", "repo": "api-server", "tags": ["backend"] },
      { "owner": "acme", "repo": "ml-pipeline", "tags": ["ml"] }
    ]
  }
}
```

#### Multiple Integrations

You can create multiple integrations via the API, each with different tokens and repository sets:

```bash
# Integration 1: Work repositories
curl -X POST http://localhost:8000/api/integrations \
  -H "Content-Type: application/json" \
  -d '{
    "type": "github",
    "name": "Acme Corp Engineering",
    "config": {
      "token": "ghp_work_token",
      "repositories": [
        {"owner": "acme", "repo": "backend-api", "tags": ["backend"]},
        {"owner": "acme", "repo": "frontend-app", "tags": ["frontend"]}
      ]
    }
  }'

# Integration 2: Personal repositories
curl -X POST http://localhost:8000/api/integrations \
  -H "Content-Type: application/json" \
  -d '{
    "type": "github",
    "name": "Personal Projects",
    "config": {
      "token": "ghp_personal_token",
      "repositories": [
        {"owner": "myusername", "repo": "side-project", "tags": ["personal"]}
      ]
    }
  }'
```

## Events Received

### Push Events

Triggered when commits are pushed to a branch.

**Event data includes:**
- Branch name
- Commit count and messages
- **File changes** (names and count, up to 50 files)
- Author username, ID, and type
- Commit SHA range
- Repository information
- URL to compare view

### Pull Request Events

**Only merged PRs are tracked** (state changes to codebase).

**Event data includes:**
- PR title and number
- Action (merged)
- **File changes** (names and count, up to 50 files)
- Author username, ID, and type
- Merged by username, ID, and type
- State and merged status
- Head and base branches
- HTML URL

### Release Events

Triggered when new releases are published.

**Event data includes:**
- Release name and tag
- **Commit SHA** at time of release
- Author username, ID, and type
- Prerelease flag
- HTML URL

### Workflow Run Events

Triggered when GitHub Actions workflows execute.

**Event data includes:**
- Workflow name and run number
- Status (queued, in_progress, completed)
- Conclusion (success, failure, cancelled, etc.)
- Branch/ref and commit SHA
- Author/triggering actor username, ID, and type
- Duration in seconds
- HTML URL

**Tracked statuses:**
- All workflow runs are tracked
- Only runs with conclusion (completed, failed, etc.) generate events
- In-progress runs are not reported

### Deployment Events

Triggered when deployments are created to environments.

**Event data includes:**
- Deployment ID
- Environment (production, staging, etc.)
- Ref (branch/tag) and commit SHA
- Task type
- Creator username, ID, and type
- Description
- Deployment URL

### Deployment Status Events

Triggered when deployment status changes.

**Event data includes:**
- Deployment ID and status ID
- State (success, failure, error, pending, in_progress, queued, inactive)
- Environment name
- Ref and commit SHA
- Creator username, ID, and type
- Description
- Deployment URL, environment URL, log URL

**Status tracking:**
- All deployment status updates are captured
- Provides complete deployment lifecycle visibility

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
docker build -t painchain-github-connector .

# Run container
docker run \
  -e BACKEND_API_URL=http://backend:8000/api \
  -e POLLING_INTERVAL=30 \
  painchain-github-connector
```

## Troubleshooting

### "Authentication failed" errors

**Problem**: `401 Unauthorized` errors when polling
**Solution**:
- Verify your GitHub token is valid
- Ensure token has `repo` and `workflow` scopes
- Check if token has expired
- For organization repos, ensure token has `read:org` scope

### No workflow events appearing

**Problem**: Workflow runs not showing in timeline
**Solution**:
- Verify GitHub token has `workflow` scope
- Check that repository actually has GitHub Actions workflows
- Confirm workflows have run recently (connector only fetches last 20 runs)

### "Repository not found" errors

**Problem**: `404 Not Found` errors
**Solution**:
- Verify repository owner and name are correct
- Ensure token has access to the repository (especially for private repos)
- Check repository hasn't been renamed or deleted

### High API rate limiting

**Problem**: GitHub API rate limit errors
**Solution**:
- Increase polling interval (e.g., from 60s to 120s)
- Reduce number of repositories being monitored
- Use a GitHub App instead of Personal Access Token (higher rate limits)

## License

Apache 2.0
