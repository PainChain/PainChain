from typing import List, Dict, Any, Optional
from datetime import datetime, timezone
from github import Github, GithubException
import requests
import sys
sys.path.insert(0, '/app')

from shared import ChangeEvent, SessionLocal


class GitHubConnector:
    """GitHub connector that fetches PRs and releases"""

    def __init__(self, token: str, repos: List[str] = None, base_url: str = None):
        self.token = token
        self.repos = repos or []
        self.base_url = base_url
        # Use base_url if provided (for GitHub Enterprise)
        if token:
            self.client = Github(base_url=base_url, login_or_token=token) if base_url else Github(token)
        else:
            self.client = None

    def test_connection(self) -> bool:
        """Test GitHub connection"""
        if not self.client:
            return False
        try:
            self.client.get_user().login
            return True
        except GithubException:
            return False

    def _fetch_registry_packages(self, org_name: str, repo_full_name: str, limit: int = 20) -> List[Dict[str, Any]]:
        """
        Fetch container packages from GitHub Container Registry for an organization

        Args:
            org_name: Organization name (e.g., "PainChain")
            repo_full_name: Full repository name for context
            limit: Maximum number of package versions to fetch

        Returns:
            List of package version dictionaries
        """
        packages = []

        try:
            # GitHub Packages API endpoint
            headers = {
                "Authorization": f"token {self.token}",
                "Accept": "application/vnd.github.v3+json"
            }

            # First, list all container packages for the org
            packages_url = f"https://api.github.com/orgs/{org_name}/packages?package_type=container"
            response = requests.get(packages_url, headers=headers)

            if response.status_code != 200:
                print(f"  Failed to fetch packages: {response.status_code}")
                return packages

            package_list = response.json()

            for package in package_list[:10]:  # Limit to 10 packages to avoid too many API calls
                package_name = package['name']

                # Get versions for this package
                versions_url = f"https://api.github.com/orgs/{org_name}/packages/container/{package_name}/versions"
                versions_response = requests.get(versions_url, headers=headers)

                if versions_response.status_code != 200:
                    continue

                versions = versions_response.json()

                # Process recent versions (limit to avoid duplicates)
                for version in versions[:limit]:
                    # Extract tags and metadata
                    tags = []
                    size_bytes = None  # GitHub API doesn't expose size in list endpoint

                    if version.get('metadata') and version['metadata'].get('container'):
                        tags = version['metadata']['container'].get('tags', [])

                    # Skip untagged images (intermediate builds)
                    if not tags or len(tags) == 0:
                        continue

                    # Note: GitHub Packages API doesn't provide image size in the versions list endpoint
                    # Size would require fetching the manifest from the registry, which is an additional API call per version
                    # For performance, we'll mark as None and display as "N/A" in the UI

                    packages.append({
                        'name': f"ghcr.io/{org_name.lower()}/{package_name}",
                        'package_name': package_name,
                        'version_id': version['id'],
                        'tags': tags,
                        'digest': version.get('name', ''),  # The version name is often the SHA digest
                        'size': size_bytes,
                        'created_at': datetime.fromisoformat(version['created_at'].replace('Z', '+00:00')),
                        'updated_at': datetime.fromisoformat(version['updated_at'].replace('Z', '+00:00')),
                        'url': version.get('html_url', f"https://github.com/orgs/{org_name}/packages/container/{package_name}"),
                        'author': version.get('author', {}).get('login', 'unknown') if version.get('author') else 'unknown'
                    })

        except Exception as e:
            print(f"  Error fetching registry packages for {org_name}: {e}")

        return packages

    def fetch_and_store_changes(self, limit: int = 50) -> Dict[str, int]:
        """
        Fetch changes from GitHub and store in database

        Returns:
            Dict with counts of fetched and stored events
        """
        if not self.client:
            raise ValueError("GitHub client not initialized")

        db = SessionLocal()
        try:
            total_fetched = 0
            total_stored = 0

            repos_to_fetch = []
            if self.repos:
                # Fetch specific repos
                for repo_name in self.repos:
                    try:
                        repos_to_fetch.append(self.client.get_repo(repo_name))
                    except GithubException as e:
                        print(f"Error accessing repo {repo_name}: {e}")
            else:
                # Fetch user's repos
                repos_to_fetch = list(self.client.get_user().get_repos()[:10])

            for repo in repos_to_fetch:
                try:
                    print(f"Fetching from {repo.full_name}...")

                    # Fetch pull requests
                    prs = list(repo.get_pulls(state='all', sort='updated', direction='desc'))
                    for pr in prs[:limit]:
                        total_fetched += 1

                        event_id = f"pr-{repo.full_name}-{pr.number}"

                        # Check if already exists
                        existing = db.query(ChangeEvent).filter(
                            ChangeEvent.source == "github",
                            ChangeEvent.event_id == event_id
                        ).first()

                        if not existing:
                            # Get list of changed files
                            try:
                                files_changed = [f.filename for f in pr.get_files()][:20]  # Limit to first 20 files
                            except:
                                files_changed = []

                            # Get review info
                            try:
                                reviews = list(pr.get_reviews())
                                reviewers = list(set([r.user.login for r in reviews if r.user]))
                                review_states = [r.state for r in reviews]
                                approved_count = review_states.count('APPROVED')
                                changes_requested_count = review_states.count('CHANGES_REQUESTED')
                            except:
                                reviewers = []
                                approved_count = 0
                                changes_requested_count = 0

                            description = {
                                "text": pr.body or "",
                                "labels": [label.name for label in pr.labels],
                                "files_changed": files_changed,
                                "related_events": []
                            }

                            db_event = ChangeEvent(
                                source="github",
                                event_id=event_id,
                                title=f"[PR] {pr.title}",
                                description=description,
                                author=pr.user.login,
                                timestamp=pr.updated_at.replace(tzinfo=timezone.utc) if pr.updated_at.tzinfo is None else pr.updated_at,
                                url=pr.html_url,
                                status=pr.state,
                                event_metadata={
                                    "repository": repo.full_name,
                                    "pr_number": pr.number,
                                    "merged": pr.merged,
                                    "mergeable": pr.mergeable,
                                    "additions": pr.additions,
                                    "deletions": pr.deletions,
                                    "changed_files": pr.changed_files,
                                    "base_branch": pr.base.ref,
                                    "head_branch": pr.head.ref,
                                    "reviewers": reviewers,
                                    "approved_count": approved_count,
                                    "changes_requested_count": changes_requested_count,
                                    "comments": pr.comments,
                                    "review_comments": pr.review_comments,
                                }
                            )
                            db.add(db_event)
                            total_stored += 1

                    # Fetch releases
                    releases = list(repo.get_releases())
                    for release in releases[:limit]:
                        total_fetched += 1

                        event_id = f"release-{repo.full_name}-{release.id}"

                        existing = db.query(ChangeEvent).filter(
                            ChangeEvent.source == "github",
                            ChangeEvent.event_id == event_id
                        ).first()

                        if not existing:
                            description = {
                                "text": release.body or "",
                                "assets": [asset.name for asset in release.get_assets()],
                                "related_events": []
                            }

                            db_event = ChangeEvent(
                                source="github",
                                event_id=event_id,
                                title=f"[Release] {release.title or release.tag_name}",
                                description=description,
                                author=release.author.login if release.author else "unknown",
                                timestamp=release.published_at.replace(tzinfo=timezone.utc) if release.published_at and release.published_at.tzinfo is None else (release.published_at or datetime.now(timezone.utc)),
                                url=release.html_url,
                                status="published" if not release.draft else "draft",
                                event_metadata={
                                    "repository": repo.full_name,
                                    "tag_name": release.tag_name,
                                    "prerelease": release.prerelease,
                                    "draft": release.draft,
                                }
                            )
                            db.add(db_event)
                            total_stored += 1

                    # Fetch GitHub Actions workflow runs
                    try:
                        workflows = list(repo.get_workflow_runs())[:limit]
                        for run in workflows:
                            total_fetched += 1
                            event_id = f"workflow-{repo.full_name}-{run.id}"

                            existing = db.query(ChangeEvent).filter(
                                ChangeEvent.source == "github",
                                ChangeEvent.event_id == event_id
                            ).first()

                            if not existing:
                                # Get job details for failed runs
                                failed_jobs = []
                                if run.conclusion in ['failure', 'timed_out', 'cancelled']:
                                    try:
                                        jobs = list(run.jobs())
                                        for job in jobs:
                                            if job.conclusion in ['failure', 'timed_out', 'cancelled']:
                                                failed_jobs.append({
                                                    "name": job.name,
                                                    "conclusion": job.conclusion,
                                                    "started_at": job.started_at.isoformat() if job.started_at else None,
                                                    "completed_at": job.completed_at.isoformat() if job.completed_at else None,
                                                })
                                    except:
                                        failed_jobs = []

                                # Calculate duration
                                duration_seconds = None
                                if run.created_at and run.updated_at:
                                    duration_seconds = (run.updated_at - run.created_at).total_seconds()

                                description = {
                                    "text": f"Workflow: {run.name}",
                                    "labels": [],
                                    "failed_jobs": failed_jobs,
                                    "related_events": []
                                }

                                status_emoji = {
                                    'success': '✓',
                                    'failure': '✗',
                                    'cancelled': '⊗',
                                    'skipped': '⊘',
                                    'timed_out': '⏱'
                                }.get(run.conclusion, '•')

                                # Get author from triggering_actor (not actor)
                                author = "unknown"
                                try:
                                    if hasattr(run, 'triggering_actor') and run.triggering_actor:
                                        author = run.triggering_actor.login
                                except:
                                    pass

                                db_event = ChangeEvent(
                                    source="github",
                                    event_id=event_id,
                                    title=f"[Workflow] {status_emoji} {run.name} - {run.head_branch}",
                                    description=description,
                                    author=author,
                                    timestamp=run.updated_at.replace(tzinfo=timezone.utc) if run.updated_at and run.updated_at.tzinfo is None else (run.updated_at or datetime.now(timezone.utc)),
                                    url=run.html_url,
                                    status=run.conclusion or run.status,
                                    event_metadata={
                                        "repository": repo.full_name,
                                        "workflow_id": run.workflow_id,
                                        "run_number": run.run_number,
                                        "run_attempt": run.run_attempt,
                                        "event": run.event,
                                        "branch": run.head_branch,
                                        "commit_sha": run.head_sha[:7],
                                        "conclusion": run.conclusion,
                                        "duration_seconds": duration_seconds,
                                        "failed_jobs_count": len(failed_jobs),
                                    }
                                )
                                db.add(db_event)
                                total_stored += 1
                    except Exception as e:
                        print(f"Error fetching workflow runs: {e}")

                    # Fetch container registry packages (only for org-level repos)
                    try:
                        org_name = repo.full_name.split('/')[0]
                        packages = self._fetch_registry_packages(org_name, repo.full_name)

                        for pkg in packages:
                            total_fetched += 1
                            event_id = f"registry-{pkg['name']}-{pkg['version_id']}"

                            existing = db.query(ChangeEvent).filter(
                                ChangeEvent.source == "github",
                                ChangeEvent.event_id == event_id
                            ).first()

                            if not existing:
                                # Format size in human-readable format
                                size_value = pkg.get('size')

                                # Build metadata dict conditionally
                                metadata = {
                                    "registry": "ghcr.io",
                                    "image": pkg['name'],
                                    "digest_short": pkg.get('digest', '')[:12] if pkg.get('digest') else 'N/A',
                                }

                                # Only include size if available
                                if size_value is not None and size_value > 0:
                                    size_mb = round(size_value / (1024 * 1024), 2)
                                    size_str = f"{size_mb}MB" if size_mb < 1024 else f"{round(size_mb/1024, 2)}GB"
                                    metadata["size"] = size_str

                                # Build text description
                                tag_list = ', '.join(pkg.get('tags', [])[:5])
                                text_parts = [
                                    f"Container image pushed to GitHub Container Registry",
                                    f"\nImage: {pkg['name']}",
                                    f"\nTags: {tag_list}",
                                ]
                                if size_value is not None and size_value > 0:
                                    text_parts.append(f"\nSize: {metadata['size']}")
                                text_parts.append(f"\nDigest: {pkg.get('digest', 'N/A')[:19]}...")

                                # Create detailed description
                                description = {
                                    "text": ''.join(text_parts),
                                    "labels": pkg.get('tags', []),
                                    "metadata": metadata,
                                    "related_events": []
                                }

                                db_event = ChangeEvent(
                                    source="github",
                                    event_id=event_id,
                                    title=f"[Image] {pkg['name']}:{', '.join(pkg.get('tags', ['<untagged>'])[:3])}",
                                    description=description,
                                    author=pkg.get('author', 'unknown'),
                                    timestamp=pkg['created_at'].replace(tzinfo=timezone.utc) if pkg['created_at'].tzinfo is None else pkg['created_at'],
                                    url=pkg.get('url', f"https://github.com/orgs/{org_name}/packages/container/{pkg['package_name']}/versions"),
                                    status="published",
                                    event_metadata={
                                        "registry": "ghcr.io",
                                        "package": pkg['package_name'],
                                        "image": f"ghcr.io/{org_name.lower()}/{pkg['package_name']}",
                                        "tags": pkg.get('tags', []),
                                        "digest": pkg.get('digest', ''),
                                        "size_bytes": pkg.get('size', 0),
                                        "repository": repo.full_name,
                                    }
                                )
                                db.add(db_event)
                                total_stored += 1
                    except Exception as e:
                        print(f"Error fetching container registry packages: {e}")

                    db.commit()
                    print(f"  Processed {repo.full_name}")

                except GithubException as e:
                    print(f"Error fetching from {repo.full_name}: {e}")
                    db.rollback()
                    continue

            return {
                "fetched": total_fetched,
                "stored": total_stored
            }

        finally:
            db.close()


