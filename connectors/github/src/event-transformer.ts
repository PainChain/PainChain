import { PainChainEvent } from './types';

/**
 * Transform GitHub push event to PainChain event format
 */
export function transformPushEvent(
  event: any,
  owner: string,
  repo: string
): PainChainEvent {
  const commits = event.payload?.commits || [];
  const branch = event.payload?.ref?.replace('refs/heads/', '') || 'unknown';

  // Aggregate file changes from all commits
  const filesChanged = new Set<string>();
  for (const commit of commits) {
    const added = commit.added || [];
    const modified = commit.modified || [];
    const removed = commit.removed || [];

    [...added, ...modified, ...removed].forEach(file => filesChanged.add(file));
  }

  const filesList = Array.from(filesChanged);
  const MAX_FILES = 50; // Truncate to prevent huge events
  const truncated = filesList.length > MAX_FILES;

  return {
    title: `Push to ${branch}`,
    connector: 'github',
    project: `${owner}/${repo}`,
    timestamp: new Date(event.created_at),
    externalId: `github-event-${event.id}`,
    data: {
      event_type: 'push',
      branch,
      commits: commits.length,
      author: event.actor?.login || 'unknown',
      author_id: event.actor?.id,
      author_type: event.actor?.type,
      files_changed_count: filesChanged.size,
      files_changed: truncated ? filesList.slice(0, MAX_FILES) : filesList,
      files_truncated: truncated,
      url: `https://github.com/${owner}/${repo}/compare/${event.payload?.before?.substring(0, 7)}...${event.payload?.head?.substring(0, 7)}`,
      commit_messages: commits.slice(0, 3).map((c: any) => c.message),
      original_event_id: event.id,
    },
  };
}

/**
 * Transform GitHub pull request event to PainChain event format
 * Only processes merged PRs (state changes only)
 */
export function transformPullRequestEvent(
  event: any,
  owner: string,
  repo: string
): PainChainEvent | null {
  const pr = event.payload?.pull_request || {};
  const action = event.payload?.action || 'unknown';

  // Only track merged PRs - these are actual state changes to the codebase
  if (!pr.merged) {
    return null;
  }

  return {
    title: `Pull request merged: ${pr.title}`,
    connector: 'github',
    project: `${owner}/${repo}`,
    timestamp: new Date(event.created_at),
    externalId: `github-event-${event.id}`,
    data: {
      event_type: 'pull_request',
      action: 'merged',
      pr_number: pr.number,
      title: pr.title,
      author: pr.user?.login || 'unknown',
      author_id: pr.user?.id,
      author_type: pr.user?.type,
      merged_by: pr.merged_by?.login || 'unknown',
      merged_by_id: pr.merged_by?.id,
      merged_by_type: pr.merged_by?.type,
      state: pr.state,
      url: pr.html_url,
      base_branch: pr.base?.ref,
      head_branch: pr.head?.ref,
      original_event_id: event.id,
    },
  };
}

/**
 * Transform GitHub release event to PainChain event format
 */
export function transformReleaseEvent(
  event: any,
  owner: string,
  repo: string
): PainChainEvent {
  const release = event.payload?.release || {};
  const action = event.payload?.action || 'published';

  return {
    title: `Release ${action}: ${release.name || release.tag_name}`,
    connector: 'github',
    project: `${owner}/${repo}`,
    timestamp: new Date(event.created_at),
    externalId: `github-event-${event.id}`,
    data: {
      event_type: 'release',
      action,
      tag: release.tag_name,
      name: release.name,
      author: release.author?.login || 'unknown',
      author_id: release.author?.id,
      author_type: release.author?.type,
      commit_sha: release.target_commitish,
      url: release.html_url,
      prerelease: release.prerelease,
      original_event_id: event.id,
    },
  };
}

/**
 * Transform GitHub Actions workflow run to PainChain event format
 */
