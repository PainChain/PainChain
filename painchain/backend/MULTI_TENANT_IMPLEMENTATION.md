# Multi-Tenant Implementation Plan

**Simplified Approach - Single Tenant Per User**

**Status:** Ready to Implement
**Last Updated:** 2026-01-06

---

## Overview

Implement single-tenant multi-tenancy with:
- ✅ Users belong to ONE tenant only
- ✅ Invitation links (no email required)
- ✅ OIDC domain-based auto-join
- ✅ Owners and admins can invite
- ✅ Tenant ID in header (current approach)

---

## Architecture

### Tenant Creation Methods

```
┌────────────────────────────────────────────────────────────┐
│                   How Tenants Are Created                  │
└────────────────────────────────────────────────────────────┘

Method 1: Basic Auth Registration (New Organization)
┌─────────────────────────────────────────────────────────┐
│ User registers → Provides org name → Creates new tenant │
│ User becomes owner of new tenant                        │
└─────────────────────────────────────────────────────────┘

Method 2: Invitation Link (Join Existing)
┌─────────────────────────────────────────────────────────┐
│ Owner/Admin generates invite link                       │
│ New user clicks link → Registers → Joins that tenant   │
│ User becomes member/admin (based on invite)             │
└─────────────────────────────────────────────────────────┘

Method 3: OIDC Auto-Join (Domain Match)
┌─────────────────────────────────────────────────────────┐
│ User logs in with OIDC (e.g., Google)                   │
│ Extract domain from email (hd claim)                    │
│ Find tenant by domain → Auto-join                       │
│ If no tenant found → Create new tenant for domain       │
└─────────────────────────────────────────────────────────┘
```

---

## Database Schema Changes

### Current Schema (Problematic)

```prisma
model User {
  id       String @id
  email    String @unique
  tenantId String        // Direct relationship
  tenant   Tenant @relation(fields: [tenantId])
  role     String        // Role stored on user
}

model Tenant {
  id    String @id
  name  String
  slug  String @unique
  users User[]
}
```

**Problems:**
- Can't invite users before they exist (need userId)
- Role is on User, not tenant-specific
- No way to track who invited whom
- No invitation expiration

---

### New Schema (Recommended)

```prisma
model User {
  id            String   @id @default(cuid())
  email         String   @unique
  emailVerified Boolean  @default(false)
  passwordHash  String?  // null for OIDC-only users

  // Profile
  firstName     String?
  lastName      String?
  displayName   String?
  avatarUrl     String?

  // Metadata
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  lastLoginAt   DateTime?
  isActive      Boolean  @default(true)

  // Multi-tenancy: User belongs to ONE tenant
  tenantId      String
  tenant        Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  role          String   @default("member") // "owner", "admin", "member", "viewer"

  // Relations
  sessions      Session[]
  oidcAccounts  OIDCAccount[]

  // Track who invited this user (optional)
  invitedBy     String?
  invitedAt     DateTime?

  @@index([tenantId])
  @@index([email])
  @@index([tenantId, email])
  @@map("users")
}

model Tenant {
  id          String   @id @default(cuid())
  name        String
  slug        String   @unique

  // Domain-based auto-joining for OIDC
  // Example: ["acme.com", "acme.co.uk"]
  // Users with @acme.com will auto-join this tenant
  domains     String[] @default([])

  // Metadata
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  // Relations
  users       User[]
  invitations TenantInvitation[]

  @@index([slug])
  @@map("tenants")
}

model TenantInvitation {
  id        String   @id @default(cuid())
  tenantId  String
  tenant    Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  // Invitation details
  token     String   @unique @default(cuid()) // Shareable token
  role      String   @default("member") // Role for invited user

  // Who created this invite
  createdBy String   // User ID of creator
  createdAt DateTime @default(now())

  // Expiration (optional - 7 days default)
  expiresAt DateTime

  // Usage tracking
  usedBy    String?  // User ID who accepted
  usedAt    DateTime?
  maxUses   Int      @default(1) // How many people can use this link (1 = single-use)
  useCount  Int      @default(0)

  // Revocation
  isRevoked Boolean  @default(false)
  revokedAt DateTime?
  revokedBy String?

  @@index([token])
  @@index([tenantId])
  @@index([createdBy])
  @@map("tenant_invitations")
}
```

