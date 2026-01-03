import * as k8s from '@kubernetes/client-node';
import { PainChainEvent } from './types';

/**
 * Transform Pod events to PainChain format
 */
export function transformPodEvent(
  eventType: string,
  pod: k8s.V1Pod,
  clusterName: string
): PainChainEvent | null {
  const namespace = pod.metadata?.namespace || 'default';
  const podName = pod.metadata?.name || 'unknown';

  // Determine if this is a significant event
  if (!isSignificantPodEvent(eventType, pod)) {
    return null;
  }

  // Extract container statuses
  const containers = (pod.status?.containerStatuses || []).map(cs => ({
    name: cs.name,
    image: cs.image,
    ready: cs.ready,
    restartCount: cs.restartCount,
    state: cs.state?.running ? 'running' :
           cs.state?.waiting ? `waiting: ${cs.state.waiting.reason}` :
           cs.state?.terminated ? `terminated: ${cs.state.terminated.reason}` : 'unknown',
  }));

  // Determine title based on event type and status
  const failedContainer = containers.find(c => c.state?.includes('terminated'));
  const waitingContainer = containers.find(c => c.state?.includes('waiting'));

  let title = '';
  if (eventType === 'DELETED') {
    title = `Pod Deleted: ${podName}`;
  } else if (eventType === 'ADDED') {
    title = `Pod Created: ${podName}`;
  } else if (failedContainer) {
    title = `Pod ${failedContainer.state}: ${podName}`;
  } else if (waitingContainer) {
    title = `Pod ${waitingContainer.state}: ${podName}`;
  } else {
    title = `Pod Updated: ${podName}`;
  }

  return {
    title,
    connector: 'kubernetes',
    project: `${clusterName}:${namespace}`,
    timestamp: new Date(pod.metadata?.creationTimestamp || Date.now()),
    externalId: `k8s-pod-${clusterName}-${namespace}-${podName}-${pod.metadata?.resourceVersion}`,
    data: {
      event_type: 'pod',
      action: eventType.toLowerCase(),
      pod_name: podName,
      namespace,
      cluster: clusterName,
      phase: pod.status?.phase,
      node: pod.spec?.nodeName,
      containers,
      labels: pod.metadata?.labels || {},
      conditions: (pod.status?.conditions || []).map(c => ({
        type: c.type,
        status: c.status,
        reason: c.reason,
      })),
    },
  };
}

