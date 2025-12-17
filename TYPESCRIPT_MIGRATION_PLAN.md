# PainChain TypeScript Migration Plan

## Vision

**Goal:** Full TypeScript backend while maintaining the plug-and-play connector architecture.

**One connector folder = Auto-discovered in UI**

```
backend/src/connectors/github/
├── connector.ts          # Polling logic
├── metadata.json        # UI config (unchanged!)
├── logo.png            # Icon
└── README.md           # Docs

→ Automatically appears in Settings UI
→ Types shared with frontend
→ No manual registration needed
```

---

## Tech Stack

### Backend
- **NestJS** - TypeScript framework (like FastAPI but for Node.js)
- **Prisma** - Type-safe ORM with auto-generated types
- **BullMQ** - Redis-based task queue with great observability
- **PostgreSQL** - Keep existing database
- **Redis** - Message broker + cache

### Frontend (Minimal Changes)
- **React + Vite** - Unchanged
- **TypeScript** - Upgrade from JavaScript
- **Shared Types** - Import from `@painchain/types` package

### Monorepo Structure
- **Turborepo** - Fast build system
- **pnpm** - Fast, disk-efficient package manager
- **Shared packages** - Types, utils, metadata

---

## Project Structure

```
PainChain/
├── package.json                    # Root workspace config
├── turbo.json                      # Turborepo config
├── pnpm-workspace.yaml            # pnpm workspaces
├── docker-compose.yml             # Updated for TS backend
│
├── packages/
│   ├── types/                     # Shared TypeScript types
│   │   ├── package.json
│   │   ├── src/
│   │   │   ├── events.ts         # ChangeEvent, EventType, etc.
│   │   │   ├── connectors.ts     # Connector interfaces
│   │   │   ├── metadata.ts       # Metadata JSON types
│   │   │   └── index.ts
│   │   └── tsconfig.json
│   │
│   └── metadata/                  # Connector metadata (shared)
│       ├── github.json
│       ├── gitlab.json
│       ├── kubernetes.json
│       └── painchain.json
│
├── apps/
│   ├── backend/                   # NestJS API + Workers
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── nest-cli.json
│   │   ├── prisma/
│   │   │   ├── schema.prisma     # Database schema
│   │   │   └── migrations/
│   │   └── src/
│   │       ├── main.ts           # Entry point
│   │       ├── app.module.ts     # Root module
│   │       ├── api/              # REST API controllers
│   │       │   ├── changes.controller.ts
│   │       │   ├── connections.controller.ts
│   │       │   └── connectors.controller.ts
│   │       ├── connectors/       # Plugin system
│   │       │   ├── connector.service.ts       # Loader
│   │       │   ├── connector.interface.ts     # Base interface
│   │       │   ├── github/
│   │       │   │   ├── github.connector.ts
│   │       │   │   ├── metadata.json
│   │       │   │   ├── logo.png
│   │       │   │   └── README.md
│   │       │   ├── gitlab/
│   │       │   ├── kubernetes/
│   │       │   └── painchain/
│   │       ├── queue/            # BullMQ integration
│   │       │   ├── queue.module.ts
│   │       │   ├── queue.service.ts
│   │       │   └── connectors.processor.ts
│   │       └── database/
│   │           └── prisma.service.ts
│   │
│   └── frontend/                 # React dashboard
│       ├── package.json          # Now depends on @painchain/types
│       ├── tsconfig.json         # Enable TypeScript
│       └── src/
│           ├── main.tsx          # Rename from .jsx
│           ├── pages/
│           │   ├── Dashboard.tsx
│           │   └── Settings.tsx
│           └── connectors/       # Event rendering (unchanged)
│
└── init.sql                      # Database initialization
```

---

## Core Types (Shared Package)

