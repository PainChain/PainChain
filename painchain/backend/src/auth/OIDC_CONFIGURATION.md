# OIDC Provider Configuration Guide

This guide explains how to configure OpenID Connect (OIDC) authentication providers for PainChain.

## Overview

PainChain supports multiple OIDC providers configured via environment variables. Users can choose their preferred provider at login, and the system automatically extracts tenant information from OIDC claims.

## Configuration

### Environment Variable Format

Add OIDC providers to your `.env` file using the `OIDC_PROVIDERS` variable as a JSON array:

```bash
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
  }
]'
```

### Field Descriptions

| Field | Required | Description |
|-------|----------|-------------|
| `id` | Yes | Unique identifier for this provider (e.g., "google", "okta") |
| `name` | Yes | Display name shown to users (e.g., "Google Workspace") |
| `iconUrl` | No | URL to provider logo/icon image |
| `issuer` | Yes | OIDC issuer URL (used for validation) |
| `clientId` | Yes | OAuth2 client ID from provider |
| `clientSecret` | Yes | OAuth2 client secret from provider |
| `authorizationUrl` | Yes | OAuth2 authorization endpoint |
| `tokenUrl` | Yes | OAuth2 token exchange endpoint |
| `userinfoUrl` | Yes | OIDC userinfo endpoint |
| `scopes` | Yes | Array of OAuth2 scopes to request |
| `tenantClaimPath` | Yes | JSON path to extract tenant from claims (see below) |
| `displayOrder` | No | Order to display on login page (lower = first) |

### Tenant Claim Path

The `tenantClaimPath` specifies which OIDC claim contains the tenant identifier. Common values:

- **Google Workspace**: `"hd"` (hosted domain)
- **Okta**: `"tenant_id"` or custom claim
- **Azure AD**: `"tid"` (tenant ID)
- **Auth0**: `"org_id"` or custom claim

## Provider Examples

### Google Workspace

```json
{
  "id": "google",
  "name": "Google Workspace",
  "iconUrl": "https://www.google.com/favicon.ico",
  "issuer": "https://accounts.google.com",
  "clientId": "123456789-abcdefg.apps.googleusercontent.com",
  "clientSecret": "GOCSPX-your-secret-here",
  "authorizationUrl": "https://accounts.google.com/o/oauth2/v2/auth",
  "tokenUrl": "https://oauth2.googleapis.com/token",
  "userinfoUrl": "https://openidconnect.googleapis.com/v1/userinfo",
  "scopes": ["openid", "email", "profile"],
  "tenantClaimPath": "hd",
  "displayOrder": 1
}
```

**Setup Steps:**
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing
3. Enable "Google+ API"
4. Create OAuth 2.0 credentials
5. Add authorized redirect URI: `http://localhost:8000/api/auth/callback`
6. Copy Client ID and Client Secret

**Tenant Extraction:**
Google Workspace users have an `hd` (hosted domain) claim that contains their organization's domain (e.g., "example.com").

---

### Okta

```json
{
  "id": "okta",
  "name": "Okta",
  "iconUrl": "https://www.okta.com/favicon.ico",
  "issuer": "https://your-domain.okta.com",
  "clientId": "0oa1a2b3c4d5e6f7g8h9",
  "clientSecret": "your-okta-secret",
  "authorizationUrl": "https://your-domain.okta.com/oauth2/v1/authorize",
  "tokenUrl": "https://your-domain.okta.com/oauth2/v1/token",
  "userinfoUrl": "https://your-domain.okta.com/oauth2/v1/userinfo",
  "scopes": ["openid", "email", "profile"],
  "tenantClaimPath": "tenant_id",
  "displayOrder": 2
}
```

**Setup Steps:**
1. Log into Okta Admin Console
2. Go to Applications → Create App Integration
3. Choose "OIDC - OpenID Connect"
4. Choose "Web Application"
5. Add redirect URI: `http://localhost:8000/api/auth/callback`
6. Copy Client ID and Client Secret
7. (Optional) Add custom `tenant_id` claim in token customization

**Tenant Extraction:**
Configure a custom claim in Okta to include tenant identifier, or use a group/organization claim.

---

### Azure Active Directory (Microsoft Entra ID)

