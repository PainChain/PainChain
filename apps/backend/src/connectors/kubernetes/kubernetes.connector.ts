import { Injectable } from '@nestjs/common'
import * as k8s from '@kubernetes/client-node'
import { PrismaService } from '../../database/prisma.service'
import { BaseConnector } from '../base.connector'
import { SyncResult, CreateChangeEventDto } from '@painchain/types'

interface KubernetesConfig {
  apiServer?: string
  token?: string
  namespaces?: string
  clusterName?: string
  verifySSL?: boolean
  pollInterval?: number
}

@Injectable()
export class KubernetesConnector extends BaseConnector {
  private kc: k8s.KubeConfig
  private k8sApi: k8s.CoreV1Api
  private appsApi: k8s.AppsV1Api
  private networkingApi: k8s.NetworkingV1Api
  private rbacApi: k8s.RbacAuthorizationV1Api
  protected k8sConfig: KubernetesConfig
  private resourceCache: Map<string, any> = new Map()

  constructor(config: Record<string, any>, private prisma: PrismaService) {
    super(config)
    this.k8sConfig = config as KubernetesConfig

    // Initialize Kubernetes client
    this.kc = new k8s.KubeConfig()

    if (this.k8sConfig.apiServer && this.k8sConfig.token) {
      this.kc.loadFromOptions({
        clusters: [{
          name: 'cluster',
          server: this.k8sConfig.apiServer,
          skipTLSVerify: !this.k8sConfig.verifySSL,
        }],
        users: [{
          name: 'user',
          token: this.k8sConfig.token,
        }],
        contexts: [{
          name: 'context',
          cluster: 'cluster',
          user: 'user',
        }],
        currentContext: 'context',
      })
    } else {
      try {
        this.kc.loadFromDefault()
      } catch (error) {
        console.error('Failed to load kubeconfig:', error)
      }
    }

    this.k8sApi = this.kc.makeApiClient(k8s.CoreV1Api)
    this.appsApi = this.kc.makeApiClient(k8s.AppsV1Api)
    this.networkingApi = this.kc.makeApiClient(k8s.NetworkingV1Api)
    this.rbacApi = this.kc.makeApiClient(k8s.RbacAuthorizationV1Api)
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.k8sApi.listNamespace()
      return true
    } catch (error) {
      console.error('Kubernetes connection test failed:', error)
      return false
    }
  }

  async sync(connectionId: number): Promise<SyncResult> {
    try {
      let eventsStored = 0
      const clusterName = this.k8sConfig.clusterName || 'default'

      console.log(`[Kubernetes] Syncing cluster: ${clusterName}`)

      // Watch all resource types sequentially with simplified approach
      eventsStored += await this.watchPods(connectionId)
      eventsStored += await this.watchDeployments(connectionId)
      eventsStored += await this.watchStatefulSets(connectionId)
      eventsStored += await this.watchDaemonSets(connectionId)
      eventsStored += await this.watchServices(connectionId)
      eventsStored += await this.watchConfigMaps(connectionId)
      eventsStored += await this.watchSecrets(connectionId)
      eventsStored += await this.watchIngresses(connectionId)
      eventsStored += await this.watchRoles(connectionId)
      eventsStored += await this.watchRoleBindings(connectionId)

      return {
        success: true,
        eventsStored,
        details: { message: `Synced ${eventsStored} events from Kubernetes cluster ${clusterName}` },
      }
    } catch (error: any) {
      console.error('[Kubernetes] Sync error:', error)
      return {
        success: false,
        eventsStored: 0,
        details: { error: error.message },
      }
    }
  }

  private async watchPods(connectionId: number): Promise<number> {
    let stored = 0
    const watch = new k8s.Watch(this.kc)
    const clusterName = this.k8sConfig.clusterName || 'default'

    return new Promise(async (resolve) => {
      const req = await watch.watch(
        '/api/v1/pods',
        {},
        (type, pod: k8s.V1Pod) => {
          if (this.isSignificantPodEvent(type, pod)) {
            this.storePodEvent(connectionId, type, pod, clusterName)
            stored++
          }
        },
        (err) => {
          if (err && err.message !== 'aborted') {
            console.error('[Kubernetes] Pod watch error:', err)
          }
          resolve(stored)
        }
      )

      setTimeout(() => req.abort(), 10000)
    })
  }

  private isSignificantPodEvent(type: string, pod: k8s.V1Pod): boolean {
    if (type === 'ADDED' && pod.status?.phase === 'Pending') return false
    if (type === 'DELETED') return true

    if (type === 'MODIFIED' && pod.status?.containerStatuses) {
      for (const cs of pod.status.containerStatuses) {
        if (cs.state?.waiting) {
          const reason = cs.state.waiting.reason || ''
          if (['CrashLoopBackOff', 'ImagePullBackOff', 'ErrImagePull', 'CreateContainerConfigError'].includes(reason)) {
            return true
          }
        }

        if (cs.state?.terminated?.reason && ['Error', 'OOMKilled'].includes(cs.state.terminated.reason)) {
          return true
        }

        const cacheKey = `${pod.metadata?.namespace}:${pod.metadata?.name}`
        const cachedRestarts = this.resourceCache.get(cacheKey)?.restartCount || 0
        if (cs.restartCount > cachedRestarts) {
          this.resourceCache.set(cacheKey, { restartCount: cs.restartCount })
          return true
        }
      }
    }

    return type === 'ADDED'
  }

  private async storePodEvent(connectionId: number, eventType: string, pod: k8s.V1Pod, clusterName: string): Promise<void> {
    const externalId = `${clusterName}:${pod.metadata?.namespace}:pod:${pod.metadata?.name}:${pod.metadata?.resourceVersion}`

    const existing = await this.prisma.changeEvent.findFirst({
      where: { connectionId, externalId },
    })
    if (existing) return

    const containers = pod.status?.containerStatuses?.map(cs => ({
      name: cs.name,
      image: cs.image,
      ready: cs.ready,
      restartCount: cs.restartCount,
      state: cs.state?.waiting ? 'waiting' : cs.state?.terminated ? 'terminated' : 'running',
      reason: cs.state?.waiting?.reason || cs.state?.terminated?.reason,
    })) || []

    const title = eventType === 'DELETED'
      ? `[Pod Deleted] ${pod.metadata?.name}`
      : eventType === 'ADDED'
      ? `[Pod Created] ${pod.metadata?.name}`
      : `[Pod ${containers[0]?.reason || 'Updated'}] ${pod.metadata?.name}`

    const event: CreateChangeEventDto = {
      connectionId,
      externalId,
      source: 'kubernetes',
      eventType: 'K8sPod',
      title,
      description: `Pod ${eventType.toLowerCase()} in namespace ${pod.metadata?.namespace}`,
      timestamp: pod.metadata?.creationTimestamp || new Date(),
      url: `k8s://${clusterName}/${pod.metadata?.namespace}/pods/${pod.metadata?.name}`,
      status: eventType.toLowerCase(),
      metadata: {
        cluster: clusterName,
        namespace: pod.metadata?.namespace,
        phase: pod.status?.phase,
        node: pod.spec?.nodeName,
        labels: pod.metadata?.labels || {},
      },
      eventMetadata: {
        containers,
        resourceType: 'pod',
      },
    }

    await this.prisma.changeEvent.create({ data: event as any })
    console.log(`[Kubernetes] Stored Pod event: ${eventType} - ${pod.metadata?.namespace}/${pod.metadata?.name}`)
  }

  private async watchDeployments(connectionId: number): Promise<number> {
    let stored = 0
    const watch = new k8s.Watch(this.kc)
    const clusterName = this.k8sConfig.clusterName || 'default'

    return new Promise(async (resolve) => {
      const req = await watch.watch(
        '/apis/apps/v1/deployments',
        {},
        async (type, deployment: k8s.V1Deployment) => {
          if (type === 'ADDED' || type === 'DELETED' || this.hasSignificantWorkloadChanges(type, deployment, 'deployment')) {
            await this.storeWorkloadEvent(connectionId, type, deployment, 'K8sDeployment', clusterName)
            stored++
          }
        },
        (err) => {
          if (err && err.message !== 'aborted') {
            console.error('[Kubernetes] Deployment watch error:', err)
          }
          resolve(stored)
        }
      )

      setTimeout(() => req.abort(), 10000)
    })
  }

  private async watchStatefulSets(connectionId: number): Promise<number> {
    let stored = 0
    const watch = new k8s.Watch(this.kc)
    const clusterName = this.k8sConfig.clusterName || 'default'

    return new Promise(async (resolve) => {
      const req = await watch.watch(
        '/apis/apps/v1/statefulsets',
        {},
        async (type, ss: k8s.V1StatefulSet) => {
          if (type === 'ADDED' || type === 'DELETED' || this.hasSignificantWorkloadChanges(type, ss, 'statefulset')) {
            await this.storeWorkloadEvent(connectionId, type, ss, 'K8sStatefulSet', clusterName)
            stored++
          }
        },
        (err) => {
          if (err && err.message !== 'aborted') {
            console.error('[Kubernetes] StatefulSet watch error:', err)
          }
          resolve(stored)
        }
      )

      setTimeout(() => req.abort(), 10000)
    })
  }

  private async watchDaemonSets(connectionId: number): Promise<number> {
    let stored = 0
    const watch = new k8s.Watch(this.kc)
    const clusterName = this.k8sConfig.clusterName || 'default'

    return new Promise(async (resolve) => {
      const req = await watch.watch(
        '/apis/apps/v1/daemonsets',
        {},
        async (type, ds: k8s.V1DaemonSet) => {
          if (type === 'ADDED' || type === 'DELETED' || this.hasSignificantWorkloadChanges(type, ds, 'daemonset')) {
            await this.storeWorkloadEvent(connectionId, type, ds, 'K8sDaemonSet', clusterName)
            stored++
          }
        },
        (err) => {
          if (err && err.message !== 'aborted') {
            console.error('[Kubernetes] DaemonSet watch error:', err)
          }
          resolve(stored)
        }
      )

      setTimeout(() => req.abort(), 10000)
    })
  }

  private hasSignificantWorkloadChanges(type: string, resource: any, kind: string): boolean {
    if (type !== 'MODIFIED') return false

    const cacheKey = `${resource.metadata?.namespace}:${resource.metadata?.name}:${kind}`
    const currentImages = resource.spec?.template?.spec?.containers?.map((c: any) => c.image) || []
    const cachedImages = this.resourceCache.get(cacheKey)?.images || []

    if (JSON.stringify(currentImages) !== JSON.stringify(cachedImages)) {
      this.resourceCache.set(cacheKey, { images: currentImages })
      return true
    }

    if (resource.spec?.replicas !== undefined) {
      const cachedReplicas = this.resourceCache.get(cacheKey)?.replicas
      if (resource.spec.replicas !== cachedReplicas) {
        this.resourceCache.set(cacheKey, { images: currentImages, replicas: resource.spec.replicas })
        return true
      }
    }

    return false
  }

  private async storeWorkloadEvent(connectionId: number, eventType: string, resource: any, k8sEventType: string, clusterName: string): Promise<void> {
    const kind = k8sEventType.replace('K8s', '')
    const externalId = `${clusterName}:${resource.metadata?.namespace}:${kind.toLowerCase()}:${resource.metadata?.name}:${resource.metadata?.resourceVersion}`

    const existing = await this.prisma.changeEvent.findFirst({
      where: { connectionId, externalId },
    })
    if (existing) return

    const images = resource.spec?.template?.spec?.containers?.map((c: any) => ({
      name: c.name,
      image: c.image,
    })) || []

    const title = eventType === 'DELETED'
      ? `[${kind} Deleted] ${resource.metadata?.name}`
      : eventType === 'ADDED'
      ? `[${kind} Created] ${resource.metadata?.name}`
      : `[${kind} Updated] ${resource.metadata?.name}`

    const event: CreateChangeEventDto = {
      connectionId,
      externalId,
      source: 'kubernetes',
      eventType: k8sEventType as any,
      title,
      description: `${kind} ${eventType.toLowerCase()} in namespace ${resource.metadata?.namespace}`,
      timestamp: resource.metadata?.creationTimestamp || new Date(),
      url: `k8s://${clusterName}/${resource.metadata?.namespace}/${kind.toLowerCase()}s/${resource.metadata?.name}`,
      status: eventType.toLowerCase(),
      metadata: {
        cluster: clusterName,
        namespace: resource.metadata?.namespace,
        labels: resource.metadata?.labels || {},
        images,
        replicas: resource.spec?.replicas,
      },
      eventMetadata: {
        resourceType: kind.toLowerCase(),
      },
    }

    await this.prisma.changeEvent.create({ data: event as any })
    console.log(`[Kubernetes] Stored ${kind} event: ${eventType} - ${resource.metadata?.namespace}/${resource.metadata?.name}`)
  }

  private async watchServices(connectionId: number): Promise<number> {
    let stored = 0
    const watch = new k8s.Watch(this.kc)
    const clusterName = this.k8sConfig.clusterName || 'default'

    return new Promise(async (resolve) => {
      const req = await watch.watch(
        '/api/v1/services',
        {},
        async (type, svc: k8s.V1Service) => {
          if (type === 'ADDED' || type === 'DELETED') {
            await this.storeGenericEvent(connectionId, type, svc, 'K8sService', clusterName)
            stored++
          }
        },
        (err) => {
          if (err && err.message !== 'aborted') {
            console.error('[Kubernetes] Service watch error:', err)
          }
          resolve(stored)
        }
      )

      setTimeout(() => req.abort(), 10000)
    })
  }

  private async watchConfigMaps(connectionId: number): Promise<number> {
    let stored = 0
    const watch = new k8s.Watch(this.kc)
    const clusterName = this.k8sConfig.clusterName || 'default'

    return new Promise(async (resolve) => {
      const req = await watch.watch(
        '/api/v1/configmaps',
        {},
        async (type, cm: k8s.V1ConfigMap) => {
          if (type === 'ADDED' || type === 'DELETED') {
            await this.storeGenericEvent(connectionId, type, cm, 'K8sConfigMap', clusterName)
            stored++
          }
        },
        (err) => {
          if (err && err.message !== 'aborted') {
            console.error('[Kubernetes] ConfigMap watch error:', err)
          }
          resolve(stored)
        }
      )

      setTimeout(() => req.abort(), 10000)
    })
  }

  private async watchSecrets(connectionId: number): Promise<number> {
    let stored = 0
    const watch = new k8s.Watch(this.kc)
    const clusterName = this.k8sConfig.clusterName || 'default'

    return new Promise(async (resolve) => {
      const req = await watch.watch(
        '/api/v1/secrets',
        {},
        async (type, secret: k8s.V1Secret) => {
          if (secret.type === 'kubernetes.io/service-account-token') return

          if (secret.type?.startsWith('helm.sh/release.v')) {
            await this.storeHelmReleaseEvent(connectionId, type, secret, clusterName)
            stored++
          } else if (type === 'ADDED' || type === 'DELETED') {
            await this.storeGenericEvent(connectionId, type, secret, 'K8sSecret', clusterName)
            stored++
          }
        },
        (err) => {
          if (err && err.message !== 'aborted') {
            console.error('[Kubernetes] Secret watch error:', err)
          }
          resolve(stored)
        }
      )

      setTimeout(() => req.abort(), 10000)
    })
  }

  private async storeHelmReleaseEvent(connectionId: number, eventType: string, secret: k8s.V1Secret, clusterName: string): Promise<void> {
    const secretName = secret.metadata?.name || ''
    const parts = secretName.split('.')
    if (parts.length < 5) return

    const releaseName = parts.slice(3, -1).join('.')
    const revision = parts[parts.length - 1].replace('v', '')

    const externalId = `${clusterName}:${secret.metadata?.namespace}:helmrelease:${releaseName}:v${revision}:${secret.metadata?.resourceVersion}`

    const existing = await this.prisma.changeEvent.findFirst({
      where: { connectionId, externalId },
    })
    if (existing) return

    const title = eventType === 'DELETED'
      ? `[Helm Uninstall] ${releaseName} (v${revision})`
      : `[Helm ${revision === '1' ? 'Install' : 'Upgrade'}] ${releaseName} (v${revision})`

    const event: CreateChangeEventDto = {
      connectionId,
      externalId,
      source: 'kubernetes',
      eventType: 'K8sHelmRelease',
      title,
      description: `Helm release ${eventType.toLowerCase()} in namespace ${secret.metadata?.namespace}`,
      timestamp: secret.metadata?.creationTimestamp || new Date(),
      url: `k8s://${clusterName}/${secret.metadata?.namespace}/helm/${releaseName}`,
      status: eventType.toLowerCase(),
      metadata: {
        cluster: clusterName,
        namespace: secret.metadata?.namespace,
        releaseName,
        revision: parseInt(revision, 10),
      },
      eventMetadata: {
        resourceType: 'helmrelease',
      },
    }

    await this.prisma.changeEvent.create({ data: event as any })
    console.log(`[Kubernetes] Stored Helm release event: ${eventType} - ${secret.metadata?.namespace}/${releaseName} v${revision}`)
  }

  private async watchIngresses(connectionId: number): Promise<number> {
    let stored = 0
    const watch = new k8s.Watch(this.kc)
    const clusterName = this.k8sConfig.clusterName || 'default'

    return new Promise(async (resolve) => {
      const req = await watch.watch(
        '/apis/networking.k8s.io/v1/ingresses',
        {},
        async (type, ingress: k8s.V1Ingress) => {
          if (type === 'ADDED' || type === 'DELETED') {
            await this.storeGenericEvent(connectionId, type, ingress, 'K8sIngress', clusterName)
            stored++
          }
        },
        (err) => {
          if (err && err.message !== 'aborted') {
            console.error('[Kubernetes] Ingress watch error:', err)
          }
          resolve(stored)
        }
      )

      setTimeout(() => req.abort(), 10000)
    })
  }

  private async watchRoles(connectionId: number): Promise<number> {
    let stored = 0
    const watch = new k8s.Watch(this.kc)
    const clusterName = this.k8sConfig.clusterName || 'default'

    return new Promise(async (resolve) => {
      const req = await watch.watch(
        '/apis/rbac.authorization.k8s.io/v1/roles',
        {},
        async (type, role: k8s.V1Role) => {
          if (type === 'ADDED' || type === 'DELETED' || type === 'MODIFIED') {
            await this.storeGenericEvent(connectionId, type, role, 'K8sRole', clusterName)
            stored++
          }
        },
        (err) => {
          if (err && err.message !== 'aborted') {
            console.error('[Kubernetes] Role watch error:', err)
          }
          resolve(stored)
        }
      )

      setTimeout(() => req.abort(), 10000)
    })
  }

  private async watchRoleBindings(connectionId: number): Promise<number> {
    let stored = 0
    const watch = new k8s.Watch(this.kc)
    const clusterName = this.k8sConfig.clusterName || 'default'

    return new Promise(async (resolve) => {
      const req = await watch.watch(
        '/apis/rbac.authorization.k8s.io/v1/rolebindings',
        {},
        async (type, rb: k8s.V1RoleBinding) => {
          if (type === 'ADDED' || type === 'DELETED' || type === 'MODIFIED') {
            await this.storeGenericEvent(connectionId, type, rb, 'K8sRoleBinding', clusterName)
            stored++
          }
        },
        (err) => {
          if (err && err.message !== 'aborted') {
            console.error('[Kubernetes] RoleBinding watch error:', err)
          }
          resolve(stored)
        }
      )

      setTimeout(() => req.abort(), 10000)
    })
  }

  private async storeGenericEvent(connectionId: number, eventType: string, resource: any, k8sEventType: string, clusterName: string): Promise<void> {
    const kind = k8sEventType.replace('K8s', '')
    const externalId = `${clusterName}:${resource.metadata?.namespace || 'cluster'}:${kind.toLowerCase()}:${resource.metadata?.name}:${resource.metadata?.resourceVersion}`

    const existing = await this.prisma.changeEvent.findFirst({
      where: { connectionId, externalId },
    })
    if (existing) return

    const title = eventType === 'DELETED'
      ? `[${kind} Deleted] ${resource.metadata?.name}`
      : eventType === 'ADDED'
      ? `[${kind} Created] ${resource.metadata?.name}`
      : `[${kind} Updated] ${resource.metadata?.name}`

    const event: CreateChangeEventDto = {
      connectionId,
      externalId,
      source: 'kubernetes',
      eventType: k8sEventType as any,
      title,
      description: `${kind} ${eventType.toLowerCase()}`,
      timestamp: resource.metadata?.creationTimestamp || new Date(),
      url: `k8s://${clusterName}/${resource.metadata?.namespace || 'cluster'}/${kind.toLowerCase()}s/${resource.metadata?.name}`,
      status: eventType.toLowerCase(),
      metadata: {
        cluster: clusterName,
        namespace: resource.metadata?.namespace,
        labels: resource.metadata?.labels || {},
      },
      eventMetadata: {
        resourceType: kind.toLowerCase(),
      },
    }

    await this.prisma.changeEvent.create({ data: event as any })
    console.log(`[Kubernetes] Stored ${kind} event: ${eventType} - ${resource.metadata?.namespace}/${resource.metadata?.name}`)
  }
}
