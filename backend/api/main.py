from fastapi import FastAPI, Depends, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import List, Optional
from pydantic import BaseModel
import sys
sys.path.insert(0, '/app')

from shared import get_db, ChangeEvent, Connection, Team

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

app = FastAPI(title="PainChain API", description="Change Management Aggregator API", version="0.1.0")

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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

        else:
            return {"success": False, "message": f"Unknown connector type: {connector_type}"}

    except Exception as e:
        return {"success": False, "message": f"Test failed: {str(e)}"}


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
        query = query.filter(ChangeEvent.timestamp >= start_dt)
    else:
        # Default to last 24 hours if no start date
        start_dt = datetime.now(timezone.utc) - timedelta(hours=24)
        query = query.filter(ChangeEvent.timestamp >= start_dt)

    if end_date:
        end_dt = datetime.fromisoformat(end_date.replace('Z', '+00:00'))
        query = query.filter(ChangeEvent.timestamp <= end_dt)
    else:
        end_dt = datetime.now(timezone.utc)

    # Filter by tags
    if tag:
        connections = db.query(Connection).all()
        matching_connection_ids = []
        for conn in connections:
            if conn.tags:
                conn_tags = [t.strip() for t in conn.tags.split(',') if t.strip()]
                if any(filter_tag in conn_tags for filter_tag in tag):
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
            "kubernetes": 0
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