**Key Changes:**
1. Keep `tenantId` directly on User (single tenant only)
2. Add `domains` array to Tenant for OIDC auto-join
3. Add `TenantInvitation` model for shareable invite links
4. Add `invitedBy` tracking on User (optional, for analytics)

---

## Implementation Steps

### Step 1: Database Migration

**File:** `painchain/backend/prisma/schema.prisma`

**Changes:**
1. Add `domains` field to Tenant model
2. Create `TenantInvitation` model
3. Add `invitedBy` and `invitedAt` fields to User

**Migration:**
```bash
npx prisma migrate dev --name add_tenant_invitations
```

---

### Step 2: Invitation Service

**File:** `painchain/backend/src/auth/services/invitation.service.ts`

```typescript
import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { TenantInvitation } from '@prisma/client';

@Injectable()
export class InvitationService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a new invitation link
   * @param tenantId - Tenant to invite to
   * @param createdBy - User ID creating the invite
   * @param role - Role for invited user
   * @param expiresInDays - Days until expiration (default 7)
   * @param maxUses - Max number of uses (default 1)
   */
  async createInvitation(
    tenantId: string,
    createdBy: string,
    role: string = 'member',
    expiresInDays: number = 7,
    maxUses: number = 1,
  ): Promise<TenantInvitation> {
    // Verify creator has permission (owner or admin)
    const creator = await this.prisma.user.findUnique({
      where: { id: createdBy },
    });

    if (!creator || creator.tenantId !== tenantId) {
      throw new BadRequestException('Invalid creator');
    }

    if (!['owner', 'admin'].includes(creator.role)) {
      throw new BadRequestException('Only owners and admins can create invitations');
    }

    // Calculate expiration
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expiresInDays);

    return this.prisma.tenantInvitation.create({
      data: {
        tenantId,
        createdBy,
        role,
        expiresAt,
        maxUses,
      },
    });
  }

  /**
   * Get invitation by token
   * @param token - Invitation token
   */
  async getInvitation(token: string): Promise<TenantInvitation & { tenant: any }> {
    const invitation = await this.prisma.tenantInvitation.findUnique({
      where: { token },
      include: {
        tenant: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
      },
    });

    if (!invitation) {
      throw new NotFoundException('Invitation not found');
    }

    return invitation;
  }

  /**
   * Validate invitation is still usable
   * @param token - Invitation token
   */
  async validateInvitation(token: string): Promise<TenantInvitation> {
    const invitation = await this.getInvitation(token);

    if (invitation.isRevoked) {
      throw new BadRequestException('This invitation has been revoked');
    }

    if (invitation.expiresAt < new Date()) {
      throw new BadRequestException('This invitation has expired');
    }

    if (invitation.useCount >= invitation.maxUses) {
      throw new BadRequestException('This invitation has reached its maximum uses');
    }

    return invitation;
  }

  /**
   * Mark invitation as used
   * @param token - Invitation token
   * @param userId - User who used the invitation
   */
  async useInvitation(token: string, userId: string): Promise<void> {
    const invitation = await this.validateInvitation(token);

    await this.prisma.tenantInvitation.update({
      where: { id: invitation.id },
      data: {
        useCount: { increment: 1 },
        usedBy: userId,
        usedAt: new Date(),
      },
    });
  }

  /**
   * Revoke an invitation
   * @param token - Invitation token
   * @param revokedBy - User ID revoking the invite
   */
  async revokeInvitation(token: string, revokedBy: string): Promise<void> {
    const invitation = await this.getInvitation(token);

    // Verify revoker has permission
    const revoker = await this.prisma.user.findUnique({
      where: { id: revokedBy },
    });

    if (!revoker || revoker.tenantId !== invitation.tenantId) {
      throw new BadRequestException('Invalid permission');
    }

    if (!['owner', 'admin'].includes(revoker.role)) {
      throw new BadRequestException('Only owners and admins can revoke invitations');
    }

    await this.prisma.tenantInvitation.update({
      where: { id: invitation.id },
      data: {
        isRevoked: true,
        revokedAt: new Date(),
        revokedBy,
      },
    });
  }

  /**
   * List all invitations for a tenant
   * @param tenantId - Tenant ID
   */
  async listInvitations(tenantId: string): Promise<TenantInvitation[]> {
    return this.prisma.tenantInvitation.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
```

---

### Step 3: Update Registration to Accept Invitations

**File:** `painchain/backend/src/auth/auth.service.ts`

