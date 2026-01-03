# PainChain Kubernetes Connector

The Kubernetes connector watches Kubernetes clusters in real-time for resource changes, transforming them into PainChain events and forwarding them to the backend.

## Features

- **Real-time watching** - Uses Kubernetes watch API for instant event notifications (not polling)
- **Multi-cluster support** - Monitor multiple Kubernetes clusters from a single integration
- **Comprehensive resource coverage** - Tracks 15+ Kubernetes resource types including Helm releases
- **Namespace filtering** - Watch all namespaces or filter to specific ones
- **Intelligent event filtering** - Only captures significant events (failures, restarts, deletions, etc.)
- **Multi-tenant aware** - Works seamlessly with both free and SaaS tiers
- **Auto-reconnection** - Automatically restarts watches when connections drop
- **Production & development modes** - Supports both token-based auth and kubeconfig contexts
- **Helm support** - Automatically detects and tracks Helm v3 releases

## Supported Resource Types

### Workloads
| Resource Type | Events Tracked | Scope |
|---------------|----------------|-------|
| **Pods** | Created, Deleted, CrashLoopBackOff, ImagePullErrors, Restarts | Namespaced |
| **Deployments** | Created, Updated, Deleted, Scaling | Namespaced |
| **StatefulSets** | Created, Updated, Deleted | Namespaced |
| **DaemonSets** | Created, Updated, Deleted | Namespaced |
| **Jobs** | Created, Running, Succeeded, Failed | Namespaced |
| **CronJobs** | Created, Updated, Deleted, Schedule changes | Namespaced |

### Configuration & Storage
| Resource Type | Events Tracked | Scope | Notes |
|---------------|----------------|-------|-------|
| **ConfigMaps** | Created, Updated, Deleted | Namespaced | Captures key names only |
| **Secrets** | Created, Updated, Deleted | Namespaced | Metadata only, never values |
| **PersistentVolumes** | Created, Bound, Released, Deleted | Cluster-wide | |
| **PersistentVolumeClaims** | Created, Bound, Lost, Deleted | Namespaced | |
| **StorageClasses** | Created, Updated, Deleted | Cluster-wide | |

### Networking
| Resource Type | Events Tracked | Scope |
|---------------|----------------|-------|
| **Services** | Created, Updated, Deleted | Namespaced |
| **Ingresses** | Created, Updated, Deleted | Namespaced |
| **IngressClasses** | Created, Updated, Deleted | Cluster-wide |

### Application Management
| Resource Type | Events Tracked | Scope | Notes |
|---------------|----------------|-------|-------|
| **Helm Releases** | Installed, Upgraded, Rolled back, Uninstalled | Namespaced | Detected from Secrets |
| **Events** | Warning events, Important Normal events | Namespaced | K8s Event objects |

## Quick Start

### 1. Start the Connector

The connector runs as a service and watches Kubernetes clusters based on backend configuration:

```bash
# Using Docker Compose (recommended)
docker-compose up -d kubernetes-connector

# Or standalone Docker
docker run \
  -e BACKEND_API_URL=http://backend:8000/api \
  painchain-kubernetes-connector
```

### 2. Get Kubernetes Access Credentials

You'll need credentials to access your Kubernetes cluster. There are two methods:

#### Method A: Service Account Token (Production - Recommended)

1. Create a ServiceAccount in your cluster:

```bash
kubectl create serviceaccount painchain-connector -n default
```

2. Create a ClusterRole with read permissions:

```bash
kubectl apply -f - <<EOF
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: painchain-reader
rules:
# Core resources
- apiGroups: [""]
  resources: ["pods", "services", "events", "namespaces", "configmaps", "secrets", "persistentvolumes", "persistentvolumeclaims"]
  verbs: ["get", "list", "watch"]
# Apps resources
- apiGroups: ["apps"]
  resources: ["deployments", "statefulsets", "daemonsets"]
  verbs: ["get", "list", "watch"]
# Batch resources
- apiGroups: ["batch"]
  resources: ["jobs", "cronjobs"]
  verbs: ["get", "list", "watch"]
# Networking resources
- apiGroups: ["networking.k8s.io"]
  resources: ["ingresses", "ingressclasses"]
  verbs: ["get", "list", "watch"]
# Storage resources
- apiGroups: ["storage.k8s.io"]
  resources: ["storageclasses"]
  verbs: ["get", "list", "watch"]
EOF
```

