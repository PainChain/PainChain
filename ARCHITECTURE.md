# PainChain v2 Architecture Plan

> **Status**: Planning Phase
> **Created**: 2025-12-26
> **Purpose**: Complete architectural redesign for connector-based event aggregation

## Overview

PainChain v2 is a complete rewrite focused on:
- **Connectors as independent containers** that self-register and push events
- **Standardized event contract** for all connectors
- **Generic frontend** that intelligently renders JSON without connector-specific code
- **Configuration as code** for all connectors
- **Free tier** (localhost/self-hosted) and **SaaS tier** (managed infrastructure with public webhooks)

## Core Principles

1. **Separation of Concerns**: Connectors are independent containers, not embedded code
2. **Self-Registration**: Connectors announce themselves to the backend on startup
3. **Standard Contract**: All events follow the same structure
4. **Generic UI**: Frontend renders JSON intelligently without knowing connector specifics
5. **Config as Code**: No complex UI forms, just YAML/JSON configuration files

---

## Repository Structure

```
PainChain/
├── charts/                          # Helm charts for Kubernetes deployment
│   ├── painchain/                   # Main PainChain chart
│   └── connectors/                  # Connector sub-charts
│
├── connectors/                      # Independent connector implementations
│   ├── github/
│   │   ├── Dockerfile
│   │   ├── connector.yaml          # Connector metadata
│   │   ├── config.example.yaml     # Example configuration
│   │   └── src/
│   │       └── index.ts            # Connector implementation
│   │
│   ├── gitlab/
│   │   ├── Dockerfile
│   │   ├── connector.yaml
│   │   ├── config.example.yaml
│   │   └── src/
│   │       └── index.ts
│   │
│   ├── kubernetes/
│   │   ├── Dockerfile
│   │   ├── connector.yaml
│   │   ├── config.example.yaml
│   │   └── src/
│   │       └── index.ts
│   │
│   └── [future connectors...]
│
├── painchain/                       # Core PainChain application
│   ├── backend/                     # NestJS backend
│   │   ├── src/
│   │   │   ├── api/                # API endpoints
│   │   │   ├── database/           # Prisma + database logic
│   │   │   ├── events/             # Event processing
│   │   │   ├── connectors/         # Connector registry
│   │   │   └── webhooks/           # Webhook receivers (SaaS tier)
│   │   ├── prisma/
│   │   │   └── schema.prisma
│   │   └── package.json
│   │
│   ├── frontend/                    # React frontend
│   │   ├── src/
│   │   │   ├── components/
│   │   │   ├── pages/
│   │   │   └── utils/
│   │   │       └── jsonRenderer.ts # Generic JSON rendering logic
│   │   └── package.json
│   │
│   ├── Dockerfile                   # Multi-stage: backend + frontend
│   └── package.json
│
├── docker-compose.yml               # Local development setup
├── deprecated/                      # Previous implementation (for reference)
└── ARCHITECTURE.md                  # This file
```

---

## Event Contract

All connectors produce events following this standardized structure:

```typescript
interface PainChainEvent {
  // Core fields (required)
  title: string              // Human-readable event title
  connector: string          // Connector type: "github", "gitlab", "kubernetes"
  project: string            // Project identifier (repo, cluster, etc.)
  timestamp: Date            // When the event occurred

  // Flexible data (connector-specific)
  data: Record<string, any>  // Structured JSON data
}
```

### Examples

**GitHub Push Event:**
```json
{
  "title": "Push to main branch",
  "connector": "github",
  "project": "acme/backend-api",
  "timestamp": "2025-12-26T10:30:00Z",
  "data": {
    "event_type": "push",
    "branch": "main",
    "author": "john.doe",
    "commits": 3,
    "url": "https://github.com/acme/backend-api/compare/abc123...def456"
  }
}
```

**Kubernetes Deployment Event:**
```json
{
  "title": "Deployment scaled: api-service",
  "connector": "kubernetes",
  "project": "prod-cluster/default",
  "timestamp": "2025-12-26T10:35:00Z",
  "data": {
    "event_type": "deployment_scaled",
    "namespace": "default",
    "deployment": "api-service",
    "replicas": {
      "old": 3,
      "new": 5
    }
  }
}
```

---

## API Design

### Core Endpoints

```
# Frontend/Backend Communication
GET  /api/timeline              # Get timeline events (with filters)
GET  /api/projects              # List all projects
GET  /api/integrations          # List user's integrations
GET  /api/integrations/:id      # Get integration details

# Integration Management (Users register their apps/tokens)
POST /api/integrations          # Register new integration (GitHub app, GitLab token, etc.)
PUT  /api/integrations/:id      # Update integration config
DELETE /api/integrations/:id    # Remove integration

# Connector → Backend (Internal)
POST /api/events                # Ingest events from connectors
GET  /api/events                # Query events (with filters)

# Webhook Receivers (Optional - if webhooks enabled)
POST /api/webhooks/github/:id   # GitHub webhook endpoint
POST /api/webhooks/gitlab/:id   # GitLab webhook endpoint
```

