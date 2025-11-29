import os
import time
from datetime import datetime
from connector import GitHubConnector

# Configuration from environment variables
GITHUB_TOKEN = os.getenv("GITHUB_TOKEN", "")
POLL_INTERVAL = int(os.getenv("POLL_INTERVAL", "300"))  # Default 5 minutes
REPOS = os.getenv("REPOS", "").split(",") if os.getenv("REPOS") else []
REPOS = [r.strip() for r in REPOS if r.strip()]  # Clean up repo list


def main():
    """Main polling loop for GitHub connector"""

    if not GITHUB_TOKEN:
        print("ERROR: GITHUB_TOKEN not set. Exiting.")
        return

    print("=" * 60)
    print("PainChain - GitHub Connector")
    print("=" * 60)
    print(f"Poll Interval: {POLL_INTERVAL} seconds")
    print(f"Repositories: {REPOS if REPOS else 'All user repos (max 10)'}")
    print("=" * 60)

    connector = GitHubConnector(token=GITHUB_TOKEN, repos=REPOS)

    # Test connection
    if not connector.test_connection():
        print("ERROR: Failed to connect to GitHub. Check your token.")
        return

    print("Connected to GitHub successfully!")
    print()

    # Main polling loop
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