3. Bind the role to the ServiceAccount:

```bash
kubectl create clusterrolebinding painchain-reader-binding \
  --clusterrole=painchain-reader \
  --serviceaccount=default:painchain-connector
```

4. Get the token and cluster info:

```bash
# Get the token
kubectl create token painchain-connector -n default

# Get the API server URL
kubectl config view --minify -o jsonpath='{.clusters[0].cluster.server}'

# Get the CA certificate (base64 encoded)
kubectl config view --raw --minify -o jsonpath='{.clusters[0].cluster.certificate-authority-data}'
```

#### Method B: Kubeconfig Context (Development)

For local development, you can use an existing kubeconfig context:

```bash
# List available contexts
kubectl config get-contexts

# Use the context name in your integration config
```

### 3. Register an Integration via API

Create integrations through the PainChain backend API:

#### Production Configuration (Token-Based)

**With CA certificate (most secure):**
```bash
curl -X POST http://localhost:8000/api/integrations \
  -H "Content-Type: application/json" \
  -d '{
    "type": "kubernetes",
    "name": "Production Cluster",
    "config": {
      "clusters": [
        {
          "name": "prod-cluster",
          "server": "https://kubernetes.example.com:6443",
          "token": "eyJhbGciOiJSUzI1NiIsImtpZCI6Ii...",
          "certificate": "LS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0tLS0t..."
        }
      ]
    }
  }'
```

**Without CA certificate (skip TLS verification - less secure):**
```bash
curl -X POST http://localhost:8000/api/integrations \
  -H "Content-Type: application/json" \
  -d '{
    "type": "kubernetes",
    "name": "Production Cluster",
    "config": {
      "clusters": [
        {
          "name": "prod-cluster",
          "server": "https://kubernetes.example.com:6443",
          "token": "eyJhbGciOiJSUzI1NiIsImtpZCI6Ii...",
          "skipTLSVerify": true
        }
      ]
    }
  }'
```

#### Development Configuration (Kubeconfig Context)

**Note:** Kubeconfig context mode only works when the connector runs directly on your host machine (not in Docker), as it needs access to your local `~/.kube/config` file.

```bash
curl -X POST http://localhost:8000/api/integrations \
  -H "Content-Type: application/json" \
  -d '{
    "type": "kubernetes",
    "name": "Local Development",
    "config": {
      "clusters": [
        {
          "name": "minikube",
          "context": "minikube"
        }
      ]
    }
  }'
```

#### k3d Local Development (Docker)

For k3d clusters running in Docker, you need to use token-based auth and connect the connector to the k3d network:

**Step 1: Create service account and RBAC**
```bash
# Create service account (if not exists)
kubectl create serviceaccount painchain-connector -n default

# Create ClusterRole with read permissions
cat <<EOF | kubectl apply -f -
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: painchain-reader
rules:
- apiGroups: [""]
  resources: ["pods", "services", "events", "namespaces"]
  verbs: ["get", "list", "watch"]
- apiGroups: ["apps"]
  resources: ["deployments", "statefulsets", "daemonsets"]
  verbs: ["get", "list", "watch"]
EOF

# Bind role to service account
cat <<EOF | kubectl apply -f -
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: painchain-reader-binding
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: painchain-reader
subjects:
- kind: ServiceAccount
  name: painchain-connector
  namespace: default
EOF
```

**Step 2: Get credentials**
```bash
# Get token
TOKEN=$(kubectl create token painchain-connector -n default --duration=876000h)

# Get CA certificate
CA_CERT=$(kubectl config view --raw --minify -o jsonpath='{.clusters[0].cluster.certificate-authority-data}')

# Get k3d cluster name
CLUSTER_NAME=$(kubectl config current-context | sed 's/k3d-//')
```