### Integration Registration (Free Tier)

**Free Tier:** Connector containers self-register on startup:

```typescript
POST /api/integrations
{
  "type": "github",
  "name": "My GitHub Repos",
  "config": {
    "token": "ghp_...",
    "repositories": [
      { "owner": "acme", "repo": "backend-api", "tags": ["backend", "critical"] }
    ],
    "polling": { "enabled": true, "interval": 60 }
  }
}

Response:
{
  "id": "int_abc123",
  "registered_at": "2025-12-26T10:00:00Z"
}
```

### Integration Registration (SaaS Tier)

**SaaS Tier:** Users register via UI or API:

```typescript
POST /api/integrations
Headers:
  Authorization: Bearer <user-token>
  X-Tenant-ID: customer-id

{
  "type": "github",
  "name": "ACME GitHub",
  "config": {
    "token": "ghp_...",
    "repositories": [
      { "owner": "acme", "repo": "backend-api", "tags": ["backend", "critical"] }
    ]
  }
}

Response:
{
  "id": "int_xyz789",
  "tenant_id": "customer-id",
  "registered_at": "2025-12-26T10:00:00Z"
}
```

Our centralized connector service periodically queries all integrations and polls accordingly.

### Event Ingestion

Connectors push events to the backend:

```typescript
POST /api/events
{
  "title": "Push to main branch",
  "connector": "github",
  "project": "acme/backend-api",
  "timestamp": "2025-12-26T10:30:00Z",
  "data": { ... }
}

Response:
{
  "event_id": "evt_xyz789",
  "stored_at": "2025-12-26T10:30:01Z"
}
```

---

## Connector Architecture

### Connector Lifecycle

1. **Startup**
   - Load configuration from mounted config file or environment variables
   - Register with PainChain backend via `POST /api/connectors/register`
   - Start event collection loop (polling or webhook listener)

2. **Event Collection**
   - Poll external API (GitHub, GitLab, K8s API) or receive webhooks
   - Transform external events into PainChain event format
   - POST to `/api/events`

3. **Health Checks**
   - Expose `/health` endpoint for container orchestration
   - Periodically heartbeat to backend

### Configuration

Connectors are configured via YAML files mounted as volumes.

**Example: `github-connector.yaml`**
```yaml
connector:
  type: github
  project: backend-team  # Logical grouping

config:
  # Authentication
  token: ${GITHUB_TOKEN}  # From environment variable

  # Which repos to monitor
  repositories:
    - owner: acme
      repo: backend-api
      tags: ["backend", "critical"]
    - owner: acme
      repo: frontend-app
      tags: ["frontend", "critical", "java"]

  # Polling config (for free tier)
  polling:
    enabled: true
    interval: 60  # seconds

  # Webhook config (for SaaS tier)
  webhook:
    enabled: false
    secret: ${GITHUB_WEBHOOK_SECRET}

  # Event filtering
  events:
    - push
    - pull_request
    - issues
```

**Docker Compose Example:**
```yaml
services:
  github-connector:
    build: ./connectors/github
    environment:
      GITHUB_TOKEN: ${GITHUB_TOKEN}
      PAINCHAIN_API_URL: http://backend:8000/api
    volumes:
      - ./config/github-connector.yaml:/app/config.yaml:ro
    depends_on:
      - backend
```

**Helm/Kubernetes Example:**
```yaml
# ConfigMap for non-sensitive config
apiVersion: v1
kind: ConfigMap
metadata:
  name: github-connector-config
data:
  config.yaml: |
    connector:
      type: github
      project: backend-team
    config:
      repositories:
        - owner: acme
          repo: backend-api
          tags: ["backend", "critical"]
      polling:
        enabled: true
        interval: 60

---
# Secret for sensitive data
apiVersion: v1
kind: Secret
metadata:
  name: github-connector-secrets
type: Opaque
data:
  github-token: <base64-encoded-token>

---
# Deployment
apiVersion: apps/v1
kind: Deployment
metadata:
  name: github-connector
spec:
  replicas: 1
  template:
    spec:
      containers:
      - name: connector
        image: painchain/github-connector:latest
        env:
        - name: GITHUB_TOKEN
          valueFrom:
            secretKeyRef:
              name: github-connector-secrets
              key: github-token
        - name: PAINCHAIN_API_URL
          value: http://painchain-backend:8000/api
        volumeMounts:
        - name: config
          mountPath: /app/config.yaml
          subPath: config.yaml
      volumes:
      - name: config
        configMap:
          name: github-connector-config
```

