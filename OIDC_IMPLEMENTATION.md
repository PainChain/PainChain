# PainChain OIDC + Basic Auth Implementation Plan

> **Status:** Planning Complete ✅ | Implementation: Not Started
>
> **Last Updated:** 2026-01-06

---

## 📋 Overview

This document outlines the complete implementation plan for adding authentication to PainChain, supporting:

- ✅ **Multiple OIDC providers** (Google, Okta, Azure, etc.) - configured via environment variables
- ✅ **Basic auth** (username/password with bcrypt hashing)
- ✅ **Multi-tenant isolation** (extract tenant ID from OIDC claims, enforce in guards)
- ✅ **Login UI** with cards for each auth method

## 🎯 Requirements Summary

| Feature | Implementation |
|---------|----------------|
| **OIDC Connectors** | Multiple providers in .env, user chooses at login |
| **Basic Auth** | Full username/password system with bcrypt |
| **Multi-tenancy** | Extract tenant from OIDC claims, validate in guards |
| **Login Flow** | Card-based UI showing all available auth methods |
| **Session Management** | JWT + database-backed sessions for revocation |
| **Security** | Rate limiting, tenant isolation, session tracking |

---

## 🗂️ Table of Contents

1. [Phase 1: Database Schema](#phase-1-database-schema)
2. [Phase 2: NestJS Auth Module](#phase-2-nestjs-auth-module)
3. [Phase 3: Environment Configuration](#phase-3-environment-configuration)
4. [Phase 4: Core Implementation](#phase-4-core-implementation)
5. [Phase 5: API Endpoints](#phase-5-api-endpoints)
6. [Phase 6: Global Guards](#phase-6-global-guards)
7. [Phase 7: Migration Strategy](#phase-7-migration-strategy)
8. [Phase 8: Security Hardening](#phase-8-security-hardening)
9. [Implementation Order](#implementation-order)
10. [OIDC Flow Diagram](#oidc-flow-diagram)
11. [Notes & Troubleshooting](#notes--troubleshooting)

---

## Phase 1: Database Schema

### 📄 Add Authentication Models to Prisma

**File:** `painchain/backend/prisma/schema.prisma`

Add these models to support authentication:

```prisma
// ============================================
// AUTHENTICATION & USER MANAGEMENT
// ============================================

// User accounts (supports both basic auth and OIDC)
model User {
  id            String   @id @default(cuid())
  email         String   @unique
  emailVerified Boolean  @default(false)
  passwordHash  String?  // bcrypt hash (null for OIDC-only users)

  // Profile information
  firstName     String?
  lastName      String?
  displayName   String?
  avatarUrl     String?

  // Account metadata
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  lastLoginAt   DateTime?
  isActive      Boolean  @default(true)

  // Multi-tenancy: Users belong to ONE tenant
  tenantId      String
  tenant        Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  // RBAC (role-based access control)
  role          String   @default("member") // "owner", "admin", "member", "viewer"

  // Relations
  sessions      Session[]
  oidcAccounts  OIDCAccount[]

  @@index([tenantId])
  @@index([email])
  @@index([tenantId, email])
  @@map("users")
}

// OIDC accounts linked to users
model OIDCAccount {
  id             String   @id @default(cuid())
  userId         String
  user           User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  providerId     String   // Links to OIDCProvider.id (e.g., "google", "okta-prod")
  providerUserId String   // User's ID in provider system (sub claim)
  claims         Json     // Full OIDC claims from userinfo endpoint

  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  lastUsedAt     DateTime @default(now())

  @@unique([providerId, providerUserId])
  @@index([userId])
  @@index([providerId])
  @@map("oidc_accounts")
}

// OIDC provider configuration (synced from env vars on startup)
model OIDCProvider {
  id               String   @id // e.g., "google", "okta-prod", "azure"
  name             String   // "Google Workspace"
  iconUrl          String?  // URL to provider icon

  // OIDC configuration
  issuer           String
  clientId         String
  clientSecret     String
  authorizationUrl String
  tokenUrl         String
  userinfoUrl      String
  scopes           String[] @default(["openid", "email", "profile"])

  // Tenant claim mapping
  tenantClaimPath  String @default("tenant_id") // JSON path to extract tenant from claims

  // Provider metadata
  isEnabled        Boolean  @default(true)
  displayOrder     Int      @default(0) // For UI ordering
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  @@index([isEnabled])
  @@map("oidc_providers")
}

// Session management (JWT + database-backed for revocation)
model Session {
  id             String   @id @default(cuid())
  userId         String
  user           User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  token          String   @unique // JWT token ID (jti claim) for revocation
  expiresAt      DateTime

  // Security metadata
  ipAddress      String?
  userAgent      String?

  // Session lifecycle
  createdAt      DateTime @default(now())
  lastActivityAt DateTime @default(now())
  revokedAt      DateTime?

  @@index([userId])
  @@index([token])
  @@index([expiresAt])
  @@map("sessions")
}
```

### 🔄 Update Existing Tenant Model

Add this relation to the existing `Tenant` model:

```prisma
model Tenant {
  // ... existing fields (id, slug, name, createdAt, integrations, events, projects, teams) ...

  users User[]  // NEW: Users belonging to this tenant
}
```

### 🚀 Run Migration

```bash
cd painchain/backend
npx prisma migrate dev --name add_authentication
```

---

## Phase 2: NestJS Auth Module

### 📁 Directory Structure

Create the following structure under `painchain/backend/src/auth/`:

```
auth/
├── auth.module.ts                    # Main auth module with imports
├── auth.controller.ts                # Login, logout, callback endpoints
├── auth.service.ts                   # Core auth business logic
│
├── guards/
│   ├── jwt-auth.guard.ts            # JWT authentication guard
│   ├── tenant.guard.ts              # Tenant validation guard (validates x-tenant-id)
│   └── roles.guard.ts               # Role-based authorization guard
│
├── strategies/
│   ├── jwt.strategy.ts              # Passport JWT strategy
│   ├── local.strategy.ts            # Passport Local strategy (basic auth)
│   └── oidc.strategy.ts             # Custom OIDC strategy (multi-provider)
│
├── decorators/
│   ├── current-user.decorator.ts    # @CurrentUser() parameter decorator
│   ├── public.decorator.ts          # @Public() route decorator
│   └── roles.decorator.ts           # @Roles('admin') decorator
│
├── services/
│   ├── password.service.ts          # Password hashing/validation (bcrypt)
│   ├── jwt.service.ts               # JWT generation/validation
│   ├── session.service.ts           # Session management
│   └── oidc-config.service.ts       # OIDC provider configuration loader
│
├── dto/
│   ├── login.dto.ts                 # Login request DTO
│   ├── register.dto.ts              # User registration DTO
│   └── auth-response.dto.ts         # Auth response DTO
│
└── interfaces/
    ├── jwt-payload.interface.ts     # JWT payload structure
    └── auth-user.interface.ts       # Authenticated user structure
```

---

## Phase 3: Environment Configuration

### 📝 Update `.env` File

**File:** `painchain/backend/.env`

Add these configuration variables:

```bash
# ============================================
# JWT CONFIGURATION
# ============================================
JWT_SECRET="your-super-secret-jwt-key-change-in-production"
JWT_EXPIRES_IN="7d"

# ============================================
# APPLICATION URLs
# ============================================
APP_URL="http://localhost:8000"
FRONTEND_URL="http://localhost:8000"

# ============================================
# BASIC AUTH CONFIGURATION
# ============================================
BASIC_AUTH_ENABLED=true
ALLOW_REGISTRATION=true
MIN_PASSWORD_LENGTH=12

# ============================================
# OIDC PROVIDERS (JSON Array)
# ============================================
OIDC_PROVIDERS='[
  {
    "id": "google",
    "name": "Google Workspace",
    "iconUrl": "https://cdn.example.com/google.png",
    "issuer": "https://accounts.google.com",
    "clientId": "your-client-id.apps.googleusercontent.com",
    "clientSecret": "your-client-secret",
    "authorizationUrl": "https://accounts.google.com/o/oauth2/v2/auth",
    "tokenUrl": "https://oauth2.googleapis.com/token",
    "userinfoUrl": "https://openidconnect.googleapis.com/v1/userinfo",
    "scopes": ["openid", "email", "profile"],
    "tenantClaimPath": "hd",
    "displayOrder": 1
  },
  {
    "id": "okta",
    "name": "Okta",
    "iconUrl": "https://cdn.example.com/okta.png",
    "issuer": "https://your-domain.okta.com",
    "clientId": "your-okta-client-id",
    "clientSecret": "your-okta-client-secret",
    "authorizationUrl": "https://your-domain.okta.com/oauth2/v1/authorize",
    "tokenUrl": "https://your-domain.okta.com/oauth2/v1/token",
    "userinfoUrl": "https://your-domain.okta.com/oauth2/v1/userinfo",
    "scopes": ["openid", "email", "profile"],
    "tenantClaimPath": "tenant_id",
    "displayOrder": 2
  },
  {
    "id": "azure",
    "name": "Azure AD",
    "iconUrl": "https://cdn.example.com/azure.png",
    "issuer": "https://login.microsoftonline.com/{tenant-id}/v2.0",
    "clientId": "your-azure-client-id",
    "clientSecret": "your-azure-client-secret",
    "authorizationUrl": "https://login.microsoftonline.com/{tenant-id}/oauth2/v2.0/authorize",
    "tokenUrl": "https://login.microsoftonline.com/{tenant-id}/oauth2/v2.0/token",
    "userinfoUrl": "https://graph.microsoft.com/oidc/userinfo",
    "scopes": ["openid", "email", "profile"],
    "tenantClaimPath": "tid",
    "displayOrder": 3
  }
]'
```

### 🔐 Generate Secure JWT Secret

```bash
openssl rand -base64 32
```

Use the output as your `JWT_SECRET` value.

---

## Phase 4: Core Implementation

### 🔑 Key Services Overview

#### 1. Password Service
**File:** `auth/services/password.service.ts`

```typescript
import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

@Injectable()
export class PasswordService {
  private readonly SALT_ROUNDS = 12;

  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, this.SALT_ROUNDS);
  }

  async verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }
}
```

**Responsibilities:**
- Hash passwords using bcrypt (12 rounds)
- Verify passwords against stored hashes
- Secure password storage

---

#### 2. JWT Service
**File:** `auth/services/jwt.service.ts`

**Responsibilities:**
- Generate JWT tokens with claims: `{ sub, email, tenantId, role, jti }`
- Verify and decode JWT tokens
- 7-day expiration (configurable)
- Include session ID (jti) for revocation

**JWT Payload Structure:**
```typescript
{
  sub: userId,         // User ID
  email: user.email,   // User email
  tenantId: user.tenantId,
  role: user.role,
  jti: sessionId,      // Session ID for revocation
  iat: timestamp,      // Issued at
  exp: timestamp,      // Expires at
  iss: 'painchain',    // Issuer
  aud: 'painchain-api' // Audience
}
```

---

#### 3. Session Service
**File:** `auth/services/session.service.ts`

**Responsibilities:**
- Create sessions (store JWT jti for revocation)
- Validate sessions (check not revoked, not expired)
- Revoke sessions (individual or all user sessions)
- Track IP address and user agent for security
- Update last activity timestamp

**Key Methods:**
```typescript
async createSession(userId, tokenId, expiresAt, metadata): Promise<Session>
async isSessionValid(tokenId): Promise<boolean>
async revokeSession(tokenId): Promise<void>
async revokeAllUserSessions(userId): Promise<void>
```

---

#### 4. OIDC Config Service
**File:** `auth/services/oidc-config.service.ts`

**Responsibilities:**
- Parse `OIDC_PROVIDERS` JSON from environment variables on startup
- Sync providers to database (upsert on module init)
- Return list of enabled providers for login page
- Provide provider details for OIDC flow

**Provider Configuration Format:**
```typescript
interface OIDCProviderConfig {
  id: string;                  // "google", "okta-prod"
  name: string;                // "Google Workspace"
  iconUrl?: string;
  issuer: string;
  clientId: string;
  clientSecret: string;
  authorizationUrl: string;
  tokenUrl: string;
  userinfoUrl: string;
  scopes: string[];
  tenantClaimPath: string;     // JSON path to extract tenant
  displayOrder: number;
}
```

---

### 🛡️ Guards Implementation

#### 1. JWT Auth Guard (Global)
**File:** `auth/guards/jwt-auth.guard.ts`

```typescript
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    // Check if route is marked as @Public()
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    return super.canActivate(context);
  }
}
```

**Responsibilities:**
- Extends Passport's `AuthGuard('jwt')`
- Checks for `@Public()` decorator to skip auth
- Validates JWT and loads user via JwtStrategy
- Applied globally to all routes

---

#### 2. Tenant Guard (Global) 🚨 Critical for Security
**File:** `auth/guards/tenant.guard.ts`

```typescript
@Injectable()
export class TenantGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user; // Set by JwtAuthGuard
    const tenantIdHeader = request.headers['x-tenant-id'];

    // If x-tenant-id header is provided, validate it matches user's tenant
    if (tenantIdHeader && tenantIdHeader !== user.tenantId) {
      throw new ForbiddenException(
        'x-tenant-id header does not match authenticated user tenant'
      );
    }

    // Inject validated tenant ID into request
    request.validatedTenantId = user.tenantId;

    return true;
  }
}
```

**Responsibilities:**
- **Multi-tenancy security enforcement**
- Validates `x-tenant-id` header matches authenticated user's tenant
- Throws `ForbiddenException` if mismatch
- Prevents cross-tenant data access
- Injects `validatedTenantId` into request

---

#### 3. Roles Guard
**File:** `auth/guards/roles.guard.ts`

**Responsibilities:**
- Checks `@Roles('admin', 'owner')` decorator
- Validates user role against required roles
- Optional guard (applied per-route, not globally)

---

### 🔐 Passport Strategies

#### 1. Local Strategy (Basic Auth)
**File:** `auth/strategies/local.strategy.ts`

**Flow:**
1. Extract email/password from request body
2. Call `authService.validateUserCredentials(email, password)`
3. Verify password hash matches
4. Return user object on success
5. Throw `UnauthorizedException` on failure

---

#### 2. JWT Strategy
**File:** `auth/strategies/jwt.strategy.ts`

**Flow:**
1. Extract JWT from `Authorization: Bearer <token>` header
2. Verify JWT signature using `JWT_SECRET`
3. Extract jti (session ID) from payload
4. Check session validity via `sessionService.isSessionValid(jti)`
5. Load user from database
6. Attach user to request object
7. Throw `UnauthorizedException` if invalid

**User Object Attached to Request:**
```typescript
{
  userId: string,
  email: string,
  tenantId: string,
  role: string,
  sessionId: string,
  tenant: Tenant
}
```

---

#### 3. OIDC Strategy (Custom Implementation)
**File:** `auth/strategies/oidc.strategy.ts`

**Note:** Custom OAuth2 implementation (not Passport-based) to support dynamic multi-provider configuration.

**Flow:**
1. Generate authorization URL for specific provider
2. Redirect user to provider's login page
3. User authenticates with provider
4. Provider redirects to callback with authorization code
5. Exchange code for access token
6. Fetch userinfo from provider
7. Extract tenant from OIDC claims (using `tenantClaimPath`)
8. Find or create user + link OIDCAccount
9. Create session and generate JWT

---

## Phase 5: API Endpoints

### 🌐 Auth Controller Routes
**File:** `auth/auth.controller.ts`

#### Public Routes (No Authentication Required)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/auth/methods` | List available auth methods (basic + OIDC providers) |
| `POST` | `/api/auth/login` | Basic auth login (email/password) |
| `POST` | `/api/auth/register` | User registration (if `ALLOW_REGISTRATION=true`) |
| `GET` | `/api/auth/oidc/:providerId` | Initiate OIDC login (redirects to provider) |
| `GET` | `/api/auth/callback` | OIDC callback handler |

#### Protected Routes (Require JWT)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/auth/me` | Get current user profile |
| `POST` | `/api/auth/logout` | Revoke current session |
| `POST` | `/api/auth/logout-all` | Revoke all user sessions |
| `GET` | `/api/auth/sessions` | List active sessions |
| `DELETE` | `/api/auth/sessions/:sessionId` | Revoke specific session |

---

### 📋 Request/Response Examples

#### `POST /api/auth/login`
**Request:**
```json
{
  "email": "user@example.com",
  "password": "securepassword123"
}
```

**Response:**
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "clxxx123",
    "email": "user@example.com",
    "tenantId": "tenant_abc",
    "role": "member",
    "displayName": "John Doe"
  }
}
```

---

#### `GET /api/auth/methods`
**Response:**
```json
{
  "basicAuth": true,
  "allowRegistration": true,
  "oidcProviders": [
    {
      "id": "google",
      "name": "Google Workspace",
      "iconUrl": "https://cdn.example.com/google.png",
      "displayOrder": 1
    },
    {
      "id": "okta",
      "name": "Okta",
      "iconUrl": "https://cdn.example.com/okta.png",
      "displayOrder": 2
    }
  ]
}
```

---

## Phase 6: Global Guards

### 🔧 Update App Module
**File:** `painchain/backend/src/app.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { TenantGuard } from './auth/guards/tenant.guard';
import { AuthModule } from './auth/auth.module';
import { DatabaseModule } from './database/database.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { EventsModule } from './events/events.module';
import { ApiModule } from './api/api.module';
import { TeamsModule } from './teams/teams.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    AuthModule,          // ✅ NEW: Add AuthModule
    IntegrationsModule,
    EventsModule,
    ApiModule,
    TeamsModule,
  ],
  providers: [
    // ✅ NEW: Global guards (applied to ALL routes unless @Public())
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,  // First: Authentication
    },
    {
      provide: APP_GUARD,
      useClass: TenantGuard,   // Second: Tenant validation
    },
  ],
})
export class AppModule {}
```

**Guard Execution Order:**
1. `JwtAuthGuard` - Validates JWT, loads user
2. `TenantGuard` - Validates tenant ID matches user

---

## Phase 7: Migration Strategy

### 🔄 Controller Migration Pattern

#### Current Pattern (Before Auth)
```typescript
@Controller('integrations')
export class IntegrationsController {
  @Get()
  async findAll(@Headers('x-tenant-id') tenantId?: string) {
    return this.integrationsService.findAll(tenantId);
  }
}
```

#### New Pattern (After Auth)
```typescript
@Controller('integrations')
export class IntegrationsController {
  @Get()
  async findAll(@CurrentUser() user) {
    // user.tenantId is validated by TenantGuard
    return this.integrationsService.findAll(user.tenantId);
  }
}
```

---

### 🚦 Phased Rollout Strategy

#### Phase A: Add Auth (Optional Mode)
1. Implement auth system completely
2. Add `@Public()` decorator to all existing controllers temporarily
3. Deploy to production
4. **Result:** Existing connectors continue working without authentication

**Example:**
```typescript
@Controller('integrations')
@Public()  // ⚠️ Temporary - allow unauthenticated access
export class IntegrationsController {
  // ... existing methods
}
```

---

#### Phase B: Update Connectors
1. Update connector code to obtain JWT via login endpoint
2. Send JWT in `Authorization: Bearer <token>` header
3. Test authenticated requests
4. **Result:** Connectors now use authentication

**Connector Update Example:**
```typescript
// Before (no auth)
await fetch('/api/integrations', {
  headers: { 'x-tenant-id': 'tenant123' }
});

// After (with auth)
const { access_token } = await login(email, password);
await fetch('/api/integrations', {
  headers: {
    'Authorization': `Bearer ${access_token}`
  }
});
```

---

#### Phase C: Enforce Auth
1. Remove `@Public()` decorators from all controllers
2. Update controllers to use `@CurrentUser()` decorator
3. Remove `@Headers('x-tenant-id')` parameters
4. Deploy to production
5. **Result:** All requests require authentication

---

### 📝 Controllers to Migrate

| File | Current Pattern | New Pattern |
|------|----------------|-------------|
| `integrations.controller.ts` | `@Headers('x-tenant-id')` | `@CurrentUser()` |
| `events.controller.ts` | `@Headers('x-tenant-id')` | `@CurrentUser()` |
| `timeline.controller.ts` | `@Headers('x-tenant-id')` | `@CurrentUser()` |
| `projects.controller.ts` | `@Headers('x-tenant-id')` | `@CurrentUser()` |
| `teams.controller.ts` | `@Headers('x-tenant-id')` | `@CurrentUser()` |

---

## Phase 8: Security Hardening

### 🔐 Password Security

| Feature | Implementation |
|---------|----------------|
| **Hashing Algorithm** | bcrypt with 12 rounds |
| **Minimum Length** | 12 characters (configurable via `MIN_PASSWORD_LENGTH`) |
| **Storage** | Only hashed passwords stored, never plaintext |
| **Validation** | Length, complexity checks on registration |

---

### 🎫 JWT Security

| Feature | Implementation |
|---------|----------------|
| **Secret** | Strong random secret (use `openssl rand -base64 32`) |
| **Algorithm** | HS256 (HMAC with SHA-256) |
| **Expiration** | 7 days default (configurable via `JWT_EXPIRES_IN`) |
| **Claims** | Minimal payload: `{ sub, email, tenantId, role, jti }` |
| **Transport** | Bearer token in Authorization header |
| **Revocation** | Database-backed sessions enable immediate revocation |

**Production Recommendations:**
- Rotate JWT secret regularly
- Use HTTPS only (never HTTP in production)
- Consider shorter expiration (1-2 days) for higher security
- Implement refresh tokens for long-lived sessions

---

### 📊 Session Security

| Feature | Implementation |
|---------|----------------|
| **Storage** | All sessions tracked in database |
| **Revocation** | Users can revoke individual or all sessions |
| **Cleanup** | Periodic job to delete expired sessions (recommended: daily) |
| **Metadata** | IP address and user agent logged for auditing |
| **Activity Tracking** | Last activity timestamp updated on each request |

---

### 🏢 Multi-Tenant Isolation

**Critical Security Feature:**

The `TenantGuard` enforces strict tenant isolation:

```typescript
// ❌ BLOCKED: User from tenant A tries to access tenant B's data
GET /api/integrations
Authorization: Bearer <tenant_a_user_token>
x-tenant-id: tenant_b

// Response: 403 Forbidden
{
  "statusCode": 403,
  "message": "x-tenant-id header does not match authenticated user tenant"
}

// ✅ ALLOWED: User accesses their own tenant's data
GET /api/integrations
Authorization: Bearer <tenant_a_user_token>
x-tenant-id: tenant_a  (or omit header - defaults to user's tenant)
```

**Prevention Mechanisms:**
- Tenant Guard validates `x-tenant-id` matches user's tenant
- All database queries scoped to `user.tenantId`
- Users cannot access other tenants' data even if they modify headers

---

### ⏱️ Rate Limiting

**File:** `painchain/backend/src/main.ts`

```typescript
import { rateLimit } from 'express-rate-limit';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Rate limiting for login endpoint
  app.use('/api/auth/login', rateLimit({
    windowMs: 15 * 60 * 1000,  // 15 minutes
    max: 5,                     // 5 attempts per window
    message: 'Too many login attempts, please try again later',
  }));

  // Global rate limiting
  app.use(rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,  // 100 requests per 15 minutes per IP
  }));

  await app.listen(8000);
}
```

---

## Implementation Order

### 📅 Step-by-Step Timeline

#### **Step 1: Database (Day 1)**
- [ ] Update `schema.prisma` with User, Session, OIDCAccount, OIDCProvider models
- [ ] Add `users User[]` relation to Tenant model
- [ ] Run migration: `npx prisma migrate dev --name add_authentication`
- [ ] Verify migration succeeded

---

#### **Step 2: Dependencies (Day 1)**
```bash
npm install @nestjs/passport @nestjs/jwt passport passport-local passport-jwt bcrypt express-rate-limit
npm install -D @types/passport-local @types/passport-jwt @types/bcrypt
```

- [ ] Install production dependencies
- [ ] Install dev dependencies
- [ ] Verify no dependency conflicts

---

#### **Step 3: Auth Module Scaffold (Day 1-2)**
- [ ] Create `auth/` directory structure
- [ ] Create empty service, controller, guard files
- [ ] Create `auth.module.ts` with JwtModule configuration
- [ ] Create TypeScript interfaces (`jwt-payload.interface.ts`, `auth-user.interface.ts`)
- [ ] Create DTOs (`login.dto.ts`, `register.dto.ts`, `auth-response.dto.ts`)

---

#### **Step 4: Core Services (Day 2-3)**
- [ ] Implement `PasswordService` (bcrypt hashing/verification)
- [ ] Implement `JwtTokenService` (JWT generation/validation)
- [ ] Implement `SessionService` (CRUD operations)
- [ ] Implement `OIDCConfigService` (env parsing, provider sync)
- [ ] Test each service independently

---

#### **Step 5: Strategies (Day 3-4)**
- [ ] Implement `LocalStrategy` (basic auth validation)
- [ ] Implement `JwtStrategy` (JWT + session validation)
- [ ] Implement OIDC flow (custom OAuth2 implementation)
- [ ] Test each strategy with mock data

---

#### **Step 6: Guards & Decorators (Day 4)**
- [ ] Implement `JwtAuthGuard` (authentication)
- [ ] Implement `TenantGuard` (multi-tenancy validation)
- [ ] Implement `RolesGuard` (authorization)
- [ ] Create `@CurrentUser()` decorator
- [ ] Create `@Public()` decorator
- [ ] Create `@Roles()` decorator

---

#### **Step 7: Auth Service & Controller (Day 5-6)**
- [ ] Implement `AuthService` core methods:
  - [ ] `validateUserCredentials(email, password)`
  - [ ] `register(dto)`
  - [ ] `login(user, metadata)`
  - [ ] `handleOIDCLogin(userInfo, provider)`
  - [ ] `getUserProfile(userId)`
- [ ] Implement `AuthController` routes:
  - [ ] `GET /auth/methods`
  - [ ] `POST /auth/login`
  - [ ] `POST /auth/register`
  - [ ] `GET /auth/oidc/:providerId`
  - [ ] `GET /auth/callback`
  - [ ] `GET /auth/me`
  - [ ] `POST /auth/logout`
  - [ ] `GET /auth/sessions`
- [ ] Add environment variable validation

---

#### **Step 8: Global Guards (Day 6)**
- [ ] Update `app.module.ts` to register global guards
- [ ] Add `@Public()` to all existing controllers (temporary)
- [ ] Test authentication flow end-to-end
- [ ] Test `@Public()` routes work without auth

---

#### **Step 9: Testing (Day 7)**
- [ ] Test basic auth login flow
- [ ] Test OIDC flow with one provider (e.g., Google)
- [ ] Test tenant isolation (cross-tenant access blocked)
- [ ] Test session revocation
- [ ] Test protected routes require JWT
- [ ] Test `@Public()` routes skip auth
- [ ] Test invalid JWT rejected
- [ ] Test expired sessions rejected

---

#### **Step 10: Controller Migration (Day 8+)**
- [ ] Update `integrations.controller.ts` to use `@CurrentUser()`
- [ ] Update `events.controller.ts` to use `@CurrentUser()`
- [ ] Update `timeline.controller.ts` to use `@CurrentUser()`
- [ ] Update `projects.controller.ts` to use `@CurrentUser()`
- [ ] Update `teams.controller.ts` to use `@CurrentUser()`
- [ ] Remove `@Headers('x-tenant-id')` parameters from all controllers
- [ ] Update services to receive tenantId from user object
- [ ] Remove `@Public()` decorators once connectors updated
- [ ] Full end-to-end testing

---

## OIDC Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    OIDC Authentication Flow                  │
└─────────────────────────────────────────────────────────────┘

1. User visits Frontend Login Page
   │
   ├─ Displays basic auth form
   └─ Displays OIDC connector cards (Google, Okta, etc.)

2. User clicks "Login with Google"
   │
   └─> GET /api/auth/oidc/google

3. Backend generates authorization URL
   │
   ├─ state = encrypt({ providerId: "google", timestamp, nonce })
   ├─ redirect_uri = APP_URL/api/auth/callback
   └─ scope = openid email profile

4. Redirect to Google
   │
   └─> https://accounts.google.com/o/oauth2/v2/auth?
       client_id=...&
       redirect_uri=...&
       scope=openid+email+profile&
       state=...&
       response_type=code

5. User authenticates with Google
   │
   └─ Enters Google credentials

6. Google redirects to callback
   │
   └─> GET /api/auth/callback?code=AUTH_CODE&state=ENCRYPTED_STATE

7. Backend processes callback
   │
   ├─ Decode state → extract providerId
   ├─ Load provider config from database
   ├─ Exchange code for tokens
   │  └─> POST provider.tokenUrl
   │      { code, client_id, client_secret, redirect_uri }
   │      Response: { access_token, id_token }
   │
   ├─ Fetch user info
   │  └─> GET provider.userinfoUrl
   │      Authorization: Bearer ACCESS_TOKEN
   │      Response: { sub, email, name, hd, ... }
   │
   ├─ Extract tenant from claims
   │  └─ Use provider.tenantClaimPath (e.g., "hd" for Google)
   │      tenantId = userInfo.hd  // "example.com"
   │
   ├─ Find or create tenant
   │  └─ findOrCreate({ slug: tenantId, name: tenantId })
   │
   ├─ Find or create user
   │  └─ findOrCreate({
   │       email: userInfo.email,
   │       tenantId: tenant.id,
   │       displayName: userInfo.name
   │     })
   │
   ├─ Link OIDC account
   │  └─ upsert OIDCAccount {
   │       userId: user.id,
   │       providerId: "google",
   │       providerUserId: userInfo.sub,
   │       claims: userInfo
   │     }
   │
   ├─ Create session
   │  └─ Session {
   │       userId: user.id,
   │       token: sessionId (UUID),
   │       expiresAt: now + 7 days,
   │       ipAddress: req.ip,
   │       userAgent: req.headers['user-agent']
   │     }
   │
   └─ Generate JWT
      └─ JWT {
           sub: user.id,
           email: user.email,
           tenantId: user.tenantId,
           role: user.role,
           jti: session.id
         }

8. Redirect to frontend
   │
   └─> 302 Redirect: FRONTEND_URL/?token=JWT_TOKEN

9. Frontend receives token
   │
   ├─ Extract token from URL query param
   ├─ Store in localStorage: localStorage.setItem('token', token)
   └─ Redirect to dashboard: window.location = '/'

10. Subsequent API requests
    │
    └─> GET /api/integrations
        Authorization: Bearer JWT_TOKEN

11. Backend validates request
    │
    ├─ JwtAuthGuard: Verify JWT signature
    ├─ JwtStrategy: Load user from database
    ├─ SessionService: Check session not revoked
    ├─ TenantGuard: Validate tenant access
    └─ ✅ Request proceeds
```

---

## Critical Files Summary

### 📁 New Files to Create

**Auth Module Core:**
1. `painchain/backend/src/auth/auth.module.ts`
2. `painchain/backend/src/auth/auth.service.ts`
3. `painchain/backend/src/auth/auth.controller.ts`

**Guards:**
4. `painchain/backend/src/auth/guards/jwt-auth.guard.ts`
5. `painchain/backend/src/auth/guards/tenant.guard.ts`
6. `painchain/backend/src/auth/guards/roles.guard.ts`

**Strategies:**
7. `painchain/backend/src/auth/strategies/jwt.strategy.ts`
8. `painchain/backend/src/auth/strategies/local.strategy.ts`
9. `painchain/backend/src/auth/strategies/oidc.strategy.ts` (optional - can be part of auth.service)

**Services:**
10. `painchain/backend/src/auth/services/password.service.ts`
11. `painchain/backend/src/auth/services/jwt.service.ts`
12. `painchain/backend/src/auth/services/session.service.ts`
13. `painchain/backend/src/auth/services/oidc-config.service.ts`

**Decorators:**
14. `painchain/backend/src/auth/decorators/current-user.decorator.ts`
15. `painchain/backend/src/auth/decorators/public.decorator.ts`
16. `painchain/backend/src/auth/decorators/roles.decorator.ts`

**DTOs:**
17. `painchain/backend/src/auth/dto/login.dto.ts`
18. `painchain/backend/src/auth/dto/register.dto.ts`
19. `painchain/backend/src/auth/dto/auth-response.dto.ts`

**Interfaces:**
20. `painchain/backend/src/auth/interfaces/jwt-payload.interface.ts`
21. `painchain/backend/src/auth/interfaces/auth-user.interface.ts`

---

### 📝 Files to Modify

**Database:**
1. `painchain/backend/prisma/schema.prisma` - Add User, Session, OIDCAccount, OIDCProvider models

**Application:**
2. `painchain/backend/src/app.module.ts` - Register AuthModule and global guards
3. `painchain/backend/.env` - Add JWT and OIDC configuration
4. `painchain/backend/src/main.ts` - Add rate limiting

**Controllers (Later Phase - Migration):**
5. `painchain/backend/src/integrations/integrations.controller.ts`
6. `painchain/backend/src/events/events.controller.ts`
7. `painchain/backend/src/api/timeline.controller.ts`
8. `painchain/backend/src/api/projects.controller.ts`
9. `painchain/backend/src/teams/teams.controller.ts`

---

## Notes & Troubleshooting

### 📝 Implementation Notes

#### Tenant Extraction from OIDC Claims

Different OIDC providers use different claim names for tenant/organization:

| Provider | Claim Path | Example Value |
|----------|------------|---------------|
| **Google Workspace** | `hd` | `"example.com"` |
| **Okta** | `tenant_id` | `"customer-123"` |
| **Azure AD** | `tid` | `"abc-123-def-456"` |
| **Auth0** | `org_id` | `"org_abc123"` |

Configure `tenantClaimPath` in each provider's config to extract the correct value.

---

#### First User Bootstrap

**Problem:** How to create the first user when there's no authentication?

**Solution 1: Seed Script**
```bash
npx prisma db seed
```

Create `prisma/seed.ts`:
```typescript
async function main() {
  // Create default tenant
  const tenant = await prisma.tenant.create({
    data: {
      slug: 'default',
      name: 'Default Tenant',
    },
  });

  // Create admin user
  const passwordHash = await bcrypt.hash('changeme123', 12);
  await prisma.user.create({
    data: {
      email: 'admin@painchain.local',
      passwordHash,
      role: 'owner',
      tenantId: tenant.id,
      emailVerified: true,
    },
  });
}
```

**Solution 2: Registration Endpoint**
- Keep `POST /api/auth/register` as `@Public()` temporarily
- First user to register becomes tenant owner
- Disable registration after first user via env var

---

### 🐛 Common Issues & Solutions

#### Issue: JWT Secret Not Set
**Error:** `JWT_SECRET is not defined`

**Solution:**
```bash
# Generate secure secret
openssl rand -base64 32

# Add to .env
JWT_SECRET="generated-secret-here"
```

---

#### Issue: OIDC Provider Not Found
**Error:** `Provider 'google' not found in database`

**Solution:**
1. Check `OIDC_PROVIDERS` JSON is valid
2. Restart backend to trigger `OIDCConfigService.onModuleInit()`
3. Verify providers synced: `SELECT * FROM oidc_providers;`

---

#### Issue: Cross-Tenant Access Not Blocked
**Error:** User can access other tenant's data

**Solution:**
1. Verify `TenantGuard` is registered in `app.module.ts`
2. Check guard order (TenantGuard must come after JwtAuthGuard)
3. Ensure services filter by `user.tenantId` in queries

---

#### Issue: Session Not Revoked
**Error:** JWT still valid after logout

**Solution:**
1. Verify `SessionService.revokeSession()` is called
2. Check `JwtStrategy` calls `sessionService.isSessionValid()`
3. Ensure jti claim in JWT matches session.token in database

---

### 🔮 Future Enhancements

**Phase 2 Features (Not in Initial Implementation):**

1. **Password Reset Flow**
   - Email-based password reset tokens
   - Expiring reset links

2. **Email Verification**
   - Confirm email after registration
   - Prevent login until verified

3. **Two-Factor Authentication (2FA)**
   - TOTP (Time-based One-Time Password)
   - Backup codes

4. **OAuth2 Scopes**
   - Granular API permissions
   - Scope-based access control

5. **Refresh Tokens**
   - Long-lived tokens for mobile apps
   - Revocable refresh tokens

6. **SSO Session Timeout**
   - Maximum session age
   - Idle timeout

7. **Audit Logging**
   - Track all auth events
   - Login attempts, session creation, revocation

8. **Advanced RBAC**
   - Custom roles and permissions
   - Resource-level permissions

9. **Team-Based Access**
   - Share resources between users in same tenant
   - Team invitations

10. **API Keys**
    - Machine-to-machine authentication
    - Scoped API keys

---

### 📚 References

- [NestJS Authentication Docs](https://docs.nestjs.com/security/authentication)
- [Passport.js Documentation](http://www.passportjs.org/)
- [OpenID Connect Spec](https://openid.net/connect/)
- [bcrypt Best Practices](https://github.com/kelektiv/node.bcrypt.js#security-issues-and-concerns)
- [JWT Best Practices](https://tools.ietf.org/html/rfc8725)

---

## 📞 Contact & Support

**Questions or issues?** Add notes directly to this file or create issues in the project repository.

---

**Last Updated:** 2026-01-06
**Document Version:** 1.0
**Status:** ✅ Ready for Implementation