```typescript
// packages/types/src/events.ts

export interface ChangeEvent {
  id: number
  connectionId: number
  source: string
  eventType: EventType
  title: string
  description: string | null
  timestamp: Date
  url: string | null
  status: string | null
  metadata: Record<string, any>
  eventMetadata: Record<string, any>
  createdAt: Date
  updatedAt: Date
}

export type EventType =
  | 'PR'
  | 'Workflow'
  | 'Commit'
  | 'Release'
  | 'Image'
  | 'MR'
  | 'Pipeline'
  | 'K8sDeployment'
  | 'K8sStatefulSet'
  | 'K8sDaemonSet'
  | 'K8sService'
  | 'K8sConfigMap'
  | 'K8sSecret'
  | 'K8sIngress'
  | 'K8sPod'
  | 'K8sRole'
  | 'K8sRoleBinding'
  | 'K8sHelmRelease'
  | 'ConnectorCreated'
  | 'ConnectorUpdated'
  | 'ConnectorDeleted'
  | 'ConnectorEnabled'
  | 'ConnectorDisabled'
  | 'ConfigChanged'
  | 'FieldVisibilityChanged'

// packages/types/src/connectors.ts

export interface ConnectorMetadata {
  id: string
  displayName: string
  color: string
  logo: string
  description: string
  connectionForm: ConnectionForm
  eventTypes: Record<string, EventTypeConfig>
}

export interface ConnectionForm {
  fields: FormField[]
}

export interface FormField {
  key: string
  label: string
  type: 'text' | 'password' | 'number' | 'checkbox'
  placeholder?: string
  default?: string | number | boolean
  required: boolean
  help?: string
  min?: number
  max?: number
  conditionalOn?: string
}

export interface EventTypeConfig {
  displayName: string
  fields: Record<string, FieldConfig>
}

export interface FieldConfig {
  defaultVisibility: boolean
  fieldLabel: string
}

export interface Connection {
  id: number
  name: string
  type: string
  config: Record<string, any>
  enabled: boolean
  lastSync: Date | null
  createdAt: Date
  updatedAt: Date
}

// packages/types/src/connectors.interface.ts

export interface IConnector {
  /**
   * Test if the connection credentials are valid
   */
  testConnection(): Promise<boolean>

  /**
   * Sync events from the external service
   * @param connectionId Database ID of this connection
   * @returns Statistics about the sync operation
   */
  sync(connectionId: number): Promise<SyncResult>
}

export interface SyncResult {
  success: boolean
  eventsStored: number
  errors?: string[]
  details?: Record<string, any>
}

export interface ConnectorConfig {
  [key: string]: any
}
```

---

## Backend Architecture (NestJS)

### 1. Main Application

```typescript
// apps/backend/src/main.ts

import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'
import { ValidationPipe } from '@nestjs/common'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    cors: true, // Enable CORS for frontend
  })

  // Validation pipe
  app.useGlobalPipes(new ValidationPipe())

  // Swagger API docs (like FastAPI's /docs)
  const config = new DocumentBuilder()
    .setTitle('PainChain API')
    .setDescription('Unified Change Management API')
    .setVersion('1.0')
    .build()
  const document = SwaggerModule.createDocument(app, config)
  SwaggerModule.setup('docs', app, document)

  await app.listen(8000)
  console.log('🚀 PainChain API running on http://localhost:8000')
  console.log('📚 API Docs available at http://localhost:8000/docs')
}

bootstrap()
```

### 2. Connector Plugin System

```typescript
// apps/backend/src/connectors/connector.interface.ts

import { IConnector, SyncResult } from '@painchain/types'

export abstract class BaseConnector implements IConnector {
  constructor(protected config: Record<string, any>) {}

  abstract testConnection(): Promise<boolean>
  abstract sync(connectionId: number): Promise<SyncResult>

  /**
   * Get metadata for this connector type
   * Reads metadata.json from the connector's directory
   */
  static getMetadata(): ConnectorMetadata {
    // Auto-load from metadata.json in same directory
    const metadataPath = join(__dirname, 'metadata.json')
    return JSON.parse(readFileSync(metadataPath, 'utf-8'))
  }
}
```

