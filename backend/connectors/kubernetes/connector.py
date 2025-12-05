import os
import sys
from datetime import datetime, timezone
from typing import List, Dict, Optional, Any
from kubernetes import client, config
from kubernetes.client.rest import ApiException

# Add parent directory to path to import shared modules
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(__file__))))
from shared.database import get_engine, Change

class KubernetesConnector:
    """
    Kubernetes connector to track cluster configuration changes.

    Tracks:
    - Deployments
    - StatefulSets
    - DaemonSets
    - Services
    - ConfigMaps
    - Secrets
    - Ingress
    """

    def __init__(self, kubeconfig: Optional[str] = None, namespaces: List[str] = None, cluster_name: str = "default"):
        """
        Initialize Kubernetes connector.

        Args:
            kubeconfig: Path to kubeconfig file (None for in-cluster auth)
            namespaces: List of namespaces to monitor (empty list for all)
            cluster_name: Cluster identifier for tagging
        """
        self.kubeconfig = kubeconfig
        self.namespaces = namespaces or []
        self.cluster_name = cluster_name
        self.client = None

        # Initialize Kubernetes client
        try:
            if kubeconfig:
                config.load_kube_config(config_file=kubeconfig)
            else:
                # Try in-cluster config first, fallback to default kubeconfig
                try:
                    config.load_incluster_config()
                except config.ConfigException:
                    config.load_kube_config()

            self.apps_v1 = client.AppsV1Api()
            self.core_v1 = client.CoreV1Api()
            self.networking_v1 = client.NetworkingV1Api()

        except Exception as e:
            print(f"Failed to initialize Kubernetes client: {e}")
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

        # If no namespaces specified, get all
        try:
            ns_list = self.core_v1.list_namespace()
            return [ns.metadata.name for ns in ns_list.items]
        except ApiException as e:
            print(f"Failed to list namespaces: {e}")
            return []

    def fetch_and_store_changes(self, connection_id: int, since: Optional[datetime] = None):
        """Fetch and store all Kubernetes configuration changes."""
        namespaces = self.get_namespaces()

        for namespace in namespaces:
            print(f"Fetching changes from namespace: {namespace}")

            # Fetch different resource types
            self.fetch_deployments(connection_id, namespace, since)
            self.fetch_statefulsets(connection_id, namespace, since)
            self.fetch_daemonsets(connection_id, namespace, since)
            self.fetch_services(connection_id, namespace, since)
            self.fetch_configmaps(connection_id, namespace, since)
            self.fetch_secrets(connection_id, namespace, since)
            self.fetch_ingresses(connection_id, namespace, since)

    def fetch_deployments(self, connection_id: int, namespace: str, since: Optional[datetime] = None):
        """Fetch Deployment changes."""
        try:
            deployments = self.apps_v1.list_namespaced_deployment(namespace)

            for deployment in deployments.items:
                # Check if deployment was modified since last check
                last_modified = deployment.metadata.managed_fields[0].time if deployment.metadata.managed_fields else deployment.metadata.creation_timestamp

                if since and last_modified < since:
                    continue

                # Store deployment change
                self._store_deployment_change(connection_id, namespace, deployment)

        except ApiException as e:
            print(f"Failed to fetch deployments in {namespace}: {e}")

    def _store_deployment_change(self, connection_id: int, namespace: str, deployment):
        """Store deployment change in database."""
        engine = get_engine()

        # Get image information
        containers = deployment.spec.template.spec.containers
        images = [{"name": c.name, "image": c.image} for c in containers]

        # Get replica information
        replicas = deployment.spec.replicas
        available_replicas = deployment.status.available_replicas or 0
        ready_replicas = deployment.status.ready_replicas or 0

        change = Change(
            source="kubernetes",
            title=f"[K8s Deployment] {deployment.metadata.name}",
            description={
                "text": f"Deployment in namespace {namespace}",
                "images": images
            },
            author=f"kubernetes/{namespace}",
            timestamp=deployment.metadata.creation_timestamp.replace(tzinfo=timezone.utc),
            url=f"k8s://{self.cluster_name}/{namespace}/deployments/{deployment.metadata.name}",
            metadata={
                "namespace": namespace,
                "cluster": self.cluster_name,
                "replicas": replicas,
                "available_replicas": available_replicas,
                "ready_replicas": ready_replicas,
                "strategy": deployment.spec.strategy.type if deployment.spec.strategy else "RollingUpdate",
                "labels": deployment.metadata.labels or {}
            },
            connection_id=connection_id
        )

        with engine.connect() as conn:
            from sqlalchemy.orm import Session
            session = Session(bind=conn)

            # Check if this change already exists
            existing = session.query(Change).filter_by(
                source="kubernetes",
                url=change.url
            ).first()

            if not existing:
                session.add(change)
                session.commit()
                print(f"Stored deployment: {deployment.metadata.name} in {namespace}")

    def fetch_statefulsets(self, connection_id: int, namespace: str, since: Optional[datetime] = None):
        """Fetch StatefulSet changes."""
        try:
            statefulsets = self.apps_v1.list_namespaced_stateful_set(namespace)

            for ss in statefulsets.items:
                last_modified = ss.metadata.managed_fields[0].time if ss.metadata.managed_fields else ss.metadata.creation_timestamp

                if since and last_modified < since:
                    continue

                self._store_statefulset_change(connection_id, namespace, ss)

        except ApiException as e:
            print(f"Failed to fetch statefulsets in {namespace}: {e}")

    def _store_statefulset_change(self, connection_id: int, namespace: str, statefulset):
        """Store statefulset change in database."""
        engine = get_engine()

        containers = statefulset.spec.template.spec.containers
        images = [{"name": c.name, "image": c.image} for c in containers]

        replicas = statefulset.spec.replicas
        ready_replicas = statefulset.status.ready_replicas or 0

        change = Change(
            source="kubernetes",
            title=f"[K8s StatefulSet] {statefulset.metadata.name}",
            description={
                "text": f"StatefulSet in namespace {namespace}",
                "images": images
            },
            author=f"kubernetes/{namespace}",
            timestamp=statefulset.metadata.creation_timestamp.replace(tzinfo=timezone.utc),
            url=f"k8s://{self.cluster_name}/{namespace}/statefulsets/{statefulset.metadata.name}",
            metadata={
                "namespace": namespace,
                "cluster": self.cluster_name,
                "replicas": replicas,
                "ready_replicas": ready_replicas,
                "service_name": statefulset.spec.service_name,
                "labels": statefulset.metadata.labels or {}
            },
            connection_id=connection_id
        )

        with engine.connect() as conn:
            from sqlalchemy.orm import Session
            session = Session(bind=conn)

            existing = session.query(Change).filter_by(
                source="kubernetes",
                url=change.url
            ).first()

            if not existing:
                session.add(change)
                session.commit()
                print(f"Stored statefulset: {statefulset.metadata.name} in {namespace}")

    def fetch_daemonsets(self, connection_id: int, namespace: str, since: Optional[datetime] = None):
        """Fetch DaemonSet changes."""
        try:
            daemonsets = self.apps_v1.list_namespaced_daemon_set(namespace)

            for ds in daemonsets.items:
                last_modified = ds.metadata.managed_fields[0].time if ds.metadata.managed_fields else ds.metadata.creation_timestamp

                if since and last_modified < since:
                    continue

                self._store_daemonset_change(connection_id, namespace, ds)

        except ApiException as e:
            print(f"Failed to fetch daemonsets in {namespace}: {e}")

    def _store_daemonset_change(self, connection_id: int, namespace: str, daemonset):
        """Store daemonset change in database."""
        engine = get_engine()

        containers = daemonset.spec.template.spec.containers
        images = [{"name": c.name, "image": c.image} for c in containers]

        desired_scheduled = daemonset.status.desired_number_scheduled or 0
        number_ready = daemonset.status.number_ready or 0

        change = Change(
            source="kubernetes",
            title=f"[K8s DaemonSet] {daemonset.metadata.name}",
            description={
                "text": f"DaemonSet in namespace {namespace}",
                "images": images
            },
            author=f"kubernetes/{namespace}",
            timestamp=daemonset.metadata.creation_timestamp.replace(tzinfo=timezone.utc),
            url=f"k8s://{self.cluster_name}/{namespace}/daemonsets/{daemonset.metadata.name}",
            metadata={
                "namespace": namespace,
                "cluster": self.cluster_name,
                "desired_scheduled": desired_scheduled,
                "number_ready": number_ready,
                "labels": daemonset.metadata.labels or {}
            },
            connection_id=connection_id
        )

        with engine.connect() as conn:
            from sqlalchemy.orm import Session
            session = Session(bind=conn)

            existing = session.query(Change).filter_by(
                source="kubernetes",
                url=change.url
            ).first()

            if not existing:
                session.add(change)
                session.commit()
                print(f"Stored daemonset: {daemonset.metadata.name} in {namespace}")

    def fetch_services(self, connection_id: int, namespace: str, since: Optional[datetime] = None):
        """Fetch Service changes."""
        try:
            services = self.core_v1.list_namespaced_service(namespace)

            for svc in services.items:
                # Skip kubernetes default service
                if svc.metadata.name == "kubernetes" and namespace == "default":
                    continue

                last_modified = svc.metadata.managed_fields[0].time if svc.metadata.managed_fields else svc.metadata.creation_timestamp

                if since and last_modified < since:
                    continue

                self._store_service_change(connection_id, namespace, svc)

        except ApiException as e:
            print(f"Failed to fetch services in {namespace}: {e}")

    def _store_service_change(self, connection_id: int, namespace: str, service):
        """Store service change in database."""
        engine = get_engine()

        ports = [{"port": p.port, "protocol": p.protocol, "target_port": str(p.target_port)} for p in (service.spec.ports or [])]

        change = Change(
            source="kubernetes",
            title=f"[K8s Service] {service.metadata.name}",
            description={
                "text": f"Service in namespace {namespace}",
                "ports": ports
            },
            author=f"kubernetes/{namespace}",
            timestamp=service.metadata.creation_timestamp.replace(tzinfo=timezone.utc),
            url=f"k8s://{self.cluster_name}/{namespace}/services/{service.metadata.name}",
            metadata={
                "namespace": namespace,
                "cluster": self.cluster_name,
                "type": service.spec.type,
                "cluster_ip": service.spec.cluster_ip,
                "selector": service.spec.selector or {},
                "labels": service.metadata.labels or {}
            },
            connection_id=connection_id
        )

        with engine.connect() as conn:
            from sqlalchemy.orm import Session
            session = Session(bind=conn)

            existing = session.query(Change).filter_by(
                source="kubernetes",
                url=change.url
            ).first()

            if not existing:
                session.add(change)
                session.commit()
                print(f"Stored service: {service.metadata.name} in {namespace}")

    def fetch_configmaps(self, connection_id: int, namespace: str, since: Optional[datetime] = None):
        """Fetch ConfigMap changes."""
        try:
            configmaps = self.core_v1.list_namespaced_config_map(namespace)

            for cm in configmaps.items:
                last_modified = cm.metadata.managed_fields[0].time if cm.metadata.managed_fields else cm.metadata.creation_timestamp

                if since and last_modified < since:
                    continue

                self._store_configmap_change(connection_id, namespace, cm)

        except ApiException as e:
            print(f"Failed to fetch configmaps in {namespace}: {e}")

    def _store_configmap_change(self, connection_id: int, namespace: str, configmap):
        """Store configmap change in database."""
        engine = get_engine()

        data_keys = list(configmap.data.keys()) if configmap.data else []

        change = Change(
            source="kubernetes",
            title=f"[K8s ConfigMap] {configmap.metadata.name}",
            description={
                "text": f"ConfigMap in namespace {namespace}",
                "keys": data_keys
            },
            author=f"kubernetes/{namespace}",
            timestamp=configmap.metadata.creation_timestamp.replace(tzinfo=timezone.utc),
            url=f"k8s://{self.cluster_name}/{namespace}/configmaps/{configmap.metadata.name}",
            metadata={
                "namespace": namespace,
                "cluster": self.cluster_name,
                "data_keys": data_keys,
                "num_keys": len(data_keys),
                "labels": configmap.metadata.labels or {}
            },
            connection_id=connection_id
        )

        with engine.connect() as conn:
            from sqlalchemy.orm import Session
            session = Session(bind=conn)

            existing = session.query(Change).filter_by(
                source="kubernetes",
                url=change.url
            ).first()

            if not existing:
                session.add(change)
                session.commit()
                print(f"Stored configmap: {configmap.metadata.name} in {namespace}")

    def fetch_secrets(self, connection_id: int, namespace: str, since: Optional[datetime] = None):
        """Fetch Secret changes (metadata only, not values)."""
        try:
            secrets = self.core_v1.list_namespaced_secret(namespace)

            for secret in secrets.items:
                # Skip service account tokens
                if secret.type == "kubernetes.io/service-account-token":
                    continue

                last_modified = secret.metadata.managed_fields[0].time if secret.metadata.managed_fields else secret.metadata.creation_timestamp

                if since and last_modified < since:
                    continue

                self._store_secret_change(connection_id, namespace, secret)

        except ApiException as e:
            print(f"Failed to fetch secrets in {namespace}: {e}")

    def _store_secret_change(self, connection_id: int, namespace: str, secret):
        """Store secret change in database (metadata only)."""
        engine = get_engine()

        data_keys = list(secret.data.keys()) if secret.data else []

        change = Change(
            source="kubernetes",
            title=f"[K8s Secret] {secret.metadata.name}",
            description={
                "text": f"Secret in namespace {namespace}",
                "keys": data_keys
            },
            author=f"kubernetes/{namespace}",
            timestamp=secret.metadata.creation_timestamp.replace(tzinfo=timezone.utc),
            url=f"k8s://{self.cluster_name}/{namespace}/secrets/{secret.metadata.name}",
            metadata={
                "namespace": namespace,
                "cluster": self.cluster_name,
                "type": secret.type,
                "data_keys": data_keys,
                "num_keys": len(data_keys),
                "labels": secret.metadata.labels or {}
            },
            connection_id=connection_id
        )

        with engine.connect() as conn:
            from sqlalchemy.orm import Session
            session = Session(bind=conn)

            existing = session.query(Change).filter_by(
                source="kubernetes",
                url=change.url
            ).first()

            if not existing:
                session.add(change)
                session.commit()
                print(f"Stored secret: {secret.metadata.name} in {namespace}")

    def fetch_ingresses(self, connection_id: int, namespace: str, since: Optional[datetime] = None):
        """Fetch Ingress changes."""
        try:
            ingresses = self.networking_v1.list_namespaced_ingress(namespace)

            for ingress in ingresses.items:
                last_modified = ingress.metadata.managed_fields[0].time if ingress.metadata.managed_fields else ingress.metadata.creation_timestamp

                if since and last_modified < since:
                    continue

                self._store_ingress_change(connection_id, namespace, ingress)

        except ApiException as e:
            print(f"Failed to fetch ingresses in {namespace}: {e}")

    def _store_ingress_change(self, connection_id: int, namespace: str, ingress):
        """Store ingress change in database."""
        engine = get_engine()

        hosts = []
        if ingress.spec.rules:
            hosts = [rule.host for rule in ingress.spec.rules if rule.host]

        change = Change(
            source="kubernetes",
            title=f"[K8s Ingress] {ingress.metadata.name}",
            description={
                "text": f"Ingress in namespace {namespace}",
                "hosts": hosts
            },
            author=f"kubernetes/{namespace}",
            timestamp=ingress.metadata.creation_timestamp.replace(tzinfo=timezone.utc),
            url=f"k8s://{self.cluster_name}/{namespace}/ingresses/{ingress.metadata.name}",
            metadata={
                "namespace": namespace,
                "cluster": self.cluster_name,
                "hosts": hosts,
                "ingress_class": ingress.spec.ingress_class_name,
                "labels": ingress.metadata.labels or {}
            },
            connection_id=connection_id
        )

        with engine.connect() as conn:
            from sqlalchemy.orm import Session
            session = Session(bind=conn)

            existing = session.query(Change).filter_by(
                source="kubernetes",
                url=change.url
            ).first()

            if not existing:
                session.add(change)
                session.commit()
                print(f"Stored ingress: {ingress.metadata.name} in {namespace}")


def sync_kubernetes(kubeconfig: Optional[str], namespaces: List[str], cluster_name: str, connection_id: int, since: Optional[datetime] = None):
    """Sync Kubernetes changes."""
    connector = KubernetesConnector(
        kubeconfig=kubeconfig,
        namespaces=namespaces,
        cluster_name=cluster_name
    )

    if not connector.test_connection():
        raise Exception("Failed to connect to Kubernetes API")

    connector.fetch_and_store_changes(connection_id, since)
    print(f"Synced Kubernetes cluster: {cluster_name}")
