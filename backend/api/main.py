from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import List, Optional
from pydantic import BaseModel
import sys
sys.path.insert(0, '/app')

from shared import get_db, ChangeEvent, Connector, Team

# Pydantic models for request/response
class ConnectorConfig(BaseModel):
    token: str = ""
    poll_interval: int = 300
    repos: str = ""
    tags: str = ""

class ConnectorUpdate(BaseModel):
    enabled: bool
    config: ConnectorConfig

class TeamCreate(BaseModel):
    name: str
    tags: str = ""

class TeamUpdate(BaseModel):
    tags: str

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

    events = query.order_by(ChangeEvent.timestamp.desc()).offset(offset).limit(limit).all()

    return [
        {
            "id": e.id,
            "source": e.source,
            "event_id": e.event_id,
            "title": e.title,
            "description": e.description,
            "author": e.author,
            "timestamp": e.timestamp.isoformat(),
            "url": e.url,
            "status": e.status,
            "metadata": e.event_metadata,
            "created_at": e.created_at.isoformat() if e.created_at else None
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
        "source": event.source,
        "event_id": event.event_id,
        "title": event.title,
        "description": event.description,
        "author": event.author,
        "timestamp": event.timestamp.isoformat(),
        "url": event.url,
        "status": event.status,
        "metadata": event.metadata,
        "created_at": event.created_at.isoformat() if event.created_at else None
    }


@app.get("/api/connectors")
async def get_connectors(db: Session = Depends(get_db)):
    """Get all configured connectors"""
    connectors = db.query(Connector).all()

    # If no connectors exist, seed with defaults
    if not connectors:
        default_connectors = [
            Connector(name="GitHub", type="github", enabled=False, config={"token": "", "poll_interval": 300, "repos": ""}),
            Connector(name="Jira", type="jira", enabled=False, config={"token": "", "poll_interval": 300, "repos": ""}),
            Connector(name="GitLab", type="gitlab", enabled=False, config={"token": "", "poll_interval": 300, "repos": ""}),
        ]
        db.add_all(default_connectors)
        db.commit()
        connectors = db.query(Connector).all()

    return [
        {
            "id": c.type,  # Use type as ID for frontend compatibility
            "name": c.name,
            "type": c.type,
            "enabled": c.enabled,
            "config": c.config,
            "last_sync": c.last_sync.isoformat() if c.last_sync else None,
            "created_at": c.created_at.isoformat() if c.created_at else None
        }
        for c in connectors
    ]


@app.get("/api/connectors/{connector_id}")
async def get_connector(connector_id: str, db: Session = Depends(get_db)):
    """Get a specific connector by type"""
    connector = db.query(Connector).filter(Connector.type == connector_id).first()

    if not connector:
        raise HTTPException(status_code=404, detail="Connector not found")

    return {
        "id": connector.type,
        "name": connector.name,
        "type": connector.type,
        "enabled": connector.enabled,
        "config": connector.config,
        "last_sync": connector.last_sync.isoformat() if connector.last_sync else None,
        "created_at": connector.created_at.isoformat() if connector.created_at else None
    }


@app.put("/api/connectors/{connector_id}")
async def update_connector(
    connector_id: str,
    update: ConnectorUpdate,
    db: Session = Depends(get_db)
):
    """Update connector configuration"""
    connector = db.query(Connector).filter(Connector.type == connector_id).first()

    if not connector:
        raise HTTPException(status_code=404, detail="Connector not found")

    # Update connector
    connector.enabled = update.enabled
    connector.config = update.config.dict()

    db.commit()
    db.refresh(connector)

    return {
        "id": connector.type,
        "name": connector.name,
        "type": connector.type,
        "enabled": connector.enabled,
        "config": connector.config,
        "message": "Connector updated successfully"
    }


@app.post("/api/connectors/{connector_id}/sync")
async def trigger_sync(connector_id: str, db: Session = Depends(get_db)):
    """Manually trigger a connector sync"""
    connector = db.query(Connector).filter(Connector.type == connector_id).first()

    if not connector:
        raise HTTPException(status_code=404, detail="Connector not found")

    if not connector.enabled:
        raise HTTPException(status_code=400, detail="Connector is disabled")

    # Import celery task
    try:
        from tasks import poll_connector
        task = poll_connector.delay(connector_id)
        return {
            "message": f"Sync triggered for {connector.name}",
            "task_id": task.id,
            "connector": connector_id
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to trigger sync: {str(e)}")


@app.get("/api/stats")
async def get_stats(db: Session = Depends(get_db)):
    """Get statistics about change events"""
    total_events = db.query(ChangeEvent).count()

    # Count by source
    sources = db.query(
        ChangeEvent.source,
        func.count(ChangeEvent.id)
    ).group_by(ChangeEvent.source).all()

    # Count by status
    statuses = db.query(
        ChangeEvent.status,
        func.count(ChangeEvent.id)
    ).group_by(ChangeEvent.status).all()

    return {
        "total_events": total_events,
        "by_source": {source: count for source, count in sources},
        "by_status": {status: count for status, count in statuses}
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
            "created_at": t.created_at.isoformat() if t.created_at else None
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
        "created_at": team.created_at.isoformat() if team.created_at else None
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
