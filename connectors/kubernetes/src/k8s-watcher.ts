import * as k8s from '@kubernetes/client-node';
import { BackendClient } from './backend-client';
import { Integration, ClusterConfig, PainChainEvent } from './types';
import {
  transformPodEvent,
  transformDeploymentEvent,
  transformServiceEvent,
  transformK8sEvent,
  transformStatefulSetEvent,
  transformDaemonSetEvent,
} from './event-transformer';

export class K8sWatcher {
  private backendClient: BackendClient;
  private activeWatches: Map<string, AbortController> = new Map();

  constructor(backendApiUrl: string) {
    this.backendClient = new BackendClient(backendApiUrl);
  }

  /**
   * Start watching all integrations
   */
  async start(): Promise<void> {
    console.log('🚀 Kubernetes Connector started');

    // Watch integrations continuously
    await this.watchIntegrations();
  }

  /**
   * Continuously fetch and watch integrations
   */
  private async watchIntegrations(): Promise<void> {
    while (true) {
      try {
        console.log('\n📡 Fetching Kubernetes integrations from backend...');
        const integrations = await this.backendClient.getKubernetesIntegrations();

        if (integrations.length === 0) {
          console.log('ℹ️  No Kubernetes integrations found');
        } else {
          console.log(`✓ Found ${integrations.length} Kubernetes integration(s)`);

          for (const integration of integrations) {
            await this.ensureIntegrationWatches(integration);
          }
        }
      } catch (error) {
        console.error('❌ Error fetching integrations:', error);
      }

      // Re-fetch integrations every 60 seconds to detect new clusters
      await this.sleep(60000);
    }
  }

  /**
   * Ensure watches are running for all clusters in an integration
   */
  private async ensureIntegrationWatches(integration: Integration): Promise<void> {
    const clusters = integration.config.clusters || [];

    for (const cluster of clusters) {
      const watchKey = `${integration.id}:${cluster.name}`;

      // If watch doesn't exist or has been aborted, start it
      if (!this.activeWatches.has(watchKey) || this.activeWatches.get(watchKey)?.signal.aborted) {
        console.log(`🔄 Starting watches for integration: ${integration.name}, cluster: ${cluster.name}`);
        this.startClusterWatches(integration, cluster);
      }
    }
  }

  /**
   * Start all resource watches for a single cluster
   */
  private startClusterWatches(integration: Integration, cluster: ClusterConfig): void {
    const watchKey = `${integration.id}:${cluster.name}`;
    const abortController = new AbortController();
    this.activeWatches.set(watchKey, abortController);

    // Get resource config (defaults to watching all resources)
    const resources = integration.config.resources || {
      pods: true,
      deployments: true,
      services: true,
      statefulsets: true,
      daemonsets: true,
      events: true,
    };

    // Initialize Kubernetes client for this cluster
    const kc = new k8s.KubeConfig();
    try {
      if (cluster.token && cluster.server) {
        // Production: Use token-based auth
        kc.loadFromOptions({
          clusters: [{
            name: cluster.name,
            server: cluster.server,
            skipTLSVerify: cluster.skipTLSVerify || false,
            caData: cluster.certificate,
          }],
          users: [{
            name: 'user',
            token: cluster.token,
          }],
          contexts: [{
            name: 'context',
            cluster: cluster.name,
            user: 'user',
          }],
          currentContext: 'context',
        });
      } else if (cluster.context) {
        // Development: Use local kubeconfig context
        kc.loadFromDefault();
        kc.setCurrentContext(cluster.context);
      } else {
        console.error(`❌ Invalid cluster config for ${cluster.name}: missing token/server or context`);
        return;
      }
    } catch (error) {
      console.error(`❌ Failed to configure Kubernetes client for ${cluster.name}:`, error);
      return;
    }

    // Test connection
    this.testConnection(kc, cluster.name).then(success => {
      if (!success) {
        console.error(`❌ Connection test failed for cluster: ${cluster.name}`);
        return;
      }

      console.log(`✓ Connected to cluster: ${cluster.name}`);

      // Start watches for each resource type
      if (resources.pods) {
        this.watchResource(kc, integration, cluster, 'pods', this.watchPods.bind(this));
      }
      if (resources.deployments) {
        this.watchResource(kc, integration, cluster, 'deployments', this.watchDeployments.bind(this));
      }
      if (resources.services) {
        this.watchResource(kc, integration, cluster, 'services', this.watchServices.bind(this));
      }
      if (resources.statefulsets) {
        this.watchResource(kc, integration, cluster, 'statefulsets', this.watchStatefulSets.bind(this));
      }
      if (resources.daemonsets) {
        this.watchResource(kc, integration, cluster, 'daemonsets', this.watchDaemonSets.bind(this));
      }
      if (resources.events) {
        this.watchResource(kc, integration, cluster, 'events', this.watchK8sEvents.bind(this));
      }
    });
  }

  /**
   * Generic resource watcher with auto-restart on errors
   */
  private watchResource(
    kc: k8s.KubeConfig,
    integration: Integration,
    cluster: ClusterConfig,
    resourceType: string,
    watchFn: (kc: k8s.KubeConfig, integration: Integration, cluster: ClusterConfig) => Promise<void>
  ): void {
    const startWatch = async () => {
      while (true) {
        try {
          await watchFn(kc, integration, cluster);
        } catch (error) {
          console.error(`❌ Watch error for ${resourceType} in ${cluster.name}:`, error);
        }

        // Wait before restarting watch
        console.log(`🔄 Restarting ${resourceType} watch for ${cluster.name} in 10 seconds...`);
        await this.sleep(10000);
      }
    };

    startWatch();
  }