---

## Frontend Architecture

### Generic JSON Rendering

The frontend doesn't have connector-specific code. Instead, it intelligently renders JSON based on structure.

**Key Principles:**
- Detect common patterns (URLs, timestamps, user references)
- Render rich UI components based on data types
- Allow filtering/sorting by any field
- Timeline view with grouping by project/connector

**Example Renderer Logic:**

```typescript
// utils/jsonRenderer.ts

interface RenderConfig {
  [key: string]: {
    type: 'text' | 'link' | 'timestamp' | 'code' | 'badge' | 'user'
    format?: (value: any) => string
  }
}

// Auto-detect rendering hints from field names and values
function detectRenderType(key: string, value: any): RenderType {
  if (key.includes('url') || key.includes('link') || /^https?:\/\//.test(value)) {
    return 'link'
  }
  if (key.includes('time') || key.includes('date') || value instanceof Date) {
    return 'timestamp'
  }
  if (key.includes('user') || key.includes('author')) {
    return 'user'
  }
  if (key.includes('status') || key.includes('severity')) {
    return 'badge'
  }
  return 'text'
}

// Recursively render JSON object
function renderJSON(data: Record<string, any>): JSX.Element {
  return (
    <div className="json-display">
      {Object.entries(data).map(([key, value]) => {
        const type = detectRenderType(key, value)
        return (
          <div key={key} className="json-field">
            <span className="field-name">{formatFieldName(key)}</span>
            {renderValue(value, type)}
          </div>
        )
      })}
    </div>
  )
}
```

---

## Free Tier vs SaaS Tier

### Free Tier (Self-Hosted)

**Architecture:**
- Run on `localhost` or private network
- Connectors use **polling** by default (pull model)
- **Webhooks optional** if users provide their own DNS/tunneling (ngrok, Cloudflare Tunnel, custom domain)

**Deployment:**
```bash
# Docker Compose
docker-compose up -d

# Access at:
# - http://localhost:8000/home
# - http://localhost:8000/settings
# - http://localhost:8000/api
```

**Connectors:**
- GitHub connector polls GitHub API every 60s
- GitLab connector polls GitLab API every 60s
- Kubernetes connector watches K8s API

### SaaS Tier (Managed)

**Architecture:**
- **Multi-tenant version with centralized connectors**
- Managed infrastructure (like Supabase model)
- Dedicated subdomain per customer: `https://customer-id.painchain.io`
- Public webhook endpoints available for each tenant
- **We run and manage all connector instances**

**Key Architectural Difference:**
In the SaaS tier, connector instances are **shared infrastructure** that poll for all users:

**Free Tier:**
```
User runs: [GitHub Connector] → [Their Backend]
           (polls their repos)
```

**SaaS Tier:**
```
We run: [GitHub Connector Service] → [Multi-tenant Backend]
        (polls repos for ALL users)

Users: Register their apps/tokens via UI/API
```

**How It Works:**
1. Users register their GitHub apps/tokens through the PainChain UI or API
2. Our centralized GitHub connector service polls GitHub for all registered users
3. Events are tagged with the correct tenant and stored in multi-tenant database
4. Each user only sees their own events

**Benefits:**
- More efficient (1 connector instance handles many users)
- We manage connector updates and scaling
- Users just provide credentials, no infrastructure to manage
- Automatic SSL/TLS, monitoring, backups, and SLAs

---

## Database Schema

```prisma
// prisma/schema.prisma

// Multi-tenant support (for SaaS tier)
model Tenant {
  id            String   @id @default(cuid())
  slug          String   @unique  // "customer-id" for customer-id.painchain.io
  name          String
  createdAt     DateTime @default(now())

  integrations  Integration[]
  events        Event[]
  projects      Project[]

  @@map("tenants")
}

// User-registered integrations (SaaS tier: users provide API keys)
// Or connector instances (Free tier: running containers)
model Integration {
  id            String   @id @default(cuid())
  tenantId      String?  // null for free tier (single tenant)
  tenant        Tenant?  @relation(fields: [tenantId], references: [id])

  type          String   // "github", "gitlab", "kubernetes"
  name          String   // User-friendly name: "ACME GitHub", "Production K8s"

  // Configuration (API keys, repos to watch, polling settings)
  config        Json     // { token: "...", repositories: [...], polling: {...} }

  // Status
  status        String   @default("active") // "active", "inactive", "error"
  lastSync      DateTime?
  registeredAt  DateTime @default(now())

  @@map("integrations")
}

model Event {
  id          String   @id @default(cuid())
  tenantId    String?  // null for free tier
  tenant      Tenant?  @relation(fields: [tenantId], references: [id])

  title       String
  connector   String   // "github", "gitlab", "kubernetes"
  project     String   // "acme/backend-api", "prod-cluster/default"
  timestamp   DateTime
  data        Json     // Flexible JSON data
  createdAt   DateTime @default(now())

  @@index([tenantId, connector, project, timestamp])
  @@index([tenantId, timestamp])
  @@index([timestamp])
  @@map("events")
}

model Project {
  id          String   @id @default(cuid())
  tenantId    String?  // null for free tier
  tenant      Tenant?  @relation(fields: [tenantId], references: [id])

  name        String   // "acme/backend-api", "prod-cluster/default"
  connector   String   // "github", "gitlab", "kubernetes"
  tags        String[] // Tags defined in connector config for this project
  createdAt   DateTime @default(now())

  @@unique([tenantId, name, connector])
  @@map("projects")
}
```