**Update the `register` method:**

```typescript
async register(dto: RegisterDto): Promise<AuthResponseDto> {
  // Check if registration is allowed
  if (!this.oidcConfigService.isRegistrationAllowed() && !dto.invitationToken) {
    throw new BadRequestException('Registration is disabled. You need an invitation to join.');
  }

  // Check if user already exists
  const existingUser = await this.prisma.user.findUnique({
    where: { email: dto.email },
  });

  if (existingUser) {
    throw new ConflictException('User with this email already exists');
  }

  // Validate password
  const minLength = this.oidcConfigService.getMinPasswordLength();
  if (dto.password.length < minLength) {
    throw new BadRequestException(`Password must be at least ${minLength} characters long`);
  }

  const passwordHash = await this.passwordService.hashPassword(dto.password);

  let tenant: Tenant;
  let role = 'member';
  let invitedBy: string | null = null;

  // CASE 1: User has invitation token → Join existing tenant
  if (dto.invitationToken) {
    const invitation = await this.invitationService.validateInvitation(dto.invitationToken);

    tenant = await this.prisma.tenant.findUnique({
      where: { id: invitation.tenantId },
    });

    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    role = invitation.role;
    invitedBy = invitation.createdBy;

    // Mark invitation as used (will be done after user creation)
  }
  // CASE 2: User provides organization name → Create new tenant
  else if (dto.organizationName) {
    const slug = this.generateSlug(dto.organizationName);

    // Check if slug already exists
    const existingTenant = await this.prisma.tenant.findUnique({
      where: { slug },
    });

    if (existingTenant) {
      throw new ConflictException('An organization with this name already exists');
    }

    tenant = await this.prisma.tenant.create({
      data: {
        name: dto.organizationName,
        slug,
        // Optionally add domain from email
        domains: dto.email.includes('@') ? [dto.email.split('@')[1]] : [],
      },
    });

    role = 'owner'; // First user is owner
  }
  // CASE 3: No invitation and no org name
  else {
    throw new BadRequestException('Must provide either organizationName or invitationToken');
  }

  // Create user
  const user = await this.prisma.user.create({
    data: {
      email: dto.email,
      passwordHash,
      firstName: dto.firstName,
      lastName: dto.lastName,
      displayName: dto.displayName || dto.firstName || dto.email.split('@')[0],
      tenantId: tenant.id,
      role,
      emailVerified: false,
      invitedBy,
      invitedAt: invitedBy ? new Date() : null,
    },
    include: { tenant: true },
  });

  // Mark invitation as used
  if (dto.invitationToken) {
    await this.invitationService.useInvitation(dto.invitationToken, user.id);
  }

  this.logger.log(`User registered: ${user.email} (tenant: ${tenant.slug}, role: ${role})`);

  // Generate JWT and create session
  return this.login(user);
}

/**
 * Generate URL-safe slug from organization name
 */
private generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    + '-' + Date.now();
}
```

---

### Step 4: Update OIDC to Auto-Join by Domain

**File:** `painchain/backend/src/auth/auth.service.ts`

**Update the `handleOIDCLogin` method:**

```typescript
async handleOIDCLogin(userInfo: OIDCUserInfo, provider: OIDCProvider): Promise<AuthResponseDto> {
  const email = userInfo.email;

  if (!email) {
    throw new BadRequestException('Email is required from OIDC provider');
  }

  const domain = email.split('@')[1];

  // Check if user already exists
  let user = await this.prisma.user.findUnique({
    where: { email },
    include: { tenant: true },
  });

  // User exists → update last login
  if (user) {
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    return this.login(user);
  }

  // User doesn't exist → Find or create tenant based on domain
  let tenant = await this.prisma.tenant.findFirst({
    where: {
      domains: {
        has: domain,
      },
    },
  });

  // No tenant found for this domain → Create new tenant
  if (!tenant) {
    this.logger.log(`Creating new tenant for domain: ${domain}`);

    tenant = await this.prisma.tenant.create({
      data: {
        name: domain.split('.')[0], // "acme" from "acme.com"
        slug: domain.replace(/\./g, '-') + '-' + Date.now(),
        domains: [domain],
      },
    });
  } else {
    this.logger.log(`Auto-joining existing tenant: ${tenant.name} (domain: ${domain})`);
  }

  // Create user and auto-join tenant
  user = await this.prisma.user.create({
    data: {
      email,
      emailVerified: userInfo.email_verified || false,
      firstName: userInfo.given_name,
      lastName: userInfo.family_name,
      displayName: userInfo.name || userInfo.email.split('@')[0],
      avatarUrl: userInfo.picture,
      tenantId: tenant.id,
      role: 'member', // Auto-joined users are members
      oidcAccounts: {
        create: {
          providerId: provider.id,
          providerUserId: userInfo.sub,
          claims: userInfo,
        },
      },
    },
    include: { tenant: true },
  });

  this.logger.log(`OIDC user created and joined tenant: ${user.email} → ${tenant.name}`);

  return this.login(user);
}
```