function isSignificantPodEvent(eventType: string, pod: k8s.V1Pod): boolean {
  // Always track deletions
  if (eventType === 'DELETED') return true;

  // Track new pods once they're beyond pending
  if (eventType === 'ADDED' && pod.status?.phase !== 'Pending') return true;

  // Track modifications with issues
  if (eventType === 'MODIFIED' && pod.status?.containerStatuses) {
    for (const cs of pod.status.containerStatuses) {
      // Check for crash loops, image pull failures, etc.
      if (cs.state?.waiting) {
        const reason = cs.state.waiting.reason || '';
        if (['CrashLoopBackOff', 'ImagePullBackOff', 'ErrImagePull'].includes(reason)) {
          return true;
        }
      }
      // Check for container failures
      if (cs.state?.terminated && cs.state.terminated.exitCode !== 0) {
        return true;
      }
      // Check for restarts
      if (cs.restartCount > 0) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Transform Deployment events to PainChain format
 */
export function transformDeploymentEvent(
  eventType: string,
  deployment: k8s.V1Deployment,
  clusterName: string
): PainChainEvent | null {
  const namespace = deployment.metadata?.namespace || 'default';
  const name = deployment.metadata?.name || 'unknown';

  const title = eventType === 'DELETED'
    ? `Deployment Deleted: ${name}`
    : eventType === 'ADDED'
    ? `Deployment Created: ${name}`
    : `Deployment Updated: ${name}`;

  const images = (deployment.spec?.template?.spec?.containers || []).map(c => c.image);

  return {
    title,
    connector: 'kubernetes',
    project: `${clusterName}:${namespace}`,
    timestamp: new Date(deployment.metadata?.creationTimestamp || Date.now()),
    externalId: `k8s-deployment-${clusterName}-${namespace}-${name}-${deployment.metadata?.resourceVersion}`,
    data: {
      event_type: 'deployment',
      action: eventType.toLowerCase(),
      deployment_name: name,
      namespace,
      cluster: clusterName,
      replicas: deployment.spec?.replicas || 0,
      ready_replicas: deployment.status?.readyReplicas || 0,
      available_replicas: deployment.status?.availableReplicas || 0,
      images,
      labels: deployment.metadata?.labels || {},
      strategy: deployment.spec?.strategy?.type,
    },
  };
}

/**
 * Transform Service events to PainChain format
 */
export function transformServiceEvent(
  eventType: string,
  service: k8s.V1Service,
  clusterName: string
): PainChainEvent | null {
  const namespace = service.metadata?.namespace || 'default';
  const name = service.metadata?.name || 'unknown';

  const title = eventType === 'DELETED'
    ? `Service Deleted: ${name}`
    : eventType === 'ADDED'
    ? `Service Created: ${name}`
    : `Service Updated: ${name}`;

  const ports = (service.spec?.ports || []).map(p => ({
    port: p.port,
    targetPort: p.targetPort,
    protocol: p.protocol,
  }));

  return {
    title,
    connector: 'kubernetes',
    project: `${clusterName}:${namespace}`,
    timestamp: new Date(service.metadata?.creationTimestamp || Date.now()),
    externalId: `k8s-service-${clusterName}-${namespace}-${name}-${service.metadata?.resourceVersion}`,
    data: {
      event_type: 'service',
      action: eventType.toLowerCase(),
      service_name: name,
      namespace,
      cluster: clusterName,
      type: service.spec?.type,
      cluster_ip: service.spec?.clusterIP,
      ports,
      labels: service.metadata?.labels || {},
    },
  };
}

/**
 * Transform Kubernetes Event objects to PainChain format
 */
export function transformK8sEvent(
  k8sEvent: k8s.CoreV1Event,
  clusterName: string
): PainChainEvent | null {
  // Only track Warning events and important Normal events
  if (!isSignificantK8sEvent(k8sEvent)) return null;

  const namespace = k8sEvent.metadata?.namespace || 'default';
  const involvedObject = k8sEvent.involvedObject;
  const objectRef = `${involvedObject.kind}/${involvedObject.name}`;

  const title = `K8s Event [${k8sEvent.type}]: ${k8sEvent.reason} - ${objectRef}`;

  return {
    title,
    connector: 'kubernetes',
    project: `${clusterName}:${namespace}`,
    timestamp: new Date(k8sEvent.lastTimestamp || k8sEvent.firstTimestamp || Date.now()),
    externalId: `k8s-event-${clusterName}-${namespace}-${k8sEvent.metadata?.name}-${k8sEvent.count}`,
    data: {
      event_type: 'k8s_event',
      reason: k8sEvent.reason,
      message: k8sEvent.message,
      type: k8sEvent.type,
      count: k8sEvent.count || 1,
      namespace,
      cluster: clusterName,
      involved_object: {
        kind: involvedObject.kind,
        name: involvedObject.name,
        namespace: involvedObject.namespace,
      },
    },
  };
}

function isSignificantK8sEvent(event: k8s.CoreV1Event): boolean {
  // Always store Warning events
  if (event.type === 'Warning') return true;

  // Store important Normal events
  const importantReasons = [
    'Pulling',
    'Pulled',
    'Created',
    'Started',
    'Killing',
    'Scheduled',
    'FailedScheduling',
    'SuccessfulCreate',
    'SuccessfulDelete',
    'ScalingReplicaSet',
    'Unhealthy',
    'BackOff',
  ];

  return importantReasons.includes(event.reason || '');
}

/**
 * Transform StatefulSet events to PainChain format
 */
export function transformStatefulSetEvent(
  eventType: string,
  statefulSet: k8s.V1StatefulSet,
  clusterName: string
): PainChainEvent | null {
  const namespace = statefulSet.metadata?.namespace || 'default';
  const name = statefulSet.metadata?.name || 'unknown';

  const title = eventType === 'DELETED'
    ? `StatefulSet Deleted: ${name}`
    : eventType === 'ADDED'
    ? `StatefulSet Created: ${name}`
    : `StatefulSet Updated: ${name}`;

  return {
    title,
    connector: 'kubernetes',
    project: `${clusterName}:${namespace}`,
    timestamp: new Date(statefulSet.metadata?.creationTimestamp || Date.now()),
    externalId: `k8s-statefulset-${clusterName}-${namespace}-${name}-${statefulSet.metadata?.resourceVersion}`,
    data: {
      event_type: 'statefulset',
      action: eventType.toLowerCase(),
      statefulset_name: name,
      namespace,
      cluster: clusterName,
      replicas: statefulSet.spec?.replicas || 0,
      ready_replicas: statefulSet.status?.readyReplicas || 0,
      current_replicas: statefulSet.status?.currentReplicas || 0,
      labels: statefulSet.metadata?.labels || {},
    },
  };
}

/**
 * Transform DaemonSet events to PainChain format
 */
export function transformDaemonSetEvent(
  eventType: string,
  daemonSet: k8s.V1DaemonSet,
  clusterName: string
): PainChainEvent | null {
  const namespace = daemonSet.metadata?.namespace || 'default';
  const name = daemonSet.metadata?.name || 'unknown';

  const title = eventType === 'DELETED'
    ? `DaemonSet Deleted: ${name}`
    : eventType === 'ADDED'
    ? `DaemonSet Created: ${name}`
    : `DaemonSet Updated: ${name}`;

  return {
    title,
    connector: 'kubernetes',
    project: `${clusterName}:${namespace}`,
    timestamp: new Date(daemonSet.metadata?.creationTimestamp || Date.now()),
    externalId: `k8s-daemonset-${clusterName}-${namespace}-${name}-${daemonSet.metadata?.resourceVersion}`,
    data: {
      event_type: 'daemonset',
      action: eventType.toLowerCase(),
      daemonset_name: name,
      namespace,
      cluster: clusterName,
      desired_number_scheduled: daemonSet.status?.desiredNumberScheduled || 0,
      current_number_scheduled: daemonSet.status?.currentNumberScheduled || 0,
      number_ready: daemonSet.status?.numberReady || 0,
      labels: daemonSet.metadata?.labels || {},
    },
  };
}

/**
 * Transform ConfigMap events to PainChain format
 */
export function transformConfigMapEvent(
  eventType: string,
  configMap: k8s.V1ConfigMap,
  clusterName: string
): PainChainEvent | null {
  const namespace = configMap.metadata?.namespace || 'default';
  const name = configMap.metadata?.name || 'unknown';

  const title = eventType === 'DELETED'
    ? `ConfigMap Deleted: ${name}`
    : eventType === 'ADDED'
    ? `ConfigMap Created: ${name}`
    : `ConfigMap Updated: ${name}`;

  const data = configMap.data || {};
  const keyNames = Object.keys(data);

  return {
    title,
    connector: 'kubernetes',
    project: `${clusterName}:${namespace}`,
    timestamp: new Date(configMap.metadata?.creationTimestamp || Date.now()),
    externalId: `k8s-configmap-${clusterName}-${namespace}-${name}-${configMap.metadata?.resourceVersion}`,
    data: {
      event_type: 'configmap',
      action: eventType.toLowerCase(),
      configmap_name: name,
      namespace,
      cluster: clusterName,
      keys_count: keyNames.length,
      keys: keyNames, // Key names only, not values
      labels: configMap.metadata?.labels || {},
    },
  };
}

/**
 * Transform Secret events to PainChain format
 * SECURITY: Never captures secret values, only metadata
 * NOTE: Helm releases are detected and transformed separately
 */
export function transformSecretEvent(
  eventType: string,
  secret: k8s.V1Secret,
  clusterName: string
): PainChainEvent | null {
  // Check if this is a Helm release secret
  if (isHelmRelease(secret)) {
    return transformHelmReleaseEvent(eventType, secret, clusterName);
  }

  const namespace = secret.metadata?.namespace || 'default';
  const name = secret.metadata?.name || 'unknown';

  const title = eventType === 'DELETED'
    ? `Secret Deleted: ${name}`
    : eventType === 'ADDED'
    ? `Secret Created: ${name}`
    : `Secret Updated: ${name}`;

  const data = secret.data || {};
  const keyNames = Object.keys(data);

  return {
    title,
    connector: 'kubernetes',
    project: `${clusterName}:${namespace}`,
    timestamp: new Date(secret.metadata?.creationTimestamp || Date.now()),
    externalId: `k8s-secret-${clusterName}-${namespace}-${name}-${secret.metadata?.resourceVersion}`,
    data: {
      event_type: 'secret',
      action: eventType.toLowerCase(),
      secret_name: name,
      namespace,
      cluster: clusterName,
      type: secret.type,
      keys_count: keyNames.length,
      keys: keyNames, // Key names only, NEVER values
      labels: secret.metadata?.labels || {},
    },
  };
}

/**
 * Transform Job events to PainChain format
 */
export function transformJobEvent(
  eventType: string,
  job: k8s.V1Job,
  clusterName: string
): PainChainEvent | null {
  const namespace = job.metadata?.namespace || 'default';
  const name = job.metadata?.name || 'unknown';

  // Determine job status
  let statusText = 'created';
  if (job.status?.succeeded && job.status.succeeded > 0) {
    statusText = 'succeeded';
  } else if (job.status?.failed && job.status.failed > 0) {
    statusText = 'failed';
  } else if (job.status?.active && job.status.active > 0) {
    statusText = 'running';
  }

  const title = eventType === 'DELETED'
    ? `Job Deleted: ${name}`
    : eventType === 'ADDED'
    ? `Job Created: ${name}`
    : `Job ${statusText}: ${name}`;

  return {
    title,
    connector: 'kubernetes',
    project: `${clusterName}:${namespace}`,
    timestamp: new Date(job.metadata?.creationTimestamp || Date.now()),
    externalId: `k8s-job-${clusterName}-${namespace}-${name}-${job.metadata?.resourceVersion}`,
    data: {
      event_type: 'job',
      action: eventType.toLowerCase(),
      job_name: name,
      namespace,
      cluster: clusterName,
      status: statusText,
      active: job.status?.active || 0,
      succeeded: job.status?.succeeded || 0,
      failed: job.status?.failed || 0,
      parallelism: job.spec?.parallelism || 1,
      completions: job.spec?.completions || 1,
      labels: job.metadata?.labels || {},
    },
  };
}

/**
 * Transform CronJob events to PainChain format
 */
export function transformCronJobEvent(
  eventType: string,
  cronJob: k8s.V1CronJob,
  clusterName: string
): PainChainEvent | null {
  const namespace = cronJob.metadata?.namespace || 'default';
  const name = cronJob.metadata?.name || 'unknown';

  const title = eventType === 'DELETED'
    ? `CronJob Deleted: ${name}`
    : eventType === 'ADDED'
    ? `CronJob Created: ${name}`
    : `CronJob Updated: ${name}`;

  return {
    title,
    connector: 'kubernetes',
    project: `${clusterName}:${namespace}`,
    timestamp: new Date(cronJob.metadata?.creationTimestamp || Date.now()),
    externalId: `k8s-cronjob-${clusterName}-${namespace}-${name}-${cronJob.metadata?.resourceVersion}`,
    data: {
      event_type: 'cronjob',
      action: eventType.toLowerCase(),
      cronjob_name: name,
      namespace,
      cluster: clusterName,
      schedule: cronJob.spec?.schedule,
      suspend: cronJob.spec?.suspend || false,
      last_schedule_time: cronJob.status?.lastScheduleTime,
      active_jobs: cronJob.status?.active?.length || 0,
      labels: cronJob.metadata?.labels || {},
    },
  };
}

/**
 * Transform PersistentVolume events to PainChain format
 */
export function transformPersistentVolumeEvent(
  eventType: string,
  pv: k8s.V1PersistentVolume,
  clusterName: string
): PainChainEvent | null {
  const name = pv.metadata?.name || 'unknown';

  const title = eventType === 'DELETED'
    ? `PersistentVolume Deleted: ${name}`
    : eventType === 'ADDED'
    ? `PersistentVolume Created: ${name}`
    : `PersistentVolume ${pv.status?.phase || 'Updated'}: ${name}`;

  return {
    title,
    connector: 'kubernetes',
    project: `${clusterName}:cluster-wide`,
    timestamp: new Date(pv.metadata?.creationTimestamp || Date.now()),
    externalId: `k8s-pv-${clusterName}-${name}-${pv.metadata?.resourceVersion}`,
    data: {
      event_type: 'persistentvolume',
      action: eventType.toLowerCase(),
      pv_name: name,
      cluster: clusterName,
      capacity: pv.spec?.capacity?.storage,
      storage_class: pv.spec?.storageClassName,
      access_modes: pv.spec?.accessModes || [],
      phase: pv.status?.phase,
      claim_ref: pv.spec?.claimRef ? `${pv.spec.claimRef.namespace}/${pv.spec.claimRef.name}` : null,
      labels: pv.metadata?.labels || {},
    },
  };
}

/**
 * Transform PersistentVolumeClaim events to PainChain format
 */
export function transformPersistentVolumeClaimEvent(
  eventType: string,
  pvc: k8s.V1PersistentVolumeClaim,
  clusterName: string
): PainChainEvent | null {
  const namespace = pvc.metadata?.namespace || 'default';
  const name = pvc.metadata?.name || 'unknown';

  const title = eventType === 'DELETED'
    ? `PersistentVolumeClaim Deleted: ${name}`
    : eventType === 'ADDED'
    ? `PersistentVolumeClaim Created: ${name}`
    : `PersistentVolumeClaim ${pvc.status?.phase || 'Updated'}: ${name}`;

  return {
    title,
    connector: 'kubernetes',
    project: `${clusterName}:${namespace}`,
    timestamp: new Date(pvc.metadata?.creationTimestamp || Date.now()),
    externalId: `k8s-pvc-${clusterName}-${namespace}-${name}-${pvc.metadata?.resourceVersion}`,
    data: {
      event_type: 'persistentvolumeclaim',
      action: eventType.toLowerCase(),
      pvc_name: name,
      namespace,
      cluster: clusterName,
      requested_storage: pvc.spec?.resources?.requests?.storage,
      storage_class: pvc.spec?.storageClassName,
      access_modes: pvc.spec?.accessModes || [],
      phase: pvc.status?.phase,
      volume_name: pvc.spec?.volumeName,
      labels: pvc.metadata?.labels || {},
    },
  };
}

/**
 * Transform Ingress events to PainChain format
 */
export function transformIngressEvent(
  eventType: string,
  ingress: k8s.V1Ingress,
  clusterName: string
): PainChainEvent | null {
  const namespace = ingress.metadata?.namespace || 'default';
  const name = ingress.metadata?.name || 'unknown';

  const title = eventType === 'DELETED'
    ? `Ingress Deleted: ${name}`
    : eventType === 'ADDED'
    ? `Ingress Created: ${name}`
    : `Ingress Updated: ${name}`;

  // Extract hosts
  const hosts: string[] = [];
  const rules = ingress.spec?.rules || [];
  for (const rule of rules) {
    if (rule.host) hosts.push(rule.host);
  }

  return {
    title,
    connector: 'kubernetes',
    project: `${clusterName}:${namespace}`,
    timestamp: new Date(ingress.metadata?.creationTimestamp || Date.now()),
    externalId: `k8s-ingress-${clusterName}-${namespace}-${name}-${ingress.metadata?.resourceVersion}`,
    data: {
      event_type: 'ingress',
      action: eventType.toLowerCase(),
      ingress_name: name,
      namespace,
      cluster: clusterName,
      ingress_class: ingress.spec?.ingressClassName,
      hosts,
      tls_enabled: (ingress.spec?.tls?.length || 0) > 0,
      load_balancer_ips: ingress.status?.loadBalancer?.ingress?.map(i => i.ip || i.hostname) || [],
      labels: ingress.metadata?.labels || {},
    },
  };
}

/**
 * Transform IngressClass events to PainChain format
 */
export function transformIngressClassEvent(
  eventType: string,
  ingressClass: k8s.V1IngressClass,
  clusterName: string
): PainChainEvent | null {
  const name = ingressClass.metadata?.name || 'unknown';

  const title = eventType === 'DELETED'
    ? `IngressClass Deleted: ${name}`
    : eventType === 'ADDED'
    ? `IngressClass Created: ${name}`
    : `IngressClass Updated: ${name}`;

  return {
    title,
    connector: 'kubernetes',
    project: `${clusterName}:cluster-wide`,
    timestamp: new Date(ingressClass.metadata?.creationTimestamp || Date.now()),
    externalId: `k8s-ingressclass-${clusterName}-${name}-${ingressClass.metadata?.resourceVersion}`,
    data: {
      event_type: 'ingressclass',
      action: eventType.toLowerCase(),
      ingressclass_name: name,
      cluster: clusterName,
      controller: ingressClass.spec?.controller,
      is_default: ingressClass.metadata?.annotations?.['ingressclass.kubernetes.io/is-default-class'] === 'true',
      labels: ingressClass.metadata?.labels || {},
    },
  };
}

/**
 * Transform StorageClass events to PainChain format
 */
export function transformStorageClassEvent(
  eventType: string,
  storageClass: k8s.V1StorageClass,
  clusterName: string
): PainChainEvent | null {
  const name = storageClass.metadata?.name || 'unknown';

  const title = eventType === 'DELETED'
    ? `StorageClass Deleted: ${name}`
    : eventType === 'ADDED'
    ? `StorageClass Created: ${name}`
    : `StorageClass Updated: ${name}`;

  return {
    title,
    connector: 'kubernetes',
    project: `${clusterName}:cluster-wide`,
    timestamp: new Date(storageClass.metadata?.creationTimestamp || Date.now()),
    externalId: `k8s-storageclass-${clusterName}-${name}-${storageClass.metadata?.resourceVersion}`,
    data: {
      event_type: 'storageclass',
      action: eventType.toLowerCase(),
      storageclass_name: name,
      cluster: clusterName,
      provisioner: storageClass.provisioner,
      reclaim_policy: storageClass.reclaimPolicy,
      volume_binding_mode: storageClass.volumeBindingMode,
      allow_volume_expansion: storageClass.allowVolumeExpansion || false,
      labels: storageClass.metadata?.labels || {},
    },
  };
}

/**
 * Check if a Secret is a Helm release
 */
export function isHelmRelease(secret: k8s.V1Secret): boolean {
  const labels = secret.metadata?.labels || {};
  return labels['owner'] === 'helm' && secret.type === 'helm.sh/release.v1';
}

/**
 * Transform Helm release (from Secret) to PainChain format
 */
export function transformHelmReleaseEvent(
  eventType: string,
  secret: k8s.V1Secret,
  clusterName: string
): PainChainEvent | null {
  const namespace = secret.metadata?.namespace || 'default';
  const labels = secret.metadata?.labels || {};

  // Extract Helm release info from labels
  const releaseName = labels['name'] || 'unknown';
  const releaseVersion = labels['version'] || 'unknown';
  const releaseStatus = labels['status'] || 'unknown';

  // Parse release data if available (it's base64 encoded and gzipped in the secret)
  // For now, we'll just capture metadata from labels

  const title = eventType === 'DELETED'
    ? `Helm Release Uninstalled: ${releaseName}`
    : eventType === 'ADDED'
    ? `Helm Release Installed: ${releaseName}`
    : `Helm Release Updated: ${releaseName} (v${releaseVersion})`;

  return {
    title,
    connector: 'kubernetes',
    project: `${clusterName}:${namespace}`,
    timestamp: new Date(secret.metadata?.creationTimestamp || Date.now()),
    externalId: `k8s-helm-${clusterName}-${namespace}-${releaseName}-${releaseVersion}`,
    data: {
      event_type: 'helm_release',
      action: eventType.toLowerCase(),
      release_name: releaseName,
      namespace,
      cluster: clusterName,
      version: releaseVersion,
      status: releaseStatus,
      labels: labels,
    },
  };
}
