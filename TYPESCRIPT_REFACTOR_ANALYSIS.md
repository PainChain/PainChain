# TypeScript Connector Refactor Analysis

## Executive Summary

Moving PainChain connectors from Python to TypeScript would enable:
- **Shared types** between frontend and backend
- **Unified codebase** (single language)
- **Better developer experience** with end-to-end type safety
- **Potential performance gains** with async/await patterns

However, it requires:
- Replacing Celery (Python-only) with a Node.js task queue
- Rewriting all connector logic (~5000+ lines)
- Maintaining two runtimes during migration
- Potential performance trade-offs

**Recommendation:** Incremental migration with hybrid architecture

---

## Current Architecture

### Tech Stack
```
Backend:
- FastAPI (Python) - API server
- Celery (Python) - Task queue
- PostgreSQL - Database
- Redis - Message broker + cache

Connectors:
- Python classes with sync_{name}() functions
- PyGithub, requests libraries
- SQLAlchemy ORM for database

Frontend:
- React + Vite
- JavaScript/JSX
```

### Connector Flow
```
1. Celery Beat schedules poll_connection(connection_id) tasks
2. Celery Worker picks up task
3. Worker dynamically imports connectors.{type}.connector
4. Calls sync_{type}(db, config, connection_id)
5. Connector polls external API
6. Creates ChangeEvent objects
7. Commits to PostgreSQL via SQLAlchemy
```

---

## TypeScript Architecture Options

### Option 1: Node.js Microservice (Side-by-Side)

**Architecture:**
```
┌─────────────┐
│  Frontend   │ (React + TS)
└──────┬──────┘
       │
       ▼
┌─────────────┐     ┌──────────────┐
│  FastAPI    │────▶│  PostgreSQL  │
│  (Python)   │◀────│              │
└─────────────┘  │  └──────────────┘
       ▲         │
       │         ▼
       │  ┌──────────────┐
       └──│  Node.js     │
          │  Connectors  │
          │  (TypeScript)│
          └──────┬───────┘
                 │
          ┌──────▼───────┐
          │   BullMQ     │
          │   (Redis)    │
          └──────────────┘
```

**What it looks like:**
```typescript
// backend-ts/src/connectors/github/connector.ts
import { Octokit } from '@octokit/rest'
import { ChangeEvent } from '../../shared/models'
import { db } from '../../shared/database'

export class GitHubConnector {
  private client: Octokit

  constructor(private config: GitHubConfig) {
    this.client = new Octokit({ auth: config.token })
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
    const repos = await this.getRepos()

    for (const repo of repos) {
      // Fetch PRs
      const prs = await this.client.pulls.list({
        owner: repo.owner,
        repo: repo.name,
        state: 'all'
      })

      for (const pr of prs.data) {
        await ChangeEvent.upsert({
          connectionId,
          source: 'github',
          eventType: 'PR',
          title: `[PR] ${pr.title}`,
          description: pr.body,
          timestamp: new Date(pr.created_at),
          url: pr.html_url,
          metadata: {
            number: pr.number,
            state: pr.state,
            merged: pr.merged_at !== null
          }
        })
      }
    }

    return { prsStored: prs.data.length }
  }
}

// Task queue integration
import { Queue, Worker } from 'bullmq'

const connectorQueue = new Queue('connectors', {
  connection: { host: 'redis', port: 6379 }
})

const worker = new Worker('connectors', async (job) => {
  const { connectionId, type } = job.data
  const connector = await loadConnector(type, job.data.config)
  return await connector.sync(connectionId)
})
```

**Pros:**
- ✅ Keep existing FastAPI (minimal disruption)
- ✅ TypeScript connectors run independently
- ✅ Can migrate connectors one at a time
- ✅ BullMQ provides great observability (UI dashboard)
- ✅ Shared types via monorepo

**Cons:**
- ❌ Two runtimes to maintain (Python + Node)
- ❌ Two task queues (Celery + BullMQ)
- ❌ More complex deployment
- ❌ Need to sync database models between Python/TS

---

### Option 2: Full Node.js Backend (Big Bang)

**Architecture:**
```
┌─────────────┐
│  Frontend   │ (React + TS)
└──────┬──────┘
       │
       ▼
┌─────────────┐     ┌──────────────┐
│  NestJS/    │────▶│  PostgreSQL  │
│  Express    │     │              │
│  (TypeScript│     │              │
└──────┬──────┘     └──────────────┘
       │
       ▼
┌─────────────┐
│   BullMQ    │
│  Connectors │
└─────────────┘
```