**Step 3: Connect connector to k3d network**
```bash
# Find your k3d network
docker network ls | grep k3d

# Connect the connector container to k3d network
docker network connect k3d-${CLUSTER_NAME} painchain-kubernetes-connector

# Restart connector
docker restart painchain-kubernetes-connector
```

**Step 4: Create integration**
```bash
curl -X POST http://localhost:8000/api/integrations \
  -H "Content-Type: application/json" \
  -d "{
    \"type\": \"kubernetes\",
    \"name\": \"Local k3d Development\",
    \"config\": {
      \"name\": \"Local k3d Development\",
      \"tags\": [\"development\", \"k3d\"],
      \"clusters\": [
        {
          \"name\": \"k3d-${CLUSTER_NAME}\",
          \"server\": \"https://k3d-${CLUSTER_NAME}-server-0:6443\",
          \"token\": \"$TOKEN\",
          \"certificate\": \"$CA_CERT\"
        }
      ]
    }
  }"
```

#### Multi-Cluster Configuration

```bash
curl -X POST http://localhost:8000/api/integrations \
  -H "Content-Type: application/json" \
  -d '{
    "type": "kubernetes",
    "name": "All Clusters",
    "config": {
      "clusters": [
        {
          "name": "prod-us-east",
          "server": "https://prod-us-east.k8s.example.com",
          "token": "eyJhbGc..."
        },
        {
          "name": "prod-eu-west",
          "server": "https://prod-eu-west.k8s.example.com",
          "token": "eyJhbGc..."
        }
      ],
      "resources": {
        "pods": true,
        "deployments": true,
        "events": true
      }
    }
  }'
```

**For multi-tenant (SaaS) deployments**, include the tenant ID:

```bash
curl -X POST http://localhost:8000/api/integrations \
  -H "Content-Type: application/json" \
  -H "x-tenant-id: your-tenant-id" \
  -d '{
    "type": "kubernetes",
    "name": "Production Cluster",
    "config": { ... }
  }'
```

### 4. How It Works

**On startup, the connector:**
1. Connects to the PainChain backend
2. Fetches all active Kubernetes integrations from `/api/integrations?type=kubernetes`
3. Establishes watch connections to each cluster for configured resources
4. Re-fetches integrations every 60 seconds to detect new clusters
5. Automatically restarts watches if connections drop

**The backend API is the single source of truth** - all integration configuration is managed through the API (and eventually the UI). The connector simply fetches and executes the configuration.

## Configuration

### Integration Configuration Schema

```typescript
{
  "type": "kubernetes",
  "name": "My Cluster",
  "config": {
    "clusters": [                       // Array of clusters to watch
      {
        "name": "cluster-name",         // Display name for the cluster

        // Production: Token-based authentication
        "server": "https://...",        // API server URL
        "token": "eyJhbGc...",          // Bearer token
        "certificate": "LS0tLS1C...",   // CA cert (base64, optional)
        "skipTLSVerify": false,         // Skip TLS verification (not recommended)

        // Development: Kubeconfig context
        "context": "minikube"           // OR use local kubeconfig context
      }
    ],
    "namespaces": ["default", "prod"],  // Optional: filter to specific namespaces
    "resources": {                      // Optional: which resources to watch
      "pods": true,
      "deployments": true,
      "services": true,
      "statefulsets": true,
      "daemonsets": true,
      "events": true
    }
  }
}
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `BACKEND_API_URL` | PainChain backend API URL | `http://painchain-app:8000/api` |

### Cluster Configuration Options

**Production (Token-Based Auth)**:
- `name`: Cluster display name (required)
- `server`: Kubernetes API server URL (required)
- `token`: ServiceAccount bearer token (required)
- `certificate`: Base64-encoded CA certificate (optional - provide this OR set skipTLSVerify)
- `skipTLSVerify`: Skip TLS verification (optional, default: false) - set to true if not providing certificate

**Development (Kubeconfig Context)**:
- `name`: Cluster display name (required)
- `context`: Name of kubeconfig context to use (required)

