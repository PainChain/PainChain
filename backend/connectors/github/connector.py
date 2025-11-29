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
                    prs = repo.get_pulls(state='all', sort='updated', direction='desc')
                    for pr in list(prs[:limit]):
                        total_fetched += 1

                        event_id = f"pr-{repo.full_name}-{pr.number}"

                        # Check if already exists
                        existing = db.query(ChangeEvent).filter(
                            ChangeEvent.source == "github",
                            ChangeEvent.event_id == event_id
                        ).first()

                        if not existing:
                            description = {
                                "text": pr.body or "",
                                "labels": [label.name for label in pr.labels],
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
                                }
                            )
                            db.add(db_event)
                            total_stored += 1

                    # Fetch releases
                    releases = repo.get_releases()
                    for release in list(releases[:limit]):
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


def sync_github(db_session, config: Dict[str, Any]) -> Dict[str, Any]:
    """
    Sync GitHub changes using provided config and database session

    Args:
        db_session: SQLAlchemy database session
        config: Configuration dict with keys: token, repos, poll_interval

    Returns:
        Dict with sync results
    """
    token = config.get('token', '')
    repos_str = config.get('repos', '')

    if not token:
        return {"error": "No GitHub token configured"}

    # Parse repos list
    repos = [r.strip() for r in repos_str.split(',') if r.strip()] if repos_str else []

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
                    prs = repo.get_pulls(state='all', sort='updated', direction='desc')
                    for pr in list(prs[:limit]):
                        total_fetched += 1
                        event_id = f"pr-{repo.full_name}-{pr.number}"

                        existing = db_session.query(ChangeEvent).filter(
                            ChangeEvent.source == "github",
                            ChangeEvent.event_id == event_id
                        ).first()

                        if not existing:
                            description = {
                                "text": pr.body or "",
                                "labels": [label.name for label in pr.labels],
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
                                }
                            )
                            db_session.add(db_event)
                            total_stored += 1

                    # Fetch releases
                    releases = repo.get_releases()
                    for release in list(releases[:limit]):
                        total_fetched += 1
                        event_id = f"release-{repo.full_name}-{release.id}"

                        existing = db_session.query(ChangeEvent).filter(
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
                            db_session.add(db_event)
                            total_stored += 1

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
