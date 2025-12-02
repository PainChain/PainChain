from typing import List, Dict, Any, Optional
from datetime import datetime, timezone
from github import Github, GithubException
import sys
sys.path.insert(0, '/app')

from shared import ChangeEvent, SessionLocal


class GitHubConnector:
    """GitHub connector that fetches PRs and releases"""

    def __init__(self, token: str, repos: List[str] = None):
        self.token = token
        self.repos = repos or []
        self.client = Github(token) if token else None

    def test_connection(self) -> bool:
        """Test GitHub connection"""
        if not self.client:
            return False
        try:
            self.client.get_user().login
            return True
        except GithubException:
            return False

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
        config: Configuration dict with keys: token, repos, poll_interval, branches
        connection_id: ID of the connection this sync belongs to

    Returns:
        Dict with sync results
    """
    token = config.get('token', '')
    repos_str = config.get('repos', '')
    branches_str = config.get('branches', '')

    if not token:
        return {"error": "No GitHub token configured"}

    # Parse repos list
    repos = [r.strip() for r in repos_str.split(',') if r.strip()] if repos_str else []

    # Parse branches list
    branches = [b.strip() for b in branches_str.split(',') if b.strip()] if branches_str else []

    # Create connector and sync
    connector = GitHubConnector(token=token, repos=repos)

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