---

### Step 5: Add Invitation Controller Endpoints

**File:** `painchain/backend/src/auth/auth.controller.ts`

**Add these endpoints:**

```typescript
import { InvitationService } from './services/invitation.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly invitationService: InvitationService,
  ) {}

  // ... existing endpoints ...

  /**
   * Create a new invitation link (owners/admins only)
   * POST /api/auth/invitations
   */
  @Post('invitations')
  @HttpCode(HttpStatus.CREATED)
  async createInvitation(
    @CurrentUser() user: AuthUser,
    @Body() dto: { role?: string; expiresInDays?: number; maxUses?: number },
  ) {
    const invitation = await this.invitationService.createInvitation(
      user.tenantId,
      user.userId,
      dto.role || 'member',
      dto.expiresInDays || 7,
      dto.maxUses || 1,
    );

    // Return invitation with full URL
    const inviteUrl = `${process.env.FRONTEND_URL}/register?invite=${invitation.token}`;

    return {
      ...invitation,
      inviteUrl,
    };
  }

  /**
   * Get invitation details (public)
   * GET /api/auth/invitations/:token
   */
  @Public()
  @Get('invitations/:token')
  async getInvitation(@Param('token') token: string) {
    const invitation = await this.invitationService.getInvitation(token);

    // Return only safe fields
    return {
      token: invitation.token,
      tenant: invitation.tenant,
      role: invitation.role,
      expiresAt: invitation.expiresAt,
      isValid: !invitation.isRevoked && invitation.expiresAt > new Date() && invitation.useCount < invitation.maxUses,
    };
  }

  /**
   * List all invitations for current tenant (owners/admins only)
   * GET /api/auth/invitations
   */
  @Get('invitations')
  async listInvitations(@CurrentUser() user: AuthUser) {
    return this.invitationService.listInvitations(user.tenantId);
  }

  /**
   * Revoke an invitation (owners/admins only)
   * DELETE /api/auth/invitations/:token
   */
  @Delete('invitations/:token')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeInvitation(
    @Param('token') token: string,
    @CurrentUser() user: AuthUser,
  ) {
    await this.invitationService.revokeInvitation(token, user.userId);
  }
}
```

---

### Step 6: Update Registration DTO

**File:** `painchain/backend/src/auth/dto/register.dto.ts`

```typescript
import { IsEmail, IsString, MinLength, IsOptional } from 'class-validator';

export class RegisterDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(12)
  password: string;

  @IsOptional()
  @IsString()
  firstName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsOptional()
  @IsString()
  displayName?: string;

  @IsOptional()
  @IsString()
  organizationName?: string;

  @IsOptional()
  @IsString()
  invitationToken?: string;
}
```

---

### Step 7: Update Auth Module

**File:** `painchain/backend/src/auth/auth.module.ts`

```typescript
import { InvitationService } from './services/invitation.service';

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get('JWT_SECRET'),
        signOptions: {
          expiresIn: config.get('JWT_EXPIRES_IN', '7d'),
          issuer: 'painchain',
          audience: 'painchain-api',
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    JwtTokenService,
    SessionService,
    OIDCConfigService,
    OIDCService,
    InvitationService, // ADD THIS
    JwtStrategy,
    LocalStrategy,
  ],
  exports: [AuthService],
})
export class AuthModule {}
```

---

## API Endpoints Summary

### Public Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/auth/methods` | Get available auth methods |
| POST | `/api/auth/login` | Login with email/password |
| POST | `/api/auth/register` | Register new user (with org or invite) |
| GET | `/api/auth/oidc/:providerId` | Initiate OIDC login |
| GET | `/api/auth/callback` | OIDC callback handler |
| GET | `/api/auth/invitations/:token` | Get invitation details |

