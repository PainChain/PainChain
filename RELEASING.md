# Release Guide

This document explains how to release PainChain - both Docker images and Helm chart.

## Overview

PainChain uses a unified release process:
- **Push to main** → Build Docker images with `:main` tag + Publish Helm chart as `0.0.0-main` (bleeding edge)
- **Push tag `v*.*.*`** → Build Docker images with version tags + Publish Helm chart with matching version (stable release)

## Directory Structure

```
PainChain/
├── backend/          # Backend application code
├── frontend/         # Frontend application code
├── helm/             # Helm chart
│   ├── Chart.yaml    # Chart metadata (version must match git tag)
│   ├── values.yaml   # Default values
│   └── templates/    # Kubernetes manifests
└── .github/
    └── workflows/
        ├── build-main.yml    # Build images + chart on push to main
        ├── release.yml       # Build images + chart on tag push
        ├── helm-test.yml     # Test Helm chart on PRs
        └── test.yml          # Test application on PRs
```

## Bleeding Edge Releases (main branch)

Every merge to `main` automatically:

1. **Builds Docker images**:
   - `ghcr.io/painchain/painchain-api:main`
   - `ghcr.io/painchain/painchain-frontend:main`

2. **Publishes Helm chart**:
   - `oci://ghcr.io/painchain/charts/painchain:0.0.0-main`

**Install bleeding edge**:
```bash
helm install painchain oci://ghcr.io/painchain/charts/painchain --version 0.0.0-main
```

## Stable Releases (tagged)

### Prerequisites

Before creating a release:

1. **Update helm/Chart.yaml**:
   ```yaml
   version: 0.2.0      # Must match tag (without 'v')
   appVersion: "0.2.0" # Application version
   ```

2. **Commit the version bump**:
   ```bash
   git add helm/Chart.yaml
   git commit -m "Bump version to 0.2.0"
   git push origin main
   ```

### Creating a Release

3. **Create and push a tag**:
   ```bash
   git tag v0.2.0
   git push origin v0.2.0
   ```

4. **Automatic release happens**:
   - ✅ Verifies helm/Chart.yaml version matches tag
   - ✅ Builds and pushes Docker images:
     - `ghcr.io/painchain/painchain-api:v0.2.0`
     - `ghcr.io/painchain/painchain-api:latest`
     - `ghcr.io/painchain/painchain-frontend:v0.2.0`
     - `ghcr.io/painchain/painchain-frontend:latest`
   - ✅ Publishes Helm chart:
     - `oci://ghcr.io/painchain/charts/painchain:0.2.0`
   - ✅ Creates GitHub Release with:
     - Auto-generated changelog
     - Packaged Helm chart (.tgz) attached

**Install stable release**:
```bash
helm install painchain oci://ghcr.io/painchain/charts/painchain --version 0.2.0
```

## Version Guidelines

