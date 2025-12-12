# PainChain Helm Chart

Officially supported Helm chart for PainChain - a change tracking and visualization platform.

## Prerequisites

- Kubernetes 1.19+
- Helm 3.0+
- PersistentVolume provisioner support in the underlying infrastructure (for PostgreSQL data persistence)

## Installation

### Quick Start

Install PainChain with default configuration:

```bash
helm install painchain .
```

### Install in a dedicated namespace

Install in a dedicated `painchain` namespace:

```bash
# Using Helm's built-in namespace creation (recommended)
helm install painchain . --namespace painchain --create-namespace

# Or enable namespace creation via values
helm install painchain . --set namespace.create=true --namespace painchain
```

### Custom Installation

Install with custom values:

```bash
helm install painchain . -f custom-values.yaml
```

### Install with custom database password:

```bash
helm install painchain . --set postgresql.auth.password=your-secure-password
```

## Configuration

The following table lists the configurable parameters of the PainChain chart and their default values.

### Global Parameters

| Parameter | Description | Default |
|-----------|-------------|---------|
| `global.imagePullPolicy` | Image pull policy | `IfNotPresent` |

### Namespace Parameters

| Parameter | Description | Default |
|-----------|-------------|---------|
| `namespace.create` | Create dedicated namespace | `false` |
| `namespace.name` | Namespace name | `painchain` |

### PostgreSQL Parameters

| Parameter | Description | Default |
|-----------|-------------|---------|
| `postgresql.enabled` | Enable PostgreSQL | `true` |
| `postgresql.image.repository` | PostgreSQL image repository | `postgres` |
| `postgresql.image.tag` | PostgreSQL image tag | `16-alpine` |
| `postgresql.auth.database` | PostgreSQL database name | `painchain` |
| `postgresql.auth.username` | PostgreSQL username | `painchain` |
| `postgresql.auth.password` | PostgreSQL password | `changeme` |
| `postgresql.primary.persistence.enabled` | Enable persistence | `true` |
| `postgresql.primary.persistence.size` | PVC size | `8Gi` |

### Redis Parameters

| Parameter | Description | Default |
|-----------|-------------|---------|
| `redis.enabled` | Enable Redis | `true` |
| `redis.image.repository` | Redis image repository | `redis` |
| `redis.image.tag` | Redis image tag | `7-alpine` |

### API Parameters

| Parameter | Description | Default |
|-----------|-------------|---------|
| `api.enabled` | Enable API service | `true` |
| `api.replicaCount` | Number of API replicas | `1` |
| `api.image.repository` | API image repository | `ghcr.io/painchain/painchain-api` |
| `api.image.tag` | API image tag | `main` |
| `api.service.type` | Kubernetes service type | `ClusterIP` |
| `api.service.port` | Service port | `8000` |

### Frontend Parameters

| Parameter | Description | Default |
|-----------|-------------|---------|
| `frontend.enabled` | Enable Frontend | `true` |
| `frontend.replicaCount` | Number of Frontend replicas | `1` |
| `frontend.image.repository` | Frontend image repository | `ghcr.io/painchain/painchain-frontend` |
| `frontend.image.tag` | Frontend image tag | `main` |
| `frontend.service.type` | Kubernetes service type | `ClusterIP` |
| `frontend.service.port` | Service port | `5174` |
| `frontend.apiUrl` | API URL for frontend | `http://localhost:8000` |

### Celery Worker Parameters

| Parameter | Description | Default |
|-----------|-------------|---------|
| `celeryWorker.enabled` | Enable Celery Worker | `true` |
| `celeryWorker.replicaCount` | Number of worker replicas | `1` |

### Celery Beat Parameters

| Parameter | Description | Default |
|-----------|-------------|---------|
| `celeryBeat.enabled` | Enable Celery Beat scheduler | `true` |
| `celeryBeat.replicaCount` | Number of beat replicas | `1` |

### Ingress Parameters

| Parameter | Description | Default |
|-----------|-------------|---------|
| `ingress.enabled` | Enable Ingress resource | `false` |
| `ingress.className` | Ingress class name (e.g., "traefik", "nginx") | `""` |
| `ingress.hosts[0].host` | Hostname for ingress | `painchain.local` |
| `ingress.tls` | TLS configuration | `[]` |

## Accessing PainChain

After installation, follow the notes printed by Helm to access your PainChain instance.

### Local Development with Port Forwarding

The default configuration uses `frontend.apiUrl: "http://localhost:8000"` which is suitable for local development with port-forwarding.

**Important**: You must forward BOTH services for the application to work:

```bash
# Terminal 1: Forward the API
kubectl --namespace painchain port-forward svc/painchain-api 8000:8000

# Terminal 2: Forward the frontend
kubectl --namespace painchain port-forward svc/painchain-frontend 5174:5174

# Open in browser
open http://localhost:5174
```

#### How Frontend Communicates with Backend

```
Browser → http://localhost:5174 (Frontend React App)
  ↓
  Frontend makes API calls to http://localhost:8000 (configured via VITE_API_URL)
  ↓
  Port-forward tunnels to painchain-api service in cluster
  ↓
  API pod processes request
```