```typescript
// apps/backend/src/connectors/connector.service.ts

import { Injectable, Logger } from '@nestjs/common'
import { readdirSync, existsSync } from 'fs'
import { join } from 'path'
import { ConnectorMetadata } from '@painchain/types'

@Injectable()
export class ConnectorService {
  private readonly logger = new Logger(ConnectorService.name)
  private connectors = new Map<string, any>()
  private metadata = new Map<string, ConnectorMetadata>()

  /**
   * Auto-discover all connectors by scanning the connectors directory
   * Each subdirectory with a connector.ts file is a valid connector
   */
  async discoverConnectors(): Promise<void> {
    const connectorsDir = join(__dirname, '.')
    const entries = readdirSync(connectorsDir, { withFileTypes: true })

    for (const entry of entries) {
      if (!entry.isDirectory()) continue

      const connectorPath = join(connectorsDir, entry.name)
      const connectorFile = join(connectorPath, `${entry.name}.connector`)
      const metadataFile = join(connectorPath, 'metadata.json')

      if (existsSync(`${connectorFile}.ts`) && existsSync(metadataFile)) {
        try {
          // Dynamically import the connector class
          const module = await import(connectorFile)
          const ConnectorClass = module[`${this.capitalize(entry.name)}Connector`]

          // Load metadata
          const metadata = ConnectorClass.getMetadata()

          this.connectors.set(entry.name, ConnectorClass)
          this.metadata.set(entry.name, metadata)

          this.logger.log(`✅ Discovered connector: ${entry.name}`)
        } catch (error) {
          this.logger.error(`❌ Failed to load connector ${entry.name}:`, error)
        }
      }
    }

    this.logger.log(`Discovered ${this.connectors.size} connectors`)
  }

  /**
   * Get all connector metadata (for /api/connectors/metadata endpoint)
   */
  getAllMetadata(): ConnectorMetadata[] {
    return Array.from(this.metadata.values())
  }

  /**
   * Get a connector instance
   */
  getConnector(type: string, config: Record<string, any>): BaseConnector {
    const ConnectorClass = this.connectors.get(type)
    if (!ConnectorClass) {
      throw new Error(`Connector type "${type}" not found`)
    }
    return new ConnectorClass(config)
  }

  private capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1)
  }
}
```

### 3. GitHub Connector Example

