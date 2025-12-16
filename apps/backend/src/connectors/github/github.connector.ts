import { Injectable } from '@nestjs/common'
import { Octokit } from '@octokit/rest'
import { PrismaService } from '../../database/prisma.service'
import { BaseConnector } from '../base.connector'
import { SyncResult, CreateChangeEventDto } from '@painchain/types'

interface GitHubConfig {
  token: string
  repos?: string
  branches?: string
  isEnterprise?: boolean
  baseUrl?: string
  pollInterval?: number
  tags?: string
}

@Injectable()
export class GithubConnector extends BaseConnector {
  private octokit: Octokit
  protected githubConfig: GitHubConfig

  constructor(config: Record<string, any>, private prisma: PrismaService) {
    super(config)
    this.githubConfig = config as GitHubConfig

    // Initialize Octokit client
    const octokitConfig: any = {
      auth: this.githubConfig.token,
    }

    if (this.githubConfig.isEnterprise && this.githubConfig.baseUrl) {
      octokitConfig.baseUrl = this.githubConfig.baseUrl
    }

    this.octokit = new Octokit(octokitConfig)
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.octokit.users.getAuthenticated()
      return true
    } catch (error) {
      return false
    }
  }

  async sync(connectionId: number): Promise<SyncResult> {
    try {
      let eventsStored = 0

      // Parse repositories
      const repos = this.githubConfig.repos
        ? this.githubConfig.repos.split(',').map((r) => r.trim()).filter(Boolean)
        : []

      // Parse branches filter
      const branchesFilter = this.githubConfig.branches
        ? this.githubConfig.branches.split(',').map((b) => b.trim()).filter(Boolean)
        : []

      // If no specific repos, fetch from authenticated user
      let reposToFetch: string[] = repos
      if (reposToFetch.length === 0) {
        const { data: userRepos } = await this.octokit.repos.listForAuthenticatedUser({
          per_page: 10,
          sort: 'updated',
        })
        reposToFetch = userRepos.map((r) => r.full_name)
      }

      for (const repoFullName of reposToFetch) {
        const [owner, repo] = repoFullName.split('/')
        if (!owner || !repo) continue

        console.log(`[GitHub] Fetching from ${repoFullName}...`)

        // Fetch pull requests
        eventsStored += await this.fetchPullRequests(connectionId, owner, repo)

        // Fetch releases
        eventsStored += await this.fetchReleases(connectionId, owner, repo)

        // Fetch workflow runs
        eventsStored += await this.fetchWorkflowRuns(connectionId, owner, repo)

        // Fetch commits
        if (branchesFilter.length > 0) {
          for (const branch of branchesFilter) {
            eventsStored += await this.fetchCommits(connectionId, owner, repo, branch)
          }
        }

        // Fetch container images (if org)
        try {
          eventsStored += await this.fetchContainerImages(connectionId, owner, repoFullName)
        } catch (error) {
          // Not all repos have packages, ignore errors
          console.log(`[GitHub] No container images for ${repoFullName}`)
        }
      }

      return {
        success: true,
        eventsStored,
        details: { message: `Synced ${eventsStored} events from GitHub` },
      }
    } catch (error) {
      return {
        success: false,
        eventsStored: 0,
        details: { error: error.message },
      }
    }
  }

  private async fetchPullRequests(
    connectionId: number,
    owner: string,
    repo: string,
  ): Promise<number> {
    let stored = 0

    try {
      const { data: pullRequests } = await this.octokit.pulls.list({
        owner,
        repo,
        state: 'all',
        sort: 'updated',
        direction: 'desc',
        per_page: 50,
      })

      for (const pr of pullRequests) {
        const externalId = `pr-${owner}/${repo}-${pr.number}`

        // Check if exists
        const existing = await this.prisma.changeEvent.findFirst({
          where: {
            connectionId,
            externalId,
          },
        })

        if (existing) continue

        // Fetch files changed
        let filesChanged: string[] = []
        try {
          const { data: files } = await this.octokit.pulls.listFiles({
            owner,
            repo,
            pull_number: pr.number,
          })
          filesChanged = files.slice(0, 20).map((f) => f.filename)
        } catch (error) {
          // Ignore errors
        }

        // Fetch reviews
        let reviewers: string[] = []
        let approvedCount = 0
        let changesRequestedCount = 0
        try {
          const { data: reviews } = await this.octokit.pulls.listReviews({
            owner,
            repo,
            pull_number: pr.number,
          })
          reviewers = [...new Set(reviews.map((r) => r.user?.login).filter(Boolean) as string[])]
          approvedCount = reviews.filter((r) => r.state === 'APPROVED').length
          changesRequestedCount = reviews.filter((r) => r.state === 'CHANGES_REQUESTED').length
        } catch (error) {
          // Ignore errors
        }

        const event: CreateChangeEventDto = {
          connectionId,
          externalId,
          source: 'github',
          eventType: 'PR',
          title: `[PR] ${pr.title}`,
          description: pr.body || '',
          timestamp: new Date(pr.updated_at),
          url: pr.html_url,
          status: pr.state,
          metadata: {
            repository: `${owner}/${repo}`,
            author: pr.user?.login || 'unknown',
            labels: pr.labels.map((l) => (typeof l === 'string' ? l : l.name)),
            files_changed: filesChanged,
          },
          eventMetadata: {
            pr_number: pr.number,
            merged: pr.merged_at !== null,
            mergeable: (pr as any).mergeable,
            additions: (pr as any).additions || 0,
            deletions: (pr as any).deletions || 0,
            changed_files: (pr as any).changed_files || 0,
            base_branch: pr.base.ref,
            head_branch: pr.head.ref,
            reviewers,
            approved_count: approvedCount,
            changes_requested_count: changesRequestedCount,
            comments: (pr as any).comments || 0,
            review_comments: (pr as any).review_comments || 0,
          },
        }

        await this.prisma.changeEvent.create({
          data: event as any,
        })

        stored++
      }
    } catch (error) {
      console.error(`[GitHub] Error fetching PRs from ${owner}/${repo}:`, error.message)
    }

    return stored
  }

  private async fetchReleases(connectionId: number, owner: string, repo: string): Promise<number> {
    let stored = 0

    try {
      const { data: releases } = await this.octokit.repos.listReleases({
        owner,
        repo,
        per_page: 50,
      })

      for (const release of releases) {
        const externalId = `release-${owner}/${repo}-${release.id}`

        const existing = await this.prisma.changeEvent.findFirst({
          where: {
            connectionId,
            externalId,
          },
        })

        if (existing) continue

        const event: CreateChangeEventDto = {
          connectionId,
          externalId,
          source: 'github',
          eventType: 'Release',
          title: `[Release] ${release.name || release.tag_name}`,
          description: release.body || '',
          timestamp: new Date(release.published_at || release.created_at),
          url: release.html_url,
          status: release.draft ? 'draft' : 'published',
          metadata: {
            repository: `${owner}/${repo}`,
            author: release.author?.login || 'unknown',
            assets: release.assets.map((a) => a.name),
          },
          eventMetadata: {
            tag_name: release.tag_name,
            prerelease: release.prerelease,
            draft: release.draft,
          },
        }

        await this.prisma.changeEvent.create({
          data: event as any,
        })

        stored++
      }
    } catch (error) {
      console.error(`[GitHub] Error fetching releases from ${owner}/${repo}:`, error.message)
    }

    return stored
  }

  private async fetchWorkflowRuns(
    connectionId: number,
    owner: string,
    repo: string,
  ): Promise<number> {
    let stored = 0

    try {
      const { data } = await this.octokit.actions.listWorkflowRunsForRepo({
        owner,
        repo,
        per_page: 50,
      })

      for (const run of data.workflow_runs) {
        const externalId = `workflow-${owner}/${repo}-${run.id}`

        const existing = await this.prisma.changeEvent.findFirst({
          where: {
            connectionId,
            externalId,
          },
        })

        if (existing) continue

        // Calculate duration
        const duration = run.updated_at && run.run_started_at
          ? (new Date(run.updated_at).getTime() - new Date(run.run_started_at).getTime()) / 1000
          : 0

        const event: CreateChangeEventDto = {
          connectionId,
          externalId,
          source: 'github',
          eventType: 'Workflow',
          title: `[Workflow] ${run.name}`,
          description: run.display_title || '',
          timestamp: new Date(run.updated_at),
          url: run.html_url,
          status: run.conclusion || run.status,
          metadata: {
            repository: `${owner}/${repo}`,
            author: run.actor?.login || 'unknown',
          },
          eventMetadata: {
            workflow_id: run.workflow_id,
            run_number: run.run_number,
            event: run.event,
            status: run.status,
            conclusion: run.conclusion,
            branch: run.head_branch,
            commit: run.head_sha,
            duration,
          },
        }

        await this.prisma.changeEvent.create({
          data: event as any,
        })

        stored++
      }
    } catch (error) {
      console.error(`[GitHub] Error fetching workflows from ${owner}/${repo}:`, error.message)
    }

    return stored
  }

  private async fetchCommits(
    connectionId: number,
    owner: string,
    repo: string,
    branch: string,
  ): Promise<number> {
    let stored = 0

    try {
      const { data: commits } = await this.octokit.repos.listCommits({
        owner,
        repo,
        sha: branch,
        per_page: 50,
      })

      for (const commit of commits) {
        const externalId = `commit-${owner}/${repo}-${commit.sha}`

        const existing = await this.prisma.changeEvent.findFirst({
          where: {
            connectionId,
            externalId,
          },
        })

        if (existing) continue

        // Fetch commit details for files changed
        let filesChanged: string[] = []
        try {
          const { data: commitDetail } = await this.octokit.repos.getCommit({
            owner,
            repo,
            ref: commit.sha,
          })
          filesChanged = (commitDetail.files || []).slice(0, 20).map((f) => f.filename)
        } catch (error) {
          // Ignore errors
        }

        const event: CreateChangeEventDto = {
          connectionId,
          externalId,
          source: 'github',
          eventType: 'Commit',
          title: `[Commit] ${commit.commit.message.split('\n')[0]}`,
          description: commit.commit.message,
          timestamp: new Date(commit.commit.author?.date || Date.now()),
          url: commit.html_url,
          status: 'committed',
          metadata: {
            repository: `${owner}/${repo}`,
            author: commit.commit.author?.name || commit.author?.login || 'unknown',
            files_changed: filesChanged,
          },
          eventMetadata: {
            sha: commit.sha,
            branch,
            additions: (commit as any).stats?.additions || 0,
            deletions: (commit as any).stats?.deletions || 0,
          },
        }

        await this.prisma.changeEvent.create({
          data: event as any,
        })

        stored++
      }
    } catch (error) {
      console.error(`[GitHub] Error fetching commits from ${owner}/${repo}:`, error.message)
    }

    return stored
  }

  private async fetchContainerImages(
    connectionId: number,
    orgName: string,
    repoFullName: string,
  ): Promise<number> {
    let stored = 0

    try {
      // GitHub Packages API
      const { data: packages } = await this.octokit.request(
        'GET /orgs/{org}/packages',
        {
          org: orgName,
          package_type: 'container',
          per_page: 10,
        },
      )

      for (const pkg of packages as any[]) {
        // Fetch versions
        const { data: versions } = await this.octokit.request(
          'GET /orgs/{org}/packages/{package_type}/{package_name}/versions',
          {
            org: orgName,
            package_type: 'container',
            package_name: pkg.name,
            per_page: 20,
          },
        )

        for (const version of versions as any[]) {
          const tags = version.metadata?.container?.tags || []
          if (tags.length === 0) continue // Skip untagged

          const externalId = `image-${orgName}-${pkg.name}-${version.id}`

          const existing = await this.prisma.changeEvent.findFirst({
            where: {
              connectionId,
              externalId,
            },
          })

          if (existing) continue

          const event: CreateChangeEventDto = {
            connectionId,
            externalId,
            source: 'github',
            eventType: 'Image',
            title: `[Image] ${pkg.name}:${tags[0]}`,
            description: `Container image published to GitHub Container Registry`,
            timestamp: new Date(version.created_at),
            url: version.html_url || `https://github.com/orgs/${orgName}/packages/container/${pkg.name}`,
            status: 'published',
            metadata: {
              registry: 'ghcr.io',
              author: version.author?.login || 'unknown',
            },
            eventMetadata: {
              image: `ghcr.io/${orgName.toLowerCase()}/${pkg.name}`,
              package_name: pkg.name,
              tags,
              digest: version.name,
              repository: repoFullName,
            },
          }

          await this.prisma.changeEvent.create({
            data: event as any,
          })

          stored++
        }
      }
    } catch (error) {
      // Not all organizations have packages, ignore errors
      console.log(`[GitHub] No packages found for ${orgName}`)
    }

    return stored
  }
}
