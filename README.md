# PainChain

**Change Management Aggregator** - Find the root cause of your production outage by following the changes that led to it across environments and infrastructure.

## Architecture

PainChain uses a clean microservices architecture:

- **PostgreSQL Database** - Central data store for all change events
- **API Service** - Read-only FastAPI service for querying events
- **Connector Services** - Independent microservices that poll external sources and write to the database
- **Frontend Dashboard** - React-based UI for viewing and filtering change events

## Features

- **Modular Connector System** - Enable/disable connectors by commenting them in `docker-compose.yml`
- **Configurable Polling** - Set poll intervals per connector via environment variables
- **Flexible Data Model** - JSONB fields for descriptions and metadata support rich, structured data
- **Real-time Dashboard** - Auto-refreshing React UI with filtering capabilities
- **Docker Compose Orchestration** - Everything runs with a single command

## Quick Start

1. **Clone and configure:**
   ```bash
   cp .env.example .env
   # Edit .env and add your GitHub token
   ```

2. **Start all services:**
   ```bash
   docker-compose up --build
   ```

3. **Access the dashboard:**
   - Frontend: http://localhost:5173
   - API Docs: http://localhost:8000/docs
   - Database: localhost:5432

## Configuration

### Environment Variables

Edit `.env` file:

```bash
# Database
DB_PASSWORD=changeme

# GitHub Connector
GITHUB_TOKEN=ghp_your_token_here
GITHUB_POLL_INTERVAL=300  # seconds
GITHUB_REPOS=owner/repo1,owner/repo2  # optional, leave empty for all repos
```

### Enable/Disable Connectors

Comment out services in `docker-compose.yml`:

```yaml
# Disable GitHub connector
# connector-github:
#   build: ...
```

## Project Structure

```
PainChain/
├── backend/
│   ├── shared/           # Shared code (models, database)
│   ├── api/              # FastAPI read-only API
│   └── connectors/
│       └── github/       # GitHub connector microservice
├── frontend/             # React dashboard
├── docker-compose.yml    # Service orchestration
└── .env                  # Configuration
```

## API Endpoints

- `GET /api/changes` - List all change events (supports filtering)
- `GET /api/changes/{id}` - Get specific event
- `GET /api/stats` - Get statistics
- `GET /api/connectors` - List configured connectors

## Adding New Connectors

1. Create `backend/connectors/<name>/` directory
2. Add connector logic with polling loop
3. Create Dockerfile
4. Add service to `docker-compose.yml`
5. Add configuration to `.env`

See `backend/connectors/github/` as a reference implementation.

## Database Schema

### change_events
- Stores all change events from all sources
- `description` field is JSONB for flexible structured data (text, related_events, etc.)
- Unique constraint on (source, event_id)

### connectors
- Tracks connector configurations and last sync times

## Development

### Run individual services:

```bash
# API only
cd backend/api
pip install -r requirements.txt
uvicorn main:app --reload

# GitHub connector only
cd backend/connectors/github
pip install -r requirements.txt
python main.py

# Frontend only
cd frontend
npm install
npm run dev
```

## License

MIT