```json
{
  "id": "azure",
  "name": "Microsoft",
  "iconUrl": "https://www.microsoft.com/favicon.ico",
  "issuer": "https://login.microsoftonline.com/{tenant-id}/v2.0",
  "clientId": "12345678-1234-1234-1234-123456789abc",
  "clientSecret": "your-azure-secret",
  "authorizationUrl": "https://login.microsoftonline.com/{tenant-id}/oauth2/v2.0/authorize",
  "tokenUrl": "https://login.microsoftonline.com/{tenant-id}/oauth2/v2.0/token",
  "userinfoUrl": "https://graph.microsoft.com/oidc/userinfo",
  "scopes": ["openid", "email", "profile"],
  "tenantClaimPath": "tid",
  "displayOrder": 3
}
```

**Setup Steps:**
1. Go to [Azure Portal](https://portal.azure.com/)
2. Navigate to Azure Active Directory → App registrations
3. Click "New registration"
4. Add redirect URI: `http://localhost:8000/api/auth/callback`
5. Go to "Certificates & secrets" → Create new client secret
6. Replace `{tenant-id}` in URLs with your Azure AD tenant ID

**Tenant Extraction:**
Azure AD includes `tid` (tenant ID) claim in ID tokens.

---

### Auth0

```json
{
  "id": "auth0",
  "name": "Auth0",
  "iconUrl": "https://auth0.com/favicon.ico",
  "issuer": "https://your-domain.auth0.com/",
  "clientId": "your-auth0-client-id",
  "clientSecret": "your-auth0-client-secret",
  "authorizationUrl": "https://your-domain.auth0.com/authorize",
  "tokenUrl": "https://your-domain.auth0.com/oauth/token",
  "userinfoUrl": "https://your-domain.auth0.com/userinfo",
  "scopes": ["openid", "email", "profile"],
  "tenantClaimPath": "org_id",
  "displayOrder": 4
}
```

**Setup Steps:**
1. Log into Auth0 Dashboard
2. Go to Applications → Create Application
3. Choose "Regular Web Application"
4. Configure "Allowed Callback URLs": `http://localhost:8000/api/auth/callback`
5. Copy Domain, Client ID, and Client Secret
6. (Optional) Enable Organizations and add `org_id` claim

**Tenant Extraction:**
Use Auth0 Organizations feature and include `org_id` claim in tokens.

---

## Complete .env Example

```bash
# ============================================
# JWT CONFIGURATION
# ============================================
JWT_SECRET="94wQYpEeyt5llDo5qUdpNheWFcNg2iQb5h5VqC/9mOw="
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
    "iconUrl": "https://www.google.com/favicon.ico",
    "issuer": "https://accounts.google.com",
    "clientId": "your-google-client-id.apps.googleusercontent.com",
    "clientSecret": "your-google-client-secret",
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
    "iconUrl": "https://www.okta.com/favicon.ico",
    "issuer": "https://your-domain.okta.com",
    "clientId": "your-okta-client-id",
    "clientSecret": "your-okta-client-secret",
    "authorizationUrl": "https://your-domain.okta.com/oauth2/v1/authorize",
    "tokenUrl": "https://your-domain.okta.com/oauth2/v1/token",
    "userinfoUrl": "https://your-domain.okta.com/oauth2/v1/userinfo",
    "scopes": ["openid", "email", "profile"],
    "tenantClaimPath": "tenant_id",
    "displayOrder": 2
  }
]'
```

## OIDC Authentication Flow

1. **User clicks "Login with Google"** on frontend
2. **Frontend redirects** to `/api/auth/oidc/google`
3. **Backend generates** authorization URL with state parameter
4. **User redirects** to provider (Google) for authentication
5. **User authenticates** and approves scopes
6. **Provider redirects** back to `/api/auth/callback?code=...&state=...`
7. **Backend exchanges** authorization code for tokens
8. **Backend fetches** user info from provider's userinfo endpoint
9. **Backend extracts** tenant from claims (e.g., `hd` field)
10. **Backend finds or creates** user and tenant in database
11. **Backend generates** JWT and creates session
12. **Backend redirects** to frontend with token: `/?token=<JWT>`
13. **Frontend stores** JWT in localStorage
14. **Subsequent requests** include `Authorization: Bearer <JWT>` header

## Testing OIDC Configuration

### 1. Check Available Methods

```bash
curl http://localhost:8000/api/auth/methods
```

Expected response:
```json
{
  "basicAuth": true,
  "allowRegistration": true,
  "oidcProviders": [
    {
      "id": "google",
      "name": "Google Workspace",
      "iconUrl": "https://www.google.com/favicon.ico"
    }
  ]
}
```

### 2. Initiate OIDC Login

Navigate to:
```
http://localhost:8000/api/auth/oidc/google
```

You should be redirected to Google's login page.

### 3. Monitor Callback

After authenticating with the provider, check backend logs for:
- Token exchange success
- Userinfo retrieval
- Tenant extraction
- User creation/login

## Troubleshooting

### Provider Not Showing Up

**Problem:** OIDC provider not listed in `/api/auth/methods`

**Solutions:**
- Check `.env` file has valid JSON in `OIDC_PROVIDERS`
- Restart backend server after changing `.env`
- Check backend logs for JSON parsing errors
- Validate JSON syntax with a JSON validator

### Invalid Redirect URI

**Problem:** Provider shows "redirect_uri_mismatch" error

**Solutions:**
- Ensure callback URL matches exactly: `http://localhost:8000/api/auth/callback`
- Check for trailing slashes (should NOT have one)
- For production, update to HTTPS URL
- Add redirect URI in provider's app configuration

### Tenant Not Found

**Problem:** Error: "Unable to extract tenant from OIDC claims"

**Solutions:**
- Verify `tenantClaimPath` matches actual claim in token
- Check provider's token customization settings
- Use JWT decoder (jwt.io) to inspect ID token claims
- Ensure users have the required tenant claim (e.g., Google Workspace users, not personal Gmail)

### Token Exchange Failed

**Problem:** Error during authorization code exchange

**Solutions:**
- Verify `clientSecret` is correct
- Check `tokenUrl` is accessible from backend
- Ensure clock is synchronized (OIDC requires accurate timestamps)
- Check provider's app is enabled/active

### Session Errors

**Problem:** "Session expired or revoked" immediately after login

**Solutions:**
- Check database connection is working
- Verify Prisma schema is up to date: `npx prisma migrate dev`
- Check `JWT_SECRET` is set in `.env`
- Ensure session is created before JWT is generated

## Security Considerations

### Production Checklist

- [ ] Use HTTPS for all URLs (`APP_URL`, `FRONTEND_URL`)
- [ ] Store `clientSecret` in secure secret manager (not in `.env`)
- [ ] Rotate `JWT_SECRET` regularly
- [ ] Enable CORS only for trusted domains
- [ ] Validate `state` parameter to prevent CSRF
- [ ] Verify `issuer` claim in ID tokens
- [ ] Set short JWT expiration (7 days default)
- [ ] Implement session cleanup job
- [ ] Enable rate limiting on auth endpoints
- [ ] Monitor for suspicious login patterns

### CORS Configuration

Update CORS settings in `main.ts` for production:

```typescript
app.enableCors({
  origin: process.env.FRONTEND_URL,
  credentials: true,
});
```

## Next Steps

1. **Frontend Implementation:**
   - Create login page with provider cards
   - Implement OIDC callback handler
   - Store JWT in localStorage
   - Add protected routes

2. **Email Verification:**
   - Implement email verification flow
   - Send verification emails for basic auth signups

3. **Password Reset:**
   - Add forgot password endpoint
   - Send password reset emails

4. **2FA (Two-Factor Authentication):**
   - Add TOTP support
   - Require 2FA for admin users

## API Reference

### GET /api/auth/methods
Returns available authentication methods

**Response:**
```json
{
  "basicAuth": true,
  "allowRegistration": true,
  "oidcProviders": [
    {
      "id": "google",
      "name": "Google Workspace",
      "iconUrl": "https://www.google.com/favicon.ico"
    }
  ]
}
```

### GET /api/auth/oidc/:providerId
Initiates OIDC login flow

**Parameters:**
- `providerId`: Provider ID (e.g., "google", "okta")

**Response:**
Redirects to provider's authorization URL

### GET /api/auth/callback
Handles OIDC callback after user authentication

**Query Parameters:**
- `code`: Authorization code from provider
- `state`: CSRF protection token

**Response:**
Redirects to frontend with JWT token: `/?token=<JWT>`

## Support

For issues or questions:
- Check backend logs for detailed error messages
- Review Prisma schema migrations
- Consult provider-specific OIDC documentation
- Verify environment variables are loaded correctly
