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

  // Only track service creation and deletion (not modifications)
  if (eventType === 'MODIFIED') return null;

  const title = eventType === 'DELETED'
    ? `Service Deleted: ${name}`
    : `Service Created: ${name}`;

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
