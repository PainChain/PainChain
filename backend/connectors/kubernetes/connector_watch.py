import os
import sys
from datetime import datetime, timezone
from typing import List, Dict, Optional, Any
from kubernetes import client, config, watch
from kubernetes.client.rest import ApiException
import hashlib
import json

# Add parent directory to path to import shared modules
sys.path.insert(0, '/app')
from shared import ChangeEvent, SessionLocal, Connection

class KubernetesWatchConnector:
    """
    Kubernetes connector using Watch API for real-time change tracking.

    Uses resourceVersion to ensure no events are missed between polling intervals.
    Implements smart filtering to only store significant changes relevant for RCA.

    Tracks:
    - Pods (crashes, restarts, failures)
    - Deployments (rollouts, image changes, scaling)
    - StatefulSets (similar to Deployments)
    - DaemonSets (similar to Deployments)
    - Services (type changes, port changes)
    - ConfigMaps (content changes)
    - Secrets (metadata changes only)
    - Ingress (host/rule changes)
    - Roles/RoleBindings (RBAC changes)
    """

    def __init__(self, api_server: Optional[str] = None, token: Optional[str] = None,
                 namespaces: List[str] = None, cluster_name: str = "default",
                 verify_ssl: bool = False):
        """
        Initialize Kubernetes Watch connector.

        Args:
            api_server: Kubernetes API server URL (None for in-cluster config)
            token: Service account bearer token (None for in-cluster config)
            namespaces: List of namespaces to monitor (empty list for all)
            cluster_name: Cluster identifier for tagging
            verify_ssl: Whether to verify SSL certificates (default False for development)
        """
        self.api_server = api_server
        self.token = token
        self.namespaces = namespaces or []
        self.cluster_name = cluster_name

        # Cache for tracking previous state of resources
        self._resource_cache = {}

        # Initialize Kubernetes client
        try:
            if api_server and token:
                print(f"Configuring Kubernetes client with API server: {api_server}")
                configuration = client.Configuration()
                configuration.host = api_server
                configuration.api_key = {"authorization": f"Bearer {token}"}
                configuration.verify_ssl = verify_ssl
                if not verify_ssl:
                    import urllib3
                    urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
                client.Configuration.set_default(configuration)
            else:
                try:
                    config.load_incluster_config()
                except config.ConfigException:
                    config.load_kube_config()

            self.apps_v1 = client.AppsV1Api()
            self.core_v1 = client.CoreV1Api()
            self.networking_v1 = client.NetworkingV1Api()
            self.rbac_v1 = client.RbacAuthorizationV1Api()
            print("Kubernetes API clients initialized")

        except Exception as e:
            print(f"Failed to initialize Kubernetes client: {e}")
            import traceback
            traceback.print_exc()
            raise

    def test_connection(self) -> bool:
        """Test Kubernetes API connectivity."""
        try:
            self.core_v1.list_namespace()
            return True
        except ApiException as e:
            print(f"Failed to connect to Kubernetes API: {e}")
            return False

    def get_namespaces(self) -> List[str]:
        """Get list of namespaces to monitor."""
        if self.namespaces:
            return self.namespaces

        try:
            ns_list = self.core_v1.list_namespace()
            return [ns.metadata.name for ns in ns_list.items]
        except ApiException as e:
            print(f"Failed to list namespaces: {e}")
            return []

    def _get_resource_versions(self, connection_id: int) -> Dict[str, str]:
        """Get stored resourceVersions from connection config."""
        session = SessionLocal()
        try:
            connection = session.query(Connection).filter_by(id=connection_id).first()
            if connection and connection.config:
                return connection.config.get('resource_versions', {})
            return {}
        finally:
            session.close()

    def _save_resource_version(self, connection_id: int, resource_type: str, resource_version: str):
        """Save resourceVersion to connection config for continuity."""
        session = SessionLocal()
        try:
            connection = session.query(Connection).filter_by(id=connection_id).first()
            if connection:
                config_data = dict(connection.config or {})  # Create new dict to trigger SQLAlchemy change detection
                if 'resource_versions' not in config_data:
                    config_data['resource_versions'] = {}
                config_data['resource_versions'][resource_type] = resource_version
                connection.config = config_data
                from sqlalchemy.orm.attributes import flag_modified
                flag_modified(connection, 'config')  # Explicitly mark as modified
                session.commit()
                print(f"Saved resourceVersion for {resource_type}: {resource_version}")
        finally:
            session.close()

    def fetch_and_store_changes(self, connection_id: int, since: Optional[datetime] = None):
        """
        Fetch changes using Watch API with resourceVersion tracking.

        This method polls for changes with a timeout, processing all events since
        the last resourceVersion. Watches run in parallel for speed.
        """
        import threading

        print(f"Starting parallel Watch API polling for cluster: {self.cluster_name}")

        # Get stored resourceVersions
        resource_versions = self._get_resource_versions(connection_id)

        # Define all watch operations
        watch_operations = [
            ('pods', self._watch_pods, resource_versions.get('pods')),
            ('deployments', self._watch_deployments, resource_versions.get('deployments')),
            ('statefulsets', self._watch_statefulsets, resource_versions.get('statefulsets')),
            ('daemonsets', self._watch_daemonsets, resource_versions.get('daemonsets')),
            ('services', self._watch_services, resource_versions.get('services')),
            ('configmaps', self._watch_configmaps, resource_versions.get('configmaps')),
            ('secrets', self._watch_secrets, resource_versions.get('secrets')),
            ('ingresses', self._watch_ingresses, resource_versions.get('ingresses')),
            ('roles', self._watch_roles, resource_versions.get('roles')),
            ('rolebindings', self._watch_rolebindings, resource_versions.get('rolebindings')),
        ]

        # Run all watches in parallel
        threads = []
        for name, watch_func, resource_version in watch_operations:
            thread = threading.Thread(
                target=watch_func,
                args=(connection_id, resource_version),
                name=f"watch-{name}"
            )
            thread.start()
            threads.append(thread)

        # Wait for all watches to complete
        for thread in threads:
            thread.join()

        print(f"Completed parallel Watch API polling for cluster: {self.cluster_name}")

    def _watch_pods(self, connection_id: int, resource_version: Optional[str] = None):
        """Watch Pod events with smart filtering."""
        print(f"Watching Pods (resourceVersion: {resource_version or 'initial'})")

        w = watch.Watch()
        try:
            # Watch for 10 seconds or until we catch up
            stream_kwargs = {'timeout_seconds': 10}
            if resource_version:
                stream_kwargs['resource_version'] = resource_version

            for event in w.stream(
                self.core_v1.list_pod_for_all_namespaces,
                **stream_kwargs
            ):
                event_type = event['type']  # ADDED, MODIFIED, DELETED
                pod = event['object']

                # Update resourceVersion
                if pod.metadata.resource_version:
                    self._save_resource_version(connection_id, 'pods', pod.metadata.resource_version)

                # Filter for significant changes
                if self._is_significant_pod_event(event_type, pod):
                    self._store_pod_event(connection_id, event_type, pod)

        except ApiException as e:
            if e.status == 410:  # Gone - resourceVersion too old
                print(f"ResourceVersion expired for pods, resyncing...")
                self._save_resource_version(connection_id, 'pods', None)
            else:
                print(f"Error watching pods: {e}")
        finally:
            w.stop()

    def _is_significant_pod_event(self, event_type: str, pod) -> bool:
        """Determine if pod event is significant for RCA."""
        # Always record ADDED and DELETED
        if event_type in ['ADDED', 'DELETED']:
            return True

        # For MODIFIED, check for significant state changes
        if event_type == 'MODIFIED':
            status = pod.status

            # Check for failure states
            if status.container_statuses:
                for cs in status.container_statuses:
                    # Waiting states indicate problems
                    if cs.state and cs.state.waiting:
                        reason = cs.state.waiting.reason
                        if reason in ['CrashLoopBackOff', 'ImagePullBackOff',
                                     'ErrImagePull', 'CreateContainerConfigError',
                                     'InvalidImageName']:
                            return True

                    # Terminated states indicate crashes
                    if cs.state and cs.state.terminated:
                        if cs.state.terminated.reason in ['Error', 'OOMKilled']:
                            return True

                    # Container restarts
                    if cs.restart_count > 0:
                        cache_key = f"{pod.metadata.namespace}:{pod.metadata.name}"
                        cached_restart_count = self._resource_cache.get(cache_key, {}).get('restart_count', 0)
                        if cs.restart_count > cached_restart_count:
                            # New restart detected
                            if cache_key not in self._resource_cache:
                                self._resource_cache[cache_key] = {}
                            self._resource_cache[cache_key]['restart_count'] = cs.restart_count
                            return True

            # Phase changes (could track with cache)
            # For now, skip phase-only changes to reduce noise

        return False

    def _get_volume_type(self, volume):
        """Determine the type of volume."""
        if volume.config_map:
            return f"configMap:{volume.config_map.name}"
        elif volume.secret:
            return f"secret:{volume.secret.secret_name}"
        elif volume.persistent_volume_claim:
            return f"pvc:{volume.persistent_volume_claim.claim_name}"
        elif volume.empty_dir:
            return "emptyDir"
        elif volume.host_path:
            return f"hostPath:{volume.host_path.path}"
        else:
            return "other"

    def _store_pod_event(self, connection_id: int, event_type: str, pod):
        """Store significant pod event."""
        session = SessionLocal()
        try:
            # Create event_id first to check for duplicates
            event_id = f"{self.cluster_name}:{pod.metadata.namespace}:pod:{pod.metadata.name}:{pod.metadata.resource_version}"

            # Check if this exact event already exists
            existing = session.query(ChangeEvent).filter_by(
                connection_id=connection_id,
                event_id=event_id
            ).first()

            if existing:
                # Event already recorded, skip
                return
            # Build description with relevant details
            description = {
                "event_type": event_type,
                "namespace": pod.metadata.namespace,
                "phase": pod.status.phase if pod.status else "Unknown",
                "node": pod.spec.node_name if pod.spec else None,
                "labels": dict(pod.metadata.labels) if pod.metadata.labels else {},
                "annotations": dict(pod.metadata.annotations) if pod.metadata.annotations else {},
            }

            # Add container spec details
            if pod.spec and pod.spec.containers:
                spec_containers = []
                for c in pod.spec.containers:
                    container_spec = {
                        "name": c.name,
                        "image": c.image,
                        "ports": [{"container_port": p.container_port, "protocol": p.protocol} for p in (c.ports or [])],
                    }
                    # Add resource requests/limits
                    if c.resources:
                        if c.resources.requests:
                            container_spec["requests"] = dict(c.resources.requests)
                        if c.resources.limits:
                            container_spec["limits"] = dict(c.resources.limits)
                    # Add environment variable count (not values for security)
                    if c.env:
                        container_spec["env_count"] = len(c.env)
                    spec_containers.append(container_spec)
                description["container_specs"] = spec_containers

            # Add volume information
            if pod.spec and pod.spec.volumes:
                description["volumes"] = [
                    {"name": v.name, "type": self._get_volume_type(v)}
                    for v in pod.spec.volumes
                ]

            # Add status information if present
            if pod.status and pod.status.container_statuses:
                containers = []
                for cs in pod.status.container_statuses:
                    container_info = {
                        "name": cs.name,
                        "image": cs.image,
                        "ready": cs.ready,
                        "restart_count": cs.restart_count
                    }

                    if cs.state:
                        if cs.state.waiting:
                            container_info["state"] = "waiting"
                            container_info["reason"] = cs.state.waiting.reason
                            container_info["message"] = cs.state.waiting.message
                        elif cs.state.terminated:
                            container_info["state"] = "terminated"
                            container_info["reason"] = cs.state.terminated.reason
                            container_info["exit_code"] = cs.state.terminated.exit_code
                        elif cs.state.running:
                            container_info["state"] = "running"

                    containers.append(container_info)

                description["containers"] = containers

            # Build title
            if event_type == 'DELETED':
                title = f"[Pod Deleted] {pod.metadata.name}"
            elif event_type == 'ADDED':
                title = f"[Pod Created] {pod.metadata.name}"
            else:
                # Find the most interesting reason for the title
                reason = "Updated"
                if pod.status and pod.status.container_statuses:
                    for cs in pod.status.container_statuses:
                        if cs.state and cs.state.waiting:
                            reason = cs.state.waiting.reason
                            break
                        elif cs.state and cs.state.terminated:
                            reason = cs.state.terminated.reason
                            break
                title = f"[Pod {reason}] {pod.metadata.name}"

            change_event = ChangeEvent(
                source="kubernetes",
                event_id=event_id,
                title=title,
                description=description,
                author=f"kubernetes/{pod.metadata.namespace}",
                timestamp=pod.metadata.creation_timestamp.replace(tzinfo=timezone.utc) if pod.metadata.creation_timestamp else datetime.now(timezone.utc),
                url=f"k8s://{self.cluster_name}/{pod.metadata.namespace}/pods/{pod.metadata.name}",
                status=event_type.lower(),
                event_metadata={
                    "cluster": self.cluster_name,
                    "namespace": pod.metadata.namespace,
                    "resource_type": "pod",
                    "labels": dict(pod.metadata.labels) if pod.metadata.labels else {}
                },
                connection_id=connection_id
            )

            session.add(change_event)
            session.commit()
            print(f"Stored Pod event: {event_type} - {pod.metadata.namespace}/{pod.metadata.name}")

        finally:
            session.close()

    def _watch_deployments(self, connection_id: int, resource_version: Optional[str] = None):
        """Watch Deployment events with smart filtering."""
        print(f"Watching Deployments (resourceVersion: {resource_version or 'initial'})")

        w = watch.Watch()
        try:
            stream_kwargs = {'timeout_seconds': 10}
            if resource_version:
                stream_kwargs['resource_version'] = resource_version

            for event in w.stream(
                self.apps_v1.list_deployment_for_all_namespaces,
                **stream_kwargs
            ):
                event_type = event['type']
                deployment = event['object']

                if deployment.metadata.resource_version:
                    self._save_resource_version(connection_id, 'deployments', deployment.metadata.resource_version)

                if self._is_significant_deployment_event(event_type, deployment):
                    self._store_deployment_event(connection_id, event_type, deployment)

        except ApiException as e:
            if e.status == 410:
                print(f"ResourceVersion expired for deployments, resyncing...")
                self._save_resource_version(connection_id, 'deployments', None)
            else:
                print(f"Error watching deployments: {e}")
        finally:
            w.stop()

    def _is_significant_deployment_event(self, event_type: str, deployment) -> bool:
        """Determine if deployment event is significant."""
        if event_type in ['ADDED', 'DELETED']:
            return True

        if event_type == 'MODIFIED':
            cache_key = f"{deployment.metadata.namespace}:{deployment.metadata.name}"

            # Check for image changes
            current_images = []
            if deployment.spec.template.spec.containers:
                current_images = [c.image for c in deployment.spec.template.spec.containers]

            cached_data = self._resource_cache.get(cache_key, {})
            cached_images = cached_data.get('images', [])

            if current_images != cached_images:
                self._resource_cache[cache_key] = {'images': current_images, 'replicas': deployment.spec.replicas}
                return True

            # Check for replica changes
            cached_replicas = cached_data.get('replicas')
            if deployment.spec.replicas != cached_replicas:
                self._resource_cache[cache_key] = {'images': current_images, 'replicas': deployment.spec.replicas}
                return True

        return False

    def _store_deployment_event(self, connection_id: int, event_type: str, deployment):
        """Store significant deployment event."""
        session = SessionLocal()
        try:
            # Create event_id first to check for duplicates
            event_id = f"{self.cluster_name}:{deployment.metadata.namespace}:deployment:{deployment.metadata.name}:{deployment.metadata.resource_version}"

            # Check if this exact event already exists
            existing = session.query(ChangeEvent).filter_by(
                connection_id=connection_id,
                event_id=event_id
            ).first()

            if existing:
                return
            images = []
            if deployment.spec.template.spec.containers:
                images = [{"name": c.name, "image": c.image} for c in deployment.spec.template.spec.containers]

            description = {
                "event_type": event_type,
                "namespace": deployment.metadata.namespace,
                "images": images,
                "replicas": deployment.spec.replicas,
                "strategy": deployment.spec.strategy.type if deployment.spec.strategy else "RollingUpdate"
            }

            if event_type == 'DELETED':
                title = f"[Deployment Deleted] {deployment.metadata.name}"
            elif event_type == 'ADDED':
                title = f"[Deployment Created] {deployment.metadata.name}"
            else:
                title = f"[Deployment Updated] {deployment.metadata.name}"

            change_event = ChangeEvent(
                source="kubernetes",
                event_id=event_id,
                title=title,
                description=description,
                author=f"kubernetes/{deployment.metadata.namespace}",
                timestamp=deployment.metadata.creation_timestamp.replace(tzinfo=timezone.utc) if deployment.metadata.creation_timestamp else datetime.now(timezone.utc),
                url=f"k8s://{self.cluster_name}/{deployment.metadata.namespace}/deployments/{deployment.metadata.name}",
                status=event_type.lower(),
                event_metadata={
                    "cluster": self.cluster_name,
                    "namespace": deployment.metadata.namespace,
                    "resource_type": "deployment",
                    "labels": dict(deployment.metadata.labels) if deployment.metadata.labels else {}
                },
                connection_id=connection_id
            )

            session.add(change_event)
            session.commit()
            print(f"Stored Deployment event: {event_type} - {deployment.metadata.namespace}/{deployment.metadata.name}")

        finally:
            session.close()

    # Additional resource watchers
    def _watch_statefulsets(self, connection_id: int, resource_version: Optional[str] = None):
        """Watch StatefulSet events."""
        print(f"Watching StatefulSets (resourceVersion: {resource_version or 'initial'})")

        w = watch.Watch()
        try:
            stream_kwargs = {'timeout_seconds': 10}
            if resource_version:
                stream_kwargs['resource_version'] = resource_version

            for event in w.stream(
                self.apps_v1.list_stateful_set_for_all_namespaces,
                **stream_kwargs
            ):
                event_type = event['type']
                ss = event['object']

                if ss.metadata.resource_version:
                    self._save_resource_version(connection_id, 'statefulsets', ss.metadata.resource_version)

                # Always store ADDED/DELETED, filter MODIFIED
                if event_type in ['ADDED', 'DELETED'] or self._has_significant_workload_changes(event_type, ss, 'statefulset'):
                    self._store_generic_event(connection_id, event_type, ss, 'StatefulSet')

        except ApiException as e:
            if e.status == 410:
                self._save_resource_version(connection_id, 'statefulsets', None)
            else:
                print(f"Error watching statefulsets: {e}")
        finally:
            w.stop()

    def _watch_daemonsets(self, connection_id: int, resource_version: Optional[str] = None):
        """Watch DaemonSet events."""
        print(f"Watching DaemonSets (resourceVersion: {resource_version or 'initial'})")

        w = watch.Watch()
        try:
            stream_kwargs = {'timeout_seconds': 10}
            if resource_version:
                stream_kwargs['resource_version'] = resource_version

            for event in w.stream(
                self.apps_v1.list_daemon_set_for_all_namespaces,
                **stream_kwargs
            ):
                event_type = event['type']
                ds = event['object']

                if ds.metadata.resource_version:
                    self._save_resource_version(connection_id, 'daemonsets', ds.metadata.resource_version)

                if event_type in ['ADDED', 'DELETED'] or self._has_significant_workload_changes(event_type, ds, 'daemonset'):
                    self._store_generic_event(connection_id, event_type, ds, 'DaemonSet')

        except ApiException as e:
            if e.status == 410:
                self._save_resource_version(connection_id, 'daemonsets', None)
            else:
                print(f"Error watching daemonsets: {e}")
        finally:
            w.stop()

    def _has_significant_workload_changes(self, event_type: str, resource, resource_kind: str) -> bool:
        """Check if workload (StatefulSet/DaemonSet) has significant changes."""
        if event_type != 'MODIFIED':
            return False

        cache_key = f"{resource.metadata.namespace}:{resource.metadata.name}:{resource_kind}"

        # Check for image changes
        current_images = []
        if resource.spec.template.spec.containers:
            current_images = [c.image for c in resource.spec.template.spec.containers]

        cached_data = self._resource_cache.get(cache_key, {})
        cached_images = cached_data.get('images', [])

        if current_images != cached_images:
            self._resource_cache[cache_key] = {'images': current_images}
            return True

        return False

    def _watch_services(self, connection_id: int, resource_version: Optional[str] = None):
        """Watch Service events."""
        print(f"Watching Services (resourceVersion: {resource_version or 'initial'})")

        w = watch.Watch()
        try:
            stream_kwargs = {'timeout_seconds': 10}
            if resource_version:
                stream_kwargs['resource_version'] = resource_version

            for event in w.stream(
                self.core_v1.list_service_for_all_namespaces,
                **stream_kwargs
            ):
                event_type = event['type']
                svc = event['object']

                if svc.metadata.resource_version:
                    self._save_resource_version(connection_id, 'services', svc.metadata.resource_version)

                # For services, track type/port changes
                if event_type in ['ADDED', 'DELETED'] or self._has_significant_service_changes(event_type, svc):
                    self._store_generic_event(connection_id, event_type, svc, 'Service')

        except ApiException as e:
            if e.status == 410:
                self._save_resource_version(connection_id, 'services', None)
            else:
                print(f"Error watching services: {e}")
        finally:
            w.stop()

    def _has_significant_service_changes(self, event_type: str, service) -> bool:
        """Check if service has significant changes."""
        if event_type != 'MODIFIED':
            return False

        cache_key = f"{service.metadata.namespace}:{service.metadata.name}:service"

        # Track service type and ports
        current_type = service.spec.type if service.spec else None
        current_ports = []
        if service.spec and service.spec.ports:
            current_ports = [(p.port, p.protocol, str(p.target_port)) for p in service.spec.ports]

        cached_data = self._resource_cache.get(cache_key, {})

        if current_type != cached_data.get('type') or current_ports != cached_data.get('ports'):
            self._resource_cache[cache_key] = {'type': current_type, 'ports': current_ports}
            return True

        return False

    def _watch_configmaps(self, connection_id: int, resource_version: Optional[str] = None):
        """Watch ConfigMap events with content change detection."""
        print(f"Watching ConfigMaps (resourceVersion: {resource_version or 'initial'})")

        w = watch.Watch()
        try:
            stream_kwargs = {'timeout_seconds': 10}
            if resource_version:
                stream_kwargs['resource_version'] = resource_version

            for event in w.stream(
                self.core_v1.list_config_map_for_all_namespaces,
                **stream_kwargs
            ):
                event_type = event['type']
                cm = event['object']

                if cm.metadata.resource_version:
                    self._save_resource_version(connection_id, 'configmaps', cm.metadata.resource_version)

                if event_type in ['ADDED', 'DELETED'] or self._has_configmap_data_changes(event_type, cm):
                    self._store_generic_event(connection_id, event_type, cm, 'ConfigMap')

        except ApiException as e:
            if e.status == 410:
                self._save_resource_version(connection_id, 'configmaps', None)
            else:
                print(f"Error watching configmaps: {e}")
        finally:
            w.stop()

    def _has_configmap_data_changes(self, event_type: str, cm) -> bool:
        """Check if configmap data has changed."""
        if event_type != 'MODIFIED':
            return False

        cache_key = f"{cm.metadata.namespace}:{cm.metadata.name}:configmap"

        # Hash the data to detect changes
        data_hash = None
        if cm.data:
            data_str = json.dumps(cm.data, sort_keys=True)
            data_hash = hashlib.md5(data_str.encode()).hexdigest()

        cached_hash = self._resource_cache.get(cache_key, {}).get('data_hash')

        if data_hash != cached_hash:
            self._resource_cache[cache_key] = {'data_hash': data_hash}
            return True

        return False

    def _watch_secrets(self, connection_id: int, resource_version: Optional[str] = None):
        """Watch Secret events (metadata only, not values)."""
        print(f"Watching Secrets (resourceVersion: {resource_version or 'initial'})")

        w = watch.Watch()
        try:
            stream_kwargs = {'timeout_seconds': 10}
            if resource_version:
                stream_kwargs['resource_version'] = resource_version

            for event in w.stream(
                self.core_v1.list_secret_for_all_namespaces,
                **stream_kwargs
            ):
                event_type = event['type']
                secret = event['object']

                # Skip service account tokens
                if secret.type == "kubernetes.io/service-account-token":
                    continue

                if secret.metadata.resource_version:
                    self._save_resource_version(connection_id, 'secrets', secret.metadata.resource_version)

                # Track secret key changes (not values)
                if event_type in ['ADDED', 'DELETED'] or self._has_secret_key_changes(event_type, secret):
                    self._store_generic_event(connection_id, event_type, secret, 'Secret')

        except ApiException as e:
            if e.status == 410:
                self._save_resource_version(connection_id, 'secrets', None)
            else:
                print(f"Error watching secrets: {e}")
        finally:
            w.stop()

    def _has_secret_key_changes(self, event_type: str, secret) -> bool:
        """Check if secret keys have changed (not values)."""
        if event_type != 'MODIFIED':
            return False

        cache_key = f"{secret.metadata.namespace}:{secret.metadata.name}:secret"

        # Track keys, not values (for security)
        current_keys = sorted(secret.data.keys()) if secret.data else []
        cached_keys = self._resource_cache.get(cache_key, {}).get('keys', [])

        if current_keys != cached_keys:
            self._resource_cache[cache_key] = {'keys': current_keys}
            return True

        return False

    def _watch_ingresses(self, connection_id: int, resource_version: Optional[str] = None):
        """Watch Ingress events."""
        print(f"Watching Ingresses (resourceVersion: {resource_version or 'initial'})")

        w = watch.Watch()
        try:
            stream_kwargs = {'timeout_seconds': 10}
            if resource_version:
                stream_kwargs['resource_version'] = resource_version

            for event in w.stream(
                self.networking_v1.list_ingress_for_all_namespaces,
                **stream_kwargs
            ):
                event_type = event['type']
                ingress = event['object']

                if ingress.metadata.resource_version:
                    self._save_resource_version(connection_id, 'ingresses', ingress.metadata.resource_version)

                if event_type in ['ADDED', 'DELETED'] or self._has_ingress_rule_changes(event_type, ingress):
                    self._store_generic_event(connection_id, event_type, ingress, 'Ingress')

        except ApiException as e:
            if e.status == 410:
                self._save_resource_version(connection_id, 'ingresses', None)
            else:
                print(f"Error watching ingresses: {e}")
        finally:
            w.stop()

    def _has_ingress_rule_changes(self, event_type: str, ingress) -> bool:
        """Check if ingress rules/hosts have changed."""
        if event_type != 'MODIFIED':
            return False

        cache_key = f"{ingress.metadata.namespace}:{ingress.metadata.name}:ingress"

        # Track hosts
        current_hosts = []
        if ingress.spec and ingress.spec.rules:
            current_hosts = sorted([rule.host for rule in ingress.spec.rules if rule.host])

        cached_hosts = self._resource_cache.get(cache_key, {}).get('hosts', [])

        if current_hosts != cached_hosts:
            self._resource_cache[cache_key] = {'hosts': current_hosts}
            return True

        return False

    def _watch_roles(self, connection_id: int, resource_version: Optional[str] = None):
        """Watch Role events for RBAC tracking."""
        print(f"Watching Roles (resourceVersion: {resource_version or 'initial'})")

        w = watch.Watch()
        try:
            stream_kwargs = {'timeout_seconds': 10}
            if resource_version:
                stream_kwargs['resource_version'] = resource_version

            for event in w.stream(
                self.rbac_v1.list_role_for_all_namespaces,
                **stream_kwargs
            ):
                event_type = event['type']
                role = event['object']

                if role.metadata.resource_version:
                    self._save_resource_version(connection_id, 'roles', role.metadata.resource_version)

                # RBAC changes are always significant
                if event_type in ['ADDED', 'MODIFIED', 'DELETED']:
                    self._store_generic_event(connection_id, event_type, role, 'Role')

        except ApiException as e:
            if e.status == 410:
                self._save_resource_version(connection_id, 'roles', None)
            else:
                print(f"Error watching roles: {e}")
        finally:
            w.stop()

    def _watch_rolebindings(self, connection_id: int, resource_version: Optional[str] = None):
        """Watch RoleBinding events for RBAC tracking."""
        print(f"Watching RoleBindings (resourceVersion: {resource_version or 'initial'})")

        w = watch.Watch()
        try:
            stream_kwargs = {'timeout_seconds': 10}
            if resource_version:
                stream_kwargs['resource_version'] = resource_version

            for event in w.stream(
                self.rbac_v1.list_role_binding_for_all_namespaces,
                **stream_kwargs
            ):
                event_type = event['type']
                rb = event['object']

                if rb.metadata.resource_version:
                    self._save_resource_version(connection_id, 'rolebindings', rb.metadata.resource_version)

                # RBAC changes are always significant
                if event_type in ['ADDED', 'MODIFIED', 'DELETED']:
                    self._store_generic_event(connection_id, event_type, rb, 'RoleBinding')

        except ApiException as e:
            if e.status == 410:
                self._save_resource_version(connection_id, 'rolebindings', None)
            else:
                print(f"Error watching rolebindings: {e}")
        finally:
            w.stop()

    def _store_generic_event(self, connection_id: int, event_type: str, resource, resource_kind: str):
        """Store a generic resource event with detailed information."""
        session = SessionLocal()
        try:
            namespace = resource.metadata.namespace or "cluster"
            event_id = f"{self.cluster_name}:{namespace}:{resource_kind.lower()}:{resource.metadata.name}:{resource.metadata.resource_version}"

            # Check if this exact event already exists
            existing = session.query(ChangeEvent).filter_by(
                connection_id=connection_id,
                event_id=event_id
            ).first()

            if existing:
                return

            # Build detailed description based on resource type
            description = {
                "event_type": event_type,
                "namespace": resource.metadata.namespace if resource.metadata.namespace else "cluster-wide",
                "resource_kind": resource_kind,
                "labels": dict(resource.metadata.labels) if resource.metadata.labels else {},
                "annotations": dict(resource.metadata.annotations) if resource.metadata.annotations else {},
            }

            # Add resource-specific details
            if resource_kind == 'ConfigMap':
                description["data"] = dict(resource.data) if resource.data else {}
                description["binary_data"] = list(resource.binary_data.keys()) if resource.binary_data else []

            elif resource_kind == 'Secret':
                # Don't include actual secret data, just keys
                description["data_keys"] = list(resource.data.keys()) if resource.data else []
                description["type"] = resource.type

            elif resource_kind == 'Service':
                description["type"] = resource.spec.type if resource.spec else None
                description["cluster_ip"] = resource.spec.cluster_ip if resource.spec else None
                if resource.spec and resource.spec.ports:
                    description["ports"] = [
                        {"port": p.port, "target_port": str(p.target_port), "protocol": p.protocol}
                        for p in resource.spec.ports
                    ]
                description["selector"] = dict(resource.spec.selector) if (resource.spec and resource.spec.selector) else {}

            elif resource_kind == 'Ingress':
                if resource.spec and resource.spec.rules:
                    description["rules"] = [
                        {
                            "host": rule.host,
                            "paths": [{"path": p.path, "backend": f"{p.backend.service.name}:{p.backend.service.port.number}"}
                                     for p in (rule.http.paths if rule.http else [])]
                        }
                        for rule in resource.spec.rules
                    ]

            elif resource_kind == 'Role':
                if resource.rules:
                    description["rules"] = [
                        {
                            "api_groups": rule.api_groups or [],
                            "resources": rule.resources or [],
                            "verbs": rule.verbs or []
                        }
                        for rule in resource.rules
                    ]

            elif resource_kind == 'RoleBinding':
                description["role_ref"] = {
                    "kind": resource.role_ref.kind,
                    "name": resource.role_ref.name
                } if resource.role_ref else None
                if resource.subjects:
                    description["subjects"] = [
                        {"kind": s.kind, "name": s.name, "namespace": s.namespace}
                        for s in resource.subjects
                    ]

            if event_type == 'DELETED':
                title = f"[{resource_kind} Deleted] {resource.metadata.name}"
            elif event_type == 'ADDED':
                title = f"[{resource_kind} Created] {resource.metadata.name}"
            else:
                title = f"[{resource_kind} Updated] {resource.metadata.name}"

            change_event = ChangeEvent(
                source="kubernetes",
                event_id=event_id,
                title=title,
                description=description,
                author=f"kubernetes/{namespace}",
                timestamp=resource.metadata.creation_timestamp.replace(tzinfo=timezone.utc) if resource.metadata.creation_timestamp else datetime.now(timezone.utc),
                url=f"k8s://{self.cluster_name}/{namespace}/{resource_kind.lower()}s/{resource.metadata.name}",
                status=event_type.lower(),
                event_metadata={
                    "cluster": self.cluster_name,
                    "namespace": namespace,
                    "resource_type": resource_kind.lower(),
                    "labels": dict(resource.metadata.labels) if resource.metadata.labels else {}
                },
                connection_id=connection_id
            )

            session.add(change_event)
            session.commit()
            print(f"Stored {resource_kind} event: {event_type} - {namespace}/{resource.metadata.name}")

        finally:
            session.close()


