from fastapi import FastAPI, Depends, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import List, Optional
from pydantic import BaseModel
import sys
import os
import json
from pathlib import Path
sys.path.insert(0, '/app')

from shared import get_db, ChangeEvent, Connection, Team

# Connector metadata directory
CONNECTORS_DIR = Path("/app/connectors")

# Pydantic models for request/response
class ConnectionConfig(BaseModel):
    token: str = ""
    poll_interval: int = 300
    repos: str = ""
    branches: str = ""

class ConnectionCreate(BaseModel):
    name: str
    type: str
    enabled: bool = False
    config: ConnectionConfig
    tags: str = ""

class ConnectionUpdate(BaseModel):
    name: str
    enabled: bool
    config: ConnectionConfig
    tags: str = ""

class TeamCreate(BaseModel):
    name: str
    tags: str = ""

class TeamUpdate(BaseModel):
    tags: str

class ConnectionTest(BaseModel):
    type: str
    config: dict

class PainChainLogEvent(BaseModel):
    event_type: str
    connector_name: str = ""
    connector_type: str = ""
    changes: dict = {}
    field: str = ""
    old_value: str = ""
    new_value: str = ""
    # For field visibility changes
    field_key: str = ""
    visible: bool = True
    author: str = "system"

app = FastAPI(title="PainChain API", description="Change Management Aggregator API", version="0.1.0")

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup_event():
    """Initialize PainChain connector on application startup"""
    from shared.database import SessionLocal
    db = SessionLocal()
    try:
        # Check if PainChain connector already exists
        painchain_connection = db.query(Connection).filter(
            Connection.type == "painchain"
        ).first()

        if not painchain_connection:
            # Create default PainChain connection
            painchain_connection = Connection(
                name="PainChain System",
                type="painchain",
                enabled=True,
                config={},
                tags="system,audit"
            )
            db.add(painchain_connection)
            db.commit()
            print("✅ PainChain connector initialized on startup")
        else:
            print("✅ PainChain connector already exists")
    except Exception as e:
        print(f"❌ Failed to initialize PainChain connector: {e}")
        db.rollback()
    finally:
        db.close()


@app.get("/")
async def root():
    return {
        "message": "PainChain API",
        "version": "0.1.0",
        "description": "Read-only API for change management events"
    }


@app.get("/health")
async def health():
    return {"status": "healthy"}


@app.get("/api/connectors/metadata")
async def get_connectors_metadata():
    """Get metadata for all available connectors"""
    metadata = []

    if not CONNECTORS_DIR.exists():
        return metadata

    for connector_dir in CONNECTORS_DIR.iterdir():
        if not connector_dir.is_dir():
            continue

        metadata_file = connector_dir / "metadata.json"
        if not metadata_file.exists():
            continue

        try:
            with open(metadata_file, 'r') as f:
                connector_metadata = json.load(f)
                metadata.append(connector_metadata)
        except Exception as e:
            print(f"Failed to load metadata for {connector_dir.name}: {e}")
            continue

    return metadata


