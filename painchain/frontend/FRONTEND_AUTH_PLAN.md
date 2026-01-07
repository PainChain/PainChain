# Frontend Authentication Implementation Plan

**Status:** Ready for Implementation
**Backend Status:** ✅ Complete and Tested
**Last Updated:** 2026-01-06

---

## Overview

This document outlines the complete frontend implementation plan for integrating with the PainChain authentication backend. The backend supports:

- ✅ Basic authentication (email/password)
- ✅ User registration
- ✅ OIDC authentication (Google, Okta, Azure, Auth0, etc.)
- ✅ JWT-based sessions with revocation
- ✅ Multi-tenant isolation
- ✅ Session management

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [File Structure](#file-structure)
3. [Implementation Phases](#implementation-phases)
4. [Component Specifications](#component-specifications)
5. [State Management](#state-management)
6. [API Integration](#api-integration)
7. [Routing & Guards](#routing--guards)
8. [User Experience](#user-experience)
9. [Testing Strategy](#testing-strategy)
10. [Security Considerations](#security-considerations)

---

## Architecture Overview

### Authentication Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    User Not Authenticated                    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌──────────────────┐
                    │   Login Page     │
                    │  - Basic Auth    │
                    │  - OIDC Cards    │
                    │  - Register Link │
                    └──────────────────┘
                              │
                    ┌─────────┴─────────┐
                    │                   │
          ┌─────────▼────────┐  ┌──────▼────────┐
          │  Basic Auth Form │  │ OIDC Provider │
          │  (Email/Pass)    │  │  (Redirect)   │
          └─────────┬────────┘  └──────┬────────┘
                    │                   │
                    │         ┌─────────▼──────────┐
                    │         │ Provider Auth Page │
                    │         │   (Google, etc)    │
                    │         └─────────┬──────────┘
                    │                   │
                    │         ┌─────────▼──────────┐
                    │         │  Callback Handler  │
                    │         │  Extract JWT Token │
                    │         └─────────┬──────────┘
                    │                   │
          ┌─────────▼───────────────────▼────────┐
          │      Store JWT in localStorage       │
          │      Load User Profile via API       │
          └─────────┬────────────────────────────┘
                    │
                    ▼
          ┌─────────────────────┐
          │  Authenticated User  │
          │  - Dashboard Access  │
          │  - Protected Routes  │
          └─────────────────────┘
```

### Tech Stack

- **Framework:** React (assumed based on existing codebase)
- **State Management:** React Context API or Zustand
- **HTTP Client:** Axios or Fetch API
- **Routing:** React Router v6
- **Form Handling:** React Hook Form (recommended)
- **Styling:** Tailwind CSS (assumed based on existing codebase)

---

## File Structure

```
frontend/src/
├── features/
│   └── auth/
│       ├── components/
│       │   ├── LoginPage.tsx              # Main login page
│       │   ├── RegisterPage.tsx           # Registration form
│       │   ├── BasicAuthForm.tsx          # Email/password form
│       │   ├── OIDCProviderCard.tsx       # OIDC provider button/card
│       │   ├── OIDCCallback.tsx           # Handle OIDC callback
│       │   ├── ProtectedRoute.tsx         # Route guard component
│       │   ├── UserMenu.tsx               # User dropdown menu
│       │   ├── SessionList.tsx            # Active sessions management
│       │   └── LogoutButton.tsx           # Logout functionality
│       │
│       ├── hooks/
│       │   ├── useAuth.ts                 # Main auth hook
│       │   ├── useLogin.ts                # Login mutation
│       │   ├── useRegister.ts             # Register mutation
│       │   ├── useLogout.ts               # Logout mutation
│       │   └── useAuthMethods.ts          # Fetch available auth methods
│       │
│       ├── context/
│       │   ├── AuthContext.tsx            # Auth state context
│       │   └── AuthProvider.tsx           # Auth state provider
│       │
│       ├── services/
│       │   ├── authApi.ts                 # API service layer
│       │   ├── tokenStorage.ts            # JWT token management
│       │   └── axiosInterceptor.ts        # HTTP interceptor for auth
│       │
│       ├── types/
│       │   └── auth.types.ts              # TypeScript interfaces
│       │
│       └── utils/
│           ├── validateToken.ts           # JWT validation
│           └── redirectAfterLogin.ts      # Post-login navigation
│
├── lib/
│   └── api.ts                             # Base API client configuration
│
└── App.tsx                                # App-level auth setup
```

---

## Implementation Phases

### Phase 1: Foundation (Day 1-2)

**Goal:** Set up authentication infrastructure

#### Tasks:
- [ ] Create auth folder structure
- [ ] Define TypeScript interfaces for auth types
- [ ] Set up AuthContext and AuthProvider
- [ ] Create token storage utility
- [ ] Configure axios interceptor for JWT
- [ ] Create base API service layer
- [ ] Implement `useAuth` hook

**Deliverables:**
- Working AuthContext with state management
- Token storage/retrieval working
- API client configured with auth headers

---

### Phase 2: Basic Authentication (Day 2-3)

**Goal:** Implement email/password login and registration

#### Tasks:
- [ ] Create LoginPage component
- [ ] Create BasicAuthForm component
- [ ] Create RegisterPage component
- [ ] Implement `useLogin` hook
- [ ] Implement `useRegister` hook
- [ ] Add form validation
- [ ] Handle loading/error states
- [ ] Redirect after successful login
- [ ] Display user-friendly error messages

**Deliverables:**
- Working login form
- Working registration form
- Error handling and validation

---

### Phase 3: OIDC Integration (Day 3-4)

**Goal:** Add OIDC provider authentication

#### Tasks:
- [ ] Fetch available auth methods from backend
- [ ] Create OIDCProviderCard component
- [ ] Implement OIDC redirect flow
- [ ] Create OIDCCallback component
- [ ] Extract and store JWT from callback URL
- [ ] Handle OIDC errors
- [ ] Test with multiple providers

**Deliverables:**
- OIDC provider cards on login page
- Working callback handler
- Successful OIDC login flow

---

### Phase 4: Protected Routes & Guards (Day 4-5)

**Goal:** Secure application routes

#### Tasks:
- [ ] Create ProtectedRoute component
- [ ] Implement route guards
- [ ] Add loading state during auth check
- [ ] Redirect unauthenticated users to login
- [ ] Preserve intended destination after login
- [ ] Handle token expiration
- [ ] Add auto-redirect for expired sessions

**Deliverables:**
- Protected routes working
- Automatic redirects for unauthorized access
- Preserved navigation state

---

### Phase 5: User Profile & Session Management (Day 5-6)

**Goal:** Add user profile and session controls

#### Tasks:
- [ ] Create UserMenu component (navbar dropdown)
- [ ] Display user profile info
- [ ] Create SessionList component
- [ ] Implement logout functionality
- [ ] Implement logout from all sessions
- [ ] Add session revocation for individual sessions
- [ ] Update UI after logout

**Deliverables:**
- User menu in navbar
- Session management page
- Working logout

---

### Phase 6: Polish & UX (Day 6-7)

**Goal:** Improve user experience

#### Tasks:
- [ ] Add loading spinners
- [ ] Improve error messages
- [ ] Add success notifications
- [ ] Implement "Remember me" option
- [ ] Add password visibility toggle
- [ ] Add "Forgot password" link (placeholder)
- [ ] Mobile-responsive design
- [ ] Accessibility improvements (ARIA labels, keyboard nav)
- [ ] Add animations/transitions

**Deliverables:**
- Polished, production-ready UI
- Mobile-friendly design
- Accessible components

---

### Phase 7: Testing & Documentation (Day 7-8)

**Goal:** Ensure reliability and maintainability

#### Tasks:
- [ ] Write unit tests for hooks
- [ ] Write component tests
- [ ] Write integration tests for auth flow
- [ ] Test error scenarios
- [ ] Test OIDC flow with real provider
- [ ] Document auth integration
- [ ] Create developer guide
- [ ] Update user documentation

**Deliverables:**
- Test coverage >80%
- Documentation complete

---

## Component Specifications

### 1. LoginPage

**Location:** `src/features/auth/components/LoginPage.tsx`

**Responsibilities:**
- Display login options (basic auth + OIDC providers)
- Fetch available auth methods from backend
- Route to appropriate authentication flow

**Props:** None

**State:**
- `authMethods` - Available authentication methods
- `loading` - Whether auth methods are loading
- `error` - Error fetching auth methods

**UI Layout:**
```
┌─────────────────────────────────────┐
│         PainChain Logo              │
│                                     │
│      Sign in to your account        │
│                                     │
│  ┌───────────────────────────────┐ │
│  │  Email                         │ │
│  │  [email input]                │ │
│  │                                │ │
│  │  Password                      │ │
│  │  [password input]              │ │
│  │                                │ │
│  │  [Sign In Button]              │ │
│  └───────────────────────────────┘ │
│                                     │
│        ─── or continue with ───     │
│                                     │
│  ┌──────┐  ┌──────┐  ┌──────┐     │
│  │Google│  │ Okta │  │Azure │     │
│  └──────┘  └──────┘  └──────┘     │
│                                     │
│  Don't have an account? Sign up    │
└─────────────────────────────────────┘
```

**Example Code:**
```tsx
export const LoginPage: React.FC = () => {
  const { data: authMethods, isLoading } = useAuthMethods();

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          <h2 className="text-3xl font-bold">Sign in to PainChain</h2>
        </div>

        {/* Basic Auth Form */}
        {authMethods?.basicAuth && <BasicAuthForm />}

        {/* OIDC Providers */}
        {authMethods?.oidcProviders && authMethods.oidcProviders.length > 0 && (
          <div className="mt-6">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-300" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-white text-gray-500">
                  Or continue with
                </span>
              </div>
            </div>

            <div className="mt-6 grid grid-cols-3 gap-3">
              {authMethods.oidcProviders.map((provider) => (
                <OIDCProviderCard key={provider.id} provider={provider} />
              ))}
            </div>
          </div>
        )}

        {/* Register Link */}
        {authMethods?.allowRegistration && (
          <div className="text-center text-sm">
            <Link to="/register" className="text-blue-600 hover:text-blue-500">
              Don't have an account? Sign up
            </Link>
          </div>
        )}
      </div>
    </div>
  );
};
```

---

### 2. BasicAuthForm

**Location:** `src/features/auth/components/BasicAuthForm.tsx`

**Responsibilities:**
- Collect email and password
- Validate inputs
- Submit to login endpoint
- Handle errors and loading states

**Props:** None

**State:**
- `email` - User's email
- `password` - User's password
- `showPassword` - Toggle password visibility
- `errors` - Form validation errors

**Example Code:**
```tsx
export const BasicAuthForm: React.FC = () => {
  const { login, isLoading, error } = useLogin();
  const { register, handleSubmit, formState: { errors } } = useForm();
  const [showPassword, setShowPassword] = useState(false);

  const onSubmit = async (data: { email: string; password: string }) => {
    await login(data);
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
          {error.message}
        </div>
      )}

      <div>
        <label htmlFor="email" className="block text-sm font-medium text-gray-700">
          Email address
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          {...register('email', {
            required: 'Email is required',
            pattern: {
              value: /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i,
              message: 'Invalid email address'
            }
          })}
          className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
        />
        {errors.email && (
          <p className="mt-1 text-sm text-red-600">{errors.email.message}</p>
        )}
      </div>

      <div>
        <label htmlFor="password" className="block text-sm font-medium text-gray-700">
          Password
        </label>
        <div className="relative">
          <input
            id="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            {...register('password', { required: 'Password is required' })}
            className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute inset-y-0 right-0 pr-3 flex items-center"
          >
            {showPassword ? <EyeSlashIcon /> : <EyeIcon />}
          </button>
        </div>
        {errors.password && (
          <p className="mt-1 text-sm text-red-600">{errors.password.message}</p>
        )}
      </div>

      <button
        type="submit"
        disabled={isLoading}
        className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
      >
        {isLoading ? 'Signing in...' : 'Sign in'}
      </button>
    </form>
  );
};
```

---

### 3. OIDCProviderCard

**Location:** `src/features/auth/components/OIDCProviderCard.tsx`

**Responsibilities:**
- Display provider name and logo
- Redirect to OIDC flow on click

**Props:**
```typescript
interface Props {
  provider: {
    id: string;
    name: string;
    iconUrl?: string;
  };
}
```

**Example Code:**
```tsx
export const OIDCProviderCard: React.FC<Props> = ({ provider }) => {
  const handleClick = () => {
    window.location.href = `/api/auth/oidc/${provider.id}`;
  };

  return (
    <button
      onClick={handleClick}
      className="w-full inline-flex justify-center py-2 px-4 border border-gray-300 rounded-md shadow-sm bg-white text-sm font-medium text-gray-500 hover:bg-gray-50"
    >
      {provider.iconUrl && (
        <img src={provider.iconUrl} alt={provider.name} className="h-5 w-5" />
      )}
      <span className="ml-2">{provider.name}</span>
    </button>
  );
};
```

---

### 4. OIDCCallback

**Location:** `src/features/auth/components/OIDCCallback.tsx`

**Responsibilities:**
- Extract JWT token from URL query parameter
- Store token in localStorage
- Load user profile
- Redirect to dashboard or intended page

**Props:** None

**State:**
- `loading` - Whether processing callback
- `error` - Error during callback processing

**Example Code:**
```tsx
export const OIDCCallback: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { setToken, loadUser } = useAuth();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const processCallback = async () => {
      const params = new URLSearchParams(location.search);
      const token = params.get('token');
      const errorParam = params.get('error');

      if (errorParam) {
        setError(decodeURIComponent(errorParam));
        return;
      }

      if (!token) {
        setError('No authentication token received');
        return;
      }

      try {
        // Store token
        setToken(token);

        // Load user profile
        await loadUser();

        // Redirect to intended page or dashboard
        const intendedPath = sessionStorage.getItem('intendedPath') || '/';
        sessionStorage.removeItem('intendedPath');
        navigate(intendedPath);
      } catch (err) {
        setError('Failed to complete authentication');
      }
    };

    processCallback();
  }, [location, navigate, setToken, loadUser]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-red-600 mb-4">
            Authentication Failed
          </h2>
          <p className="text-gray-600 mb-4">{error}</p>
          <Link to="/login" className="text-blue-600 hover:text-blue-500">
            Back to login
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4" />
        <p className="text-gray-600">Completing sign in...</p>
      </div>
    </div>
  );
};
```

---

### 5. ProtectedRoute

**Location:** `src/features/auth/components/ProtectedRoute.tsx`

**Responsibilities:**
- Check if user is authenticated
- Redirect to login if not authenticated
- Show loading state while checking auth
- Preserve intended destination

**Props:**
```typescript
interface Props {
  children: React.ReactNode;
  requireRole?: string;
}
```

**Example Code:**
```tsx
export const ProtectedRoute: React.FC<Props> = ({ children, requireRole }) => {
  const { user, isLoading } = useAuth();
  const location = useLocation();

  // Still loading auth state
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
      </div>
    );
  }

  // Not authenticated
  if (!user) {
    // Store intended destination
    sessionStorage.setItem('intendedPath', location.pathname);
    return <Navigate to="/login" replace />;
  }

  // Role check
  if (requireRole && user.role !== requireRole) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-red-600 mb-4">
            Access Denied
          </h2>
          <p className="text-gray-600">
            You don't have permission to access this page.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};
```

---

### 6. UserMenu

**Location:** `src/features/auth/components/UserMenu.tsx`

**Responsibilities:**
- Display user avatar and name
- Show dropdown menu with profile/settings/logout
- Handle logout

**Props:** None

**Example Code:**
```tsx
export const UserMenu: React.FC = () => {
  const { user, logout } = useAuth();
  const [isOpen, setIsOpen] = useState(false);

  if (!user) return null;

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center space-x-3 focus:outline-none"
      >
        {user.avatarUrl ? (
          <img
            src={user.avatarUrl}
            alt={user.displayName}
            className="h-8 w-8 rounded-full"
          />
        ) : (
          <div className="h-8 w-8 rounded-full bg-blue-600 flex items-center justify-center text-white font-semibold">
            {user.displayName?.charAt(0).toUpperCase()}
          </div>
        )}
        <span className="text-sm font-medium">{user.displayName}</span>
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-48 rounded-md shadow-lg bg-white ring-1 ring-black ring-opacity-5">
          <div className="py-1">
            <Link
              to="/profile"
              className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
            >
              Your Profile
            </Link>
            <Link
              to="/sessions"
              className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
            >
              Active Sessions
            </Link>
            <button
              onClick={() => logout()}
              className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
            >
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
```

---

## State Management

### AuthContext Structure

**Location:** `src/features/auth/context/AuthContext.tsx`

```typescript
interface AuthState {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  register: (data: RegisterDto) => Promise<void>;
  logout: () => Promise<void>;
  logoutAll: () => Promise<void>;
  loadUser: () => Promise<void>;
  setToken: (token: string) => void;
}

interface User {
  id: string;
  email: string;
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
  role: string;
  tenantId: string;
  tenant: {
    id: string;
    name: string;
    slug: string;
  };
}
```

**Example Implementation:**
```typescript
export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<AuthState>({
    user: null,
    token: localStorage.getItem('auth_token'),
    isLoading: true,
    isAuthenticated: false,
  });

  // Load user on mount if token exists
  useEffect(() => {
    if (state.token) {
      loadUser();
    } else {
      setState(prev => ({ ...prev, isLoading: false }));
    }
  }, []);

  const loadUser = async () => {
    try {
      const response = await authApi.getMe();
      setState(prev => ({
        ...prev,
        user: response.data,
        isAuthenticated: true,
        isLoading: false,
      }));
    } catch (error) {
      // Token invalid, clear it
      localStorage.removeItem('auth_token');
      setState({
        user: null,
        token: null,
        isLoading: false,
        isAuthenticated: false,
      });
    }
  };

  const login = async (email: string, password: string) => {
    const response = await authApi.login({ email, password });
    const { access_token, user } = response.data;

    localStorage.setItem('auth_token', access_token);
    setState({
      user,
      token: access_token,
      isLoading: false,
      isAuthenticated: true,
    });
  };

  const logout = async () => {
    try {
      await authApi.logout();
    } catch (error) {
      // Continue with local logout even if API fails
    }

    localStorage.removeItem('auth_token');
    setState({
      user: null,
      token: null,
      isLoading: false,
      isAuthenticated: false,
    });
  };

  const setToken = (token: string) => {
    localStorage.setItem('auth_token', token);
    setState(prev => ({ ...prev, token }));
  };

  return (
    <AuthContext.Provider
      value={{
        ...state,
        login,
        register,
        logout,
        logoutAll,
        loadUser,
        setToken,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
```

---

## API Integration

### API Service Layer

**Location:** `src/features/auth/services/authApi.ts`

```typescript
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api';

export const authApi = {
  // Fetch available auth methods
  getAuthMethods: async () => {
    return axios.get(`${API_URL}/auth/methods`);
  },

  // Login with email/password
  login: async (credentials: { email: string; password: string }) => {
    return axios.post(`${API_URL}/auth/login`, credentials);
  },

  // Register new user
  register: async (data: {
    email: string;
    password: string;
    firstName?: string;
    lastName?: string;
    displayName?: string;
    tenantId?: string;
  }) => {
    return axios.post(`${API_URL}/auth/register`, data);
  },

  // Get current user profile
  getMe: async () => {
    const token = localStorage.getItem('auth_token');
    return axios.get(`${API_URL}/auth/me`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
  },

  // Logout current session
  logout: async () => {
    const token = localStorage.getItem('auth_token');
    return axios.post(`${API_URL}/auth/logout`, null, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
  },

  // Logout all sessions
  logoutAll: async () => {
    const token = localStorage.getItem('auth_token');
    return axios.post(`${API_URL}/auth/logout-all`, null, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
  },

  // Get active sessions
  getSessions: async () => {
    const token = localStorage.getItem('auth_token');
    return axios.get(`${API_URL}/auth/sessions`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
  },

  // Revoke specific session
  revokeSession: async (sessionId: string) => {
    const token = localStorage.getItem('auth_token');
    return axios.delete(`${API_URL}/auth/sessions/${sessionId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
  },
};
```

---

### Axios Interceptor

**Location:** `src/features/auth/services/axiosInterceptor.ts`

```typescript
import axios from 'axios';

// Add request interceptor to include auth token
axios.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('auth_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Add response interceptor to handle 401 errors
axios.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Token expired or invalid
      localStorage.removeItem('auth_token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);
```

---

## Routing & Guards

### App Router Configuration

**Location:** `src/App.tsx`

```tsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './features/auth/context/AuthProvider';
import { ProtectedRoute } from './features/auth/components/ProtectedRoute';
import { LoginPage } from './features/auth/components/LoginPage';
import { RegisterPage } from './features/auth/components/RegisterPage';
import { OIDCCallback } from './features/auth/components/OIDCCallback';

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Public routes */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/auth/callback" element={<OIDCCallback />} />

          {/* Protected routes */}
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Dashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/profile"
            element={
              <ProtectedRoute>
                <ProfilePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/sessions"
            element={
              <ProtectedRoute>
                <SessionsPage />
              </ProtectedRoute>
            }
          />

          {/* Admin-only routes */}
          <Route
            path="/admin"
            element={
              <ProtectedRoute requireRole="owner">
                <AdminPage />
              </ProtectedRoute>
            }
          />

          {/* Catch all */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
```

---

## User Experience

### Loading States

1. **Initial Auth Check**
   - Show full-page spinner while checking if user is authenticated
   - Avoid flash of login page for authenticated users

2. **Login/Register Forms**
   - Disable submit button during submission
   - Show loading spinner on button
   - Clear errors when user starts typing

3. **OIDC Redirect**
   - Show "Redirecting to [Provider]..." message
   - Smooth transition to provider's page

4. **Callback Processing**
   - Show "Completing sign in..." spinner
   - Handle errors gracefully with clear messages

### Error Handling

1. **Form Validation Errors**
   - Show inline errors below fields
   - Highlight invalid fields with red border
   - Clear errors on input change

2. **API Errors**
   - Display user-friendly messages
   - Map backend error codes to readable messages
   - Provide actionable next steps

3. **Network Errors**
   - Show "Unable to connect" message
   - Provide retry button
   - Indicate offline status

### Success Feedback

1. **Registration Success**
   - Show success message
   - Auto-redirect to dashboard after 2 seconds
   - Or show email verification prompt

2. **Login Success**
   - Smooth redirect to intended page
   - No flash or jarring transitions

3. **Logout**
   - Show "Logged out successfully" toast
   - Immediate redirect to login page

---

## Testing Strategy

### Unit Tests

Test individual hooks and utilities:

```typescript
// Example: useLogin.test.ts
describe('useLogin', () => {
  it('should login successfully with valid credentials', async () => {
    // Test implementation
  });

  it('should handle invalid credentials error', async () => {
    // Test implementation
  });

  it('should store token in localStorage on success', async () => {
    // Test implementation
  });
});
```

### Component Tests

Test component rendering and interactions:

```typescript
// Example: BasicAuthForm.test.tsx
describe('BasicAuthForm', () => {
  it('should render email and password inputs', () => {
    // Test implementation
  });

  it('should show validation errors for invalid email', async () => {
    // Test implementation
  });

  it('should call login on form submit', async () => {
    // Test implementation
  });
});
```

### Integration Tests

Test complete authentication flows:

```typescript
// Example: auth-flow.test.tsx
describe('Authentication Flow', () => {
  it('should complete login flow from login page to dashboard', async () => {
    // 1. Render app
    // 2. Navigate to login
    // 3. Fill form
    // 4. Submit
    // 5. Verify redirect to dashboard
    // 6. Verify user is shown in navbar
  });

  it('should handle OIDC callback and redirect', async () => {
    // Test OIDC callback flow
  });
});
```

---

## Security Considerations

### Token Storage

- ✅ Store JWT in `localStorage` (acceptable for this use case)
- ✅ Alternative: `sessionStorage` for more security (lost on tab close)
- ❌ Avoid storing in cookies (CSRF risk without proper setup)

### CSRF Protection

- ✅ OIDC `state` parameter validated by backend
- ✅ JWT tokens in Authorization header (not cookies)

### XSS Protection

- ✅ React escapes output by default
- ✅ Validate and sanitize user inputs
- ❌ Never use `dangerouslySetInnerHTML` with user content

### Token Expiration

- ✅ Handle 401 responses globally
- ✅ Clear token and redirect to login
- ✅ Show "Session expired" message

### Password Security

- ✅ Validate password strength on frontend
- ✅ Use `type="password"` inputs
- ✅ Add password visibility toggle
- ✅ Never log or expose passwords

### HTTPS

- ✅ Use HTTPS in production
- ✅ Update `APP_URL` and `FRONTEND_URL` to HTTPS
- ✅ Set `Secure` flag on cookies (if using cookies)

---

## Environment Variables

Create `.env` file in frontend:

```bash
# API Configuration
VITE_API_URL=http://localhost:8000/api

# Feature Flags
VITE_ENABLE_REGISTRATION=true
VITE_ENABLE_OIDC=true

# Environment
VITE_ENV=development
```

For production:

```bash
VITE_API_URL=https://api.painchain.com/api
VITE_ENV=production
```

---

## Next Steps After Completion

1. **Email Verification**
   - Add email verification flow
   - Send verification emails
   - Verify email before full access

2. **Password Reset**
   - Implement "Forgot Password" flow
   - Send reset emails
   - Create password reset page

3. **Two-Factor Authentication (2FA)**
   - Add TOTP support
   - QR code setup
   - Backup codes

4. **User Preferences**
   - Theme selection (dark mode)
   - Language preferences
   - Notification settings

5. **Audit Logs**
   - Show login history
   - Display IP addresses and devices
   - Alert on suspicious activity

6. **Social Login**
   - Add GitHub, GitLab OAuth
   - LinkedIn authentication
   - Custom SAML providers

---

## Reference Links

- **Backend API Documentation:** `painchain/backend/src/auth/OIDC_CONFIGURATION.md`
- **Backend Auth Controllers:** `painchain/backend/src/auth/auth.controller.ts`
- **Backend Auth Service:** `painchain/backend/src/auth/auth.service.ts`
- **JWT Strategy:** `painchain/backend/src/auth/strategies/jwt.strategy.ts`

---

## Success Criteria

The frontend auth implementation is complete when:

- [ ] Users can register with email/password
- [ ] Users can login with email/password
- [ ] Users can login with OIDC providers
- [ ] Protected routes redirect unauthenticated users
- [ ] User profile is displayed in navbar
- [ ] Users can view active sessions
- [ ] Users can logout (single session)
- [ ] Users can logout all sessions
- [ ] Token expiration is handled gracefully
- [ ] Errors are displayed clearly
- [ ] Loading states are shown appropriately
- [ ] Mobile responsive design
- [ ] Accessibility requirements met
- [ ] Test coverage >80%

---

**End of Frontend Authentication Plan**
