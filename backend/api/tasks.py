import sys
sys.path.insert(0, '/app')

from celery_app import celery_app
from shared import get_db, Connector, ChangeEvent
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


@celery_app.task(name='tasks.poll_connector')
def poll_connector(connector_type: str):
    """Poll a specific connector for changes"""
    logger.info(f"Polling connector: {connector_type}")

    # Get database session
    db = next(get_db())

    try:
        # Get connector config from database
        connector = db.query(Connector).filter(
            Connector.type == connector_type,
            Connector.enabled == True
        ).first()

        if not connector:
            logger.warning(f"Connector {connector_type} not found or disabled")
            return {"status": "skipped", "reason": "disabled or not found"}

        # Get connector module
        connector_module = get_connector_module(connector_type)
        if not connector_module:
            logger.error(f"Failed to load connector module for {connector_type}")
            return {"status": "error", "reason": "module not found"}

        # Get connector function (e.g., sync_github)
        sync_func_name = f"sync_{connector_type}"
        if not hasattr(connector_module, sync_func_name):
            logger.error(f"Connector module {connector_type} missing {sync_func_name} function")
            return {"status": "error", "reason": "sync function not found"}

        sync_func = getattr(connector_module, sync_func_name)

        # Execute sync
        result = sync_func(db, connector.config)

        # Update last_sync timestamp
        connector.last_sync = datetime.utcnow()
        db.commit()

        logger.info(f"Successfully polled {connector_type}: {result}")
        return {"status": "success", "result": result}

    except Exception as e:
        logger.error(f"Error polling {connector_type}: {e}")
        return {"status": "error", "error": str(e)}
    finally:
        db.close()


@celery_app.task(name='tasks.sync_all_connectors')
def sync_all_connectors():
    """Sync all enabled connectors"""
    logger.info("Syncing all enabled connectors")

    db = next(get_db())

    try:
        # Get all enabled connectors
        connectors = db.query(Connector).filter(Connector.enabled == True).all()

        results = []
        for connector in connectors:
            logger.info(f"Triggering sync for {connector.type}")
            result = poll_connector.delay(connector.type)
            results.append({
                "connector": connector.type,
                "task_id": result.id
            })

        return {"status": "success", "triggered": len(results), "tasks": results}

    except Exception as e:
        logger.error(f"Error syncing all connectors: {e}")
        return {"status": "error", "error": str(e)}
    finally:
        db.close()
