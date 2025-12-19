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
      eventsStored += await this.watchK8sEvents(connectionId)

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

      setTimeout(() => req.abort(), 300000)
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

    // Detailed container statuses
    const containers = await Promise.all((pod.status?.containerStatuses || []).map(async cs => {
      const containerInfo: any = {
        name: cs.name,
        image: cs.image,
        image_id: cs.imageID,
        ready: cs.ready,
        restart_count: cs.restartCount,
        started: cs.started,
      }

      // Detailed state information
      if (cs.state?.running) {
        containerInfo.state = 'running'
        containerInfo.started_at = cs.state.running.startedAt
      } else if (cs.state?.waiting) {
        containerInfo.state = 'waiting'
        containerInfo.reason = cs.state.waiting.reason
        containerInfo.message = cs.state.waiting.message
      } else if (cs.state?.terminated) {
        containerInfo.state = 'terminated'
        containerInfo.reason = cs.state.terminated.reason
        containerInfo.message = cs.state.terminated.message
        containerInfo.exit_code = cs.state.terminated.exitCode
        containerInfo.signal = cs.state.terminated.signal
        containerInfo.started_at = cs.state.terminated.startedAt
        containerInfo.finished_at = cs.state.terminated.finishedAt

        // Note: Logs can be fetched via kubectl:
        // kubectl logs -n <namespace> <pod> -c <container> --previous --tail=100
        if (cs.state.terminated.exitCode !== 0) {
          containerInfo.fetch_logs_cmd = `kubectl logs -n ${pod.metadata?.namespace} ${pod.metadata?.name} -c ${cs.name} --previous --tail=100`
        }
      }

      // Last termination state (if restarted)
      if (cs.lastState?.terminated) {
        containerInfo.last_termination = {
          reason: cs.lastState.terminated.reason,
          exit_code: cs.lastState.terminated.exitCode,
          finished_at: cs.lastState.terminated.finishedAt,
        }
      }

      return containerInfo
    }))

    // Init container statuses
    const initContainers = (pod.status?.initContainerStatuses || []).map(ics => ({
      name: ics.name,
      image: ics.image,
      ready: ics.ready,
      restart_count: ics.restartCount,
      state: ics.state?.running ? 'running' : ics.state?.waiting ? 'waiting' : ics.state?.terminated ? 'terminated' : 'unknown',
      reason: ics.state?.waiting?.reason || ics.state?.terminated?.reason,
      exit_code: ics.state?.terminated?.exitCode,
    }))

    // Pod conditions (Ready, ContainersReady, PodScheduled, Initialized)
    const conditions = (pod.status?.conditions || []).map(c => ({
      type: c.type,
      status: c.status,
      reason: c.reason,
      message: c.message,
      last_transition: c.lastTransitionTime,
    }))

    // Container specs (requests, limits, etc.)
    const containerSpecs = (pod.spec?.containers || []).map(c => ({
      name: c.name,
      image: c.image,
      requests: c.resources?.requests,
      limits: c.resources?.limits,
      ports: c.ports?.map(p => ({ name: p.name, container_port: p.containerPort, protocol: p.protocol })),
      env_count: c.env?.length || 0,
      volume_mounts: c.volumeMounts?.map(vm => ({ name: vm.name, mount_path: vm.mountPath, read_only: vm.readOnly })),
    }))

    // Volumes
    const volumes = (pod.spec?.volumes || []).map(v => ({
      name: v.name,
      type: Object.keys(v).find(k => k !== 'name') || 'unknown',
    }))

    // Determine primary issue for title
    const failedContainer = containers.find(c => c.state === 'terminated' && c.exit_code !== 0)
    const waitingContainer = containers.find(c => c.state === 'waiting')
    const primaryIssue = failedContainer?.reason || waitingContainer?.reason

    const title = eventType === 'DELETED'
      ? `[Pod Deleted] ${pod.metadata?.name}`
      : eventType === 'ADDED'
      ? `[Pod Created] ${pod.metadata?.name}`
      : primaryIssue
      ? `[Pod ${primaryIssue}] ${pod.metadata?.name}`
      : `[Pod Updated] ${pod.metadata?.name}`

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
        node_selector: pod.spec?.nodeSelector,
        service_account: pod.spec?.serviceAccountName,
        host_ip: pod.status?.hostIP,
        pod_ip: pod.status?.podIP,
        qos_class: pod.status?.qosClass,
        labels: pod.metadata?.labels || {},
        annotations: pod.metadata?.annotations || {},
      },
      eventMetadata: {
        resourceType: 'pod',
        containers,
        init_containers: initContainers,
        conditions,
        container_specs: containerSpecs,
        volumes,
        restart_policy: pod.spec?.restartPolicy,
        dns_policy: pod.spec?.dnsPolicy,
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

      setTimeout(() => req.abort(), 300000)
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

      setTimeout(() => req.abort(), 300000)
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

      setTimeout(() => req.abort(), 300000)
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

    // Get cached version to compute diffs
    const cacheKey = `${resource.metadata?.namespace}:${kind.toLowerCase()}:${resource.metadata?.name}`
    const cached = this.resourceCache.get(cacheKey)

    // Current images
    const currentImages = resource.spec?.template?.spec?.containers?.map((c: any) => ({
      name: c.name,
      image: c.image,
    })) || []

    // Detect image changes
    let imagesChanged: any[] = []
    if (eventType === 'MODIFIED' && cached?.images) {
      const cachedImageMap = new Map(cached.images.map((img: any) => [img.name, img.image]))
      const currentImageMap = new Map(currentImages.map((img: any) => [img.name, img.image]))

      imagesChanged = currentImages.filter((img: any) => {
        const oldImage = cachedImageMap.get(img.name)
        return oldImage && oldImage !== img.image
      }).map((img: any) => ({
        name: img.name,
        old_image: cachedImageMap.get(img.name),
        new_image: img.image,
      }))
    }

    // Detailed container specs
    const containerSpecs = resource.spec?.template?.spec?.containers?.map((c: any) => ({
      name: c.name,
      image: c.image,
      requests: c.resources?.requests,
      limits: c.resources?.limits,
      env_count: c.env?.length || 0,
      ports: c.ports?.map((p: any) => ({ name: p.name, container_port: p.containerPort, protocol: p.protocol })),
      liveness_probe: c.livenessProbe ? {
        type: c.livenessProbe.httpGet ? 'http' : c.livenessProbe.exec ? 'exec' : c.livenessProbe.tcpSocket ? 'tcp' : 'unknown',
        path: c.livenessProbe.httpGet?.path,
        port: c.livenessProbe.httpGet?.port || c.livenessProbe.tcpSocket?.port,
      } : null,
      readiness_probe: c.readinessProbe ? {
        type: c.readinessProbe.httpGet ? 'http' : c.readinessProbe.exec ? 'exec' : c.readinessProbe.tcpSocket ? 'tcp' : 'unknown',
        path: c.readinessProbe.httpGet?.path,
        port: c.readinessProbe.httpGet?.port || c.readinessProbe.tcpSocket?.port,
      } : null,
    })) || []

    // Conditions (Available, Progressing, ReplicaFailure)
    const conditions = resource.status?.conditions?.map((c: any) => ({
      type: c.type,
      status: c.status,
      reason: c.reason,
      message: c.message,
      last_update: c.lastUpdateTime,
      last_transition: c.lastTransitionTime,
    })) || []

    // Rollout status
    const rolloutStatus: any = {}
    if (kind === 'Deployment') {
      rolloutStatus.desired_replicas = resource.spec?.replicas || 0
      rolloutStatus.updated_replicas = resource.status?.updatedReplicas || 0
      rolloutStatus.ready_replicas = resource.status?.readyReplicas || 0
      rolloutStatus.available_replicas = resource.status?.availableReplicas || 0
      rolloutStatus.unavailable_replicas = resource.status?.unavailableReplicas || 0
      rolloutStatus.observed_generation = resource.status?.observedGeneration
      rolloutStatus.collision_count = resource.status?.collisionCount
    } else if (kind === 'StatefulSet') {
      rolloutStatus.desired_replicas = resource.spec?.replicas || 0
      rolloutStatus.ready_replicas = resource.status?.readyReplicas || 0
      rolloutStatus.current_replicas = resource.status?.currentReplicas || 0
      rolloutStatus.updated_replicas = resource.status?.updatedReplicas || 0
      rolloutStatus.available_replicas = resource.status?.availableReplicas || 0
      rolloutStatus.current_revision = resource.status?.currentRevision
      rolloutStatus.update_revision = resource.status?.updateRevision
    } else if (kind === 'DaemonSet') {
      rolloutStatus.desired_number_scheduled = resource.status?.desiredNumberScheduled || 0
      rolloutStatus.current_number_scheduled = resource.status?.currentNumberScheduled || 0
      rolloutStatus.number_ready = resource.status?.numberReady || 0
      rolloutStatus.number_available = resource.status?.numberAvailable || 0
      rolloutStatus.number_unavailable = resource.status?.numberUnavailable || 0
      rolloutStatus.updated_number_scheduled = resource.status?.updatedNumberScheduled || 0
      rolloutStatus.number_misscheduled = resource.status?.numberMisscheduled || 0
    }

    // Update strategy
    const strategy = kind === 'Deployment'
      ? {
          type: resource.spec?.strategy?.type,
          max_surge: resource.spec?.strategy?.rollingUpdate?.maxSurge,
          max_unavailable: resource.spec?.strategy?.rollingUpdate?.maxUnavailable,
        }
      : kind === 'StatefulSet'
      ? {
          type: resource.spec?.updateStrategy?.type,
          partition: resource.spec?.updateStrategy?.rollingUpdate?.partition,
        }
      : kind === 'DaemonSet'
      ? {
          type: resource.spec?.updateStrategy?.type,
          max_surge: resource.spec?.updateStrategy?.rollingUpdate?.maxSurge,
          max_unavailable: resource.spec?.updateStrategy?.rollingUpdate?.maxUnavailable,
        }
      : null

    // Determine title with status info
    const failedCondition = conditions.find((c: any) => c.status === 'False' && (c.type === 'Available' || c.type === 'Progressing'))
    const titleSuffix = imagesChanged.length > 0
      ? ` (${imagesChanged.length} image${imagesChanged.length > 1 ? 's' : ''} updated)`
      : failedCondition
      ? ` - ${failedCondition.reason || 'Failed'}`
      : ''

    const title = eventType === 'DELETED'
      ? `[${kind} Deleted] ${resource.metadata?.name}`
      : eventType === 'ADDED'
      ? `[${kind} Created] ${resource.metadata?.name}`
      : `[${kind} Updated] ${resource.metadata?.name}${titleSuffix}`

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
        annotations: resource.metadata?.annotations || {},
        selector: resource.spec?.selector?.matchLabels,
        replicas: resource.spec?.replicas,
        ...rolloutStatus,
      },
      eventMetadata: {
        resourceType: kind.toLowerCase(),
        images: currentImages,
        images_changed: imagesChanged,
        container_specs: containerSpecs,
        conditions,
        strategy,
        restart_policy: resource.spec?.template?.spec?.restartPolicy,
        service_account: resource.spec?.template?.spec?.serviceAccountName,
        volumes: resource.spec?.template?.spec?.volumes?.map((v: any) => ({
          name: v.name,
          type: Object.keys(v).find(k => k !== 'name') || 'unknown',
        })),
      },
    }

    // Update cache for future diff detection
    this.resourceCache.set(cacheKey, { images: currentImages })

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
            await this.storeServiceEvent(connectionId, type, svc, clusterName)
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

      setTimeout(() => req.abort(), 300000)
    })
  }

  private async storeServiceEvent(connectionId: number, eventType: string, svc: k8s.V1Service, clusterName: string): Promise<void> {
    const externalId = `${clusterName}:${svc.metadata?.namespace}:service:${svc.metadata?.name}:${svc.metadata?.resourceVersion}`

    const existing = await this.prisma.changeEvent.findFirst({
      where: { connectionId, externalId },
    })
    if (existing) return

    const title = eventType === 'DELETED'
      ? `[Service Deleted] ${svc.metadata?.name}`
      : `[Service Created] ${svc.metadata?.name}`

    // Extract port mappings
    const ports = svc.spec?.ports?.map(p => ({
      name: p.name || undefined,
      protocol: p.protocol,
      port: p.port,
      target_port: p.targetPort,
      node_port: p.nodePort || undefined,
    })) || []

    // External IPs and load balancer info
    const externalIPs = svc.spec?.externalIPs || []
    const loadBalancerIP = svc.spec?.loadBalancerIP
    const loadBalancerIngress = svc.status?.loadBalancer?.ingress?.map(ing => ({
      hostname: ing.hostname,
      ip: ing.ip,
    })) || []

    const event: CreateChangeEventDto = {
      connectionId,
      externalId,
      source: 'kubernetes',
      eventType: 'K8sService' as any,
      title,
      description: `Service ${eventType.toLowerCase()} in ${svc.metadata?.namespace}`,
      timestamp: svc.metadata?.creationTimestamp || new Date(),
      url: `k8s://${clusterName}/${svc.metadata?.namespace}/services/${svc.metadata?.name}`,
      status: eventType.toLowerCase(),
      metadata: {
        cluster: clusterName,
        namespace: svc.metadata?.namespace,
        labels: svc.metadata?.labels || {},
        type: svc.spec?.type, // ClusterIP, NodePort, LoadBalancer, ExternalName
        cluster_ip: svc.spec?.clusterIP,
        external_ips: externalIPs,
        session_affinity: svc.spec?.sessionAffinity,
      },
      eventMetadata: {
        resourceType: 'service',
        ports,
        selector: svc.spec?.selector || {},
        load_balancer_ip: loadBalancerIP,
        load_balancer_ingress: loadBalancerIngress,
        external_name: svc.spec?.externalName, // For ExternalName type
        external_traffic_policy: svc.spec?.externalTrafficPolicy,
      },
    }

    await this.prisma.changeEvent.create({ data: event as any })
    console.log(`[Kubernetes] Stored Service event: ${eventType} - ${svc.metadata?.namespace}/${svc.metadata?.name}`)
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
            await this.storeConfigMapEvent(connectionId, type, cm, clusterName)
            stored++
          } else if (type === 'MODIFIED') {
            const hasChanges = await this.hasConfigMapChanges(cm)
            if (hasChanges) {
              await this.storeConfigMapEvent(connectionId, type, cm, clusterName)
              stored++
            }
          }
        },
        (err) => {
          if (err && err.message !== 'aborted') {
            console.error('[Kubernetes] ConfigMap watch error:', err)
          }
          resolve(stored)
        }
      )

      setTimeout(() => req.abort(), 300000)
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
            await this.storeSecretEvent(connectionId, type, secret, clusterName)
            stored++
          } else if (type === 'MODIFIED') {
            const hasChanges = await this.hasSecretChanges(secret)
            if (hasChanges) {
              await this.storeSecretEvent(connectionId, type, secret, clusterName)
              stored++
            }
          }
        },
        (err) => {
          if (err && err.message !== 'aborted') {
            console.error('[Kubernetes] Secret watch error:', err)
          }
          resolve(stored)
        }
      )

      setTimeout(() => req.abort(), 300000)
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

    // Parse Helm release data from secret (if available - won't exist for DELETED)
    let releaseInfo: any = {}
    if (eventType !== 'DELETED') {
      try {
        if (secret.data?.release) {
          const releaseData = Buffer.from(secret.data.release, 'base64')
          // Helm stores release data as base64-encoded gzipped JSON
          const zlib = require('zlib')
          const decompressed = zlib.gunzipSync(releaseData).toString('utf-8')
          const releaseObj = JSON.parse(decompressed)

          releaseInfo = {
            chart_name: releaseObj.chart?.metadata?.name,
            chart_version: releaseObj.chart?.metadata?.version,
            app_version: releaseObj.chart?.metadata?.appVersion,
            status: releaseObj.info?.status,
            description: releaseObj.info?.description,
            first_deployed: releaseObj.info?.first_deployed,
            last_deployed: releaseObj.info?.last_deployed,
            notes: releaseObj.info?.notes?.substring(0, 500), // First 500 chars of notes
          }

          // Extract top-level value keys (not full values for DB size)
          if (releaseObj.config) {
            releaseInfo.value_keys = Object.keys(releaseObj.config).slice(0, 20) // Top 20 keys
          }

          // Extract manifest resource types (what K8s resources were created)
          if (releaseObj.manifest) {
            const resourceTypes = new Set<string>()
            const manifests = releaseObj.manifest.split('---\n')
            manifests.forEach((m: string) => {
              const kindMatch = m.match(/kind:\s*(\w+)/)
              if (kindMatch) resourceTypes.add(kindMatch[1])
            })
            releaseInfo.resource_types = Array.from(resourceTypes)
          }
        }
      } catch (err) {
        console.error(`[Kubernetes] Failed to parse Helm release data for ${releaseName}:`, err)
      }
    }

    const title = eventType === 'DELETED'
      ? `[Helm Uninstall] ${releaseName} (v${revision})`
      : `[Helm ${revision === '1' ? 'Install' : 'Upgrade'}] ${releaseName} (v${revision})`

    const titleSuffix = releaseInfo.chart_name
      ? ` - ${releaseInfo.chart_name}:${releaseInfo.chart_version}`
      : ''

    // Debugging commands
    const debugCommands = {
      get_values: `helm get values ${releaseName} -n ${secret.metadata?.namespace}`,
      get_manifest: `helm get manifest ${releaseName} -n ${secret.metadata?.namespace}`,
      get_notes: `helm get notes ${releaseName} -n ${secret.metadata?.namespace}`,
      get_history: `helm history ${releaseName} -n ${secret.metadata?.namespace}`,
      diff_from_previous: revision > '1'
        ? `helm diff revision ${releaseName} ${parseInt(revision) - 1} ${revision} -n ${secret.metadata?.namespace}`
        : null,
    }

    const event: CreateChangeEventDto = {
      connectionId,
      externalId,
      source: 'kubernetes',
      eventType: 'K8sHelmRelease',
      title: title + titleSuffix,
      description: releaseInfo.description || `Helm release ${eventType.toLowerCase()} in namespace ${secret.metadata?.namespace}`,
      timestamp: secret.metadata?.creationTimestamp || new Date(),
      url: `k8s://${clusterName}/${secret.metadata?.namespace}/helm/${releaseName}`,
      status: releaseInfo.status?.toLowerCase() || eventType.toLowerCase(),
      metadata: {
        cluster: clusterName,
        namespace: secret.metadata?.namespace,
        release_name: releaseName,
        revision: parseInt(revision, 10),
        chart_name: releaseInfo.chart_name,
        chart_version: releaseInfo.chart_version,
        app_version: releaseInfo.app_version,
        first_deployed: releaseInfo.first_deployed,
        last_deployed: releaseInfo.last_deployed,
      },
      eventMetadata: {
        resourceType: 'helmrelease',
        status: releaseInfo.status,
        value_keys: releaseInfo.value_keys,
        resource_types: releaseInfo.resource_types,
        notes: releaseInfo.notes,
        debug_commands: debugCommands,
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

      setTimeout(() => req.abort(), 300000)
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

      setTimeout(() => req.abort(), 300000)
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

      setTimeout(() => req.abort(), 300000)
    })
  }

  private async watchK8sEvents(connectionId: number): Promise<number> {
    let stored = 0
    const watch = new k8s.Watch(this.kc)
    const clusterName = this.k8sConfig.clusterName || 'default'

    return new Promise(async (resolve) => {
      const req = await watch.watch(
        '/api/v1/events',
        {},
        async (type, event: k8s.CoreV1Event) => {
          // Only store significant events
          if (this.isSignificantK8sEvent(event)) {
            await this.storeK8sEventObject(connectionId, type, event, clusterName)
            stored++
          }
        },
        (err) => {
          if (err && err.message !== 'aborted') {
            console.error('[Kubernetes] Event watch error:', err)
          }
          resolve(stored)
        }
      )

      setTimeout(() => req.abort(), 300000)
    })
  }

  private isSignificantK8sEvent(event: k8s.CoreV1Event): boolean {
    // Always store Warning events
    if (event.type === 'Warning') return true

    // Store important Normal events
    const importantReasons = [
      'Pulling',
      'Pulled',
      'Created',
      'Started',
      'Killing',
      'Scheduled',
      'SuccessfulCreate',
      'SuccessfulDelete',
      'ScalingReplicaSet',
      'Unhealthy',
    ]

    return importantReasons.includes(event.reason || '')
  }

  private async storeK8sEventObject(connectionId: number, eventType: string, k8sEvent: k8s.CoreV1Event, clusterName: string): Promise<void> {
    // Use event name + count as external ID to track unique occurrences
    const externalId = `${clusterName}:${k8sEvent.metadata?.namespace}:event:${k8sEvent.metadata?.name}:${k8sEvent.count || 1}`

    const existing = await this.prisma.changeEvent.findFirst({
      where: { connectionId, externalId },
    })
    if (existing) return

    const involvedObject = k8sEvent.involvedObject
    const objectRef = `${involvedObject.kind}/${involvedObject.name}`

    const title = `[K8s Event] ${k8sEvent.reason}: ${objectRef}`

    const event: CreateChangeEventDto = {
      connectionId,
      externalId,
      source: 'kubernetes',
      eventType: 'K8sEvent',
      title,
      description: k8sEvent.message || '',
      timestamp: k8sEvent.lastTimestamp || k8sEvent.firstTimestamp || new Date(),
      url: `k8s://${clusterName}/${k8sEvent.metadata?.namespace}/events/${k8sEvent.metadata?.name}`,
      status: k8sEvent.type?.toLowerCase() || 'normal',
      metadata: {
        cluster: clusterName,
        namespace: k8sEvent.metadata?.namespace,
        event_type: k8sEvent.type,
        reason: k8sEvent.reason,
        involved_object: {
          kind: involvedObject.kind,
          name: involvedObject.name,
          namespace: involvedObject.namespace,
          uid: involvedObject.uid,
        },
      },
      eventMetadata: {
        resourceType: 'event',
        count: k8sEvent.count,
        first_timestamp: k8sEvent.firstTimestamp,
        last_timestamp: k8sEvent.lastTimestamp,
        reporting_component: k8sEvent.reportingComponent,
        reporting_instance: k8sEvent.reportingInstance,
        source_component: k8sEvent.source?.component,
        source_host: k8sEvent.source?.host,
      },
    }

    await this.prisma.changeEvent.create({ data: event as any })
    console.log(`[Kubernetes] Stored K8s Event: ${k8sEvent.type} - ${k8sEvent.reason} - ${objectRef}`)
  }

  private hasConfigMapChanges(cm: k8s.V1ConfigMap): boolean {
    const cacheKey = `${cm.metadata?.namespace}:configmap:${cm.metadata?.name}`
    const cached = this.resourceCache.get(cacheKey)
    const currentKeys = Object.keys(cm.data || {}).sort()
    const currentData = cm.data || {}

    if (!cached) {
      this.resourceCache.set(cacheKey, { keys: currentKeys, data: currentData })
      return false
    }

    const cachedKeys = cached.keys || []
    const cachedData = cached.data || {}

    // Check if keys changed or values changed
    const keysChanged = JSON.stringify(currentKeys) !== JSON.stringify(cachedKeys)
    const valuesChanged = JSON.stringify(currentData) !== JSON.stringify(cachedData)

    if (keysChanged || valuesChanged) {
      this.resourceCache.set(cacheKey, { keys: currentKeys, data: currentData })
      return true
    }

    return false
  }

  private hasSecretChanges(secret: k8s.V1Secret): boolean {
    const cacheKey = `${secret.metadata?.namespace}:secret:${secret.metadata?.name}`
    const cached = this.resourceCache.get(cacheKey)
    const currentKeys = Object.keys(secret.data || {}).sort()

    if (!cached) {
      this.resourceCache.set(cacheKey, { keys: currentKeys })
      return false
    }

    const cachedKeys = cached.keys || []

    // Only check if keys changed (not values for security)
    const keysChanged = JSON.stringify(currentKeys) !== JSON.stringify(cachedKeys)

    if (keysChanged) {
      this.resourceCache.set(cacheKey, { keys: currentKeys })
      return true
    }

    return false
  }

  private async storeConfigMapEvent(connectionId: number, eventType: string, cm: k8s.V1ConfigMap, clusterName: string): Promise<void> {
    const externalId = `${clusterName}:${cm.metadata?.namespace}:configmap:${cm.metadata?.name}:${cm.metadata?.resourceVersion}`

    const existing = await this.prisma.changeEvent.findFirst({
      where: { connectionId, externalId },
    })
    if (existing) return

    const cacheKey = `${cm.metadata?.namespace}:configmap:${cm.metadata?.name}`
    const cached = this.resourceCache.get(cacheKey)
    const currentKeys = Object.keys(cm.data || {})
    const currentData = cm.data || {}

    let keysAdded: string[] = []
    let keysRemoved: string[] = []
    let keysModified: string[] = []

    if (eventType === 'MODIFIED' && cached) {
      const cachedKeys = cached.keys || []
      const cachedData = cached.data || {}

      keysAdded = currentKeys.filter(k => !cachedKeys.includes(k))
      keysRemoved = cachedKeys.filter(k => !currentKeys.includes(k))
      keysModified = currentKeys.filter(k =>
        cachedKeys.includes(k) && currentData[k] !== cachedData[k]
      )
    }

    const title = eventType === 'DELETED'
      ? `[ConfigMap Deleted] ${cm.metadata?.name}`
      : eventType === 'ADDED'
      ? `[ConfigMap Created] ${cm.metadata?.name}`
      : `[ConfigMap Updated] ${cm.metadata?.name}`

    const changesSummary = eventType === 'MODIFIED'
      ? ` (${keysAdded.length} added, ${keysModified.length} modified, ${keysRemoved.length} removed)`
      : ''

    const event: CreateChangeEventDto = {
      connectionId,
      externalId,
      source: 'kubernetes',
      eventType: 'K8sConfigMap',
      title: title + changesSummary,
      description: `ConfigMap ${eventType.toLowerCase()} in namespace ${cm.metadata?.namespace}`,
      timestamp: cm.metadata?.creationTimestamp || new Date(),
      url: `k8s://${clusterName}/${cm.metadata?.namespace}/configmaps/${cm.metadata?.name}`,
      status: eventType.toLowerCase(),
      metadata: {
        cluster: clusterName,
        namespace: cm.metadata?.namespace,
        labels: cm.metadata?.labels || {},
        keys: currentKeys,
        num_keys: currentKeys.length,
      },
      eventMetadata: {
        resourceType: 'configmap',
        data: currentData,
        keys_added: keysAdded,
        keys_removed: keysRemoved,
        keys_modified: keysModified,
      },
    }

    await this.prisma.changeEvent.create({ data: event as any })
    console.log(`[Kubernetes] Stored ConfigMap event: ${eventType} - ${cm.metadata?.namespace}/${cm.metadata?.name}`)
  }

  private async storeSecretEvent(connectionId: number, eventType: string, secret: k8s.V1Secret, clusterName: string): Promise<void> {
    const externalId = `${clusterName}:${secret.metadata?.namespace}:secret:${secret.metadata?.name}:${secret.metadata?.resourceVersion}`

    const existing = await this.prisma.changeEvent.findFirst({
      where: { connectionId, externalId },
    })
    if (existing) return

    const cacheKey = `${secret.metadata?.namespace}:secret:${secret.metadata?.name}`
    const cached = this.resourceCache.get(cacheKey)
    const currentKeys = Object.keys(secret.data || {})

    let keysAdded: string[] = []
    let keysRemoved: string[] = []

    if (eventType === 'MODIFIED' && cached) {
      const cachedKeys = cached.keys || []
      keysAdded = currentKeys.filter(k => !cachedKeys.includes(k))
      keysRemoved = cachedKeys.filter(k => !currentKeys.includes(k))
    }

    const title = eventType === 'DELETED'
      ? `[Secret Deleted] ${secret.metadata?.name}`
      : eventType === 'ADDED'
      ? `[Secret Created] ${secret.metadata?.name}`
      : `[Secret Updated] ${secret.metadata?.name}`

    const changesSummary = eventType === 'MODIFIED'
      ? ` (${keysAdded.length} keys added, ${keysRemoved.length} keys removed)`
      : ''

    const event: CreateChangeEventDto = {
      connectionId,
      externalId,
      source: 'kubernetes',
      eventType: 'K8sSecret',
      title: title + changesSummary,
      description: `Secret ${eventType.toLowerCase()} in namespace ${secret.metadata?.namespace}`,
      timestamp: secret.metadata?.creationTimestamp || new Date(),
      url: `k8s://${clusterName}/${secret.metadata?.namespace}/secrets/${secret.metadata?.name}`,
      status: eventType.toLowerCase(),
      metadata: {
        cluster: clusterName,
        namespace: secret.metadata?.namespace,
        labels: secret.metadata?.labels || {},
        type: secret.type,
        keys: currentKeys,
        num_keys: currentKeys.length,
      },
      eventMetadata: {
        resourceType: 'secret',
        keys_added: keysAdded,
        keys_removed: keysRemoved,
        // Do NOT store secret values for security
      },
    }

    await this.prisma.changeEvent.create({ data: event as any })
    console.log(`[Kubernetes] Stored Secret event: ${eventType} - ${secret.metadata?.namespace}/${secret.metadata?.name}`)
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