**What it looks like:**
```typescript
// backend/src/api/routes/changes.ts
import { Router } from 'express'
import { ChangeEvent } from '../models'

const router = Router()

router.get('/api/changes', async (req, res) => {
  const { start_date, end_date, source, tags } = req.query

  const changes = await ChangeEvent.findAll({
    where: {
      timestamp: {
        $gte: start_date,
        $lte: end_date
      },
      ...(source && { source }),
      ...(tags && { tags: { $contains: tags } })
    },
    order: [['timestamp', 'DESC']]
  })

  res.json(changes)
})

// Shared types across frontend and backend!
// shared/types/events.ts
export interface ChangeEvent {
  id: number
  connectionId: number
  source: string
  eventType: EventType
  title: string
  description: string | null
  timestamp: Date
  url: string | null
  metadata: Record<string, any>
}

export type EventType =
  | 'PR'
  | 'Workflow'
  | 'Commit'
  | 'K8sDeployment'
  // ... auto-imported from metadata.json!
```

**Pros:**
- ✅ Single language across stack
- ✅ End-to-end type safety
- ✅ Shared code/types between frontend/backend
- ✅ Simpler deployment (one runtime)
- ✅ Better async handling than Python
- ✅ Huge ecosystem (npm)

**Cons:**
- ❌ Rewrite entire API (~2000+ lines)
- ❌ Rewrite all connectors (~5000+ lines)
- ❌ Need new ORM (Prisma/TypeORM)
- ❌ Risk of bugs during migration
- ❌ Downtime during cutover

---

### Option 3: Hybrid (Keep Python API + TS Connectors)

**Architecture:**
```
┌─────────────┐
│  Frontend   │ (React + TS)
└──────┬──────┘
       │
       ▼
┌─────────────┐     ┌──────────────┐
│  FastAPI    │────▶│  PostgreSQL  │
│  (Python)   │◀────│              │
│  - REST API │  │  └──────────────┘
│  - Connector│  │
│    registry │  │
└─────────────┘  │
                 │
          ┌──────▼───────┐
          │  TypeScript  │
          │  Connectors  │
          │  + BullMQ    │
          └──────────────┘
```

**How it works:**
1. FastAPI serves metadata and events (unchanged)
2. FastAPI triggers BullMQ jobs instead of Celery tasks
3. Node.js workers run TypeScript connectors
4. Connectors write directly to PostgreSQL
5. Frontend unchanged (still uses FastAPI endpoints)

**Implementation:**
```python
# backend/api/main.py (FastAPI stays in Python)
from arq import create_pool  # Or use Redis directly
import redis

redis_client = redis.Redis.from_url(REDIS_URL)

@app.post("/api/connections/{connection_id}/sync")
async def trigger_sync(connection_id: int):
    # Instead of celery.send_task(), use BullMQ compatible Redis command
    await redis_client.lpush(
        'bullmq:connectors:wait',
        json.dumps({
            'name': 'poll_connection',
            'data': {'connectionId': connection_id},
            'opts': {}
        })
    )
    return {"status": "queued"}
```

```typescript
// backend-ts/src/worker.ts
import { Worker } from 'bullmq'
import { Pool } from 'pg'

const db = new Pool({ connectionString: process.env.DATABASE_URL })

const worker = new Worker('connectors', async (job) => {
  const { connectionId } = job.data

  // Load connector
  const connection = await db.query(
    'SELECT type, config FROM connections WHERE id = $1',
    [connectionId]
  )

  const ConnectorClass = await import(`./connectors/${connection.type}`)
  const connector = new ConnectorClass(connection.config)

  return await connector.sync(connectionId)
}, {
  connection: { host: 'redis', port: 6379 }
})
```

**Pros:**
- ✅ Keep proven FastAPI code
- ✅ Migrate connectors incrementally
- ✅ TypeScript where it matters most (connectors)
- ✅ Less risky than full rewrite
- ✅ Can share types via code generation

**Cons:**
- ❌ Still two runtimes
- ❌ Types not truly shared (need codegen)
- ❌ Python API can't use TS types directly

---

## Migration Path Recommendation

### Phase 1: Hybrid Setup (2-3 weeks)
1. Add Node.js service to docker-compose
2. Install BullMQ + TypeScript setup
3. Create shared database models (Prisma or TypeORM)
4. Set up type generation from metadata.json
5. Keep Celery running in parallel

### Phase 2: Migrate One Connector (1 week)
1. Choose simplest connector (PainChain?)
2. Rewrite in TypeScript
3. Test in isolation
4. Run both Python and TS versions in parallel
5. Compare outputs for consistency
6. Switch traffic to TS version

