import os
import sys
import time
from datetime import datetime, timezone, timedelta
from typing import List
from pydantic_settings import BaseSettings

sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(__file__))))
from shared.database import get_engine
from connector import sync_kubernetes


class Settings(BaseSettings):
    """Environment-based configuration."""
    kubeconfig: str = None  # Path to kubeconfig (None for in-cluster or default)
    cluster_name: str = "default"  # Cluster identifier
    namespaces: str = ""  # Comma-separated list of namespaces (empty for all)
    poll_interval: int = 300  # Seconds between polls
    connection_id: int  # Database connection ID

    class Config:
        env_file = ".env"


def main():
    """Main polling loop for Kubernetes connector."""
    settings = Settings()

    # Parse namespaces
    namespaces = [ns.strip() for ns in settings.namespaces.split(",") if ns.strip()] if settings.namespaces else []

    print(f"Starting Kubernetes connector for cluster: {settings.cluster_name}")
    print(f"Monitoring namespaces: {namespaces if namespaces else 'all'}")
    print(f"Poll interval: {settings.poll_interval}s")

    last_sync = None

    while True:
        try:
            # Calculate since time (only fetch changes since last sync)
            since = last_sync if last_sync else datetime.now(timezone.utc) - timedelta(days=7)

            sync_kubernetes(
                kubeconfig=settings.kubeconfig,
                namespaces=namespaces,
                cluster_name=settings.cluster_name,
                connection_id=settings.connection_id,
                since=since
            )

            last_sync = datetime.now(timezone.utc)
            print(f"Sync completed at {last_sync}")

        except Exception as e:
            print(f"Error during sync: {e}")

        print(f"Sleeping for {settings.poll_interval}s...")
        time.sleep(settings.poll_interval)


if __name__ == "__main__":
    main()