def sync_kubernetes(db_session, config: Dict[str, Any], connection_id: int) -> Dict[str, Any]:
    """
    Sync Kubernetes changes using Watch API with resourceVersion tracking.

    Args:
        db_session: SQLAlchemy database session
        config: Configuration dict with keys: api_server, token, namespaces, cluster_name, verify_ssl
        connection_id: ID of the connection this sync belongs to

    Returns:
        Dict with sync results
    """
    api_server = config.get('api_server') or config.get('apiServer')
    token = config.get('token')
    namespaces_str = config.get('namespaces', '')
    cluster_name = config.get('cluster_name') or config.get('clusterName', 'default')

    namespaces = [ns.strip() for ns in namespaces_str.split(',') if ns.strip()] if namespaces_str else []

    print(f"Syncing Kubernetes cluster: {cluster_name}")
    print(f"API Server: {api_server if api_server else 'in-cluster'}")
    print(f"Namespaces: {namespaces if namespaces else 'all'}")

    verify_ssl = config.get('verify_ssl', False)

    connector = KubernetesWatchConnector(
        api_server=api_server,
        token=token,
        namespaces=namespaces,
        cluster_name=cluster_name,
        verify_ssl=verify_ssl
    )

    if not connector.test_connection():
        raise Exception("Failed to connect to Kubernetes API")

    connector.fetch_and_store_changes(connection_id, since=None)

    print(f"Successfully synced Kubernetes cluster: {cluster_name}")

    return {
        "cluster": cluster_name,
        "namespaces": namespaces if namespaces else "all"
    }