### Namespace Filtering

**Watch all namespaces** (default):
```json
{
  "namespaces": []
}
```

**Watch specific namespaces**:
```json
{
  "namespaces": ["default", "production", "staging"]
}
```

Note: Currently only the first namespace in the array is used. Multi-namespace support is coming soon.

### Resource Selection

By default, all resources are watched. You can selectively disable resources:

```json
{
  "resources": {
    "pods": true,
    "deployments": true,
    "services": false,      // Disable service watching
    "statefulsets": true,
    "daemonsets": false,    // Disable daemonset watching
    "events": true
  }
}
```

## Architecture

The Kubernetes connector uses a watch-based architecture for real-time event streaming:

1. **Startup**: Connector connects to PainChain backend
2. **Integration Fetching**: Queries `/api/integrations?type=kubernetes` for all integrations
3. **Watch Establishment**: For each cluster:
   - Authenticates using token or kubeconfig context
   - Tests connection to cluster
   - Establishes watch streams for each enabled resource type
4. **Event Processing**:
   - Receives resource change events in real-time from Kubernetes API
   - Filters for significant events only
   - Transforms to PainChain event format
5. **Forwarding**: Posts events to backend via `/api/events` with proper tenant isolation
6. **Auto-Recovery**: Automatically restarts watches if connections drop
7. **Re-sync**: Re-fetches integrations every 60 seconds to detect configuration changes

```
┌─────────────────────┐
│ Kubernetes Cluster  │
│  - Watch API        │
│  - Resource Events  │
└──────────┬──────────┘
           │ Real-time watch
           ↓
┌─────────────────────┐
│ K8s Connector       │
│  - Watch manager    │
│  - Filter events    │
│  - Transform        │
│  - Auto-reconnect   │
└──────────┬──────────┘
           │ POST /api/events
           ↓
┌─────────────────────┐
│ PainChain Backend   │
│  - Deduplicate      │
└─────────────────────┘
```

## Events Received

### Pod Events

Captures significant pod lifecycle events:

**Tracked events:**
- Pod created (when running)
- Pod deleted
- CrashLoopBackOff
- ImagePullBackOff / ErrImagePull
- Container terminations with non-zero exit codes
- Container restarts

**Event data includes:**
- Pod name and namespace
- Phase (Running, Pending, Failed, etc.)
- Node name
- Container statuses (ready, restart count, state)
- Labels
- Conditions

**Not tracked:**
- Routine pod updates without issues
- Pending pods

### Deployment Events

Tracks all deployment changes:

**Tracked events:**
- Deployment created
- Deployment updated
- Deployment deleted

**Event data includes:**
- Deployment name and namespace
- Replica counts (desired, ready, available)
- Container images
- Deployment strategy
- Labels

### Service Events

Tracks service lifecycle:

**Tracked events:**
- Service created
- Service deleted

**Event data includes:**
- Service name and namespace
- Service type (ClusterIP, NodePort, LoadBalancer)
- Cluster IP
- Ports configuration
- Labels

**Not tracked:**
- Service modifications (only creation and deletion)

### StatefulSet Events

Tracks all statefulset changes:

**Tracked events:**
- StatefulSet created
- StatefulSet updated
- StatefulSet deleted

**Event data includes:**
- StatefulSet name and namespace
- Replica counts (desired, ready, current)
- Labels

### DaemonSet Events

Tracks all daemonset changes:

**Tracked events:**
- DaemonSet created
- DaemonSet updated
- DaemonSet deleted

**Event data includes:**
- DaemonSet name and namespace
- Scheduling stats (desired, current, ready)
- Labels

### Kubernetes Event Objects

Captures important cluster events:

**Tracked events:**
- All Warning events
- Important Normal events:
  - Container image pulling/pulled
  - Container created/started/killed
  - Pod scheduling events
  - Replica scaling
  - Health check failures
  - BackOff events

**Event data includes:**
- Event reason and message
- Event type (Warning/Normal)
- Event count
- Involved object (Pod, Deployment, etc.)