### Protected Endpoints

| Method | Endpoint | Description | Required Role |
|--------|----------|-------------|---------------|
| GET | `/api/auth/me` | Get current user | Any |
| POST | `/api/auth/logout` | Logout current session | Any |
| POST | `/api/auth/logout-all` | Logout all sessions | Any |
| GET | `/api/auth/sessions` | List active sessions | Any |
| DELETE | `/api/auth/sessions/:id` | Revoke session | Any |
| POST | `/api/auth/invitations` | Create invitation link | Owner/Admin |
| GET | `/api/auth/invitations` | List invitations | Owner/Admin |
| DELETE | `/api/auth/invitations/:token` | Revoke invitation | Owner/Admin |

---

## Frontend Implementation

### Registration Page

```tsx
// URL: /register
// Query params: ?invite=abc123

export const RegisterPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const inviteToken = searchParams.get('invite');
  const { data: invitation, isLoading } = useInvitation(inviteToken);
  const { register: registerUser } = useRegister();

  // Loading invitation details
  if (inviteToken && isLoading) {
    return <div>Loading invitation...</div>;
  }

  // Invalid invitation
  if (inviteToken && !invitation?.isValid) {
    return (
      <div>
        <h2>Invalid Invitation</h2>
        <p>This invitation link has expired or is no longer valid.</p>
      </div>
    );
  }

  return (
    <div>
      {invitation ? (
        // Joining existing organization
        <div>
          <h2>Join {invitation.tenant.name}</h2>
          <p>You've been invited to join {invitation.tenant.name} as a {invitation.role}.</p>

          <form onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            registerUser({
              email: data.get('email'),
              password: data.get('password'),
              firstName: data.get('firstName'),
              lastName: data.get('lastName'),
              invitationToken: inviteToken,
            });
          }}>
            <Input name="email" label="Email" required />
            <Input name="password" type="password" label="Password" required />
            <Input name="firstName" label="First Name" />
            <Input name="lastName" label="Last Name" />
            <Button type="submit">Join {invitation.tenant.name}</Button>
          </form>
        </div>
      ) : (
        // Creating new organization
        <div>
          <h2>Create Your Organization</h2>

          <form onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            registerUser({
              email: data.get('email'),
              password: data.get('password'),
              firstName: data.get('firstName'),
              lastName: data.get('lastName'),
              organizationName: data.get('organizationName'),
            });
          }}>
            <Input name="email" label="Email" required />
            <Input name="password" type="password" label="Password" required />
            <Input name="firstName" label="First Name" />
            <Input name="lastName" label="Last Name" />
            <Input name="organizationName" label="Organization Name" required />
            <Button type="submit">Create Organization</Button>
          </form>
        </div>
      )}
    </div>
  );
};
```

### Team Management Page

```tsx
// URL: /team (owners/admins only)

export const TeamPage: React.FC = () => {
  const { user } = useAuth();
  const { data: teamMembers } = useTeamMembers();
  const { data: invitations } = useInvitations();
  const createInvite = useCreateInvitation();
  const revokeInvite = useRevokeInvitation();

  const canManageTeam = ['owner', 'admin'].includes(user.role);

  const handleCreateInvite = async (role: string, expiresInDays: number, maxUses: number) => {
    const result = await createInvite({ role, expiresInDays, maxUses });

    // Copy invite URL to clipboard
    navigator.clipboard.writeText(result.inviteUrl);
    toast.success('Invite link copied to clipboard!');
  };

  return (
    <div>
      <h1>Team Management</h1>

      {/* Create Invitation */}
      {canManageTeam && (
        <section>
          <h2>Invite Team Members</h2>
          <InviteForm onSubmit={handleCreateInvite} />
        </section>
      )}

      {/* Active Invitations */}
      {canManageTeam && (
        <section>
          <h2>Active Invitations</h2>
          <Table>
            <thead>
              <tr>
                <th>Link</th>
                <th>Role</th>
                <th>Expires</th>
                <th>Uses</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {invitations?.map((inv) => (
                <tr key={inv.id}>
                  <td>
                    <CopyButton text={inv.inviteUrl} />
                  </td>
                  <td>{inv.role}</td>
                  <td>{formatDate(inv.expiresAt)}</td>
                  <td>{inv.useCount} / {inv.maxUses}</td>
                  <td>
                    <button onClick={() => revokeInvite(inv.token)}>
                      Revoke
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </section>
      )}

      {/* Team Members */}
      <section>
        <h2>Team Members</h2>
        <Table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Joined</th>
            </tr>
          </thead>
          <tbody>
            {teamMembers?.map((member) => (
              <tr key={member.id}>
                <td>{member.displayName}</td>
                <td>{member.email}</td>
                <td>{member.role}</td>
                <td>{formatDate(member.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </section>
    </div>
  );
};
```