```typescript
// apps/backend/src/connectors/github/github.connector.ts

import { Octokit } from '@octokit/rest'
import { BaseConnector } from '../connector.interface'
import { SyncResult, ChangeEvent } from '@painchain/types'
import { PrismaService } from '../../database/prisma.service'
import { Injectable } from '@nestjs/common'

@Injectable()
export class GithubConnector extends BaseConnector {
  private client: Octokit

  constructor(config: Record<string, any>, private prisma: PrismaService) {
    super(config)

    this.client = new Octokit({
      auth: config.token,
      ...(config.baseUrl && { baseUrl: config.baseUrl })
    })
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.client.users.getAuthenticated()
      return true
    } catch {
      return false
    }
  }

  async sync(connectionId: number): Promise<SyncResult> {
    let eventsStored = 0
    const errors: string[] = []

    try {
      const repos = await this.getRepos()

      for (const repo of repos) {
        // Fetch PRs
        const prs = await this.fetchPullRequests(repo)
        eventsStored += await this.storePullRequests(connectionId, repo, prs)

        // Fetch Workflows
        const workflows = await this.fetchWorkflows(repo)
        eventsStored += await this.storeWorkflows(connectionId, repo, workflows)

        // Fetch Commits
        const commits = await this.fetchCommits(repo)
        eventsStored += await this.storeCommits(connectionId, repo, commits)

        // Fetch Releases
        const releases = await this.fetchReleases(repo)
        eventsStored += await this.storeReleases(connectionId, repo, releases)
      }

      return {
        success: true,
        eventsStored,
        details: { reposProcessed: repos.length }
      }
    } catch (error) {
      return {
        success: false,
        eventsStored,
        errors: [error.message]
      }
    }
  }

  private async getRepos() {
    if (this.config.repos && this.config.repos.length > 0) {
      return this.config.repos.map(repo => {
        const [owner, name] = repo.split('/')
        return { owner, name, full_name: repo }
      })
    }

    // Fetch all accessible repos
    const { data } = await this.client.repos.listForAuthenticatedUser({
      sort: 'updated',
      per_page: 100
    })

    return data.map(repo => ({
      owner: repo.owner.login,
      name: repo.name,
      full_name: repo.full_name
    }))
  }

  private async fetchPullRequests(repo: any) {
    const { data } = await this.client.pulls.list({
      owner: repo.owner,
      repo: repo.name,
      state: 'all',
      sort: 'updated',
      direction: 'desc',
      per_page: 50
    })
    return data
  }

  private async storePullRequests(
    connectionId: number,
    repo: any,
    prs: any[]
  ): Promise<number> {
    let stored = 0

    for (const pr of prs) {
      await this.prisma.changeEvent.upsert({
        where: {
          connection_id_external_id: {
            connection_id: connectionId,
            external_id: `pr-${pr.id}`
          }
        },
        create: {
          connection_id: connectionId,
          external_id: `pr-${pr.id}`,
          source: 'github',
          event_type: 'PR',
          title: `[PR] ${pr.title}`,
          description: pr.body || '',
          timestamp: new Date(pr.created_at),
          url: pr.html_url,
          status: pr.state,
          metadata: {
            number: pr.number,
            state: pr.state,
            merged: pr.merged_at !== null,
            repository: repo.full_name
          },
          event_metadata: {
            head_branch: pr.head.ref,
            base_branch: pr.base.ref,
            additions: pr.additions,
            deletions: pr.deletions,
            changed_files: pr.changed_files
          }
        },
        update: {
          title: `[PR] ${pr.title}`,
          description: pr.body || '',
          status: pr.state,
          metadata: {
            number: pr.number,
            state: pr.state,
            merged: pr.merged_at !== null,
            repository: repo.full_name
          },
          event_metadata: {
            head_branch: pr.head.ref,
            base_branch: pr.base.ref,
            additions: pr.additions,
            deletions: pr.deletions,
            changed_files: pr.changed_files
          }
        }
      })
      stored++
    }

    return stored
  }

  // Similar methods for workflows, commits, releases...
}
```

### 4. BullMQ Integration

```typescript
// apps/backend/src/queue/queue.module.ts

import { BullModule } from '@nestjs/bull'
import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { ConnectorsProcessor } from './connectors.processor'

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        redis: {
          host: config.get('REDIS_HOST', 'localhost'),
          port: config.get('REDIS_PORT', 6379)
        }
      }),
      inject: [ConfigService]
    }),
    BullModule.registerQueue({
      name: 'connectors'
    })
  ],
  providers: [ConnectorsProcessor],
  exports: [BullModule]
})
export class QueueModule {}
```

```typescript
// apps/backend/src/queue/connectors.processor.ts

import { Process, Processor } from '@nestjs/bull'
import { Logger } from '@nestjs/common'
import { Job } from 'bull'
import { ConnectorService } from '../connectors/connector.service'
import { PrismaService } from '../database/prisma.service'

@Processor('connectors')
export class ConnectorsProcessor {
  private readonly logger = new Logger(ConnectorsProcessor.name)

  constructor(
    private connectorService: ConnectorService,
    private prisma: PrismaService
  ) {}

  @Process('poll')
  async handlePoll(job: Job<{ connectionId: number }>) {
    const { connectionId } = job.data
    this.logger.log(`Polling connection ${connectionId}`)

    try {
      // Load connection from database
      const connection = await this.prisma.connection.findUnique({
        where: { id: connectionId }
      })

      if (!connection || !connection.enabled) {
        this.logger.warn(`Connection ${connectionId} not found or disabled`)
        return { status: 'skipped' }
      }

      // Get connector instance
      const connector = this.connectorService.getConnector(
        connection.type,
        connection.config
      )

      // Execute sync
      const result = await connector.sync(connectionId)

      // Update last_sync timestamp
      await this.prisma.connection.update({
        where: { id: connectionId },
        data: { last_sync: new Date() }
      })

      this.logger.log(`✅ Polled connection ${connectionId}: ${result.eventsStored} events`)
      return result
    } catch (error) {
      this.logger.error(`❌ Error polling connection ${connectionId}:`, error)
      throw error
    }
  }
}
```

