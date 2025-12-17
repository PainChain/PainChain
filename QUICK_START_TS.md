# TypeScript Backend - Quick Start Guide

## What We Built

We've created the **foundation** for the TypeScript migration:

1. **Monorepo** with shared types between frontend/backend
2. **NestJS backend** with dependency injection
3. **Prisma ORM** for type-safe database access
4. **Shared types package** that both apps can use

## Project Structure

```
PainChain/
├── packages/
│   └── types/              # Shared TypeScript interfaces
│       ├── src/
│       │   ├── events.ts        # ChangeEvent, EventType
│       │   ├── connectors.ts    # IConnector, Connection
│       │   └── teams.ts         # Team types
│       └── package.json
│
└── apps/
    └── backend/            # NestJS API
        ├── prisma/
        │   └── schema.prisma    # Database schema
        ├── src/
        │   ├── main.ts          # Entry point
        │   ├── app.module.ts    # Root module
        │   └── database/
        └── package.json
```

## Testing the Foundation

### 1. Install Dependencies

```bash
# From project root
pnpm install
```

This installs all dependencies for all workspaces.

### 2. Build Shared Types

```bash
cd packages/types
pnpm build
```

This compiles the TypeScript types that will be shared across apps.

### 3. Set Up Database Connection

Create `.env` in `apps/backend/`:

```bash
cd apps/backend
cat > .env << 'EOF'
DATABASE_URL="postgresql://painchain:changeme@localhost:5432/painchain"
REDIS_HOST="localhost"
REDIS_PORT=6379
PORT=8000
EOF
```

### 4. Generate Prisma Client

```bash
# Still in apps/backend
pnpm prisma generate
```

This creates the type-safe database client from your schema.

### 5. View Database Schema

```bash
# Optional: Open Prisma Studio to see the schema visually
pnpm prisma studio
```

Opens at http://localhost:5555

## What Works Right Now

✅ **Type definitions** - All interfaces compiled
✅ **Prisma schema** - Matches existing database
✅ **NestJS structure** - Modules and dependency injection ready

## What's Not Implemented Yet

❌ **API Controllers** - No REST endpoints yet
❌ **Connectors** - No auto-discovery system yet
❌ **BullMQ** - No task queue yet
❌ **Migrations** - Need to create initial migration

These are the next steps we'll build together!

## Try Out the Types

Create a test file to see types in action:

```bash
cd packages/types
cat > test-types.ts << 'EOF'
import { ChangeEvent, EventType, IConnector, SyncResult } from './src'

// This is fully typed!
const event: ChangeEvent = {
  id: 1,
  connectionId: 1,
  externalId: 'pr-123',
  source: 'github',
  eventType: 'PR',  // Must be a valid EventType - try 'InvalidType' and see error!
  title: '[PR] Add TypeScript support',
  description: 'Migrating to TypeScript',
  timestamp: new Date(),
  url: 'https://github.com/user/repo/pull/123',
  status: 'open',
  metadata: { number: 123 },
  eventMetadata: { branches: 'main <- feature' },
  createdAt: new Date(),
  updatedAt: new Date(),
}

// Connector interface
class MyConnector implements IConnector {
  async testConnection(): Promise<boolean> {
    return true
  }

  async sync(connectionId: number): Promise<SyncResult> {
    return {
      success: true,
      eventsStored: 10,
    }
  }
}

console.log('Types work!', event.eventType)
EOF

# Compile and run
npx ts-node test-types.ts
```

## Understanding the Architecture

### Shared Types (@painchain/types)

```typescript
// Any app can import these
import { ChangeEvent } from '@painchain/types'

// Frontend knows the exact shape
const events: ChangeEvent[] = await fetch('/api/changes')

// Backend uses same types
async createEvent(dto: CreateChangeEventDto): Promise<ChangeEvent>
```

### NestJS Modules

```typescript
// app.module.ts connects everything
@Module({
  imports: [
    DatabaseModule,      // Provides PrismaService
    ConnectorsModule,    // TODO: Auto-discovery
    QueueModule,         // TODO: BullMQ
    ApiModule,           // TODO: REST endpoints
  ]
})
export class AppModule {}
```

### Prisma Client

```typescript
// Fully type-safe database queries
const events = await prisma.changeEvent.findMany({
  where: {
    source: 'github',  // Autocomplete works!
    eventType: 'PR'    // Type-checked!
  },
  include: { connection: true }
})
// events is typed as ChangeEvent[]
```

## Next Session Plan

When we continue, we'll build:

1. **Connector auto-discovery** - Scan `src/connectors/` directory
2. **Base connector class** - Implement `IConnector` interface
3. **PainChain connector** - Migrate first connector as proof-of-concept
4. **API controller** - `/api/changes` endpoint
5. **BullMQ integration** - Background job processing

## Questions?

- **pnpm commands**: `pnpm` works like `npm` but faster
- **Workspace**: `workspace:*` means "use local package"
- **Turborepo**: Caches builds for speed
- **Prisma**: Generates types from schema automatically

Ready to continue? Let's build the connector system! 🚀
