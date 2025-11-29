from sqlalchemy import Column, Integer, String, Text, DateTime, Boolean, JSON, ForeignKey
from sqlalchemy.sql import func
from .database import Base


class Connection(Base):
    __tablename__ = "connections"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    type = Column(String(50), nullable=False, index=True)
    config = Column(JSON, nullable=False)
    enabled = Column(Boolean, default=True, index=True)
    tags = Column(String)  # Comma-separated tags
    last_sync = Column(DateTime)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class ChangeEvent(Base):
    __tablename__ = "change_events"

    id = Column(Integer, primary_key=True, index=True)
    connection_id = Column(Integer, ForeignKey('connections.id', ondelete='CASCADE'), index=True)
    source = Column(String(50), nullable=False, index=True)
    event_id = Column(String(255), nullable=False)
    title = Column(Text, nullable=False)
    description = Column(JSON)  # JSONB - flexible for related_events, details, etc.
    author = Column(String(255), nullable=False, index=True)
    timestamp = Column(DateTime, nullable=False, index=True)
    url = Column(Text, nullable=False)
    status = Column(String(50), nullable=False, index=True)
    event_metadata = Column("metadata", JSON)  # Use different attribute name
    created_at = Column(DateTime, server_default=func.now())


class Team(Base):
    __tablename__ = "teams"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False, unique=True)
    tags = Column(JSON, nullable=False)  # Array of tag strings
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