**Schema Notes:**

**Free Tier:**
- `tenantId` is `null` (single tenant, self-hosted)
- `Integration` model represents running connector containers
- Users configure via YAML files

**SaaS Tier:**
- Each customer gets a `Tenant` record
- `Integration` model stores user-provided API keys and configuration
- Centralized connector services query all `Integration` records and poll accordingly
- All data is isolated by `tenantId`

---

## Implementation Phases

### Phase 1: Core Backend + Database
- [ ] Set up PainChain backend (NestJS)
- [ ] Implement Prisma schema (Tenant, Integration, Event, Project models)
- [ ] Create `/api/integrations` endpoints (POST, GET, PUT, DELETE)
- [ ] Create `/api/events` POST endpoint (event ingestion)
- [ ] Create `/api/events` GET endpoint (query events with tenant isolation)
- [ ] Create `/api/timeline` endpoint
- [ ] Create `/api/projects` endpoint
- [ ] Docker setup for backend + PostgreSQL

### Phase 2: First Connector (GitHub)
- [ ] Create `connectors/github/` structure
- [ ] Implement GitHub connector with polling logic
- [ ] Query `/api/integrations` for all GitHub integrations (multi-tenant aware)
- [ ] Poll GitHub API for each integration's configured repos
- [ ] Transform GitHub events to PainChain format
- [ ] POST events to backend with correct tenantId
- [ ] Docker image for GitHub connector
- [ ] Docker Compose integration
- [ ] Handle free tier (tenantId=null) and SaaS tier (multiple tenantIds)

### Phase 3: Generic Frontend
- [ ] React app setup
- [ ] Timeline view (`/home`)
- [ ] Generic JSON renderer
- [ ] Project filtering
- [ ] Connector status view (`/settings`)
- [ ] Serve frontend from same container as backend

### Phase 4: Additional Connectors
- [ ] GitLab connector (polling)
- [ ] Kubernetes connector (API watch)
- [ ] Connector health monitoring

### Phase 5: SaaS Tier Features
- [ ] Webhook receivers (`/api/webhooks/github/:id`)
- [ ] GitHub/GitLab webhook signature verification
- [ ] Switch connectors to push mode when webhooks configured
- [ ] Public URL management
- [ ] Customer isolation

### Phase 6: Helm Charts
- [ ] PainChain Helm chart
- [ ] Connector sub-charts
- [ ] ConfigMap/Secret management
- [ ] Ingress configuration

---

## Development Workflow

### Local Development

```bash
# 1. Start core services (backend, db, redis)
docker-compose up -d painchain-backend painchain-db

# 2. Start a connector
docker-compose up -d github-connector

# 3. Access UI
open http://localhost:8000/home
```

### Adding a New Connector

1. Create directory: `connectors/new-connector/`
2. Implement connector logic in `src/index.ts`
3. Create `Dockerfile`
4. Create `connector.yaml` metadata
5. Create `config.example.yaml` for users
6. Add to `docker-compose.yml`
7. Build and test

---

## Migration from v1

The `deprecated/` folder contains the previous implementation for reference.

**Key differences:**
- **Old**: Connectors embedded in backend code
- **New**: Connectors as independent containers

**Migration path:**
- No direct migration needed
- Fresh install recommended
- Export data from old system if needed (separate script)

---

## Future Considerations

**Authentication/Authorization:**
- OIDC planned for both free and SaaS tiers (future phase)
- Multi-tenant isolation for SaaS tier

**Rate Limiting:**
- Not enforced by PainChain (users provide their own API keys)
- Could implement intelligent poll time backoff in future if needed

**Event Retention:**
- Default: 18 months
- Configurable per organization
- Goal: SOC2 compliance for audit trail purposes

**Future Features (TBD):**
- Alert/notification system
- Connector marketplace/registry

---

## References

- Old codebase: `deprecated/`
- Event examples: TBD (add as connectors are built)
- API documentation: Auto-generated from NestJS (Swagger)
