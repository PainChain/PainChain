import sys
sys.path.insert(0, '/app')

from celery_app import celery_app
from shared import get_db, Connection, ChangeEvent
from datetime import datetime
from sqlalchemy.orm import Session
import importlib
import logging
import redis
import os

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Redis client for task deduplication
redis_client = redis.from_url(os.getenv('REDIS_URL', 'redis://localhost:6379/0'))


def get_connector_module(connector_type: str):
    """Dynamically import connector module"""
    try:
        module = importlib.import_module(f'connectors.{connector_type}.connector')
        return module
    except ImportError as e:
        logger.error(f"Failed to import connector {connector_type}: {e}")
        return None


@celery_app.task(name='tasks.poll_connection')
def poll_connection(connection_id: int):
    """Poll a specific connection for changes"""

    # Task deduplication: Check if this connection is already being polled
    lock_key = f"poll_lock:{connection_id}"
    lock = redis_client.lock(lock_key, timeout=300, blocking=False)  # 5 minute timeout

    if not lock.acquire(blocking=False):
        logger.info(f"Connection {connection_id} is already being polled, skipping")
        return {"status": "skipped", "reason": "already polling"}

    try:
        logger.info(f"Polling connection ID: {connection_id}")

        # Get database session
        db = next(get_db())

        try:
            # Get connection config from database
            connection = db.query(Connection).filter(
                Connection.id == connection_id,
                Connection.enabled == True
            ).first()

            if not connection:
                logger.warning(f"Connection {connection_id} not found or disabled")
                return {"status": "skipped", "reason": "disabled or not found"}

            # Get connector module
            connector_module = get_connector_module(connection.type)
            if not connector_module:
                logger.error(f"Failed to load connector module for {connection.type}")
                return {"status": "error", "reason": "module not found"}

            # Get connector function (e.g., sync_github)
            sync_func_name = f"sync_{connection.type}"
            if not hasattr(connector_module, sync_func_name):
                logger.error(f"Connector module {connection.type} missing {sync_func_name} function")
                return {"status": "error", "reason": "sync function not found"}

            sync_func = getattr(connector_module, sync_func_name)

            # Execute sync with connection_id
            result = sync_func(db, connection.config, connection.id)

            # Update last_sync timestamp
            connection.last_sync = datetime.utcnow()
            db.commit()

            logger.info(f"Successfully polled connection {connection_id} ({connection.name}): {result}")
            return {"status": "success", "result": result}

        except Exception as e:
            logger.error(f"Error polling connection {connection_id}: {e}")
            return {"status": "error", "error": str(e)}
        finally:
            db.close()
    finally:
        # Release the lock
        lock.release()
        logger.debug(f"Released poll lock for connection {connection_id}")


@celery_app.task(name='tasks.sync_all_connections')
def sync_all_connections():
    """Sync enabled connections based on their individual poll_interval"""
    logger.info("Checking connections for scheduled sync")

    db = next(get_db())

    try:
        # Get all enabled connections
        connections = db.query(Connection).filter(Connection.enabled == True).all()

        results = []
        for connection in connections:
            # Get poll_interval from connection config (default to 300 seconds)
            poll_interval = connection.config.get('poll_interval', 300)

            # Check if connection needs syncing based on last_sync time
            should_sync = False
            if connection.last_sync is None:
                # Never synced before - sync now
                should_sync = True
            else:
                # Check if enough time has passed since last sync
                from datetime import timezone
                now = datetime.now(timezone.utc)
                time_since_sync = (now - connection.last_sync.replace(tzinfo=timezone.utc)).total_seconds()
                should_sync = time_since_sync >= poll_interval

            if should_sync:
                logger.info(f"Triggering sync for connection {connection.id} ({connection.name}) - poll_interval: {poll_interval}s")
                result = poll_connection.delay(connection.id)
                results.append({
                    "connection_id": connection.id,
                    "connection_name": connection.name,
                    "task_id": result.id,
                    "poll_interval": poll_interval
                })
            else:
                logger.debug(f"Skipping connection {connection.id} ({connection.name}) - not due for sync yet")

        logger.info(f"Triggered sync for {len(results)} connections")
        return {"status": "success", "triggered": len(results), "tasks": results}

    except Exception as e:
        logger.error(f"Error syncing all connections: {e}")
        return {"status": "error", "error": str(e)}
    finally:
        db.close()