  /**
   * Watch Pods
   */
  private async watchPods(kc: k8s.KubeConfig, integration: Integration, cluster: ClusterConfig): Promise<void> {
    const watch = new k8s.Watch(kc);
    const path = integration.config.namespaces?.length
      ? `/api/v1/namespaces/${integration.config.namespaces[0]}/pods`
      : '/api/v1/pods';

    console.log(`👀 Watching pods in ${cluster.name}...`);

    return new Promise((resolve, reject) => {
      watch.watch(
        path,
        {},
        (type, obj: k8s.V1Pod) => {
          const event = transformPodEvent(type, obj, cluster.name);
          if (event) {
            this.postEvent(event, integration);
          }
        },
        (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        }
      );
    });
  }

  /**
   * Watch Deployments
   */
  private async watchDeployments(kc: k8s.KubeConfig, integration: Integration, cluster: ClusterConfig): Promise<void> {
    const watch = new k8s.Watch(kc);
    const path = integration.config.namespaces?.length
      ? `/apis/apps/v1/namespaces/${integration.config.namespaces[0]}/deployments`
      : '/apis/apps/v1/deployments';

    console.log(`👀 Watching deployments in ${cluster.name}...`);

    return new Promise((resolve, reject) => {
      watch.watch(
        path,
        {},
        (type, obj: k8s.V1Deployment) => {
          const event = transformDeploymentEvent(type, obj, cluster.name);
          if (event) {
            this.postEvent(event, integration);
          }
        },
        (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        }
      );
    });
  }

  /**
   * Watch Services
   */
  private async watchServices(kc: k8s.KubeConfig, integration: Integration, cluster: ClusterConfig): Promise<void> {
    const watch = new k8s.Watch(kc);
    const path = integration.config.namespaces?.length
      ? `/api/v1/namespaces/${integration.config.namespaces[0]}/services`
      : '/api/v1/services';

    console.log(`👀 Watching services in ${cluster.name}...`);

    return new Promise((resolve, reject) => {
      watch.watch(
        path,
        {},
        (type, obj: k8s.V1Service) => {
          const event = transformServiceEvent(type, obj, cluster.name);
          if (event) {
            this.postEvent(event, integration);
          }
        },
        (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        }
      );
    });
  }

  /**
   * Watch StatefulSets
   */
  private async watchStatefulSets(kc: k8s.KubeConfig, integration: Integration, cluster: ClusterConfig): Promise<void> {
    const watch = new k8s.Watch(kc);
    const path = integration.config.namespaces?.length
      ? `/apis/apps/v1/namespaces/${integration.config.namespaces[0]}/statefulsets`
      : '/apis/apps/v1/statefulsets';

    console.log(`👀 Watching statefulsets in ${cluster.name}...`);

    return new Promise((resolve, reject) => {
      watch.watch(
        path,
        {},
        (type, obj: k8s.V1StatefulSet) => {
          const event = transformStatefulSetEvent(type, obj, cluster.name);
          if (event) {
            this.postEvent(event, integration);
          }
        },
        (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        }
      );
    });
  }

  /**
   * Watch DaemonSets
   */
  private async watchDaemonSets(kc: k8s.KubeConfig, integration: Integration, cluster: ClusterConfig): Promise<void> {
    const watch = new k8s.Watch(kc);
    const path = integration.config.namespaces?.length
      ? `/apis/apps/v1/namespaces/${integration.config.namespaces[0]}/daemonsets`
      : '/apis/apps/v1/daemonsets';

    console.log(`👀 Watching daemonsets in ${cluster.name}...`);

    return new Promise((resolve, reject) => {
      watch.watch(
        path,
        {},
        (type, obj: k8s.V1DaemonSet) => {
          const event = transformDaemonSetEvent(type, obj, cluster.name);
          if (event) {
            this.postEvent(event, integration);
          }
        },
        (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        }
      );
    });
  }

  /**
   * Watch Kubernetes Events
   */
  private async watchK8sEvents(kc: k8s.KubeConfig, integration: Integration, cluster: ClusterConfig): Promise<void> {
    const watch = new k8s.Watch(kc);
    const path = integration.config.namespaces?.length
      ? `/api/v1/namespaces/${integration.config.namespaces[0]}/events`
      : '/api/v1/events';

    console.log(`👀 Watching k8s events in ${cluster.name}...`);

    return new Promise((resolve, reject) => {
      watch.watch(
        path,
        {},
        (type, obj: k8s.CoreV1Event) => {
          const event = transformK8sEvent(obj, cluster.name);
          if (event) {
            this.postEvent(event, integration);
          }
        },
        (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        }
      );
    });
  }

  /**
   * Test connection to a cluster
   */
  private async testConnection(kc: k8s.KubeConfig, clusterName: string): Promise<boolean> {
    try {
      const k8sApi = kc.makeApiClient(k8s.CoreV1Api);
      await k8sApi.listNamespace();
      return true;
    } catch (error) {
      console.error(`Connection test failed for ${clusterName}:`, error);
      return false;
    }
  }

  /**
   * Post event to backend
   */
  private async postEvent(event: PainChainEvent, integration: Integration): Promise<void> {
    event.integrationId = integration.id;
    await this.backendClient.postEvent(event, integration.tenantId || undefined);
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
