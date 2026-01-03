// PainChain Kubernetes Connector Types

export interface Integration {
  id: string;
  tenantId: string | null;
  type: string;
  name: string;
  config: KubernetesConfig;
  status: string;
  lastSync: Date | null;
  registeredAt: Date;
}

export interface KubernetesConfig {
  clusters: ClusterConfig[];
  namespaces?: string[]; // Optional namespace filter (empty = all namespaces)
  resources?: ResourceConfig; // Which resources to watch
}

export interface ClusterConfig {
  name: string; // Cluster display name
  server: string; // API server URL
  token?: string; // Bearer token
  certificate?: string; // CA certificate (base64)
  skipTLSVerify?: boolean; // Skip TLS verification
  context?: string; // Kubeconfig context name (for local development)
}

export interface ResourceConfig {
  pods?: boolean;
  deployments?: boolean;
  statefulsets?: boolean;
  daemonsets?: boolean;
  services?: boolean;
  configmaps?: boolean;
  secrets?: boolean;
  jobs?: boolean;
  cronjobs?: boolean;
  persistentvolumes?: boolean;
  persistentvolumeclaims?: boolean;
  ingresses?: boolean;
  ingressclasses?: boolean;
  storageclasses?: boolean;
  events?: boolean; // K8s Event objects
  helm?: boolean; // Helm releases
}

export interface PainChainEvent {
  title: string;
  connector: string;
  project: string; // cluster:namespace
  timestamp: Date;
  integrationId?: string;
  externalId?: string;
  data: Record<string, any>;
}

export interface WatchContext {
  integration: Integration;
  cluster: ClusterConfig;
  resourceType: string;
  namespace?: string;
}