---

## User Flows

### Flow 1: First User Creates Organization

```
1. Visit /register
2. Fill form:
   - Email: alice@acme.com
   - Password: ••••••••
   - Organization Name: "Acme Corp"
3. Click "Create Organization"
4. Backend:
   - Creates tenant "Acme Corp" with domain ["acme.com"]
   - Creates user alice@acme.com with role "owner"
5. Redirect to dashboard
```

### Flow 2: Team Member Joins via Invite Link

```
1. Alice (owner) creates invite:
   - Goes to /team
   - Clicks "Create Invite Link"
   - Selects role: "member"
   - Gets link: /register?invite=abc123
2. Alice shares link with Bob (via Slack, etc.)
3. Bob clicks link → /register?invite=abc123
4. Page shows: "Join Acme Corp"
5. Bob fills:
   - Email: bob@acme.com
   - Password: ••••••••
6. Clicks "Join Acme Corp"
7. Backend:
   - Validates invite token
   - Creates user bob@acme.com with role "member"
   - Links to Acme Corp tenant
   - Marks invite as used
8. Bob redirects to dashboard
```

### Flow 3: OIDC User Auto-Joins

```
1. Alice created "Acme Corp" with domain "acme.com"
2. Carol clicks "Sign in with Google"
3. Google auth → carol@acme.com
4. Backend:
   - Extracts domain "acme.com"
   - Finds tenant "Acme Corp" (matches domain)
   - Creates user carol@acme.com with role "member"
   - Auto-joins "Acme Corp"
5. Carol redirects to dashboard
```

### Flow 4: OIDC User Creates New Org (No Matching Domain)

```
1. No existing tenant for "newco.com"
2. Dave clicks "Sign in with Google"
3. Google auth → dave@newco.com
4. Backend:
   - Extracts domain "newco.com"
   - No tenant found with this domain
   - Creates new tenant "newco" with domain ["newco.com"]
   - Creates user dave@newco.com with role "member"
5. Dave redirects to dashboard
```

---

## Testing Checklist

- [ ] Create organization via basic auth registration
- [ ] First user in org is owner
- [ ] Owner can create invite links
- [ ] Admin can create invite links
- [ ] Member cannot create invite links
- [ ] Invite link shows correct org name
- [ ] User can join via valid invite link
- [ ] Expired invite links are rejected
- [ ] Used single-use invite links are rejected
- [ ] Multi-use invite links work correctly
- [ ] Revoked invite links are rejected
- [ ] OIDC user auto-joins by domain
- [ ] OIDC creates new org if no domain match
- [ ] Multiple users can join same tenant
- [ ] Users are properly isolated by tenant
- [ ] TenantGuard validates tenant access

---

## Security Considerations

1. **Invitation Token Security:**
   - Use cryptographically secure random tokens (cuid)
   - Expire invitations after 7 days (configurable)
   - Allow owners to revoke invitations
   - Track who created each invitation

2. **Domain Validation:**
   - Only extract domain from verified OIDC claims
   - Don't allow users to specify arbitrary domains
   - Match domains case-insensitively

3. **Role Enforcement:**
   - Only owners/admins can create invitations
   - Validate role in invitation (prevent privilege escalation)
   - Enforce role checks in guards

4. **Tenant Isolation:**
   - All queries filtered by tenantId
   - TenantGuard validates x-tenant-id header
   - Users cannot access other tenants' data

---

## Next Steps After Implementation

1. **Team Member Management:**
   - Change member roles (owner/admin only)
   - Remove team members (owner only)
   - Transfer ownership

2. **Usage Tracking:**
   - Track invitation usage analytics
   - Show who invited whom
   - Audit log for team changes

3. **Advanced Invitations:**
   - Email-specific invitations (restrict to specific email)
   - Time-limited invitations
   - Department/group assignments

4. **Billing & Limits:**
   - Limit team size by plan
   - Track active users per tenant
   - Billing based on team size

---

**Ready to implement!**