### Phase 3: Migrate Remaining Connectors (3-4 weeks)
1. GitHub connector
2. GitLab connector
3. Kubernetes connector
4. Verify all event types match

### Phase 4: Remove Celery (1 week)
1. Remove Python connector code
2. Remove Celery worker/beat containers
3. Update docs
4. Clean up dependencies

### Phase 5 (Optional): Migrate API (4-6 weeks)
1. Build NestJS/Express API matching FastAPI routes
2. Run in parallel
3. Switch traffic gradually (feature flags)
4. Remove FastAPI when confident

**Total Time: 8-12 weeks (or 3-4 weeks without API migration)**

---

## Database Considerations

### Current (SQLAlchemy)
```python
class ChangeEvent(Base):
    __tablename__ = "change_events"

    id = Column(Integer, primary_key=True)
    connection_id = Column(Integer, ForeignKey("connections.id"))
    source = Column(String, nullable=False)
    event_type = Column(String, nullable=False)
    title = Column(String, nullable=False)
    metadata = Column(JSONB)
```

### TypeScript Option A: Prisma
```prisma
model ChangeEvent {
  id           Int      @id @default(autoincrement())
  connectionId Int      @map("connection_id")
  source       String
  eventType    String   @map("event_type")
  title        String
  metadata     Json?

  connection   Connection @relation(fields: [connectionId], references: [id])

  @@map("change_events")
}
```

```typescript
// Auto-generated types!
const events = await prisma.changeEvent.findMany({
  where: { source: 'github' },
  include: { connection: true }
})
```

**Pros:**
- ✅ Best TypeScript integration
- ✅ Auto-generates types
- ✅ Great migrations tool
- ✅ Excellent performance

**Cons:**
- ❌ Another schema to maintain
- ❌ Migration from SQLAlchemy schema

### TypeScript Option B: TypeORM
```typescript
@Entity('change_events')
export class ChangeEvent {
  @PrimaryGeneratedColumn()
  id: number

  @Column({ name: 'connection_id' })
  connectionId: number

  @Column()
  source: string

  @Column({ name: 'event_type' })
  eventType: string

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any>

  @ManyToOne(() => Connection)
  @JoinColumn({ name: 'connection_id' })
  connection: Connection
}
```

**Pros:**
- ✅ Similar to SQLAlchemy (familiar)
- ✅ Works with existing schema
- ✅ Good TypeScript support

**Cons:**
- ❌ More verbose than Prisma
- ❌ Slower than Prisma
- ❌ Less magic, more boilerplate

### TypeScript Option C: pg + Kysely (SQL builder)
```typescript
import { Kysely, PostgresDialect } from 'kysely'

interface Database {
  change_events: ChangeEventTable
  connections: ConnectionTable
}

const db = new Kysely<Database>({
  dialect: new PostgresDialect({ pool })
})

// Type-safe queries
const events = await db
  .selectFrom('change_events')
  .where('source', '=', 'github')
  .selectAll()
  .execute()
```

**Pros:**
- ✅ Lightweight
- ✅ Full control over queries
- ✅ Works with existing schema
- ✅ Type-safe without codegen

**Cons:**
- ❌ Manual type definitions
- ❌ No relation management
- ❌ More boilerplate for complex queries

**Recommendation: Prisma** for best TypeScript experience

---

## Task Queue Comparison

| Feature | Celery (Python) | BullMQ (Node.js) |
|---------|----------------|------------------|
| Language | Python | TypeScript/JS |
| Transport | Redis, RabbitMQ | Redis only |
| Scheduling | Celery Beat | Bull Board |
| UI Dashboard | Flower | Bull Board (built-in) |
| Retries | ✅ | ✅ |
| Priorities | ✅ | ✅ |
| Rate limiting | ✅ | ✅ |
| Job chaining | ✅ | ✅ |
| Observability | Good | Excellent |
| Performance | Good | Excellent |
| Memory usage | Higher | Lower |

**Winner: BullMQ** - Better observability, native TypeScript, more performant

---

## Type Sharing Strategies

### Strategy 1: Monorepo with Shared Package
```
PainChain/
├── packages/
│   └── types/
│       ├── events.ts
│       ├── connectors.ts
│       └── metadata.ts
├── frontend/
│   └── package.json → depends on @painchain/types
└── backend-ts/
    └── package.json → depends on @painchain/types
```

```typescript
// packages/types/events.ts
export interface ChangeEvent {
  id: number
  source: 'github' | 'gitlab' | 'kubernetes' | 'painchain'
  eventType: string
  // ... shared across frontend + backend!
}
```

