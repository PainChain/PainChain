import sys
sys.path.insert(0, '/app')

from celery_app import celery_app
from shared import get_db, Connection, ChangeEvent
from datetime import datetime
from sqlalchemy.orm import Session
import importlib
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


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


@celery_app.task(name='tasks.sync_all_connections')
def sync_all_connections():
    """Sync all enabled connections"""
    logger.info("Syncing all enabled connections")

    db = next(get_db())

    try:
        # Get all enabled connections
        connections = db.query(Connection).filter(Connection.enabled == True).all()

        results = []
        for connection in connections:
            logger.info(f"Triggering sync for connection {connection.id} ({connection.name})")
            result = poll_connection.delay(connection.id)
            results.append({
                "connection_id": connection.id,
                "connection_name": connection.name,
                "task_id": result.id
            })

        return {"status": "success", "triggered": len(results), "tasks": results}

    except Exception as e:
        logger.error(f"Error syncing all connections: {e}")
        return {"status": "error", "error": str(e)}
    finally:
        db.close()