Follow [Semantic Versioning](https://semver.org/):

- **PATCH** (0.1.0 → 0.1.1): Bug fixes, documentation
- **MINOR** (0.1.0 → 0.2.0): New features, backward compatible
- **MAJOR** (0.9.0 → 1.0.0): Breaking changes

## Release Workflow

```
┌──────────────────────┐
│  Feature Development │
│  (on feature branch) │
└──────────┬───────────┘
           │
           ▼
    ┌──────────────┐
    │  Create PR   │
    └──────┬───────┘
           │
           ▼
    ┌──────────────┐
    │ Tests Run    │
    │ (app + helm) │
    └──────┬───────┘
           │
           ▼
    ┌──────────────┐
    │  Merge to    │
    │    main      │
    └──────┬───────┘
           │
           ▼
  ┌─────────────────────┐
  │ Publish bleeding    │
  │ edge (0.0.0-main)   │
  └─────────────────────┘


When ready for stable release:

    ┌──────────────────┐
    │ Update Chart.yaml│
    │ version: 0.2.0   │
    └────────┬─────────┘
             │
             ▼
    ┌────────────────┐
    │ Commit & Push  │
    │ to main        │
    └────────┬───────┘
             │
             ▼
    ┌────────────────┐
    │ Create & Push  │
    │ tag v0.2.0     │
    └────────┬───────┘
             │
             ▼
  ┌──────────────────────┐
  │ Verify version match │
  └──────────┬───────────┘
             │
             ▼
  ┌──────────────────────┐
  │ Build Docker images  │
  │ v0.2.0 + latest      │
  └──────────┬───────────┘
             │
             ▼
  ┌──────────────────────┐
  │ Publish Helm chart   │
  │ 0.2.0                │
  └──────────┬───────────┘
             │
             ▼
  ┌──────────────────────┐
  │ Create GitHub Release│
  │ + attach chart.tgz   │
  └──────────────────────┘
```

## Examples

### Patch Release (Bug Fix)

```bash
# 1. Update version
sed -i 's/^version:.*/version: 0.1.1/' helm/Chart.yaml
git add helm/Chart.yaml
git commit -m "Fix pod selector bug - bump to 0.1.1"
git push origin main

# 2. Create tag
git tag v0.1.1
git push origin v0.1.1
```

### Minor Release (New Feature)

```bash
# 1. Update version
sed -i 's/^version:.*/version: 0.2.0/' helm/Chart.yaml
git add helm/Chart.yaml
git commit -m "Add Slack connector - bump to 0.2.0"
git push origin main

# 2. Create tag
git tag v0.2.0
git push origin v0.2.0
```

### Major Release (Breaking Change)

```bash
# 1. Update version
sed -i 's/^version:.*/version: 1.0.0/' helm/Chart.yaml
git add helm/Chart.yaml
git commit -m "BREAKING: Restructure API endpoints - bump to 1.0.0"
git push origin main

# 2. Create tag
git tag v1.0.0
git push origin v1.0.0
```

## Troubleshooting

### Release fails with "version mismatch"

**Error**: "Chart.yaml version does not match tag version"

**Fix**: Ensure helm/Chart.yaml version matches the tag (without 'v'):
```bash
# Tag: v0.2.0
# Chart.yaml should have: version: 0.2.0
```

### Docker build fails

Check the build logs in GitHub Actions. Common issues:
- Missing dependencies in Dockerfile
- Build context issues
- Out of disk space

### Helm chart not appearing in GHCR

1. Check GitHub Actions logs
2. Verify GHCR token has correct permissions
3. Check package visibility is "Public"

## Testing Before Release

### Test locally with kind

```bash
# Create test cluster
kind create cluster --name painchain-test

# Build local images
docker build -t ghcr.io/painchain/painchain-api:test backend
docker build -t ghcr.io/painchain/painchain-frontend:test frontend

# Load images into kind
kind load docker-image ghcr.io/painchain/painchain-api:test --name painchain-test
kind load docker-image ghcr.io/painchain/painchain-frontend:test --name painchain-test

# Install chart
helm install painchain ./helm \
  --set api.image.tag=test \
  --set frontend.image.tag=test \
  --namespace painchain --create-namespace

# Test
kubectl get pods -n painchain

# Cleanup
kind delete cluster --name painchain-test
```

### Test helm chart only

```bash
# Lint
helm lint helm

# Template
helm template painchain helm --debug

# Dry-run install
helm install painchain helm --dry-run --debug
```

## FAQ

**Q: Can I re-release the same version?**

A: No, GHCR doesn't allow overwriting. Delete the tag, increment the patch version, and release again.

**Q: Should I delete the main tag?**

A: No, the `main` tag is continuously updated with each merge to main.

**Q: What if I forget to update Chart.yaml?**

A: The workflow will fail with a clear error. Delete the tag, update Chart.yaml, and re-push the tag.

**Q: How do I rollback a bad release?**

A: You can't delete from GHCR, but you can:
1. Create a new patch release with the fix
2. Update documentation to skip the bad version
3. For critical issues, communicate via GitHub Release notes

**Q: Can users install "latest" Helm chart?**

A: No, Helm requires explicit versions. Use `0.0.0-main` for latest development or specific versions for stable releases.