### Strategy 2: Code Generation from metadata.json
```typescript
// scripts/generate-types.ts
import * as fs from 'fs'
import * as path from 'path'

const connectors = ['github', 'gitlab', 'kubernetes', 'painchain']

let output = 'export type EventType = \n'

for (const connector of connectors) {
  const metadata = JSON.parse(
    fs.readFileSync(`../backend/connectors/${connector}/metadata.json`, 'utf-8')
  )

  for (const eventType of Object.keys(metadata.eventTypes)) {
    output += `  | '${eventType}'\n`
  }
}

fs.writeFileSync('src/types/generated.ts', output)
```

**Recommendation: Monorepo** - Most maintainable

---

## Performance Considerations

### Python (Current)
- PyGithub is synchronous (blocks on API calls)
- SQLAlchemy ORM adds overhead
- Celery worker startup is slow (~2-3 seconds)
- Memory: ~150MB per worker

### TypeScript (Proposed)
- Octokit is async/await (non-blocking)
- Can batch database operations easily
- Fast startup (~200ms)
- Memory: ~80MB per worker
- Can use worker threads for parallelism

**Expected improvement: 30-40% faster polling**

---

## Risks & Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| Bugs in rewritten code | High | Parallel run with comparison |
| Missing Python libraries | Medium | Evaluate TS alternatives first |
| Team TypeScript experience | Medium | Training + pair programming |
| Database connection pooling | Low | Use Prisma connection pool |
| Breaking API contracts | High | Keep FastAPI during migration |
| Loss of Celery features | Medium | BullMQ has feature parity |

---

## Decision Matrix

| Criteria | Python (Current) | Option 1 (Microservice) | Option 2 (Full TS) | Option 3 (Hybrid) |
|----------|-----------------|------------------------|-------------------|-------------------|
| Type Safety | ❌ Low | ✅ High | ✅✅ Excellent | ✅ High |
| Code Sharing | ❌ None | ⚠️ Some | ✅ Extensive | ⚠️ Some |
| Migration Risk | N/A | ⚠️ Medium | ❌ High | ✅ Low |
| Deployment Complexity | ✅ Low | ❌ High | ✅ Low | ⚠️ Medium |
| Developer Experience | ⚠️ Good | ✅ Excellent | ✅ Excellent | ✅ Excellent |
| Performance | ⚠️ Good | ✅ Better | ✅ Better | ✅ Better |
| Maintenance Burden | ⚠️ Medium | ❌ High | ✅ Low | ⚠️ Medium |
| Time to Complete | N/A | 3-4 weeks | 8-12 weeks | 3-4 weeks |

---

## Recommendation

**Go with Option 3: Hybrid Architecture**

**Why:**
1. ✅ Lowest risk (incremental migration)
2. ✅ Keep proven FastAPI (stable, documented)
3. ✅ Get TypeScript benefits where they matter (connectors)
4. ✅ Can complete in 3-4 weeks
5. ✅ Option to migrate API later if desired

**Next Steps:**
1. Set up Node.js service in docker-compose
2. Install BullMQ + Prisma
3. Create TypeScript project structure
4. Migrate PainChain connector (simplest)
5. Test thoroughly
6. Migrate remaining connectors one by one
7. Remove Celery when all migrated

**Don't do this yet if:**
- ❌ Team doesn't know TypeScript well
- ❌ Python connectors are working perfectly
- ❌ You need to ship new features urgently
- ❌ No bandwidth for 3-4 week project

**Do this if:**
- ✅ Want better type safety
- ✅ Planning to add many more connectors
- ✅ Team excited about TypeScript
- ✅ Want improved developer experience
- ✅ Need better performance

---

## Cost-Benefit Analysis

### Costs
- **Time:** 3-4 weeks engineering time
- **Risk:** Potential bugs during migration
- **Complexity:** Two runtimes initially
- **Learning:** Team needs TS/Node experience

### Benefits
- **Type Safety:** Catch errors at compile time
- **Developer Experience:** Better autocomplete, refactoring
- **Performance:** 30-40% faster polling
- **Maintainability:** Easier to add new connectors
- **Unified Codebase:** Shared types between FE/BE
- **Modern Stack:** Easier hiring (TS is popular)

**ROI:** Benefits outweigh costs if adding 3+ more connectors

---

## Questions to Answer Before Proceeding

1. **Team Skills:** Does team have TypeScript experience?
2. **Timeline:** Can we dedicate 3-4 weeks to this?
3. **Priority:** Is this more important than new features?
4. **Resources:** Can we run two runtimes (Python + Node)?
5. **Future:** Planning to add many more connectors?
6. **Pain Points:** Are current Python connectors causing problems?

If you answered "yes" to most of these, proceed with hybrid migration.