@app.get("/api/connectors/{connector_id}/logo")
async def get_connector_logo(connector_id: str):
    """Get logo for a specific connector"""
    connector_dir = CONNECTORS_DIR / connector_id

    if not connector_dir.exists():
        raise HTTPException(status_code=404, detail="Connector not found")

    # Read metadata to get logo filename
    metadata_file = connector_dir / "metadata.json"
    if not metadata_file.exists():
        raise HTTPException(status_code=404, detail="Connector metadata not found")

    try:
        with open(metadata_file, 'r') as f:
            metadata = json.load(f)
            logo_filename = metadata.get('logo')

            if not logo_filename:
                raise HTTPException(status_code=404, detail="Logo not specified in metadata")

            logo_path = connector_dir / logo_filename

            if not logo_path.exists():
                raise HTTPException(status_code=404, detail="Logo file not found")

            return FileResponse(logo_path)
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail="Invalid metadata file")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/changes", response_model=List[dict])
async def get_changes(
    source: Optional[str] = None,
    status: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    team_id: Optional[int] = None,
    tag: List[str] = Query([]),
    limit: int = 100,
    offset: int = 0,
    db: Session = Depends(get_db)
):
    """Get change events from the database with filtering"""
    query = db.query(ChangeEvent)

    if source:
        query = query.filter(ChangeEvent.source == source)

    if status:
        query = query.filter(ChangeEvent.status == status)

    if start_date:
        from datetime import datetime
        start_dt = datetime.fromisoformat(start_date.replace('Z', '+00:00'))
        query = query.filter(ChangeEvent.timestamp >= start_dt)

    if end_date:
        from datetime import datetime
        end_dt = datetime.fromisoformat(end_date.replace('Z', '+00:00'))
        query = query.filter(ChangeEvent.timestamp <= end_dt)

    # Filter by team - events must have a tag that the team subscribes to
    if team_id:
        team = db.query(Team).filter(Team.id == team_id).first()
        if team and team.tags:
            # Get all connections that have at least one tag the team subscribes to
            connections = db.query(Connection).all()
            matching_connection_ids = []
            for conn in connections:
                if conn.tags:
                    conn_tags = [t.strip() for t in conn.tags.split(',') if t.strip()]
                    # Check if any team tag matches any connection tag
                    if any(team_tag in conn_tags for team_tag in team.tags):
                        matching_connection_ids.append(conn.id)

            if matching_connection_ids:
                query = query.filter(ChangeEvent.connection_id.in_(matching_connection_ids))
            else:
                # No matching connections, return empty
                return []

    # Filter by tags - events must be from a connection with at least one of these tags
    # Special handling: if filtering by a team tag, include team's subscribed tags
    if tag:
        # Expand filter tags to include team subscriptions
        expanded_filter_tags = set(tag)

        # Check if any filter tag is a team NAME (not just a tag in team.tags)
        # Load all teams and check in Python since Team.tags is JSON
        all_teams = db.query(Team).all()
        for filter_tag in tag:
            for team in all_teams:
                if team.name == filter_tag and team.tags:
                    # Add all team's subscribed tags to the filter
                    expanded_filter_tags.update(team.tags)
                    break

        connections = db.query(Connection).all()
        matching_connection_ids = []
        for conn in connections:
            if conn.tags:
                conn_tags = [t.strip() for t in conn.tags.split(',') if t.strip()]
                # Check if any of the expanded filter tags match any connection tag
                if any(filter_tag in conn_tags for filter_tag in expanded_filter_tags):
                    matching_connection_ids.append(conn.id)

        if matching_connection_ids:
            query = query.filter(ChangeEvent.connection_id.in_(matching_connection_ids))
        else:
            # No matching connections, return empty
            return []

    events = query.order_by(ChangeEvent.timestamp.desc()).offset(offset).limit(limit).all()

    return [
        {
            "id": e.id,
            "connection_id": e.connection_id,
            "source": e.source,
            "event_id": e.event_id,
            "title": e.title,
            "description": e.description,
            "author": e.author,
            "timestamp": e.timestamp.isoformat() + 'Z' if e.timestamp.tzinfo is None else e.timestamp.isoformat(),
            "url": e.url,
            "status": e.status,
            "metadata": e.event_metadata,
            "created_at": (e.created_at.isoformat() + 'Z' if e.created_at.tzinfo is None else e.created_at.isoformat()) if e.created_at else None
        }
        for e in events
    ]


@app.get("/api/changes/{event_id}")
async def get_change(event_id: int, db: Session = Depends(get_db)):
    """Get a specific change event by ID"""
    event = db.query(ChangeEvent).filter(ChangeEvent.id == event_id).first()

    if not event:
        return {"error": "Event not found"}, 404

    return {
        "id": event.id,
        "connection_id": event.connection_id,
        "source": event.source,
        "event_id": event.event_id,
        "title": event.title,
        "description": event.description,
        "author": event.author,
        "timestamp": event.timestamp.isoformat() + 'Z' if event.timestamp.tzinfo is None else event.timestamp.isoformat(),
        "url": event.url,
        "status": event.status,
        "metadata": event.metadata,
        "created_at": (event.created_at.isoformat() + 'Z' if event.created_at.tzinfo is None else event.created_at.isoformat()) if event.created_at else None
    }