The frontend is a **client-side React app** that runs in your browser and makes direct HTTP requests to the API URL. When using port-forwarding, both services are accessible via localhost.

### Production with Ingress

For production deployments, configure an ingress to expose the frontend and API:

```bash
helm install painchain . \
  --set ingress.enabled=true \
  --set ingress.className=nginx \
  --set ingress.hosts[0].host=painchain.example.com \
  --namespace painchain --create-namespace
```

When ingress is enabled, the frontend automatically uses the ingress hostname as the API URL.

## Upgrading

```bash
helm upgrade painchain . -f custom-values.yaml
```

## Uninstalling

```bash
helm uninstall painchain
```

This will remove all resources associated with the chart, except for PersistentVolumeClaims (to prevent data loss).

To also remove PVCs:

```bash
kubectl delete pvc -l app.kubernetes.io/instance=painchain
```

## Architecture

This chart deploys the following components:

### Core Services

- **PostgreSQL**: Database for storing change events and configuration
- **Redis**: Message broker for Celery task queue
- **API**: Flask backend service (port 8000)
- **Celery Worker**: Background task processor for connector syncing
- **Celery Beat**: Scheduler for periodic tasks
- **Frontend**: React/Vite-based web interface (port 5174)

### Supporting Resources

- **ServiceAccount**: Kubernetes identity for the API pod
- **ClusterRole**: Read-only permissions for Kubernetes resources (pods, deployments, configmaps, etc.)
- **ClusterRoleBinding**: Binds the ClusterRole to the ServiceAccount
- **DB Init Job**: Helm hook that automatically initializes the database schema on install/upgrade

### RBAC for Kubernetes Monitoring

The chart creates RBAC resources to enable **in-cluster Kubernetes monitoring**:

**ServiceAccount** (`painchain`)
- Provides an identity for the API pod to authenticate with the Kubernetes API

**ClusterRole** (`painchain`)
- Grants **read-only** permissions to:
  - Core resources: namespaces, services, configmaps, secrets, PVs, PVCs, events
  - Workloads: deployments, statefulsets, daemonsets, replicasets
  - Networking: ingresses, network policies
  - Batch: jobs, cronjobs

**ClusterRoleBinding** (`painchain`)
- Binds the ClusterRole to the ServiceAccount

#### Why RBAC is Required

These RBAC resources are **essential** if you want to:
- ✅ Monitor the cluster PainChain is running in (in-cluster monitoring)
- ✅ Use the Kubernetes connector without manually providing tokens
- ✅ Automatically detect pod changes, deployments, config map updates, etc.

The ServiceAccount token is **automatically mounted** into the API pod at `/var/run/secrets/kubernetes.io/serviceaccount/token` and used by the Kubernetes connector for authentication.

#### When You Can Skip RBAC

You can disable RBAC if:
- ❌ You never plan to use the Kubernetes connector
- ❌ You only monitor external clusters (by providing explicit API URLs and tokens)

To disable RBAC resources, you would need to remove the template files and update the API deployment to not use the ServiceAccount.

## Production Recommendations

1. **Use a strong database password**:
   ```bash
   --set postgresql.auth.password=your-secure-password
   ```

2. **Configure resource limits**:
   Edit `values.yaml` to set appropriate resource requests and limits for your workload.

3. **Enable ingress**:
   Configure ingress in `values.yaml` to expose the application externally.

4. **Use external database** (optional):
   For production, consider using a managed database service and disable the built-in PostgreSQL.

5. **Configure persistent storage**:
   Ensure your cluster has a storage class that supports ReadWriteOnce access mode.

6. **Monitor disk usage**:
   Kubernetes nodes can experience disk pressure from Docker images and build cache. Regularly clean up unused resources:
   ```bash
   docker system prune -f
   docker volume prune -f
   ```

## Troubleshooting

### Frontend Shows "Old Version"

If the frontend shows outdated code after upgrading:

1. Rebuild and reimport the frontend image:
   ```bash
   cd /path/to/PainChain/frontend
   docker build -t ghcr.io/painchain/painchain-frontend:main .
   k3d image import ghcr.io/painchain/painchain-frontend:main -c painchain-dev
   ```

2. Delete the frontend pod to force recreation:
   ```bash
   kubectl delete pod -n painchain -l app.kubernetes.io/component=frontend
   ```

### Pods Stuck in Pending (Disk Pressure)

If pods are stuck in pending due to disk pressure:

1. Clean up Docker resources on the host:
   ```bash
   docker system prune -f && docker volume prune -f
   ```

2. Remove the disk pressure taint:
   ```bash
   kubectl taint nodes <node-name> node.kubernetes.io/disk-pressure:NoSchedule-
   ```

### Database Connection Issues

Check that the database is running and accessible:

```bash
kubectl get pods -n painchain -l app.kubernetes.io/component=postgresql
kubectl logs -n painchain -l app.kubernetes.io/component=postgresql
```

### Kubernetes Connector Not Working

Verify RBAC resources are created:

```bash
kubectl get serviceaccount,clusterrole,clusterrolebinding -n painchain
```

Check that the API pod is using the ServiceAccount:

```bash
kubectl get pod -n painchain -l app.kubernetes.io/component=api -o yaml | grep serviceAccountName
```

## License

Apache License 2.0
