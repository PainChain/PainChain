import { Gitlab } from '@gitbeaker/rest';
import { BackendClient } from './backend-client';
import { Integration, ProjectConfig } from './types';
import {
  transformGitLabEvent,
  transformPipelineEvent,
  transformDeploymentEvent,
  transformTagEvent,
  transformReleaseEvent,
  transformJobEvent
} from './event-transformer';

export class GitLabPoller {
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
    console.log('🚀 GitLab Connector started');
    console.log(`⏱️  Polling interval: ${this.pollingInterval / 1000}s`);

    // Run immediately, then on interval
    await this.pollAll();

    setInterval(async () => {
      await this.pollAll();
    }, this.pollingInterval);
  }

  /**
   * Poll all GitLab integrations
   */
  private async pollAll(): Promise<void> {
    try {
      console.log('\n📡 Fetching integrations from backend...');
      const integrations = await this.backendClient.getGitLabIntegrations();

      if (integrations.length === 0) {
        console.log('ℹ️  No GitLab integrations found');
        return;
      }

      console.log(`✓ Found ${integrations.length} GitLab integration(s)`);

      for (const integration of integrations) {
        await this.pollIntegration(integration);
      }
    } catch (error) {
      console.error('❌ Error in poll cycle:', error);
    }
  }

  /**
   * Poll a single integration (with all its projects)
   */
  private async pollIntegration(integration: Integration): Promise<void> {
    try {
      console.log(`\n📦 Processing integration: ${integration.name}`);

      const gitlab = new Gitlab({
        token: integration.config.token,
        host: integration.config.url || 'https://gitlab.com',
      });

      const projects = integration.config.repositories || [];

      for (const projectConfig of projects) {
        await this.pollProject(gitlab, projectConfig, integration);
        await this.pollPipelines(gitlab, projectConfig, integration);
        await this.pollJobs(gitlab, projectConfig, integration);
        await this.pollDeployments(gitlab, projectConfig, integration);
        await this.pollTags(gitlab, projectConfig, integration);
        await this.pollReleases(gitlab, projectConfig, integration);
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
   * Poll events for a single project
   */
  private async pollProject(
    gitlab: InstanceType<typeof Gitlab>,
    projectConfig: ProjectConfig,
    integration: Integration
  ): Promise<void> {
    const projectKey = projectConfig.project;

    try {
      console.log(`  ↳ Polling project: ${projectKey}`);

      // Get project events
      const events = await gitlab.Events.all({
        projectId: projectKey,
        perPage: 20,
      });

      let eventCount = 0;

      // Transform and post all events (backend handles deduplication)
      for (const event of events) {
        const painchainEvent = transformGitLabEvent(event, projectKey);

        if (painchainEvent) {
          // For push events, fetch commit details to get file changes
          const eventAny = event as any;
          if ((event.action_name === 'pushed to' || event.action_name === 'pushed new') && eventAny.push_data?.commit_to) {
            try {
              const commit = await gitlab.Commits.show(projectKey, eventAny.push_data.commit_to);
              const MAX_FILES = 50; // Truncate to prevent huge events
              const filesList = [
                ...(commit.stats?.additions ? Object.keys(commit.stats.additions) : []),
                ...(commit.stats?.deletions ? Object.keys(commit.stats.deletions) : []),
              ];
              const truncated = filesList.length > MAX_FILES;

              painchainEvent.data.files_changed_count = filesList.length;
              painchainEvent.data.files_changed = truncated ? filesList.slice(0, MAX_FILES) : filesList;
              painchainEvent.data.files_truncated = truncated;
            } catch (error: any) {
              console.error(`    ⚠️  Failed to fetch commit details: ${error.message}`);
              // Continue without file data
            }
          }

          // For merge request events, fetch MR changes to get file list
          if (event.target_type === 'MergeRequest' && eventAny.target?.iid) {
            try {
              const mrChanges = await (gitlab.MergeRequests as any).show(projectKey, eventAny.target.iid, { include_diverged_commits_count: true });
              const MAX_FILES = 50; // Truncate to prevent huge events
              const filesList = (mrChanges.changes || []).map((c: any) => c.new_path || c.old_path);
              const truncated = filesList.length > MAX_FILES;

              painchainEvent.data.files_changed_count = filesList.length;
              painchainEvent.data.files_changed = truncated ? filesList.slice(0, MAX_FILES) : filesList;
              painchainEvent.data.files_truncated = truncated;
            } catch (error: any) {
              console.error(`    ⚠️  Failed to fetch MR changes: ${error.message}`);
              // Continue without file data
            }
          }

          await this.backendClient.postEvent(
            { ...painchainEvent, integrationId: integration.id },
            integration.tenantId || undefined
          );
          eventCount++;
        }
      }

      console.log(`    ✓ ${eventCount} event(s) sent (backend deduplicates)`);
    } catch (error) {
      console.error(`    ❌ Error polling project ${projectKey}:`, error);
    }
  }

  /**
   * Poll pipelines for a single project
   */
  private async pollPipelines(
    gitlab: InstanceType<typeof Gitlab>,
    projectConfig: ProjectConfig,
    integration: Integration
  ): Promise<void> {
    const projectKey = projectConfig.project;

    try {
      console.log(`  ↳ Polling pipelines: ${projectKey}`);

      // Get recent pipelines
      const pipelines = await gitlab.Pipelines.all(projectKey, {
        perPage: 10,
        orderBy: 'updated_at',
      });

      let pipelineCount = 0;

      // Transform and post all pipeline events (backend handles deduplication)
      for (const pipeline of pipelines) {
        const painchainEvent = transformPipelineEvent(pipeline, projectKey);
        await this.backendClient.postEvent(
          { ...painchainEvent, integrationId: integration.id },
          integration.tenantId || undefined
        );
        pipelineCount++;
      }

      console.log(`    ✓ ${pipelineCount} pipeline(s) sent (backend deduplicates)`);
    } catch (error) {
      console.error(`    ❌ Error polling pipelines for ${projectKey}:`, error);
    }
  }

  /**
   * Poll deployments for a single project
   */
  private async pollDeployments(
    gitlab: InstanceType<typeof Gitlab>,
    projectConfig: ProjectConfig,
    integration: Integration
  ): Promise<void> {
    const projectKey = projectConfig.project;

    try {
      console.log(`  ↳ Polling deployments: ${projectKey}`);

      // Get recent deployments
      const deployments = await (gitlab as any).Deployments.all(projectKey, {
        perPage: 10,
        orderBy: 'updated_at',
      });

      let deploymentCount = 0;

      // Transform and post all deployment events (backend handles deduplication)
      for (const deployment of deployments) {
        const painchainEvent = transformDeploymentEvent(deployment, projectKey);
        await this.backendClient.postEvent(
          { ...painchainEvent, integrationId: integration.id },
          integration.tenantId || undefined
        );
        deploymentCount++;
      }

      console.log(`    ✓ ${deploymentCount} deployment(s) sent (backend deduplicates)`);
    } catch (error) {
      console.error(`    ❌ Error polling deployments for ${projectKey}:`, error);
    }
  }

  /**
   * Poll tags for a single project
   */
  private async pollTags(
    gitlab: InstanceType<typeof Gitlab>,
    projectConfig: ProjectConfig,
    integration: Integration
  ): Promise<void> {
    const projectKey = projectConfig.project;

    try {
      console.log(`  ↳ Polling tags: ${projectKey}`);

      // Get recent tags
      const tags = await gitlab.Tags.all(projectKey, {
        perPage: 10,
        orderBy: 'updated',
      });

      let tagCount = 0;

      // Transform and post all tag events (backend handles deduplication)
      // Note: We only track tag creation from this API (deletion detection would require tracking state)
      for (const tag of tags) {
        const painchainEvent = transformTagEvent(tag, projectKey, 'created');
        await this.backendClient.postEvent(
          { ...painchainEvent, integrationId: integration.id },
          integration.tenantId || undefined
        );
        tagCount++;
      }

      console.log(`    ✓ ${tagCount} tag(s) sent (backend deduplicates)`);
    } catch (error) {
      console.error(`    ❌ Error polling tags for ${projectKey}:`, error);
    }
  }

  /**
   * Poll releases for a single project
   */
  private async pollReleases(
    gitlab: InstanceType<typeof Gitlab>,
    projectConfig: ProjectConfig,
    integration: Integration
  ): Promise<void> {
    const projectKey = projectConfig.project;

    try {
      console.log(`  ↳ Polling releases: ${projectKey}`);

      // Get recent releases
      const releases = await (gitlab as any).ProjectReleases.all(projectKey, {
        perPage: 10,
      });

      let releaseCount = 0;

      // Transform and post all release events (backend handles deduplication)
      for (const release of releases) {
        const painchainEvent = transformReleaseEvent(release, projectKey);
        await this.backendClient.postEvent(
          { ...painchainEvent, integrationId: integration.id },
          integration.tenantId || undefined
        );
        releaseCount++;
      }

      console.log(`    ✓ ${releaseCount} release(s) sent (backend deduplicates)`);
    } catch (error) {
      console.error(`    ❌ Error polling releases for ${projectKey}:`, error);
    }
  }

  /**
   * Poll jobs for a single project
   */
  private async pollJobs(
    gitlab: InstanceType<typeof Gitlab>,
    projectConfig: ProjectConfig,
    integration: Integration
  ): Promise<void> {
    const projectKey = projectConfig.project;

    try {
      console.log(`  ↳ Polling jobs: ${projectKey}`);

      // Get recent jobs from all pipelines
      const jobs = await (gitlab as any).Jobs.all(projectKey, {
        perPage: 20,
        orderBy: 'updated_at',
      });

      let jobCount = 0;

      // Transform and post all job events (backend handles deduplication)
      for (const job of jobs) {
        const painchainEvent = transformJobEvent(job, projectKey);
        await this.backendClient.postEvent(
          { ...painchainEvent, integrationId: integration.id },
          integration.tenantId || undefined
        );
        jobCount++;
      }

      console.log(`    ✓ ${jobCount} job(s) sent (backend deduplicates)`);
    } catch (error) {
      console.error(`    ❌ Error polling jobs for ${projectKey}:`, error);
    }
  }
}