def sync_github(db_session, config: Dict[str, Any], connection_id: int) -> Dict[str, Any]:
    """
    Sync GitHub changes using provided config and database session

    Args:
        db_session: SQLAlchemy database session
        config: Configuration dict with keys: token, repos, poll_interval, branches, isEnterprise, base_url
        connection_id: ID of the connection this sync belongs to

    Returns:
        Dict with sync results
    """
    token = config.get('token', '')
    repos_str = config.get('repos', '')
    branches_str = config.get('branches', '')
    is_enterprise = config.get('isEnterprise', False) or config.get('is_enterprise', False)
    base_url = config.get('base_url', '') or config.get('baseUrl', '')

    if not token:
        return {"error": "No GitHub token configured"}

    # Parse repos list
    repos = [r.strip() for r in repos_str.split(',') if r.strip()] if repos_str else []

    # Parse branches list
    branches = [b.strip() for b in branches_str.split(',') if b.strip()] if branches_str else []

    # Only use base_url if isEnterprise is true
    enterprise_url = base_url if (is_enterprise and base_url) else None

    # Create connector and sync
    connector = GitHubConnector(token=token, repos=repos, base_url=enterprise_url)

    if not connector.test_connection():
        return {"error": "Failed to connect to GitHub"}

    # Temporarily replace SessionLocal to use provided session
    # Save original fetch_and_store_changes method
    original_method = connector.fetch_and_store_changes

    # Create a modified version that uses the provided session
    def fetch_with_session(limit=50):
        """Modified fetch that uses provided session"""
        if not connector.client:
            raise ValueError("GitHub client not initialized")

        # Use branches list for filtering
        filter_branches = branches if branches else []

        try:
            total_fetched = 0
            total_stored = 0

            repos_to_fetch = []
            if connector.repos:
                for repo_name in connector.repos:
                    try:
                        repos_to_fetch.append(connector.client.get_repo(repo_name))
                    except GithubException as e:
                        print(f"Error accessing repo {repo_name}: {e}")
            else:
                repos_to_fetch = list(connector.client.get_user().get_repos()[:10])

            for repo in repos_to_fetch:
                try:
                    print(f"Fetching from {repo.full_name}...")

                    # Fetch pull requests
                    prs = list(repo.get_pulls(state='all', sort='updated', direction='desc'))
                    for pr in prs[:limit]:
                        total_fetched += 1
                        event_id = f"pr-{repo.full_name}-{pr.number}"

                        # Skip if branches are specified and this PR's base branch doesn't match
                        if filter_branches and pr.base.ref not in filter_branches:
                            continue

                        existing = db_session.query(ChangeEvent).filter(
                            ChangeEvent.connection_id == connection_id,
                            ChangeEvent.event_id == event_id
                        ).first()

                        if not existing:
                            # Get list of changed files
                            try:
                                files_changed = [f.filename for f in pr.get_files()][:20]  # Limit to first 20 files
                            except:
                                files_changed = []

                            # Get review info
                            try:
                                reviews = list(pr.get_reviews())
                                reviewers = list(set([r.user.login for r in reviews if r.user]))
                                review_states = [r.state for r in reviews]
                                approved_count = review_states.count('APPROVED')
                                changes_requested_count = review_states.count('CHANGES_REQUESTED')
                            except:
                                reviewers = []
                                approved_count = 0
                                changes_requested_count = 0

                            description = {
                                "text": pr.body or "",
                                "labels": [label.name for label in pr.labels],
                                "files_changed": files_changed,
                                "related_events": []
                            }

                            db_event = ChangeEvent(
                                connection_id=connection_id,
                                source="github",
                                event_id=event_id,
                                title=f"[PR] {pr.title}",
                                description=description,
                                author=pr.user.login,
                                timestamp=pr.updated_at.replace(tzinfo=timezone.utc) if pr.updated_at.tzinfo is None else pr.updated_at,
                                url=pr.html_url,
                                status=pr.state,
                                event_metadata={
                                    "repository": repo.full_name,
                                    "pr_number": pr.number,
                                    "merged": pr.merged,
                                    "mergeable": pr.mergeable,
                                    "additions": pr.additions,
                                    "deletions": pr.deletions,
                                    "changed_files": pr.changed_files,
                                    "base_branch": pr.base.ref,
                                    "head_branch": pr.head.ref,
                                    "reviewers": reviewers,
                                    "approved_count": approved_count,
                                    "changes_requested_count": changes_requested_count,
                                    "comments": pr.comments,
                                    "review_comments": pr.review_comments,
                                }
                            )
                            db_session.add(db_event)
                            total_stored += 1

                    # Fetch releases
                    releases = list(repo.get_releases())
                    for release in releases[:limit]:
                        total_fetched += 1
                        event_id = f"release-{repo.full_name}-{release.id}"

                        existing = db_session.query(ChangeEvent).filter(
                            ChangeEvent.connection_id == connection_id,
                            ChangeEvent.event_id == event_id
                        ).first()

                        if not existing:
                            description = {
                                "text": release.body or "",
                                "assets": [asset.name for asset in release.get_assets()],
                                "related_events": []
                            }

                            db_event = ChangeEvent(
                                connection_id=connection_id,
                                source="github",
                                event_id=event_id,
                                title=f"[Release] {release.title or release.tag_name}",
                                description=description,
                                author=release.author.login if release.author else "unknown",
                                timestamp=release.published_at.replace(tzinfo=timezone.utc) if release.published_at and release.published_at.tzinfo is None else (release.published_at or datetime.now(timezone.utc)),
                                url=release.html_url,
                                status="published" if not release.draft else "draft",
                                event_metadata={
                                    "repository": repo.full_name,
                                    "tag_name": release.tag_name,
                                    "prerelease": release.prerelease,
                                    "draft": release.draft,
                                }
                            )
                            db_session.add(db_event)
                            total_stored += 1

                    # Fetch GitHub Actions workflow runs
                    try:
                        workflows = list(repo.get_workflow_runs())[:limit]
                        print(f"  Found {len(workflows)} workflow runs for {repo.full_name}")
                        workflow_stored = 0
                        workflow_existing = 0
                        for run in workflows:
                            total_fetched += 1
                            event_id = f"workflow-{repo.full_name}-{run.id}"

                            # Skip if branches are specified and this run's branch doesn't match
                            if filter_branches and run.head_branch not in filter_branches:
                                continue

                            existing = db_session.query(ChangeEvent).filter(
                                ChangeEvent.connection_id == connection_id,
                                ChangeEvent.event_id == event_id
                            ).first()

                            if not existing:
                                # Get job details for failed runs
                                failed_jobs = []
                                if run.conclusion in ['failure', 'timed_out', 'cancelled']:
                                    try:
                                        jobs = list(run.jobs())
                                        for job in jobs:
                                            if job.conclusion in ['failure', 'timed_out', 'cancelled']:
                                                failed_jobs.append({
                                                    "name": job.name,
                                                    "conclusion": job.conclusion,
                                                    "started_at": job.started_at.isoformat() if job.started_at else None,
                                                    "completed_at": job.completed_at.isoformat() if job.completed_at else None,
                                                })
                                    except:
                                        failed_jobs = []

                                # Calculate duration if both timestamps exist
                                duration_seconds = None
                                if run.created_at and run.updated_at:
                                    duration_seconds = (run.updated_at - run.created_at).total_seconds()

                                description = {
                                    "text": f"Workflow: {run.name}",
                                    "labels": [],
                                    "failed_jobs": failed_jobs,
                                    "related_events": []
                                }

                                status_emoji = {
                                    'success': '✓',
                                    'failure': '✗',
                                    'cancelled': '⊗',
                                    'skipped': '⊘',
                                    'timed_out': '⏱'
                                }.get(run.conclusion, '•')

                                # Get author from triggering_actor (not actor)
                                author = "unknown"
                                try:
                                    if hasattr(run, 'triggering_actor') and run.triggering_actor:
                                        author = run.triggering_actor.login
                                except:
                                    pass

                                db_event = ChangeEvent(
                                    connection_id=connection_id,
                                    source="github",
                                    event_id=event_id,
                                    title=f"[Workflow] {status_emoji} {run.name} - {run.head_branch}",
                                    description=description,
                                    author=author,
                                    timestamp=run.updated_at.replace(tzinfo=timezone.utc) if run.updated_at and run.updated_at.tzinfo is None else (run.updated_at or datetime.now(timezone.utc)),
                                    url=run.html_url,
                                    status=run.conclusion or run.status,
                                    event_metadata={
                                        "repository": repo.full_name,
                                        "workflow_id": run.workflow_id,
                                        "run_number": run.run_number,
                                        "run_attempt": run.run_attempt,
                                        "event": run.event,
                                        "branch": run.head_branch,
                                        "commit_sha": run.head_sha[:7],
                                        "conclusion": run.conclusion,
                                        "duration_seconds": duration_seconds,
                                        "failed_jobs_count": len(failed_jobs),
                                    }
                                )
                                db_session.add(db_event)
                                total_stored += 1
                                workflow_stored += 1
                            else:
                                workflow_existing += 1
                        print(f"  Workflows: {workflow_stored} stored, {workflow_existing} already existed")
                    except Exception as e:
                        print(f"Error fetching workflow runs: {e}")
                        import traceback
                        traceback.print_exc()

                    # Fetch commits from branches
                    if branches:
                        for branch_name in branches:
                            try:
                                branch = repo.get_branch(branch_name)
                                commits = list(repo.get_commits(sha=branch.commit.sha))[:limit]

                                for commit in commits:
                                    total_fetched += 1
                                    event_id = f"commit-{repo.full_name}-{commit.sha}"

                                    existing = db_session.query(ChangeEvent).filter(
                                        ChangeEvent.connection_id == connection_id,
                                        ChangeEvent.event_id == event_id
                                    ).first()

                                    if not existing:
                                        # Get list of changed files for commit
                                        try:
                                            files_changed = [f.filename for f in commit.files][:20]  # Limit to first 20 files
                                        except:
                                            files_changed = []

                                        description = {
                                            "text": commit.commit.message,
                                            "labels": [],
                                            "files_changed": files_changed,
                                            "related_events": []
                                        }

                                        db_event = ChangeEvent(
                                            connection_id=connection_id,
                                            source="github",
                                            event_id=event_id,
                                            title=f"[Commit] {commit.commit.message.split(chr(10))[0][:100]}",
                                            description=description,
                                            author=commit.commit.author.name if commit.commit.author else "unknown",
                                            timestamp=commit.commit.author.date.replace(tzinfo=timezone.utc) if commit.commit.author.date and commit.commit.author.date.tzinfo is None else (commit.commit.author.date or datetime.now(timezone.utc)),
                                            url=commit.html_url,
                                            status="committed",
                                            event_metadata={
                                                "repository": repo.full_name,
                                                "branch": branch_name,
                                                "sha": commit.sha,
                                                "additions": commit.stats.additions if commit.stats else 0,
                                                "deletions": commit.stats.deletions if commit.stats else 0,
                                                "total_changes": commit.stats.total if commit.stats else 0,
                                            }
                                        )
                                        db_session.add(db_event)
                                        total_stored += 1
                            except GithubException as e:
                                print(f"Error fetching commits from branch {branch_name}: {e}")
                                continue

                    # Fetch container registry packages
                    try:
                        org_name = repo.full_name.split('/')[0]
                        packages = connector._fetch_registry_packages(org_name, repo.full_name)
                        print(f"  Found {len(packages)} container package versions for {repo.full_name}")

                        for pkg in packages:
                            total_fetched += 1
                            event_id = f"registry-{pkg['name']}-{pkg['version_id']}"

                            existing = db_session.query(ChangeEvent).filter(
                                ChangeEvent.connection_id == connection_id,
                                ChangeEvent.event_id == event_id
                            ).first()

                            if not existing:
                                # Format size in human-readable format
                                size_value = pkg.get('size')

                                # Build metadata dict conditionally
                                metadata = {
                                    "registry": "ghcr.io",
                                    "image": pkg['name'],
                                    "digest_short": pkg.get('digest', '')[:12] if pkg.get('digest') else 'N/A',
                                }

                                # Only include size if available
                                if size_value is not None and size_value > 0:
                                    size_mb = round(size_value / (1024 * 1024), 2)
                                    size_str = f"{size_mb}MB" if size_mb < 1024 else f"{round(size_mb/1024, 2)}GB"
                                    metadata["size"] = size_str

                                # Build text description
                                tag_list = ', '.join(pkg.get('tags', [])[:5])
                                text_parts = [
                                    f"Container image pushed to GitHub Container Registry",
                                    f"\nImage: {pkg['name']}",
                                    f"\nTags: {tag_list}",
                                ]
                                if size_value is not None and size_value > 0:
                                    text_parts.append(f"\nSize: {metadata['size']}")
                                text_parts.append(f"\nDigest: {pkg.get('digest', 'N/A')[:19]}...")

                                # Create detailed description
                                description = {
                                    "text": ''.join(text_parts),
                                    "labels": pkg.get('tags', []),
                                    "metadata": metadata,
                                    "related_events": []
                                }

                                db_event = ChangeEvent(
                                    connection_id=connection_id,
                                    source="github",
                                    event_id=event_id,
                                    title=f"[Image] {pkg['name']}:{', '.join(pkg.get('tags', ['<untagged>'])[:3])}",
                                    description=description,
                                    author=pkg.get('author', 'unknown'),
                                    timestamp=pkg['created_at'].replace(tzinfo=timezone.utc) if pkg['created_at'].tzinfo is None else pkg['created_at'],
                                    url=pkg.get('url', f"https://github.com/orgs/{org_name}/packages/container/{pkg['package_name']}/versions"),
                                    status="published",
                                    event_metadata={
                                        "registry": "ghcr.io",
                                        "package": pkg['package_name'],
                                        "image": f"ghcr.io/{org_name.lower()}/{pkg['package_name']}",
                                        "tags": pkg.get('tags', []),
                                        "digest": pkg.get('digest', ''),
                                        "size_bytes": pkg.get('size', 0),
                                        "repository": repo.full_name,
                                    }
                                )
                                db_session.add(db_event)
                                total_stored += 1
                    except Exception as e:
                        print(f"Error fetching container registry packages: {e}")
                        import traceback
                        traceback.print_exc()

                    db_session.commit()
                    print(f"  Processed {repo.full_name}")

                except GithubException as e:
                    print(f"Error fetching from {repo.full_name}: {e}")
                    db_session.rollback()
                    continue

            return {
                "fetched": total_fetched,
                "stored": total_stored
            }

        except Exception as e:
            db_session.rollback()
            raise e

    return fetch_with_session()
