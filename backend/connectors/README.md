# PainChain Connectors

This directory contains all connector implementations for PainChain. Each connector is self-contained in its own folder with all necessary configuration, code, and assets.

## Architecture

Connectors use a **hybrid discovery system**: backend metadata is auto-discovered, but frontend configuration requires manual setup for event display and connection forms.

### How It Works

**Auto-Discovered (Backend):**
1. **Backend** - Scans `/app/connectors/` directory for folders containing `metadata.json`
2. **API Endpoint** - `/api/connectors/metadata` returns all connector metadata
3. **Frontend** - Loads metadata on startup and dynamically:
   - Generates CSS classes for event badges (`.source-badge.{connector-id}`)
   - Loads connector logos from backend
   - Applies colors to timeline visualization

**Manual Configuration (Frontend):**
- Connection form fields (`connectorConfigs.json`)
- Event type display configurations (`Dashboard.jsx`)
- Field visibility settings (`fieldVisibility.js`)

**Why Hybrid?** Full automation would require a complex schema system for defining UI forms and field rendering logic. The manual approach provides maximum flexibility for custom event displays and validation while still auto-discovering backend metadata.

## Adding a New Connector

Adding a connector requires both **backend implementation** (steps 1-7) and **frontend configuration** (steps 8-9):

### Backend Steps (Auto-Discovered)
1-7: Create connector folder, metadata, logo, and implementation

### Frontend Steps (Manual Configuration)
8-9: Configure connection form and event display

**Overview:**

### 1. Create Connector Folder

Create a new folder in `/backend/connectors/` with your connector name (lowercase, no spaces):

```bash
mkdir /backend/connectors/myconnector
cd /backend/connectors/myconnector
```

### 2. Create metadata.json

Create a `metadata.json` file with the following structure:

```json
{
  "id": "myconnector",
  "displayName": "My Connector",
  "color": "#FF5733",
  "logo": "myconnector.png",
  "description": "Brief description of what this connector tracks"
}
```

**Fields:**
- `id` (required): Unique identifier, must match folder name (lowercase, alphanumeric)
- `displayName` (required): Human-readable name shown in UI
- `color` (required): Hex color code for timeline bars and event badges
- `logo` (required): Filename of logo image (must be in connector folder)
- `description` (required): One-line description of connector purpose

