import { PainChainEvent } from './types';

/**
 * Transform GitLab push event to PainChain event format
 */
export function transformPushEvent(
  event: any,
  project: string
): PainChainEvent {
  const commits = event.total_commits_count || 0;
  const branch = event.push_data?.ref || 'unknown';

  return {
    title: `Push to ${branch}`,
    connector: 'gitlab',
    project,
    timestamp: new Date(event.created_at),
    externalId: `gitlab-event-${event.id}`,
    data: {
      event_type: 'push',
      branch,
      commits,
      author: event.author?.username || 'unknown',
      author_id: event.author?.id,
      author_email: event.author?.email,
      url: `${event.project_id}`, // GitLab event URLs vary
      commit_sha: event.push_data?.commit_to,
      original_event_id: event.id,
    },
  };
}

/**
 * Transform GitLab merge request event to PainChain event format
 */
export function transformMergeRequestEvent(
  event: any,
  project: string
): PainChainEvent {
  const action = event.action_name || 'unknown';
  const mr = event.target || {};

  return {
    title: `Merge request ${action}: ${mr.title || 'Untitled'}`,
    connector: 'gitlab',
    project,
    timestamp: new Date(event.created_at),
    externalId: `gitlab-event-${event.id}`,
    data: {
      event_type: 'merge_request',
      action,
      mr_iid: mr.iid,
      title: mr.title,
      author: event.author?.username || 'unknown',
      author_id: event.author?.id,
      author_email: event.author?.email,
      state: mr.state,
      url: mr.web_url,
      source_branch: mr.source_branch,
      target_branch: mr.target_branch,
      original_event_id: event.id,
    },
  };
}

/**
 * Transform GitLab pipeline event to PainChain event format
 */
export function transformPipelineEvent(
  pipeline: any,
  project: string
): PainChainEvent {
  const duration = pipeline.duration || 0;

  return {
    title: `[Pipeline] ${pipeline.ref}`,
    connector: 'gitlab',
    project,
    timestamp: new Date(pipeline.updated_at || pipeline.created_at),
    externalId: `gitlab-pipeline-${pipeline.id}`,
    data: {
      event_type: 'pipeline',
      pipeline_id: pipeline.id,
      status: pipeline.status,
      ref: pipeline.ref,
      sha: pipeline.sha,
      author: pipeline.user?.username || 'unknown',
      author_id: pipeline.user?.id,
      author_email: pipeline.user?.email,
      duration_seconds: duration,
      url: pipeline.web_url,
      original_pipeline_id: pipeline.id,
    },
  };
}

/**
 * Transform GitLab deployment event to PainChain event format
 */
export function transformDeploymentEvent(
  deployment: any,
  project: string
): PainChainEvent {
  // Map status to title
  const statusMap: { [key: string]: string } = {
    created: 'created',
    running: 'in progress',
    success: '✓ succeeded',
    failed: '✗ failed',
    canceled: 'canceled',
  };

  const status = deployment.status || 'unknown';
  const statusText = statusMap[status] || status;

  return {
    title: `Deployment to ${deployment.environment?.name || 'unknown'} ${statusText}`,
    connector: 'gitlab',
    project,
    timestamp: new Date(deployment.updated_at || deployment.created_at),
    externalId: `gitlab-deployment-${deployment.id}`,
    data: {
      event_type: 'deployment',
      deployment_id: deployment.id,
      status: deployment.status,
      environment: deployment.environment?.name,
      environment_id: deployment.environment?.id,
      ref: deployment.ref,
      commit_sha: deployment.sha,
      deployer: deployment.user?.username || 'unknown',
      deployer_id: deployment.user?.id,
      deployer_email: deployment.user?.email,
      url: deployment.deployable?.web_url,
      original_deployment_id: deployment.id,
    },
  };
}

/**
 * Transform GitLab tag event to PainChain event format
 */
export function transformTagEvent(
  tag: any,
  project: string,
  action: 'created' | 'deleted'
): PainChainEvent {
  return {
    title: `Tag ${action}: ${tag.name}`,
    connector: 'gitlab',
    project,
    timestamp: new Date(tag.created_at || Date.now()),
    externalId: `gitlab-tag-${project}-${tag.name}-${action}`,
    data: {
      event_type: 'tag',
      action,
      tag_name: tag.name,
      commit_sha: tag.commit?.id,
      commit_message: tag.commit?.message,
      message: tag.message,
      author: tag.commit?.author_name || 'unknown',
      url: tag.web_url,
    },
  };
}

/**
 * Transform GitLab release event to PainChain event format
 */
export function transformReleaseEvent(
  release: any,
  project: string
): PainChainEvent {
  return {
    title: `Release created: ${release.name || release.tag_name}`,
    connector: 'gitlab',
    project,
    timestamp: new Date(release.created_at),
    externalId: `gitlab-release-${release.tag_name}`,
    data: {
      event_type: 'release',
      tag_name: release.tag_name,
      release_name: release.name,
      description: release.description,
      author: release.author?.username || 'unknown',
      author_id: release.author?.id,
      author_email: release.author?.email,
      commit_sha: release.commit?.id,
      url: release._links?.self,
      upcoming_release: release.upcoming_release,
      assets_count: release.assets?.count || 0,
    },
  };
}

/**
 * Transform GitLab job event to PainChain event format
 */
export function transformJobEvent(
  job: any,
  project: string
): PainChainEvent {
  // Map status to title text
  const statusMap: { [key: string]: string } = {
    created: 'created',
    pending: 'pending',
    running: 'running',
    success: '✓ succeeded',
    failed: '✗ failed',
    canceled: 'canceled',
    skipped: 'skipped',
    manual: 'waiting (manual)',
  };

  const status = job.status || 'unknown';
  const statusText = statusMap[status] || status;

  return {
    title: `[Job] ${job.name} ${statusText}`,
    connector: 'gitlab',
    project,
    timestamp: new Date(job.finished_at || job.started_at || job.created_at),
    externalId: `gitlab-job-${job.id}`,
    data: {
      event_type: 'job',
      job_id: job.id,
      job_name: job.name,
      status: job.status,
      stage: job.stage,
      ref: job.ref,
      commit_sha: job.commit?.id,
      pipeline_id: job.pipeline?.id,
      duration_seconds: job.duration || 0,
      queued_duration: job.queued_duration,
      runner_id: job.runner?.id,
      runner_description: job.runner?.description,
      failure_reason: job.failure_reason,
      allow_failure: job.allow_failure,
      url: job.web_url,
      artifacts: job.artifacts_file ? true : false,
      coverage: job.coverage,
      user: job.user?.username || 'unknown',
      user_id: job.user?.id,
    },
  };
}

/**
 * Main transformer - routes to appropriate event transformer
 */
export function transformGitLabEvent(
  event: any,
  project: string
): PainChainEvent | null {
  try {
    switch (event.action_name) {
      case 'pushed to':
      case 'pushed new':
        return transformPushEvent(event, project);
      case 'opened':
      case 'closed':
      case 'merged':
      case 'updated':
        if (event.target_type === 'MergeRequest') {
          return transformMergeRequestEvent(event, project);
        }
        return null;
      default:
        // Ignore other event types for now
        return null;
    }
  } catch (error) {
    console.error(`Error transforming GitLab event:`, error);
    return null;
  }
}