### 5. API Controllers

```typescript
// apps/backend/src/api/connectors.controller.ts

import { Controller, Get } from '@nestjs/common'
import { ApiTags, ApiOperation } from '@nestjs/swagger'
import { ConnectorService } from '../connectors/connector.service'

@ApiTags('connectors')
@Controller('api/connectors')
export class ConnectorsController {
  constructor(private connectorService: ConnectorService) {}

  @Get('metadata')
  @ApiOperation({ summary: 'Get all connector metadata (auto-discovered)' })
  async getMetadata() {
    return this.connectorService.getAllMetadata()
  }

  @Get('types')
  @ApiOperation({ summary: 'Get list of available connector types' })
  async getTypes() {
    const metadata = this.connectorService.getAllMetadata()
    return metadata.map(m => m.id)
  }
}
```

---

## Database Schema (Prisma)

```prisma
// apps/backend/prisma/schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model ChangeEvent {
  id             Int      @id @default(autoincrement())
  connectionId   Int      @map("connection_id")
  externalId     String?  @map("external_id")
  source         String
  eventType      String   @map("event_type")
  title          String
  description    String?
  timestamp      DateTime
  url            String?
  status         String?
  metadata       Json     @default("{}")
  eventMetadata  Json     @default("{}") @map("event_metadata")
  createdAt      DateTime @default(now()) @map("created_at")
  updatedAt      DateTime @updatedAt @map("updated_at")

  connection Connection @relation(fields: [connectionId], references: [id], onDelete: Cascade)

  @@unique([connectionId, externalId], name: "connection_id_external_id")
  @@index([connectionId])
  @@index([source])
  @@index([eventType])
  @@index([timestamp])
  @@map("change_events")
}

model Connection {
  id         Int      @id @default(autoincrement())
  name       String
  type       String
  config     Json
  enabled    Boolean  @default(true)
  lastSync   DateTime? @map("last_sync")
  createdAt  DateTime @default(now()) @map("created_at")
  updatedAt  DateTime @updatedAt @map("updated_at")

  events     ChangeEvent[]
  teams      TeamConnection[]

  @@map("connections")
}

model Team {
  id          Int      @id @default(autoincrement())
  name        String   @unique
  description String?
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  connections TeamConnection[]

  @@map("teams")
}

model TeamConnection {
  id           Int      @id @default(autoincrement())
  teamId       Int      @map("team_id")
  connectionId Int      @map("connection_id")

  team       Team       @relation(fields: [teamId], references: [id], onDelete: Cascade)
  connection Connection @relation(fields: [connectionId], references: [id], onDelete: Cascade)

  @@unique([teamId, connectionId])
  @@map("team_connections")
}
```

---

## Migration Strategy

### Phase 1: Setup Infrastructure (Week 1)

**Day 1-2: Monorepo Setup**
```bash
# Initialize pnpm workspace
pnpm init
pnpm add -Dw turbo typescript @types/node

# Create packages/types
cd packages/types
pnpm init
pnpm add -D typescript

# Create apps/backend
cd apps/backend
pnpm create nest-app .
pnpm add @prisma/client
pnpm add -D prisma
```

**Day 3-4: Database Setup**
```bash
# Initialize Prisma
npx prisma init

# Create schema (copy from above)
# Generate Prisma client
npx prisma generate

# Create migration from existing database
npx prisma db pull
npx prisma migrate dev --name init
```

**Day 5: BullMQ Setup**
```bash
pnpm add @nestjs/bull bull
pnpm add -D @types/bull

# Set up queue module
# Configure Redis connection
```

### Phase 2: Core API Migration (Week 2)

**Day 1-2: REST Endpoints**
- `/api/changes` - List events with filters
- `/api/connections` - CRUD for connections
- `/api/connectors/metadata` - Auto-discovery
- `/api/teams` - Team management

