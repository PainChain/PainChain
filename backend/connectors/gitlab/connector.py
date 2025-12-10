from typing import List, Dict, Any, Optional
from datetime import datetime, timezone
import gitlab
from gitlab.exceptions import GitlabError
import requests
import sys
sys.path.insert(0, '/app')

from shared import ChangeEvent, SessionLocal


class GitLabConnector:
    """GitLab connector that fetches MRs, releases, and pipelines"""

    def __init__(self, token: str, url: str = "https://gitlab.com", repos: List[str] = None):
        self.token = token
        self.url = url
        self.repos = repos or []
        self.client = gitlab.Gitlab(url, private_token=token) if token else None

    def test_connection(self) -> bool:
        """Test GitLab connection"""
        if not self.client:
            return False
        try:
            self.client.auth()
            return True
        except GitlabError:
            return False

    def _fetch_registry_repositories(self, project_id: str, limit: int = 20) -> List[Dict[str, Any]]:
        """
        Fetch container registry repositories and tags from GitLab Container Registry

        Args:
            project_id: GitLab project ID
            limit: Maximum number of tags to fetch per repository

        Returns:
            List of registry tag dictionaries
        """
        registry_items = []

        try:
            # GitLab Registry API endpoint
            headers = {
                "PRIVATE-TOKEN": self.token
            }

            # Get registry repositories for this project
            repos_url = f"{self.url}/api/v4/projects/{project_id}/registry/repositories"
            response = requests.get(repos_url, headers=headers)

            if response.status_code != 200:
                print(f"  Failed to fetch registry repositories: {response.status_code}")
                return registry_items

            repositories = response.json()

            for repo in repositories:
                repo_id = repo['id']
                repo_path = repo['path']  # e.g., registry.gitlab.com/org/project/image

                # Get tags for this repository
                tags_url = f"{self.url}/api/v4/projects/{project_id}/registry/repositories/{repo_id}/tags"
                tags_response = requests.get(tags_url, headers=headers)

                if tags_response.status_code != 200:
                    continue

                tags = tags_response.json()

                # Process recent tags
                for tag in tags[:limit]:
                    registry_items.append({
                        'repository_path': repo_path,
                        'repository_id': repo_id,
                        'tag_name': tag['name'],
                        'digest': tag.get('digest', ''),
                        'revision': tag.get('revision', ''),
                        'size': tag.get('total_size', 0),
                        'created_at': datetime.fromisoformat(tag['created_at'].replace('Z', '+00:00')) if tag.get('created_at') else datetime.now(timezone.utc),
                        'location': tag.get('location', repo_path),
                    })

        except Exception as e:
            print(f"  Error fetching registry repositories for project {project_id}: {e}")

        return registry_items

    def fetch_and_store_changes(self, limit: int = 50) -> Dict[str, int]:
        """
        Fetch changes from GitLab and store in database

        Returns:
            Dict with counts of fetched and stored events
        """
        if not self.client:
            raise ValueError("GitLab client not initialized")

        db = SessionLocal()
        try:
            total_fetched = 0
            total_stored = 0

            projects_to_fetch = []
            if self.repos:
                # Fetch specific projects
                for repo_name in self.repos:
                    try:
                        projects_to_fetch.append(self.client.projects.get(repo_name))
                    except GitlabError as e:
                        print(f"Error accessing project {repo_name}: {e}")
            else:
                # Fetch user's projects
                projects_to_fetch = list(self.client.projects.list(membership=True, get_all=False, per_page=10))

            for project in projects_to_fetch:
                try:
                    print(f"Fetching from {project.path_with_namespace}...")

                    # Fetch merge requests
                    mrs = project.mergerequests.list(order_by='updated_at', sort='desc', get_all=False, per_page=limit)
                    for mr in mrs:
                        total_fetched += 1

                        event_id = f"mr-{project.path_with_namespace}-{mr.iid}"

                        # Check if already exists
                        existing = db.query(ChangeEvent).filter(
                            ChangeEvent.source == "gitlab",
                            ChangeEvent.event_id == event_id
                        ).first()

                        if not existing:
                            # Get list of changed files
                            try:
                                changes = mr.changes()
                                files_changed = [change['new_path'] for change in changes.get('changes', [])][:20]
                            except:
                                files_changed = []

                            # Get approval info
                            try:
                                approvals = mr.approvals.get()
                                approved_by = [a['user']['username'] for a in approvals.approved_by]
                                approved_count = len(approved_by)
                            except:
                                approved_by = []
                                approved_count = 0

                            # Get labels
                            labels = mr.labels if hasattr(mr, 'labels') else []

                            description = {
                                "text": mr.description or "",
                                "labels": labels,
                                "files_changed": files_changed,
                                "related_events": []
                            }

                            # Parse timestamp
                            updated_at = datetime.fromisoformat(mr.updated_at.replace('Z', '+00:00'))
                            if updated_at.tzinfo is None:
                                updated_at = updated_at.replace(tzinfo=timezone.utc)

                            db_event = ChangeEvent(
                                source="gitlab",
                                event_id=event_id,
                                title=f"[MR] {mr.title}",
                                description=description,
                                author=mr.author.get('username', 'unknown'),
                                timestamp=updated_at,
                                url=mr.web_url,
                                status=mr.state,
                                event_metadata={
                                    "project": project.path_with_namespace,
                                    "mr_iid": mr.iid,
                                    "merged": mr.state == 'merged',
                                    "mergeable": mr.merge_status == 'can_be_merged',
                                    "source_branch": mr.source_branch,
                                    "target_branch": mr.target_branch,
                                    "approved_by": approved_by,
                                    "approved_count": approved_count,
                                    "user_notes_count": mr.user_notes_count,
                                    "upvotes": mr.upvotes,
                                    "downvotes": mr.downvotes,
                                }
                            )
                            db.add(db_event)
                            total_stored += 1

                    # Fetch releases
                    try:
                        releases = project.releases.list(get_all=False, per_page=limit)
                        for release in releases:
                            total_fetched += 1

                            event_id = f"release-{project.path_with_namespace}-{release.tag_name}"

                            existing = db.query(ChangeEvent).filter(
                                ChangeEvent.source == "gitlab",
                                ChangeEvent.event_id == event_id
                            ).first()

                            if not existing:
                                # Get release assets
                                assets = []
                                if hasattr(release, 'assets') and release.assets:
                                    links = release.assets.get('links', [])
                                    assets = [link.get('name', '') for link in links]

                                description = {
                                    "text": release.description or "",
                                    "assets": assets,
                                    "related_events": []
                                }

                                # Parse timestamp
                                released_at = datetime.fromisoformat(release.released_at.replace('Z', '+00:00'))
                                if released_at.tzinfo is None:
                                    released_at = released_at.replace(tzinfo=timezone.utc)

                                db_event = ChangeEvent(
                                    source="gitlab",
                                    event_id=event_id,
                                    title=f"[Release] {release.name or release.tag_name}",
                                    description=description,
                                    author=release.author.get('username', 'unknown') if hasattr(release, 'author') and release.author else "unknown",
                                    timestamp=released_at,
                                    url=f"{project.web_url}/-/releases/{release.tag_name}",
                                    status="published",
                                    event_metadata={
                                        "project": project.path_with_namespace,
                                        "tag_name": release.tag_name,
                                    }
                                )
                                db.add(db_event)
                                total_stored += 1
                    except GitlabError as e:
                        print(f"Error fetching releases: {e}")

                    # Fetch pipeline runs
                    try:
                        pipelines = project.pipelines.list(order_by='updated_at', sort='desc', get_all=False, per_page=limit)
                        for pipeline in pipelines:
                            total_fetched += 1
                            event_id = f"pipeline-{project.path_with_namespace}-{pipeline.id}"

                            existing = db.query(ChangeEvent).filter(
                                ChangeEvent.source == "gitlab",
                                ChangeEvent.event_id == event_id
                            ).first()

                            if not existing:
                                # Get detailed pipeline info
                                try:
                                    full_pipeline = project.pipelines.get(pipeline.id)

                                    # Get job details for failed pipelines
                                    failed_jobs = []
                                    if full_pipeline.status in ['failed', 'canceled']:
                                        try:
                                            jobs = full_pipeline.jobs.list(get_all=False, per_page=100)
                                            for job in jobs:
                                                if job.status in ['failed', 'canceled']:
                                                    failed_jobs.append({
                                                        "name": job.name,
                                                        "status": job.status,
                                                        "started_at": job.started_at,
                                                        "finished_at": job.finished_at,
                                                    })
                                        except:
                                            failed_jobs = []

                                    # Calculate duration
                                    duration_seconds = full_pipeline.duration

                                    description = {
                                        "text": f"Pipeline for {full_pipeline.ref}",
                                        "labels": [],
                                        "failed_jobs": failed_jobs,
                                        "related_events": []
                                    }

                                    status_emoji = {
                                        'success': '✓',
                                        'failed': '✗',
                                        'canceled': '⊗',
                                        'skipped': '⊘',
                                        'manual': '⊙'
                                    }.get(full_pipeline.status, '•')

                                    # Get author from user
                                    author = "unknown"
                                    if hasattr(full_pipeline, 'user') and full_pipeline.user:
                                        author = full_pipeline.user.get('username', 'unknown')

                                    # Parse timestamp
                                    updated_at = datetime.fromisoformat(full_pipeline.updated_at.replace('Z', '+00:00'))
                                    if updated_at.tzinfo is None:
                                        updated_at = updated_at.replace(tzinfo=timezone.utc)

                                    db_event = ChangeEvent(
                                        source="gitlab",
                                        event_id=event_id,
                                        title=f"[Pipeline] {status_emoji} {full_pipeline.ref}",
                                        description=description,
                                        author=author,
                                        timestamp=updated_at,
                                        url=full_pipeline.web_url,
                                        status=full_pipeline.status,
                                        event_metadata={
                                            "project": project.path_with_namespace,
                                            "pipeline_id": full_pipeline.id,
                                            "ref": full_pipeline.ref,
                                            "sha": full_pipeline.sha[:7],
                                            "source": full_pipeline.source,
                                            "duration_seconds": duration_seconds,
                                            "failed_jobs_count": len(failed_jobs),
                                        }
                                    )
                                    db.add(db_event)
                                    total_stored += 1
                                except Exception as e:
                                    print(f"Error processing pipeline {pipeline.id}: {e}")
                    except Exception as e:
                        print(f"Error fetching pipelines: {e}")

                    # Fetch container registry repositories and tags
                    try:
                        registry_items = self._fetch_registry_repositories(project.id)

                        for item in registry_items:
                            total_fetched += 1
                            event_id = f"registry-{item['repository_path']}-{item['tag_name']}-{item['digest'][:12]}"

                            existing = db.query(ChangeEvent).filter(
                                ChangeEvent.source == "gitlab",
                                ChangeEvent.event_id == event_id
                            ).first()

                            if not existing:
                                # Format size in human-readable format
                                size_value = item.get('size', 0)

                                # Build metadata dict conditionally
                                metadata = {
                                    "registry": "gitlab",
                                    "image": item['repository_path'],
                                    "digest_short": item.get('digest', '')[:12] if item.get('digest') else 'N/A'
                                }

                                # Only include size if available
                                if size_value is not None and size_value > 0:
                                    size_mb = round(size_value / (1024 * 1024), 2)
                                    size_str = f"{size_mb}MB" if size_mb < 1024 else f"{round(size_mb/1024, 2)}GB"
                                    metadata["size"] = size_str

                                # Build text description
                                text_parts = [
                                    f"Container image pushed to GitLab Container Registry",
                                    f"\nImage: {item['repository_path']}",
                                    f"\nTag: {item['tag_name']}"
                                ]
                                if size_value is not None and size_value > 0:
                                    text_parts.append(f"\nSize: {metadata['size']}")
                                text_parts.append(f"\nDigest: {item.get('digest', 'N/A')[:19]}...")

                                # Create detailed description
                                description = {
                                    "text": ''.join(text_parts),
                                    "labels": [item['tag_name']],
                                    "metadata": metadata,
                                    "related_events": []
                                }

                                db_event = ChangeEvent(
                                    source="gitlab",
                                    event_id=event_id,
                                    title=f"[Image] {item['repository_path']}:{item['tag_name']}",
                                    description=description,
                                    author="unknown",
                                    timestamp=item['created_at'].replace(tzinfo=timezone.utc) if item['created_at'].tzinfo is None else item['created_at'],
                                    url=item.get('location', f"{self.url}/"),
                                    status="published",
                                    event_metadata={
                                        "registry": "gitlab",
                                        "repository_path": item['repository_path'],
                                        "repository_id": item['repository_id'],
                                        "image": item['repository_path'],
                                        "tag": item['tag_name'],
                                        "tags": [item['tag_name']],
                                        "digest": item.get('digest', ''),
                                        "revision": item.get('revision', ''),
                                        "size_bytes": item.get('size', 0),
                                        "project_id": str(project.id),
                                    }
                                )
                                db.add(db_event)
                                total_stored += 1
                    except Exception as e:
                        print(f"Error fetching container registry: {e}")

                    db.commit()
                    print(f"  Processed {project.path_with_namespace}")

                except GitlabError as e:
                    print(f"Error fetching from {project.path_with_namespace}: {e}")
                    db.rollback()
                    continue

            return {
                "fetched": total_fetched,
                "stored": total_stored
            }

        finally:
            db.close()