**Not tracked:**
- Routine Normal events without operational significance

## Multi-Tenant Support

The connector seamlessly handles both deployment models:

### Free Tier (Self-Hosted)
- `tenantId` is `null` for all integrations
- Single-tenant mode
- All events belong to the single user

### SaaS Tier (Managed)
- Each integration has a unique `tenantId`
- Connector watches ALL tenants' clusters from shared instance
- Events are tagged with correct `tenantId` for isolation
- Users only see their own events via backend API

## Development

### Local Development Setup

```bash
# Install dependencies
npm install

# Set environment variables
export BACKEND_API_URL=http://localhost:8000/api

# Run in development mode
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
docker build -t painchain-kubernetes-connector .

# Run container (with kubeconfig mounted for dev)
docker run \
  -e BACKEND_API_URL=http://backend:8000/api \
  -v ~/.kube/config:/root/.kube/config \
  painchain-kubernetes-connector
```

### Testing with Minikube

**Note:** Only works when connector runs on host (not in Docker).

```bash
# Start minikube
minikube start

# Get the context name
kubectl config current-context

# Use the context in your integration config
{
  "clusters": [{"name": "local", "context": "minikube"}]
}
```

### Testing with k3d

```bash
# Start k3d cluster
k3d cluster create my-cluster

# Follow the "k3d Local Development" setup above
# Key points:
# - Use token-based auth (not kubeconfig context)
# - Connect connector to k3d Docker network
# - Use internal Docker hostname for server URL
```

## Troubleshooting

### "Connection test failed" errors

**Problem**: Cannot connect to Kubernetes cluster
**Solution**:
- Verify API server URL is correct and accessible
- Check that the token is valid and hasn't expired
- Ensure the connector can reach the cluster (network/firewall)
- For self-signed certificates, provide the CA certificate or use `skipTLSVerify: true` (not recommended for production)
- **For k3d/kind clusters**: Ensure connector container is on the same Docker network as the cluster
- **For local clusters**: Use internal Docker hostname (e.g., `k3d-cluster-server-0:6443`), not `localhost` or `0.0.0.0`

### "Forbidden" or permission errors

**Problem**: `403 Forbidden` errors when watching resources
**Solution**:
- Verify the ServiceAccount has appropriate RBAC permissions
- Ensure ClusterRole includes `get`, `list`, and `watch` verbs
- Check ClusterRoleBinding is correctly configured
- For namespace-scoped permissions, use Role + RoleBinding instead

### Watch connections dropping

**Problem**: Watches disconnect frequently
**Solution**:
- This is normal - the connector automatically restarts watches
- Check cluster API server logs for connection issues
- Verify network stability between connector and cluster
- Consider increasing API server timeout settings if needed

### No events appearing

**Problem**: Events not showing in PainChain
**Solution**:
- Check connector logs for errors
- Verify resource types are enabled in config (`resources` field)
- Ensure events are actually happening in the cluster (trigger a pod restart)
- Check backend API connectivity
- Verify namespace filter isn't excluding events

### Using kubeconfig in Docker

**Problem**: Kubeconfig context not working in Docker
**Solution**:
- Mount your kubeconfig file: `-v ~/.kube/config:/root/.kube/config`
- Or use token-based auth instead (recommended for production)

### "Invalid cluster config" errors

**Problem**: Cluster configuration rejected
**Solution**:
- Ensure you provide either (`server` + `token`) OR (`context`)
- Don't mix authentication methods for the same cluster
- Verify token format is correct (JWT starting with `eyJ`)

## Security Best Practices

1. **Use dedicated ServiceAccounts** - Don't use admin credentials
2. **Minimal RBAC permissions** - Grant only `get`, `list`, `watch` on needed resources
3. **Namespace isolation** - Use namespace-scoped Roles when possible
4. **TLS verification** - Always verify certificates in production (`skipTLSVerify: false`)
5. **Token rotation** - Regularly rotate ServiceAccount tokens
6. **Network policies** - Restrict connector's network access to API server only

## License

Apache 2.0