**Color Guidelines:**
- Use distinct, high-contrast colors
- Test against dark backgrounds (#1e1e1e)
- Avoid colors too similar to existing connectors:
  - GitHub: #00E8A0 (green)
  - GitLab: #fc6d26 (orange)
  - Kubernetes: #326ce5 (blue)
  - PainChain: #9f7aea (purple)

### 3. Add Logo

Place your logo image in the connector folder:

```bash
cp /path/to/logo.png /backend/connectors/myconnector/myconnector.png
```

**Logo Requirements:**
- Format: PNG (preferred) or JPG
- Size: 512x512px recommended
- Transparent background preferred
- Clear, recognizable icon/logo

### 4. Create Connector Implementation

Create `connector.py` with your connector logic:

```python
from typing import Dict, Any, Optional
from datetime import datetime
import sys
sys.path.insert(0, '/app')

from shared import ChangeEvent, SessionLocal


class MyConnectorConnector:
    """MyConnector connector description"""

    def __init__(self, **config):
        """Initialize MyConnector connector"""
        # Store configuration
        self.api_key = config.get('api_key', '')
        self.endpoint = config.get('endpoint', '')

    def test_connection(self) -> bool:
        """Test MyConnector connection"""
        try:
            # Test your API connection here
            return True
        except Exception as e:
            print(f"Connection test failed: {e}")
            return False

    def fetch_and_store_changes(self, db_session, connection_id: int) -> Dict[str, Any]:
        """Fetch changes from MyConnector and store in database"""
        fetched = 0
        stored = 0

        try:
            # Fetch events from your API
            events = self._fetch_events()

            for event in events:
                # Create unique event ID
                event_id = f"myconnector-{event['type']}-{event['id']}"

                # Check if event already exists
                existing = db_session.query(ChangeEvent).filter(
                    ChangeEvent.source == "myconnector",
                    ChangeEvent.event_id == event_id
                ).first()

                if existing:
                    continue

                # Create ChangeEvent
                change_event = ChangeEvent(
                    connection_id=connection_id,
                    source="myconnector",
                    event_id=event_id,
                    title=event['title'],
                    description=event['description'],
                    author=event['author'],
                    timestamp=event['timestamp'],
                    url=event['url'],
                    status=event['status'],
                    event_metadata=event.get('metadata', {})
                )

                db_session.add(change_event)
                stored += 1

            db_session.commit()
            fetched = len(events)

        except Exception as e:
            print(f"Failed to fetch changes: {e}")
            db_session.rollback()

        return {"fetched": fetched, "stored": stored}

    def _fetch_events(self):
        """Private method to fetch events from API"""
        # Implement your API fetching logic here
        pass


def sync_myconnector(db_session, config: Dict[str, Any], connection_id: int) -> Dict[str, Any]:
    """
    Sync MyConnector (called by Celery tasks)

    Args:
        db_session: SQLAlchemy database session
        config: Configuration dict
        connection_id: ID of the connection this sync belongs to

    Returns:
        Dict with sync results
    """
    connector = MyConnectorConnector(**config)

    if not connector.test_connection():
        return {"error": "MyConnector connection test failed"}

    result = connector.fetch_and_store_changes(db_session, connection_id)

    print(f"MyConnector sync completed for connection {connection_id}")
    print(f"  Fetched: {result['fetched']} events")
    print(f"  Stored: {result['stored']} new events")

    return {
        "status": "success",
        "fetched": result['fetched'],
        "stored": result['stored']
    }
```

### 5. Create __init__.py

Export your connector class and sync function:

```python
from .connector import MyConnectorConnector, sync_myconnector

__all__ = ['MyConnectorConnector', 'sync_myconnector']
```

### 6. Create requirements.txt

List Python dependencies specific to your connector:

```txt
pydantic==2.10.3
pydantic-settings==2.6.1
python-dotenv==1.0.1
psycopg2-binary==2.9.10
sqlalchemy==2.0.36
# Add your connector-specific dependencies here
requests==2.31.0
```

### 7. Create main.py (Optional)

For standalone polling mode:

```python
import os
import time
from datetime import datetime
from connector import MyConnectorConnector

# Configuration from environment variables
API_KEY = os.getenv("MYCONNECTOR_API_KEY", "")
POLL_INTERVAL = int(os.getenv("POLL_INTERVAL", "300"))


def main():
    """Main polling loop for MyConnector"""

    if not API_KEY:
        print("ERROR: MYCONNECTOR_API_KEY not set. Exiting.")
        return

    print("=" * 60)
    print("PainChain - MyConnector Connector")
    print("=" * 60)
    print(f"Poll Interval: {POLL_INTERVAL} seconds")
    print("=" * 60)

    connector = MyConnectorConnector(api_key=API_KEY)

    if not connector.test_connection():
        print("ERROR: Failed to connect to MyConnector.")
        return

    print("Connected to MyConnector successfully!")
    print()

    while True:
        try:
            print(f"[{datetime.now().isoformat()}] Starting sync...")
            result = connector.fetch_and_store_changes()
            print(f"[{datetime.now().isoformat()}] Sync complete:")
            print(f"  - Fetched: {result['fetched']} events")
            print(f"  - Stored: {result['stored']} new events")
            print()
        except Exception as e:
            print(f"[{datetime.now().isoformat()}] ERROR: {e}")
            print()

        print(f"Sleeping for {POLL_INTERVAL} seconds...")
        print("-" * 60)
        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    main()
```

### 8. Add Connector Configuration (Frontend - Required)

**Why manual?** The connection form needs to know what fields to display (API keys, URLs, poll intervals, etc.) and validation rules specific to your connector.

Create configuration schema in `/frontend/src/config/connectorConfigs.json`:

```json
{
  "myconnector": {
    "id": "myconnector",
    "name": "My Connector",
    "fields": [
      {
        "key": "name",
        "label": "Connection Name",
        "type": "text",
        "placeholder": "e.g., Production MyConnector",
        "required": true
      },
      {
        "key": "api_key",
        "label": "API Key",
        "type": "password",
        "placeholder": "Enter API Key",
        "required": true
      },
      {
        "key": "endpoint",
        "label": "API Endpoint",
        "type": "text",
        "placeholder": "https://api.myconnector.com",
        "required": false
      },
      {
        "key": "pollInterval",
        "label": "Poll Interval (seconds)",
        "type": "number",
        "placeholder": "300",
        "default": "300",
        "required": true
      },
      {
        "key": "tags",
        "label": "Tags",
        "type": "text",
        "placeholder": "tag1,tag2,tag3",
        "help": "Comma-separated tags for filtering events by team.",
        "required": false
      }
    ]
  }
}
```

### 9. Register Event Types (Frontend - Required)

**Why manual?** Each connector produces different event types with unique data structures. The frontend needs to know how to display each event type's specific fields.

Add event type configurations in `/frontend/src/pages/Dashboard.jsx`:

```javascript
// Add to EVENT_TYPE_CONFIGS object
'MyConnectorDeploy': {
  titleMatch: '[Deploy]',
  sections: [{
    title: 'Details',
    fields: [
      {key: 'environment', label: 'Environment', value: (event) => event.description?.environment},
      {key: 'version', label: 'Version', value: (event) => event.description?.version},
      {key: 'status', label: 'Status', value: (event) => event.metadata?.status}
    ]
  }]
},
```

Add to field visibility system in `/frontend/src/utils/fieldVisibility.js`:

```javascript
// In DEFAULT_FIELD_VISIBILITY
MyConnectorDeploy: {
  environment: true,
  version: true,
  status: true
},

// In FIELD_LABELS
MyConnectorDeploy: {
  environment: 'Environment',
  version: 'Version',
  status: 'Deployment Status'
},

// In EVENT_TYPE_NAMES
MyConnectorDeploy: 'Deployments (MyConnector)',
```

### 10. Test Your Connector

1. **Backend Test**: Verify metadata endpoint returns your connector
   ```bash
   curl http://localhost:8000/api/connectors/metadata
   ```

2. **Logo Test**: Verify logo is accessible
   ```bash
   curl http://localhost:8000/api/connectors/myconnector/logo --output test.png
   ```

3. **Frontend Test**: Check Settings page shows your connector with logo and color

4. **Integration Test**: Create a connection and verify events appear in dashboard

## Connector Folder Structure

```
/backend/connectors/myconnector/
├── metadata.json          # Required: Connector metadata
├── myconnector.png       # Required: Logo image
├── connector.py          # Required: Main connector logic
├── __init__.py          # Required: Module exports
├── requirements.txt     # Required: Python dependencies
├── main.py             # Optional: Standalone polling script
├── README.md           # Optional: Connector documentation
└── Dockerfile          # Optional: Containerization
```

## Best Practices

### Event IDs
- Use consistent, predictable format: `{source}-{type}-{id}`
- Ensure uniqueness to prevent duplicate storage
- Example: `myconnector-deploy-12345`

### Timestamps
- Use UTC timezone
- Convert from API timestamps to Python datetime objects
- Store in database as datetime (not string)

### Error Handling
- Always wrap API calls in try/except
- Use `db_session.rollback()` on errors
- Print errors for debugging (visible in container logs)
- Return error status in sync function

### Metadata
- Store rich metadata in `event_metadata` field (JSON)
- Include IDs, counts, statuses, relevant flags
- Keep description field human-readable text

### Rate Limiting
- Respect API rate limits
- Use appropriate poll intervals (300s minimum recommended)
- Implement exponential backoff for retries

## Testing

### Unit Tests
Create `/backend/connectors/myconnector/test_connector.py`:

```python
import pytest
from connector import MyConnectorConnector

def test_connection():
    connector = MyConnectorConnector(api_key="test")
    # Add your test assertions
```

### Integration Tests
Test full workflow:
1. Create connection via API
2. Trigger sync
3. Verify events in database
4. Check dashboard display

## Troubleshooting

### Connector Not Appearing in Frontend
- Check `metadata.json` exists and is valid JSON
- Verify `id` matches folder name exactly
- Check browser console for loading errors
- Verify `/api/connectors/metadata` returns your connector

### Logo Not Loading
- Check logo file exists in connector folder
- Verify `logo` field in metadata.json matches filename
- Check file permissions (should be readable)
- Test endpoint: `/api/connectors/{id}/logo`

### Colors Not Applying
- Verify hex color format in metadata.json (include #)
- Check browser DevTools for CSS injection
- Clear browser cache
- Check `injectConnectorStyles()` runs on app mount

### Events Not Storing
- Check database connection in connector code
- Verify `source` field matches connector `id`
- Check for unique event_id conflicts
- Look for exceptions in container logs

## Resources

- [GitHub Connector](./github/) - Full-featured example
- [PainChain Connector](./painchain/) - Minimal internal connector
- [Event Data Model](../shared/models.py) - ChangeEvent schema
- [API Documentation](../../docs/API.md) - Backend API reference

## Questions?

Open an issue or discussion in the PainChain GitHub repository!