def sync_gitlab(db_session, config: Dict[str, Any], connection_id: int) -> Dict[str, Any]:
    """
    Sync GitLab changes using provided config and database session

    Args:
        db_session: SQLAlchemy database session
        config: Configuration dict with keys: token, url, repos, poll_interval, branches
        connection_id: ID of the connection this sync belongs to

    Returns:
        Dict with sync results
    """
    token = config.get('token', '')
    url = config.get('url', 'https://gitlab.com')
    repos_str = config.get('repos', '')
    branches_str = config.get('branches', '')

    if not token:
        return {"error": "No GitLab token configured"}

    # Parse repos list
    repos = [r.strip() for r in repos_str.split(',') if r.strip()] if repos_str else []

    # Parse branches list
    branches = [b.strip() for b in branches_str.split(',') if b.strip()] if branches_str else []

    # Create connector and sync
    connector = GitLabConnector(token=token, url=url, repos=repos)

    if not connector.test_connection():
        return {"error": "Failed to connect to GitLab"}

    # Create a modified version that uses the provided session
    def fetch_with_session(limit=50):
        """Modified fetch that uses provided session"""
        if not connector.client:
            raise ValueError("GitLab client not initialized")

        # Use branches list for filtering
        filter_branches = branches if branches else []

        try:
            total_fetched = 0
            total_stored = 0

            projects_to_fetch = []
            if connector.repos:
                for repo_name in connector.repos:
                    try:
                        projects_to_fetch.append(connector.client.projects.get(repo_name))
                    except GitlabError as e:
                        print(f"Error accessing project {repo_name}: {e}")
            else:
                projects_to_fetch = list(connector.client.projects.list(membership=True, get_all=False, per_page=10))

            for project in projects_to_fetch:
                try:
                    print(f"Fetching from {project.path_with_namespace}...")

                    # Fetch merge requests
                    mrs = project.mergerequests.list(order_by='updated_at', sort='desc', get_all=False, per_page=limit)
                    for mr in mrs:
                        total_fetched += 1
                        event_id = f"mr-{project.path_with_namespace}-{mr.iid}"

                        # Skip if branches are specified and this MR's target branch doesn't match
                        if filter_branches and mr.target_branch not in filter_branches:
                            continue

                        existing = db_session.query(ChangeEvent).filter(
                            ChangeEvent.connection_id == connection_id,
                            ChangeEvent.event_id == event_id
                        ).first()

                        if not existing:
                            # Get list of changed files
                            try:
                                changes = mr.changes()
                                files_changed = [change['new_path'] for change in changes.get('changes', [])][:20]
                            except:
                                files_changed = []

                            # Get approval info
                            try:
                                approvals = mr.approvals.get()
                                approved_by = [a['user']['username'] for a in approvals.approved_by]
                                approved_count = len(approved_by)
                            except:
                                approved_by = []
                                approved_count = 0

                            # Get labels
                            labels = mr.labels if hasattr(mr, 'labels') else []

                            description = {
                                "text": mr.description or "",
                                "labels": labels,
                                "files_changed": files_changed,
                                "related_events": []
                            }

                            # Parse timestamp
                            updated_at = datetime.fromisoformat(mr.updated_at.replace('Z', '+00:00'))
                            if updated_at.tzinfo is None:
                                updated_at = updated_at.replace(tzinfo=timezone.utc)

                            db_event = ChangeEvent(
                                connection_id=connection_id,
                                source="gitlab",
                                event_id=event_id,
                                title=f"[MR] {mr.title}",
                                description=description,
                                author=mr.author.get('username', 'unknown'),
                                timestamp=updated_at,
                                url=mr.web_url,
                                status=mr.state,
                                event_metadata={
                                    "project": project.path_with_namespace,
                                    "mr_iid": mr.iid,
                                    "merged": mr.state == 'merged',
                                    "mergeable": mr.merge_status == 'can_be_merged',
                                    "source_branch": mr.source_branch,
                                    "target_branch": mr.target_branch,
                                    "approved_by": approved_by,
                                    "approved_count": approved_count,
                                    "user_notes_count": mr.user_notes_count,
                                    "upvotes": mr.upvotes,
                                    "downvotes": mr.downvotes,
                                }
                            )
                            db_session.add(db_event)
                            total_stored += 1

                    # Fetch releases
                    try:
                        releases = project.releases.list(get_all=False, per_page=limit)
                        for release in releases:
                            total_fetched += 1
                            event_id = f"release-{project.path_with_namespace}-{release.tag_name}"

                            existing = db_session.query(ChangeEvent).filter(
                                ChangeEvent.connection_id == connection_id,
                                ChangeEvent.event_id == event_id
                            ).first()

                            if not existing:
                                # Get release assets
                                assets = []
                                if hasattr(release, 'assets') and release.assets:
                                    links = release.assets.get('links', [])
                                    assets = [link.get('name', '') for link in links]

                                description = {
                                    "text": release.description or "",
                                    "assets": assets,
                                    "related_events": []
                                }

                                # Parse timestamp
                                released_at = datetime.fromisoformat(release.released_at.replace('Z', '+00:00'))
                                if released_at.tzinfo is None:
                                    released_at = released_at.replace(tzinfo=timezone.utc)

                                db_event = ChangeEvent(
                                    connection_id=connection_id,
                                    source="gitlab",
                                    event_id=event_id,
                                    title=f"[Release] {release.name or release.tag_name}",
                                    description=description,
                                    author=release.author.get('username', 'unknown') if hasattr(release, 'author') and release.author else "unknown",
                                    timestamp=released_at,
                                    url=f"{project.web_url}/-/releases/{release.tag_name}",
                                    status="published",
                                    event_metadata={
                                        "project": project.path_with_namespace,
                                        "tag_name": release.tag_name,
                                    }
                                )
                                db_session.add(db_event)
                                total_stored += 1
                    except GitlabError as e:
                        print(f"Error fetching releases: {e}")

                    # Fetch pipeline runs
                    try:
                        pipelines = project.pipelines.list(order_by='updated_at', sort='desc', get_all=False, per_page=limit)
                        print(f"  Found {len(pipelines)} pipelines for {project.path_with_namespace}")
                        pipeline_stored = 0
                        pipeline_existing = 0
                        for pipeline in pipelines:
                            total_fetched += 1
                            event_id = f"pipeline-{project.path_with_namespace}-{pipeline.id}"

                            # Get detailed pipeline info to check branch
                            try:
                                full_pipeline = project.pipelines.get(pipeline.id)

                                # Skip if branches are specified and this pipeline's ref doesn't match
                                if filter_branches and full_pipeline.ref not in filter_branches:
                                    continue

                            except Exception as e:
                                print(f"  Error fetching pipeline {pipeline.id}: {e}")
                                continue

                            existing = db_session.query(ChangeEvent).filter(
                                ChangeEvent.connection_id == connection_id,
                                ChangeEvent.event_id == event_id
                            ).first()

                            if not existing:
                                # Process pipeline (full_pipeline already fetched above)
                                try:
                                    # Get job details for failed pipelines
                                    failed_jobs = []
                                    if full_pipeline.status in ['failed', 'canceled']:
                                        try:
                                            jobs = full_pipeline.jobs.list(get_all=False, per_page=100)
                                            for job in jobs:
                                                if job.status in ['failed', 'canceled']:
                                                    failed_jobs.append({
                                                        "name": job.name,
                                                        "status": job.status,
                                                        "started_at": job.started_at,
                                                        "finished_at": job.finished_at,
                                                    })
                                        except:
                                            failed_jobs = []

                                    # Calculate duration
                                    duration_seconds = full_pipeline.duration

                                    description = {
                                        "text": f"Pipeline for {full_pipeline.ref}",
                                        "labels": [],
                                        "failed_jobs": failed_jobs,
                                        "related_events": []
                                    }

                                    status_emoji = {
                                        'success': '✓',
                                        'failed': '✗',
                                        'canceled': '⊗',
                                        'skipped': '⊘',
                                        'manual': '⊙'
                                    }.get(full_pipeline.status, '•')

                                    # Get author from user
                                    author = "unknown"
                                    if hasattr(full_pipeline, 'user') and full_pipeline.user:
                                        author = full_pipeline.user.get('username', 'unknown')

                                    # Parse timestamp
                                    updated_at = datetime.fromisoformat(full_pipeline.updated_at.replace('Z', '+00:00'))
                                    if updated_at.tzinfo is None:
                                        updated_at = updated_at.replace(tzinfo=timezone.utc)

                                    db_event = ChangeEvent(
                                        connection_id=connection_id,
                                        source="gitlab",
                                        event_id=event_id,
                                        title=f"[Pipeline] {status_emoji} {full_pipeline.ref}",
                                        description=description,
                                        author=author,
                                        timestamp=updated_at,
                                        url=full_pipeline.web_url,
                                        status=full_pipeline.status,
                                        event_metadata={
                                            "project": project.path_with_namespace,
                                            "pipeline_id": full_pipeline.id,
                                            "ref": full_pipeline.ref,
                                            "sha": full_pipeline.sha[:7],
                                            "source": full_pipeline.source,
                                            "duration_seconds": duration_seconds,
                                            "failed_jobs_count": len(failed_jobs),
                                        }
                                    )
                                    db_session.add(db_event)
                                    total_stored += 1
                                    pipeline_stored += 1
                                except Exception as e:
                                    print(f"Error processing pipeline {pipeline.id}: {e}")
                            else:
                                pipeline_existing += 1
                        print(f"  Pipelines: {pipeline_stored} stored, {pipeline_existing} already existed")
                    except Exception as e:
                        print(f"Error fetching pipelines: {e}")
                        import traceback
                        traceback.print_exc()

                    # Fetch commits from branches
                    if branches:
                        for branch_name in branches:
                            try:
                                branch = project.branches.get(branch_name)
                                commits = project.commits.list(ref_name=branch_name, get_all=False, per_page=limit)

                                for commit in commits:
                                    total_fetched += 1
                                    event_id = f"commit-{project.path_with_namespace}-{commit.id}"

                                    existing = db_session.query(ChangeEvent).filter(
                                        ChangeEvent.connection_id == connection_id,
                                        ChangeEvent.event_id == event_id
                                    ).first()

                                    if not existing:
                                        # Get commit details
                                        try:
                                            full_commit = project.commits.get(commit.id)
                                            stats = full_commit.stats
                                            additions = stats.get('additions', 0)
                                            deletions = stats.get('deletions', 0)
                                            total_changes = stats.get('total', 0)
                                        except:
                                            additions = 0
                                            deletions = 0
                                            total_changes = 0

                                        description = {
                                            "text": commit.message,
                                            "labels": [],
                                            "files_changed": [],
                                            "related_events": []
                                        }

                                        # Parse timestamp
                                        committed_date = datetime.fromisoformat(commit.committed_date.replace('Z', '+00:00'))
                                        if committed_date.tzinfo is None:
                                            committed_date = committed_date.replace(tzinfo=timezone.utc)

                                        db_event = ChangeEvent(
                                            connection_id=connection_id,
                                            source="gitlab",
                                            event_id=event_id,
                                            title=f"[Commit] {commit.title[:100]}",
                                            description=description,
                                            author=commit.author_name,
                                            timestamp=committed_date,
                                            url=commit.web_url,
                                            status="committed",
                                            event_metadata={
                                                "project": project.path_with_namespace,
                                                "branch": branch_name,
                                                "sha": commit.id,
                                                "additions": additions,
                                                "deletions": deletions,
                                                "total_changes": total_changes,
                                            }
                                        )
                                        db_session.add(db_event)
                                        total_stored += 1
                            except GitlabError as e:
                                print(f"Error fetching commits from branch {branch_name}: {e}")
                                continue

                    # Fetch container registry repositories and tags
                    try:
                        registry_items = connector._fetch_registry_repositories(project.id)
                        print(f"  Found {len(registry_items)} container registry items for {project.path_with_namespace}")

                        for item in registry_items:
                            total_fetched += 1
                            event_id = f"registry-{item['repository_path']}-{item['tag_name']}-{item['digest'][:12]}"

                            existing = db_session.query(ChangeEvent).filter(
                                ChangeEvent.connection_id == connection_id,
                                ChangeEvent.event_id == event_id
                            ).first()

                            if not existing:
                                # Format size in human-readable format
                                size_value = item.get('size', 0)

                                # Build metadata dict conditionally
                                metadata = {
                                    "registry": "gitlab",
                                    "image": item['repository_path'],
                                    "digest_short": item.get('digest', '')[:12] if item.get('digest') else 'N/A'
                                }

                                # Only include size if available
                                if size_value is not None and size_value > 0:
                                    size_mb = round(size_value / (1024 * 1024), 2)
                                    size_str = f"{size_mb}MB" if size_mb < 1024 else f"{round(size_mb/1024, 2)}GB"
                                    metadata["size"] = size_str

                                # Build text description
                                text_parts = [
                                    f"Container image pushed to GitLab Container Registry",
                                    f"\nImage: {item['repository_path']}",
                                    f"\nTag: {item['tag_name']}"
                                ]
                                if size_value is not None and size_value > 0:
                                    text_parts.append(f"\nSize: {metadata['size']}")
                                text_parts.append(f"\nDigest: {item.get('digest', 'N/A')[:19]}...")

                                # Create detailed description
                                description = {
                                    "text": ''.join(text_parts),
                                    "labels": [item['tag_name']],
                                    "metadata": metadata,
                                    "related_events": []
                                }

                                db_event = ChangeEvent(
                                    connection_id=connection_id,
                                    source="gitlab",
                                    event_id=event_id,
                                    title=f"[Image] {item['repository_path']}:{item['tag_name']}",
                                    description=description,
                                    author="unknown",
                                    timestamp=item['created_at'].replace(tzinfo=timezone.utc) if item['created_at'].tzinfo is None else item['created_at'],
                                    url=item.get('location', f"{connector.url}/"),
                                    status="published",
                                    event_metadata={
                                        "registry": "gitlab",
                                        "repository_path": item['repository_path'],
                                        "repository_id": item['repository_id'],
                                        "image": item['repository_path'],
                                        "tag": item['tag_name'],
                                        "tags": [item['tag_name']],
                                        "digest": item.get('digest', ''),
                                        "revision": item.get('revision', ''),
                                        "size_bytes": item.get('size', 0),
                                        "project_id": str(project.id),
                                    }
                                )
                                db_session.add(db_event)
                                total_stored += 1
                    except Exception as e:
                        print(f"Error fetching container registry: {e}")
                        import traceback
                        traceback.print_exc()

                    db_session.commit()
                    print(f"  Processed {project.path_with_namespace}")

                except GitlabError as e:
                    print(f"Error fetching from {project.path_with_namespace}: {e}")
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