@app.get("/api/connections")
async def get_connections(db: Session = Depends(get_db)):
    """Get all configured connections"""
    connections = db.query(Connection).all()

    return [
        {
            "id": c.id,
            "name": c.name,
            "type": c.type,
            "enabled": c.enabled,
            "config": c.config,
            "tags": c.tags or "",
            "last_sync": (c.last_sync.isoformat() + 'Z' if c.last_sync.tzinfo is None else c.last_sync.isoformat()) if c.last_sync else None,
            "created_at": (c.created_at.isoformat() + 'Z' if c.created_at.tzinfo is None else c.created_at.isoformat()) if c.created_at else None
        }
        for c in connections
    ]


@app.get("/api/connections/{connection_id}")
async def get_connection(connection_id: int, db: Session = Depends(get_db)):
    """Get a specific connection by ID"""
    connection = db.query(Connection).filter(Connection.id == connection_id).first()

    if not connection:
        raise HTTPException(status_code=404, detail="Connection not found")

    return {
        "id": connection.id,
        "name": connection.name,
        "type": connection.type,
        "enabled": connection.enabled,
        "config": connection.config,
        "tags": connection.tags or "",
        "last_sync": (connection.last_sync.isoformat() + 'Z' if connection.last_sync.tzinfo is None else connection.last_sync.isoformat()) if connection.last_sync else None,
        "created_at": (connection.created_at.isoformat() + 'Z' if connection.created_at.tzinfo is None else connection.created_at.isoformat()) if connection.created_at else None
    }


@app.post("/api/connections")
async def create_connection(
    connection_data: ConnectionCreate,
    db: Session = Depends(get_db)
):
    """Create a new connection"""
    connection = Connection(
        name=connection_data.name,
        type=connection_data.type,
        enabled=connection_data.enabled,
        config=connection_data.config.dict(),
        tags=connection_data.tags
    )

    db.add(connection)
    db.commit()
    db.refresh(connection)

    # Trigger immediate sync if connection is enabled
    task_id = None
    if connection.enabled:
        try:
            from tasks import poll_connection
            task = poll_connection.delay(connection.id)
            task_id = task.id
        except Exception as e:
            print(f"Failed to trigger initial sync: {e}")

    return {
        "id": connection.id,
        "name": connection.name,
        "type": connection.type,
        "enabled": connection.enabled,
        "config": connection.config,
        "tags": connection.tags,
        "message": "Connection created successfully",
        "task_id": task_id
    }


@app.put("/api/connections/{connection_id}")
async def update_connection(
    connection_id: int,
    update: ConnectionUpdate,
    db: Session = Depends(get_db)
):
    """Update connection configuration"""
    connection = db.query(Connection).filter(Connection.id == connection_id).first()

    if not connection:
        raise HTTPException(status_code=404, detail="Connection not found")

    # Update connection
    connection.name = update.name
    connection.enabled = update.enabled
    connection.config = update.config.dict()
    connection.tags = update.tags

    db.commit()
    db.refresh(connection)

    # Trigger immediate sync if connection is enabled
    task_id = None
    if connection.enabled:
        try:
            from tasks import poll_connection
            task = poll_connection.delay(connection.id)
            task_id = task.id
        except Exception as e:
            print(f"Failed to trigger sync after update: {e}")

    return {
        "id": connection.id,
        "name": connection.name,
        "type": connection.type,
        "enabled": connection.enabled,
        "config": connection.config,
        "tags": connection.tags,
        "message": "Connection updated successfully",
        "task_id": task_id
    }


@app.delete("/api/connections/{connection_id}")
async def delete_connection(connection_id: int, db: Session = Depends(get_db)):
    """Delete a connection"""
    connection = db.query(Connection).filter(Connection.id == connection_id).first()

    if not connection:
        raise HTTPException(status_code=404, detail="Connection not found")

    db.delete(connection)
    db.commit()

    return {"message": "Connection deleted successfully"}


