import { Octokit } from '@octokit/rest';
import { BackendClient } from './backend-client';
import { Integration, RepositoryConfig } from './types';
import { transformGitHubEvent, transformWorkflowRun } from './event-transformer';

export class GitHubPoller {
  private backendClient: BackendClient;
  private pollingInterval: number;

  constructor(backendApiUrl: string, pollingInterval: number = 60) {
    this.backendClient = new BackendClient(backendApiUrl);
    this.pollingInterval = pollingInterval * 1000; // Convert to ms
  }

  /**
   * Start the polling loop
   */
  async start(): Promise<void> {
    console.log('🚀 GitHub Connector started');
    console.log(`⏱️  Polling interval: ${this.pollingInterval / 1000}s`);

    // Run immediately, then on interval
    await this.pollAll();

    setInterval(async () => {
      await this.pollAll();
    }, this.pollingInterval);
  }

  /**
   * Poll all GitHub integrations
   */
  private async pollAll(): Promise<void> {
    try {
      console.log('\n📡 Fetching integrations from backend...');
      const integrations = await this.backendClient.getGitHubIntegrations();

      if (integrations.length === 0) {
        console.log('ℹ️  No GitHub integrations found');
        return;
      }

      console.log(`✓ Found ${integrations.length} GitHub integration(s)`);

      for (const integration of integrations) {
        await this.pollIntegration(integration);
      }
    } catch (error) {
      console.error('❌ Error in poll cycle:', error);
    }
  }

  /**
   * Poll a single integration (with all its repositories)
   */
  private async pollIntegration(integration: Integration): Promise<void> {
    try {
      console.log(`\n📦 Processing integration: ${integration.name}`);

      const octokit = new Octokit({
        auth: integration.config.token,
      });

      const repositories = integration.config.repositories || [];

      for (const repo of repositories) {
        await this.pollRepository(octokit, repo, integration.tenantId, integration.id);
        await this.pollWorkflowRuns(octokit, repo, integration.tenantId, integration.id);
      }

      // Update last sync time
      await this.backendClient.updateIntegrationSync(
        integration.id,
        integration.tenantId || undefined
      );
    } catch (error) {
      console.error(`❌ Error polling integration ${integration.name}:`, error);
    }
  }

  /**
   * Poll events for a single repository
   */
  private async pollRepository(
    octokit: Octokit,
    repo: RepositoryConfig,
    tenantId: string | null,
    integrationId: string
  ): Promise<void> {
    const repoKey = `${repo.owner}/${repo.repo}`;

    try {
      console.log(`  📂 Polling ${repoKey}...`);

      // Fetch recent events
      const { data: events } = await octokit.activity.listRepoEvents({
        owner: repo.owner,
        repo: repo.repo,
        per_page: 30,
      });

      let eventCount = 0;

      for (const event of events) {
        // Transform GitHub event to PainChain format
        const painchainEvent = transformGitHubEvent(event, repo.owner, repo.repo);

        if (painchainEvent) {
          // For merged PRs, fetch file changes
          if (event.type === 'PullRequestEvent' && (event.payload as any)?.pull_request?.merged) {
            try {
              const pr = (event.payload as any).pull_request;
              const { data: prFiles } = await octokit.pulls.listFiles({
                owner: repo.owner,
                repo: repo.repo,
                pull_number: pr.number,
              });

              const MAX_FILES = 50; // Truncate to prevent huge events
              const filesList = prFiles.map(f => f.filename);
              const truncated = filesList.length > MAX_FILES;

              painchainEvent.data.files_changed_count = filesList.length;
              painchainEvent.data.files_changed = truncated ? filesList.slice(0, MAX_FILES) : filesList;
              painchainEvent.data.files_truncated = truncated;
            } catch (error: any) {
              console.error(`    ⚠️  Failed to fetch PR files: ${error.message}`);
              // Continue without file data
            }
          }

          // Post to backend (backend handles deduplication)
          await this.backendClient.postEvent(
            {
              ...painchainEvent,
              integrationId,
            },
            tenantId || undefined
          );
          eventCount++;
        }
      }

      console.log(`  ✓ ${eventCount} event(s) sent (backend deduplicates)`);
    } catch (error: any) {
      if (error.status === 404) {
        console.error(`  ❌ Repository not found: ${repoKey}`);
      } else if (error.status === 401) {
        console.error(`  ❌ Authentication failed for ${repoKey}`);
      } else {
        console.error(`  ❌ Error polling ${repoKey}:`, error.message);
      }
    }
  }

  /**
   * Poll GitHub Actions workflow runs for a repository
   */
  private async pollWorkflowRuns(
    octokit: Octokit,
    repo: RepositoryConfig,
    tenantId: string | null,
    integrationId: string
  ): Promise<void> {
    const repoKey = `${repo.owner}/${repo.repo}`;

    try {
      console.log(`  ⚙️  Polling workflows for ${repoKey}...`);

      // Fetch recent workflow runs
      const { data } = await octokit.actions.listWorkflowRunsForRepo({
        owner: repo.owner,
        repo: repo.repo,
        per_page: 20,
      });

      let workflowCount = 0;

      for (const run of data.workflow_runs) {
        // Transform workflow run to PainChain format
        const painchainEvent = transformWorkflowRun(run, repo.owner, repo.repo);

        // Post to backend (backend handles deduplication)
        await this.backendClient.postEvent(
          {
            ...painchainEvent,
            integrationId,
          },
          tenantId || undefined
        );
        workflowCount++;
      }

      console.log(`  ✓ ${workflowCount} workflow run(s) sent (backend deduplicates)`);
    } catch (error: any) {
      if (error.status === 404) {
        console.error(`  ❌ Repository or workflows not found: ${repoKey}`);
      } else if (error.status === 401) {
        console.error(`  ❌ Authentication failed for ${repoKey}`);
      } else {
        console.error(`  ❌ Error polling workflows for ${repoKey}:`, error.message);
      }
    }
  }
}
