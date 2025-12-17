# PainChain Release Process

This document describes the release process for PainChain, including versioning, testing, and deployment.

## Table of Contents

- [Development Workflow](#development-workflow)
- [Pre-Release Testing](#pre-release-testing)
- [Release Process](#release-process)
- [Docker Images](#docker-images)
- [Version Numbering](#version-numbering)
- [Post-Release](#post-release)

## Development Workflow

### Day-to-Day Development

1. **Create a feature branch**
   ```bash
   git checkout -b feature/add-grafana-connector
   ```

2. **Make your changes and commit**
   ```bash
   git add .
   git commit -m "Add Grafana connector for metrics tracking"
   ```

3. **Push to GitHub**
   ```bash
   git push origin feature/add-grafana-connector
   ```

4. **Open a Pull Request**
   - GitHub Actions will automatically build the images (but not push them)
   - Review the changes
   - Merge to `main`

5. **Automatic main branch builds**
   - When merged to `main`, GitHub Actions automatically builds and publishes:
     - `ghcr.io/<owner>/painchain-api:main`
     - `ghcr.io/<owner>/painchain-frontend:main`
   - These are "bleeding edge" builds for testing

## Pre-Release Testing

Before creating a release, thoroughly test the application:

### 1. Test Locally with Docker Compose

```bash
# Ensure you have a .env file
cp .env.example .env

# Edit .env with appropriate values
nano .env

# Stop any running containers
docker compose down

# Rebuild images from scratch
docker compose build --no-cache

# Start all services
docker compose up -d

# Watch logs
docker compose logs -f
```

### 2. Verify All Services

```bash
# Check all containers are running
docker compose ps

# Expected output:
# painchain-db          running
# painchain-redis       running
# painchain-api         running
# painchain-celery-worker running
# painchain-celery-beat running
# painchain-frontend    running
```

### 3. Test Core Functionality

1. **Frontend**: Navigate to http://localhost (port 80)
   - Should load the dashboard
   - Check that timeline renders
   - Verify filters work
   - Test SPA routing (refresh on a route should work)

2. **API**: Test http://localhost:8000/docs
   - Swagger UI should load
   - Test key endpoints

3. **Database**: Verify data persistence
   ```bash
   docker compose exec db psql -U painchain -d painchain -c "\dt"
   ```

4. **Connectors**: Test a connector sync
   - Go to Settings → Connections
   - Add a test connection
   - Verify events are fetched

### 4. Test Production Build

Build images as they would be in production:

```bash
# Build backend (from repository root)
docker build -t painchain-backend:test -f apps/backend/Dockerfile .

# Build frontend (from frontend directory)
cd frontend
docker build -t painchain-frontend:test .
cd ..

# Run production builds
docker run -d -p 8000:8000 \
  -e DATABASE_URL=postgresql://... \
  -e REDIS_HOST=redis \
  -e REDIS_PORT=6379 \
  painchain-backend:test

docker run -d -p 80:80 \
  painchain-frontend:test
```

**Note**: Frontend now serves on port 80 via nginx in production mode.

## Release Process

### 1. Update Version Information

Ensure version is updated in relevant files:
- `backend/api/main.py` (if you have a version constant)
- `frontend/package.json`
- `README.md` (if version is mentioned)

### 2. Update CHANGELOG

Create or update `CHANGELOG.md`:

```markdown
## [v0.2.0] - 2025-12-09

### Added
- Team tag filtering
- GitLab repository names in events
- GitHub Actions CI/CD workflows

### Changed
- Timeline legend moved to right sidebar
- Environment variables now use .env file

### Fixed
- Tag expansion bug causing incorrect filtering
- Datetime timezone issues in timeline endpoint
```

### 3. Create a Git Tag

```bash
# Ensure you're on main and up to date
git checkout main
git pull

# Create annotated tag
git tag -a v0.2.0 -m "Release v0.2.0

- Team tag filtering
- GitLab repository names
- CI/CD workflows
- Bug fixes for tag filtering and timeline"

# Push the tag
git push origin v0.2.0
```

### 4. Automated Release

GitHub Actions will automatically:
1. Build Docker images for `api` and `frontend`
2. Tag images with:
   - `v0.2.0` (specific version)
   - `latest` (latest release)
3. Push to GitHub Container Registry
4. Create a GitHub Release with auto-generated changelog

Monitor the workflow at: `https://github.com/<owner>/painchain/actions`

### 5. Verify Published Images

```bash
# Pull the released images
docker pull ghcr.io/<owner>/painchain-api:v0.2.0
docker pull ghcr.io/<owner>/painchain-frontend:v0.2.0

# Or use latest
docker pull ghcr.io/<owner>/painchain-api:latest
docker pull ghcr.io/<owner>/painchain-frontend:latest

# Test the released images
docker run -d ghcr.io/<owner>/painchain-api:v0.2.0
```

## Docker Images

### Published Images

All images are published to GitHub Container Registry (ghcr.io):

- **Backend**: `ghcr.io/<owner>/painchain-backend`
- **Frontend**: `ghcr.io/<owner>/painchain-frontend`

### Image Tags

- `latest` - Latest stable release
- `v0.2.0`, `v0.1.0` - Specific version tags
- `main` - Latest commit on main branch (bleeding edge)

### Multi-Architecture Support

Images are built for:
- `linux/amd64` (x86_64)
- `linux/arm64` (ARM64, Apple Silicon)

**Note**: Images use Alpine Linux 3.20 to ensure compatibility with ARM64 QEMU emulation during builds. See [DOCKER_BUILD_UPGRADE.md](./DOCKER_BUILD_UPGRADE.md) for details.

## Version Numbering

PainChain follows [Semantic Versioning](https://semver.org/):

```
v{MAJOR}.{MINOR}.{PATCH}
```

- **MAJOR**: Breaking changes
- **MINOR**: New features (backwards compatible)
- **PATCH**: Bug fixes

Examples:
- `v0.1.0` - Initial release
- `v0.2.0` - Added team features
- `v0.2.1` - Bug fix for team filtering
- `v1.0.0` - First stable release

## Post-Release

### 1. Update Documentation

- Update `README.md` with installation instructions using new version
- Update any getting started guides
- Update Helm chart version (if applicable)

### 2. Announce the Release

- Post in project discussions
- Update project website (if applicable)
- Tweet/post on social media

### 3. Monitor Issues

After release, monitor for:
- Bug reports
- Feature requests
- Installation issues

### 4. Plan Next Release

- Create milestone for next version
- Triage issues into next release
- Update project roadmap

## Hotfix Process

For urgent fixes to a release:

```bash
# Create hotfix branch from tag
git checkout -b hotfix/v0.2.1 v0.2.0

# Make the fix
git commit -m "Fix critical security issue"

# Create new tag
git tag -a v0.2.1 -m "Hotfix: Security patch"

# Push
git push origin v0.2.1

# Merge back to main
git checkout main
git merge hotfix/v0.2.1
git push origin main
```

## Rollback

If a release has critical issues:

### Option 1: Revert to Previous Tag

```bash
# Users can pin to previous version
docker pull ghcr.io/<owner>/painchain-api:v0.1.0
```

### Option 2: Delete Tag and Re-release

```bash
# Delete tag locally and remotely
git tag -d v0.2.0
git push origin :refs/tags/v0.2.0

# Delete release on GitHub (manually)

# Fix issues and re-tag
git tag -a v0.2.0 -m "Release v0.2.0 (fixed)"
git push origin v0.2.0
```

## Production Deployment

For users deploying PainChain:

```bash
# Clone repository
git clone https://github.com/<owner>/painchain.git
cd painchain

# Copy environment template
cp .env.example .env

# Edit .env with production values
nano .env

# Start services
docker compose up -d

# Verify deployment
docker compose ps
docker compose logs -f
```

Or using published images:

```yaml
# docker-compose.prod.yml
version: '3.8'
services:
  api:
    image: ghcr.io/<owner>/painchain-api:latest
    # ... rest of config

  frontend:
    image: ghcr.io/<owner>/painchain-frontend:latest
    # ... rest of config
```

## Security Considerations

- Never commit `.env` file
- Rotate `DB_PASSWORD` regularly
- Use secrets management in production
- Keep dependencies updated
- Monitor security advisories

## Support

For release-related questions:
- GitHub Issues: `https://github.com/<owner>/painchain/issues`
- Discussions: `https://github.com/<owner>/painchain/discussions`