@app.post("/api/connections/{connection_id}/sync")
async def trigger_sync(connection_id: int, db: Session = Depends(get_db)):
    """Manually trigger a connection sync"""
    connection = db.query(Connection).filter(Connection.id == connection_id).first()

    if not connection:
        raise HTTPException(status_code=404, detail="Connection not found")

    if not connection.enabled:
        raise HTTPException(status_code=400, detail="Connection is disabled")

    # Import celery task
    try:
        from tasks import poll_connection
        task = poll_connection.delay(connection_id)
        return {
            "message": f"Sync triggered for {connection.name}",
            "task_id": task.id,
            "connection_id": connection_id
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to trigger sync: {str(e)}")


@app.post("/api/connections/test")
async def test_connection(test_data: ConnectionTest):
    """Test a connection configuration without saving it"""
    try:
        connector_type = test_data.type
        config = test_data.config

        if connector_type == 'github':
            from github import Github, GithubException
            token = config.get('token', '')
            is_enterprise = config.get('isEnterprise', False) or config.get('is_enterprise', False)
            base_url = config.get('base_url', '') or config.get('baseUrl', '')

            if not token:
                return {"success": False, "message": "GitHub token is required"}

            # Only use base_url if isEnterprise is true
            enterprise_url = base_url if (is_enterprise and base_url) else None

            try:
                # Use base_url if provided (for GitHub Enterprise)
                client = Github(base_url=enterprise_url, login_or_token=token) if enterprise_url else Github(token)
                user = client.get_user()
                login = user.login
                return {
                    "success": True,
                    "message": f"Connected successfully as {login}" + (f" (Enterprise)" if enterprise_url else ""),
                    "details": {
                        "login": login,
                        "name": user.name,
                        "type": user.type,
                        "base_url": enterprise_url or "https://api.github.com"
                    }
                }
            except GithubException as e:
                return {"success": False, "message": f"GitHub authentication failed: {str(e)}"}

        elif connector_type == 'gitlab':
            import gitlab
            token = config.get('token', '')
            if not token:
                return {"success": False, "message": "GitLab token is required"}

            try:
                gl = gitlab.Gitlab('https://gitlab.com', private_token=token)
                gl.auth()
                user = gl.user
                return {
                    "success": True,
                    "message": f"Connected successfully as {user.username}",
                    "details": {
                        "username": user.username,
                        "name": user.name
                    }
                }
            except Exception as e:
                return {"success": False, "message": f"GitLab authentication failed: {str(e)}"}

        elif connector_type == 'kubernetes':
            from kubernetes import client, config as k8s_config
            api_server = config.get('api_server')
            token = config.get('token')

            try:
                if api_server and token:
                    # Use provided API server and token
                    configuration = client.Configuration()
                    configuration.host = api_server
                    configuration.api_key = {"authorization": f"Bearer {token}"}
                    configuration.verify_ssl = True
                    api_client = client.ApiClient(configuration)
                else:
                    # Try in-cluster config
                    try:
                        k8s_config.load_incluster_config()
                    except k8s_config.ConfigException:
                        k8s_config.load_kube_config()
                    api_client = client.ApiClient()

                # Test connection by listing namespaces
                v1 = client.CoreV1Api(api_client)
                namespaces = v1.list_namespace(limit=1)

                return {
                    "success": True,
                    "message": f"Connected successfully to Kubernetes cluster",
                    "details": {
                        "api_server": api_server or "in-cluster",
                        "accessible": True
                    }
                }
            except Exception as e:
                return {"success": False, "message": f"Kubernetes connection failed: {str(e)}"}

        elif connector_type == 'painchain':
            # PainChain connector always succeeds (internal logging)
            return {
                "success": True,
                "message": "PainChain connector is ready",
                "details": {
                    "type": "internal"
                }
            }

        else:
            return {"success": False, "message": f"Unknown connector type: {connector_type}"}

    except Exception as e:
        return {"success": False, "message": f"Test failed: {str(e)}"}


@app.post("/api/painchain/log")
async def log_painchain_event(
    event_data: PainChainLogEvent,
    db: Session = Depends(get_db)
):
    """Log a PainChain event (internal system events)"""
    try:
        # Get PainChain connection (should always exist after startup)
        painchain_connection = db.query(Connection).filter(
            Connection.type == "painchain"
        ).first()

        if not painchain_connection:
            raise HTTPException(status_code=500, detail="PainChain connector not initialized")

        # Import PainChain connector
        from connectors.painchain.connector import PainChainConnector

        # Initialize connector
        connector = PainChainConnector()

        # Log the appropriate event type
        event_type = event_data.event_type
        success = False

        if event_type == "connector_created":
            success = connector.log_connector_created(
                db_session=db,
                connection_id=painchain_connection.id,
                connector_name=event_data.connector_name,
                connector_type=event_data.connector_type,
                author=event_data.author
            )
        elif event_type == "connector_updated":
            success = connector.log_connector_updated(
                db_session=db,
                connection_id=painchain_connection.id,
                connector_name=event_data.connector_name,
                connector_type=event_data.connector_type,
                changes=event_data.changes,
                author=event_data.author
            )
        elif event_type == "connector_deleted":
            success = connector.log_connector_deleted(
                db_session=db,
                connection_id=painchain_connection.id,
                connector_name=event_data.connector_name,
                connector_type=event_data.connector_type,
                author=event_data.author
            )
        elif event_type == "connector_enabled":
            success = connector.log_connector_enabled(
                db_session=db,
                connection_id=painchain_connection.id,
                connector_name=event_data.connector_name,
                connector_type=event_data.connector_type,
                author=event_data.author
            )
        elif event_type == "connector_disabled":
            success = connector.log_connector_disabled(
                db_session=db,
                connection_id=painchain_connection.id,
                connector_name=event_data.connector_name,
                connector_type=event_data.connector_type,
                author=event_data.author
            )
        elif event_type == "config_changed":
            success = connector.log_config_changed(
                db_session=db,
                connection_id=painchain_connection.id,
                connector_name=event_data.connector_name,
                field=event_data.field,
                old_value=event_data.old_value,
                new_value=event_data.new_value,
                author=event_data.author
            )
        elif event_type == "field_visibility_changed":
            success = connector.log_field_visibility_changed(
                db_session=db,
                connection_id=painchain_connection.id,
                event_type=event_data.connector_type,  # The event type being configured (e.g., "PR", "ConnectorCreated")
                field_key=event_data.field_key,
                visible=event_data.visible,
                author=event_data.author
            )
        else:
            return {"success": False, "message": f"Unknown event type: {event_type}"}

        if success:
            return {
                "success": True,
                "message": f"PainChain event logged: {event_type}",
                "event_type": event_type
            }
        else:
            return {
                "success": False,
                "message": f"Event type {event_type} not subscribed or failed to log"
            }

    except Exception as e:
        return {"success": False, "message": f"Failed to log PainChain event: {str(e)}"}


@app.get("/api/stats")
async def get_stats(
    source: Optional[str] = None,
    status: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    team_id: Optional[int] = None,
    tag: List[str] = Query([]),
    db: Session = Depends(get_db)
):
    """Get statistics about change events with optional filtering"""
    query = db.query(ChangeEvent)

    # Apply same filters as /api/changes endpoint
    if source:
        query = query.filter(ChangeEvent.source == source)

    if status:
        query = query.filter(ChangeEvent.status == status)

    if start_date:
        from datetime import datetime
        start_dt = datetime.fromisoformat(start_date.replace('Z', '+00:00'))
        query = query.filter(ChangeEvent.timestamp >= start_dt)

    if end_date:
        from datetime import datetime
        end_dt = datetime.fromisoformat(end_date.replace('Z', '+00:00'))
        query = query.filter(ChangeEvent.timestamp <= end_dt)

    # Filter by team - events must have a tag that the team subscribes to
    if team_id:
        team = db.query(Team).filter(Team.id == team_id).first()
        if team and team.tags:
            # Get all connections that have at least one tag the team subscribes to
            connections = db.query(Connection).all()
            matching_connection_ids = []
            for conn in connections:
                if conn.tags:
                    conn_tags = [t.strip() for t in conn.tags.split(',') if t.strip()]
                    # Check if any team tag matches any connection tag
                    if any(team_tag in conn_tags for team_tag in team.tags):
                        matching_connection_ids.append(conn.id)

            if matching_connection_ids:
                query = query.filter(ChangeEvent.connection_id.in_(matching_connection_ids))
            else:
                # No matching connections, return empty stats
                return {
                    "total_events": 0,
                    "by_source": {},
                    "by_status": {}
                }

    # Filter by tags - events must be from a connection with at least one of these tags
    if tag:
        connections = db.query(Connection).all()
        matching_connection_ids = []
        for conn in connections:
            if conn.tags:
                conn_tags = [t.strip() for t in conn.tags.split(',') if t.strip()]
                # Check if any of the filter tags match any connection tag
                if any(filter_tag in conn_tags for filter_tag in tag):
                    matching_connection_ids.append(conn.id)

        if matching_connection_ids:
            query = query.filter(ChangeEvent.connection_id.in_(matching_connection_ids))
        else:
            # No matching connections, return empty stats
            return {
                "total_events": 0,
                "by_source": {},
                "by_status": {}
            }

    total_events = query.count()

    # Count by source (with filters applied)
    sources_query = query.with_entities(
        ChangeEvent.source,
        func.count(ChangeEvent.id)
    ).group_by(ChangeEvent.source)
    sources = sources_query.all()

    # Count by status (with filters applied)
    statuses_query = query.with_entities(
        ChangeEvent.status,
        func.count(ChangeEvent.id)
    ).group_by(ChangeEvent.status)
    statuses = statuses_query.all()

    return {
        "total_events": total_events,
        "by_source": {source: count for source, count in sources},
        "by_status": {status: count for status, count in statuses}
    }


@app.get("/api/timeline")
async def get_timeline(
    source: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    tag: List[str] = Query([]),
    db: Session = Depends(get_db)
):
    """Get time-series data for events with smart binning"""
    from datetime import datetime, timedelta, timezone
    from sqlalchemy import func as sql_func

    query = db.query(ChangeEvent)

    # Apply filters
    if source:
        query = query.filter(ChangeEvent.source == source)

    if start_date:
        start_dt = datetime.fromisoformat(start_date.replace('Z', '+00:00'))
        # Ensure timezone-aware
        if start_dt.tzinfo is None:
            start_dt = start_dt.replace(tzinfo=timezone.utc)
        query = query.filter(ChangeEvent.timestamp >= start_dt)
    else:
        # Default to last 24 hours if no start date
        start_dt = datetime.now(timezone.utc) - timedelta(hours=24)
        query = query.filter(ChangeEvent.timestamp >= start_dt)

    if end_date:
        end_dt = datetime.fromisoformat(end_date.replace('Z', '+00:00'))
        # Ensure timezone-aware
        if end_dt.tzinfo is None:
            end_dt = end_dt.replace(tzinfo=timezone.utc)
        query = query.filter(ChangeEvent.timestamp <= end_dt)
    else:
        end_dt = datetime.now(timezone.utc)

    # Filter by tags - with team expansion
    if tag:
        # Expand filter tags to include team subscriptions
        expanded_filter_tags = set(tag)

        # Check if any filter tag is a team NAME (not just a tag in team.tags)
        # Load all teams and check in Python since Team.tags is JSON
        all_teams = db.query(Team).all()
        for filter_tag in tag:
            for team in all_teams:
                if team.name == filter_tag and team.tags:
                    # Add all team's subscribed tags to the filter
                    expanded_filter_tags.update(team.tags)
                    break

        connections = db.query(Connection).all()
        matching_connection_ids = []
        for conn in connections:
            if conn.tags:
                conn_tags = [t.strip() for t in conn.tags.split(',') if t.strip()]
                if any(filter_tag in conn_tags for filter_tag in expanded_filter_tags):
                    matching_connection_ids.append(conn.id)

        if matching_connection_ids:
            query = query.filter(ChangeEvent.connection_id.in_(matching_connection_ids))
        else:
            return {"bins": [], "interval": "hour", "total_events": 0}

    # Always divide the time range into exactly 60 bins
    num_bins = 60
    time_range_seconds = (end_dt - start_dt).total_seconds()
    bin_width_seconds = time_range_seconds / num_bins

    # Calculate bin size for display purposes
    if bin_width_seconds < 60:
        bin_size = "second"
    elif bin_width_seconds < 3600:
        bin_size = "minute"
    elif bin_width_seconds < 86400:
        bin_size = "hour"
    else:
        bin_size = "day"

    # Get all events in the time range
    all_events = db.query(
        ChangeEvent.timestamp,
        ChangeEvent.source
    ).filter(
        ChangeEvent.id.in_(query.with_entities(ChangeEvent.id))
    ).all()

    # Create 60 empty bins
    bins_dict = {}
    for i in range(num_bins):
        bin_start = start_dt + timedelta(seconds=i * bin_width_seconds)
        bin_key = bin_start.isoformat()
        bins_dict[bin_key] = {
            "time": bin_key,
            "total": 0,
            "github": 0,
            "gitlab": 0,
            "kubernetes": 0,
            "painchain": 0
        }

    # Assign events to bins
    total_events = 0
    for event_time, source in all_events:
        # Ensure event_time is timezone-aware
        if event_time.tzinfo is None:
            event_time = event_time.replace(tzinfo=timezone.utc)

        # Calculate which bin this event belongs to
        seconds_from_start = (event_time - start_dt).total_seconds()
        bin_index = min(int(seconds_from_start / bin_width_seconds), num_bins - 1)

        bin_start = start_dt + timedelta(seconds=bin_index * bin_width_seconds)
        bin_key = bin_start.isoformat()

        if bin_key in bins_dict:
            bins_dict[bin_key][source] = bins_dict[bin_key].get(source, 0) + 1
            bins_dict[bin_key]["total"] += 1
            total_events += 1

    # Convert to list sorted by time
    bins_list = sorted(bins_dict.values(), key=lambda x: x["time"])

    # Update the last bin's time label to end_dt so the graph extends to "now"
    if bins_list:
        bins_list[-1]["time"] = end_dt.isoformat()

    return {
        "bins": bins_list,
        "interval": bin_size,
        "total_events": total_events,
        "by_source": {source: count for source, count in
                     db.query(ChangeEvent.source, sql_func.count(ChangeEvent.id))
                     .filter(ChangeEvent.id.in_(query.with_entities(ChangeEvent.id)))
                     .group_by(ChangeEvent.source).all()}
    }


# Team management endpoints
@app.get("/api/teams")
async def get_teams(db: Session = Depends(get_db)):
    """Get all teams"""
    teams = db.query(Team).all()
    return [
        {
            "id": t.id,
            "name": t.name,
            "tags": t.tags,
            "created_at": (t.created_at.isoformat() + 'Z' if t.created_at.tzinfo is None else t.created_at.isoformat()) if t.created_at else None
        }
        for t in teams
    ]


@app.get("/api/teams/{team_id}")
async def get_team(team_id: int, db: Session = Depends(get_db)):
    """Get a specific team"""
    team = db.query(Team).filter(Team.id == team_id).first()

    if not team:
        raise HTTPException(status_code=404, detail="Team not found")

    return {
        "id": team.id,
        "name": team.name,
        "tags": team.tags,
        "created_at": (team.created_at.isoformat() + 'Z' if team.created_at.tzinfo is None else team.created_at.isoformat()) if team.created_at else None
    }


@app.post("/api/teams")
async def create_team(team_data: TeamCreate, db: Session = Depends(get_db)):
    """Create a new team"""
    # Check if team already exists
    existing = db.query(Team).filter(Team.name == team_data.name).first()
    if existing:
        raise HTTPException(status_code=400, detail="Team already exists")

    # Parse tags and ensure team name is the first tag
    additional_tags = [t.strip() for t in team_data.tags.split(',') if t.strip()] if team_data.tags else []
    all_tags = [team_data.name] + additional_tags

    team = Team(
        name=team_data.name,
        tags=all_tags
    )

    db.add(team)
    db.commit()
    db.refresh(team)

    return {
        "id": team.id,
        "name": team.name,
        "tags": team.tags,
        "message": "Team created successfully"
    }


@app.put("/api/teams/{team_id}")
async def update_team(
    team_id: int,
    update: TeamUpdate,
    db: Session = Depends(get_db)
):
    """Update team tags"""
    team = db.query(Team).filter(Team.id == team_id).first()

    if not team:
        raise HTTPException(status_code=404, detail="Team not found")

    # Parse additional tags and combine with team name (immutable first tag)
    additional_tags = [t.strip() for t in update.tags.split(',') if t.strip()] if update.tags else []
    all_tags = [team.name] + additional_tags

    team.tags = all_tags
    db.commit()
    db.refresh(team)

    return {
        "id": team.id,
        "name": team.name,
        "tags": team.tags,
        "message": "Team updated successfully"
    }


@app.delete("/api/teams/{team_id}")
async def delete_team(team_id: int, db: Session = Depends(get_db)):
    """Delete a team"""
    team = db.query(Team).filter(Team.id == team_id).first()

    if not team:
        raise HTTPException(status_code=404, detail="Team not found")

    db.delete(team)
    db.commit()

    return {"message": "Team deleted successfully"}