export function transformWorkflowRun(
  run: any,
  owner: string,
  repo: string
): PainChainEvent {
  // Calculate duration in seconds
  const duration = run.updated_at && run.run_started_at
    ? (new Date(run.updated_at).getTime() - new Date(run.run_started_at).getTime()) / 1000
    : 0;

  return {
    title: `[Workflow] ${run.name}`,
    connector: 'github',
    project: `${owner}/${repo}`,
    timestamp: new Date(run.updated_at || run.created_at),
    externalId: `github-workflow-${run.id}`,
    data: {
      event_type: 'workflow',
      workflow_name: run.name,
      run_number: run.run_number,
      status: run.status,
      conclusion: run.conclusion,
      branch: run.head_branch,
      commit_sha: run.head_sha,
      author: run.actor?.login || run.triggering_actor?.login || 'unknown',
      author_id: run.actor?.id || run.triggering_actor?.id,
      author_type: run.actor?.type || run.triggering_actor?.type,
      event: run.event,
      duration_seconds: Math.round(duration),
      url: run.html_url,
      original_run_id: run.id,
    },
  };
}

/**
 * Transform GitHub deployment event to PainChain event format
 */
export function transformDeploymentEvent(
  event: any,
  owner: string,
  repo: string
): PainChainEvent {
  const deployment = event.payload?.deployment || {};

  return {
    title: `Deployment to ${deployment.environment || 'unknown'}`,
    connector: 'github',
    project: `${owner}/${repo}`,
    timestamp: new Date(event.created_at),
    externalId: `github-event-${event.id}`,
    data: {
      event_type: 'deployment',
      deployment_id: deployment.id,
      environment: deployment.environment,
      ref: deployment.ref,
      commit_sha: deployment.sha,
      task: deployment.task,
      creator: deployment.creator?.login || 'unknown',
      creator_id: deployment.creator?.id,
      creator_type: deployment.creator?.type,
      description: deployment.description,
      url: deployment.url,
      original_event_id: event.id,
    },
  };
}

/**
 * Transform GitHub deployment status event to PainChain event format
 */
export function transformDeploymentStatusEvent(
  event: any,
  owner: string,
  repo: string
): PainChainEvent {
  const deploymentStatus = event.payload?.deployment_status || {};
  const deployment = event.payload?.deployment || {};

  // Map state to title
  const stateMap: { [key: string]: string } = {
    success: '✓ succeeded',
    failure: '✗ failed',
    error: '✗ errored',
    pending: 'pending',
    in_progress: 'in progress',
    queued: 'queued',
    inactive: 'deactivated',
  };

  const state = deploymentStatus.state || 'unknown';
  const stateText = stateMap[state] || state;

  return {
    title: `Deployment to ${deployment.environment || 'unknown'} ${stateText}`,
    connector: 'github',
    project: `${owner}/${repo}`,
    timestamp: new Date(event.created_at),
    externalId: `github-event-${event.id}`,
    data: {
      event_type: 'deployment_status',
      deployment_id: deployment.id,
      status_id: deploymentStatus.id,
      state: deploymentStatus.state,
      environment: deployment.environment,
      ref: deployment.ref,
      commit_sha: deployment.sha,
      creator: deploymentStatus.creator?.login || 'unknown',
      creator_id: deploymentStatus.creator?.id,
      creator_type: deploymentStatus.creator?.type,
      description: deploymentStatus.description,
      deployment_url: deploymentStatus.deployment_url,
      environment_url: deploymentStatus.environment_url,
      log_url: deploymentStatus.log_url,
      original_event_id: event.id,
    },
  };
}

/**
 * Main transformer - routes to appropriate event transformer
 */
export function transformGitHubEvent(
  event: any,
  owner: string,
  repo: string
): PainChainEvent | null {
  try {
    switch (event.type) {
      case 'PushEvent':
        return transformPushEvent(event, owner, repo);
      case 'PullRequestEvent':
        return transformPullRequestEvent(event, owner, repo);
      case 'ReleaseEvent':
        return transformReleaseEvent(event, owner, repo);
      case 'DeploymentEvent':
        return transformDeploymentEvent(event, owner, repo);
      case 'DeploymentStatusEvent':
        return transformDeploymentStatusEvent(event, owner, repo);
      default:
        // Ignore other event types for now
        return null;
    }
  } catch (error) {
    console.error(`Error transforming ${event.type} event:`, error);
    return null;
  }
}
