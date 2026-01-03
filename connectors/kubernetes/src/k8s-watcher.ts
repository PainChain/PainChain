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
  transformConfigMapEvent,
  transformSecretEvent,
  transformJobEvent,
  transformCronJobEvent,
  transformPersistentVolumeEvent,
  transformPersistentVolumeClaimEvent,
  transformIngressEvent,
  transformIngressClassEvent,
  transformStorageClassEvent,
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
      configmaps: true,
      secrets: true,
      jobs: true,
      cronjobs: true,
      persistentvolumes: true,
      persistentvolumeclaims: true,
      ingresses: true,
      ingressclasses: true,
      storageclasses: true,
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
      if (resources.configmaps) {
        this.watchResource(kc, integration, cluster, 'configmaps', this.watchConfigMaps.bind(this));
      }
      if (resources.secrets) {
        this.watchResource(kc, integration, cluster, 'secrets', this.watchSecrets.bind(this));
      }
      if (resources.jobs) {
        this.watchResource(kc, integration, cluster, 'jobs', this.watchJobs.bind(this));
      }
      if (resources.cronjobs) {
        this.watchResource(kc, integration, cluster, 'cronjobs', this.watchCronJobs.bind(this));
      }
      if (resources.persistentvolumes) {
        this.watchResource(kc, integration, cluster, 'persistentvolumes', this.watchPersistentVolumes.bind(this));
      }
      if (resources.persistentvolumeclaims) {
        this.watchResource(kc, integration, cluster, 'persistentvolumeclaims', this.watchPersistentVolumeClaims.bind(this));
      }
      if (resources.ingresses) {
        this.watchResource(kc, integration, cluster, 'ingresses', this.watchIngresses.bind(this));
      }
      if (resources.ingressclasses) {
        this.watchResource(kc, integration, cluster, 'ingressclasses', this.watchIngressClasses.bind(this));
      }
      if (resources.storageclasses) {
        this.watchResource(kc, integration, cluster, 'storageclasses', this.watchStorageClasses.bind(this));
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
   * Watch ConfigMaps
   */
  private async watchConfigMaps(kc: k8s.KubeConfig, integration: Integration, cluster: ClusterConfig): Promise<void> {
    const watch = new k8s.Watch(kc);
    const path = integration.config.namespaces?.length
      ? `/api/v1/namespaces/${integration.config.namespaces[0]}/configmaps`
      : '/api/v1/configmaps';

    console.log(`👀 Watching configmaps in ${cluster.name}...`);

    return new Promise((resolve, reject) => {
      watch.watch(
        path,
        {},
        (type, obj: k8s.V1ConfigMap) => {
          const event = transformConfigMapEvent(type, obj, cluster.name);
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
   * Watch Secrets
   */
  private async watchSecrets(kc: k8s.KubeConfig, integration: Integration, cluster: ClusterConfig): Promise<void> {
    const watch = new k8s.Watch(kc);
    const path = integration.config.namespaces?.length
      ? `/api/v1/namespaces/${integration.config.namespaces[0]}/secrets`
      : '/api/v1/secrets';

    console.log(`👀 Watching secrets in ${cluster.name}...`);

    return new Promise((resolve, reject) => {
      watch.watch(
        path,
        {},
        (type, obj: k8s.V1Secret) => {
          const event = transformSecretEvent(type, obj, cluster.name);
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
   * Watch Jobs
   */
  private async watchJobs(kc: k8s.KubeConfig, integration: Integration, cluster: ClusterConfig): Promise<void> {
    const watch = new k8s.Watch(kc);
    const path = integration.config.namespaces?.length
      ? `/apis/batch/v1/namespaces/${integration.config.namespaces[0]}/jobs`
      : '/apis/batch/v1/jobs';

    console.log(`👀 Watching jobs in ${cluster.name}...`);

    return new Promise((resolve, reject) => {
      watch.watch(
        path,
        {},
        (type, obj: k8s.V1Job) => {
          const event = transformJobEvent(type, obj, cluster.name);
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
   * Watch CronJobs
   */
  private async watchCronJobs(kc: k8s.KubeConfig, integration: Integration, cluster: ClusterConfig): Promise<void> {
    const watch = new k8s.Watch(kc);
    const path = integration.config.namespaces?.length
      ? `/apis/batch/v1/namespaces/${integration.config.namespaces[0]}/cronjobs`
      : '/apis/batch/v1/cronjobs';

    console.log(`👀 Watching cronjobs in ${cluster.name}...`);

    return new Promise((resolve, reject) => {
      watch.watch(
        path,
        {},
        (type, obj: k8s.V1CronJob) => {
          const event = transformCronJobEvent(type, obj, cluster.name);
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
   * Watch PersistentVolumes
   */
  private async watchPersistentVolumes(kc: k8s.KubeConfig, integration: Integration, cluster: ClusterConfig): Promise<void> {
    const watch = new k8s.Watch(kc);
    const path = '/api/v1/persistentvolumes'; // PVs are cluster-scoped

    console.log(`👀 Watching persistentvolumes in ${cluster.name}...`);

    return new Promise((resolve, reject) => {
      watch.watch(
        path,
        {},
        (type, obj: k8s.V1PersistentVolume) => {
          const event = transformPersistentVolumeEvent(type, obj, cluster.name);
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
   * Watch PersistentVolumeClaims
   */
  private async watchPersistentVolumeClaims(kc: k8s.KubeConfig, integration: Integration, cluster: ClusterConfig): Promise<void> {
    const watch = new k8s.Watch(kc);
    const path = integration.config.namespaces?.length
      ? `/api/v1/namespaces/${integration.config.namespaces[0]}/persistentvolumeclaims`
      : '/api/v1/persistentvolumeclaims';

    console.log(`👀 Watching persistentvolumeclaims in ${cluster.name}...`);

    return new Promise((resolve, reject) => {
      watch.watch(
        path,
        {},
        (type, obj: k8s.V1PersistentVolumeClaim) => {
          const event = transformPersistentVolumeClaimEvent(type, obj, cluster.name);
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
   * Watch Ingresses
   */
  private async watchIngresses(kc: k8s.KubeConfig, integration: Integration, cluster: ClusterConfig): Promise<void> {
    const watch = new k8s.Watch(kc);
    const path = integration.config.namespaces?.length
      ? `/apis/networking.k8s.io/v1/namespaces/${integration.config.namespaces[0]}/ingresses`
      : '/apis/networking.k8s.io/v1/ingresses';

    console.log(`👀 Watching ingresses in ${cluster.name}...`);

    return new Promise((resolve, reject) => {
      watch.watch(
        path,
        {},
        (type, obj: k8s.V1Ingress) => {
          const event = transformIngressEvent(type, obj, cluster.name);
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
   * Watch IngressClasses
   */
  private async watchIngressClasses(kc: k8s.KubeConfig, integration: Integration, cluster: ClusterConfig): Promise<void> {
    const watch = new k8s.Watch(kc);
    const path = '/apis/networking.k8s.io/v1/ingressclasses'; // IngressClasses are cluster-scoped

    console.log(`👀 Watching ingressclasses in ${cluster.name}...`);

    return new Promise((resolve, reject) => {
      watch.watch(
        path,
        {},
        (type, obj: k8s.V1IngressClass) => {
          const event = transformIngressClassEvent(type, obj, cluster.name);
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
   * Watch StorageClasses
   */
  private async watchStorageClasses(kc: k8s.KubeConfig, integration: Integration, cluster: ClusterConfig): Promise<void> {
    const watch = new k8s.Watch(kc);
    const path = '/apis/storage.k8s.io/v1/storageclasses'; // StorageClasses are cluster-scoped

    console.log(`👀 Watching storageclasses in ${cluster.name}...`);

    return new Promise((resolve, reject) => {
      watch.watch(
        path,
        {},
        (type, obj: k8s.V1StorageClass) => {
          const event = transformStorageClassEvent(type, obj, cluster.name);
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