**Day 3-4: Connector Plugin System**
- Auto-discovery mechanism
- Base connector interface
- Metadata loading
- Dynamic imports

**Day 5: Testing**
- Integration tests
- API contract tests
- Connector loading tests

### Phase 3: Migrate Connectors (Week 3)

**Day 1: PainChain Connector** (simplest)
- Rewrite in TypeScript
- Test thoroughly
- Compare with Python version

**Day 2-3: GitHub Connector**
- Port all event types
- Test API calls
- Verify event storage

**Day 4: GitLab Connector**
- Similar structure to GitHub
- Test pipelines and MRs

**Day 5: Kubernetes Connector**
- Most complex (watch API)
- May need @kubernetes/client-node

### Phase 4: Frontend Updates (Week 4)

**Day 1-2: TypeScript Conversion**
```bash
cd apps/frontend
pnpm add -D typescript @types/react @types/react-dom

# Rename .jsx → .tsx
# Add tsconfig.json
# Fix type errors
```

**Day 3-4: Shared Types Integration**
```typescript
// Instead of:
const changes: any[] = await fetchChanges()

// Now:
import { ChangeEvent } from '@painchain/types'
const changes: ChangeEvent[] = await fetchChanges()
```

**Day 5: Testing & Polish**
- E2E testing
- Fix type errors
- Update documentation

### Phase 5: Deployment (Week 5)

**Day 1-2: Docker Updates**
- Update docker-compose.yml
- Build TypeScript backend image
- Configure environment variables

**Day 3: Data Migration**
- Export from Python backend
- Import to TypeScript backend
- Verify data integrity

**Day 4: Parallel Run**
- Run both backends
- Compare outputs
- Monitor for issues

**Day 5: Cutover**
- Switch frontend to TS backend
- Deprecate Python backend
- Update documentation

---

## Docker Setup

```yaml
# docker-compose.yml

version: '3.8'

services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: painchain
      POSTGRES_USER: painchain
      POSTGRES_PASSWORD: ${DB_PASSWORD:-changeme}
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

  backend:
    build:
      context: .
      dockerfile: apps/backend/Dockerfile
    environment:
      DATABASE_URL: postgresql://painchain:${DB_PASSWORD:-changeme}@db:5432/painchain
      REDIS_HOST: redis
      REDIS_PORT: 6379
      NODE_ENV: production
    ports:
      - "8001:8000"
    depends_on:
      - db
      - redis
    volumes:
      - ./apps/backend/src/connectors:/app/dist/connectors

  worker:
    build:
      context: .
      dockerfile: apps/backend/Dockerfile
    command: npm run worker
    environment:
      DATABASE_URL: postgresql://painchain:${DB_PASSWORD:-changeme}@db:5432/painchain
      REDIS_HOST: redis
      REDIS_PORT: 6379
      NODE_ENV: production
    depends_on:
      - db
      - redis
      - backend
    volumes:
      - ./apps/backend/src/connectors:/app/dist/connectors

  frontend:
    build:
      context: .
      dockerfile: apps/frontend/Dockerfile
    environment:
      VITE_API_URL: http://localhost:8001
    ports:
      - "5174:5174"
    depends_on:
      - backend

volumes:
  postgres_data:
```

---

## Next Steps

**I propose we start with Phase 1 immediately:**

1. **Create monorepo structure** with packages/types
2. **Set up NestJS backend** with Prisma
3. **Implement connector auto-discovery**
4. **Migrate PainChain connector** as proof-of-concept
5. **Test end-to-end**

**This gets us:**
- ✅ TypeScript backend foundation
- ✅ Shared types between FE/BE
- ✅ Plugin architecture preserved
- ✅ One working connector to validate approach

**Want me to start building this out?** I can:
1. Create the monorepo structure
2. Set up NestJS + Prisma
3. Implement the connector auto-discovery
4. Migrate one connector as example
5. Update docker-compose.yml

This will give you a working foundation to build on, and you can learn TypeScript as we go!
