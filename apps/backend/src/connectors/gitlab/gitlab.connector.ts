import { Injectable } from '@nestjs/common'
import { Gitlab } from '@gitbeaker/rest'
import { PrismaService } from '../../database/prisma.service'
import { BaseConnector } from '../base.connector'
import { SyncResult, CreateChangeEventDto } from '@painchain/types'

interface GitLabConfig {
  token: string
  repos?: string
  branches?: string
  pollInterval?: number
  tags?: string
}

@Injectable()
export class GitlabConnector extends BaseConnector {
  private gitlab: InstanceType<typeof Gitlab>
  protected gitlabConfig: GitLabConfig

  constructor(config: Record<string, any>, private prisma: PrismaService) {
    super(config)
    this.gitlabConfig = config as GitLabConfig

    // Initialize GitLab client
    this.gitlab = new Gitlab({
      token: this.gitlabConfig.token,
    })
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.gitlab.Users.showCurrentUser()
      return true
    } catch (error) {
      return false
    }
  }

  async sync(connectionId: number): Promise<SyncResult> {
    try {
      let eventsStored = 0

      // Parse project IDs/paths
      const projects = this.gitlabConfig.repos
        ? this.gitlabConfig.repos.split(',').map((r) => r.trim()).filter(Boolean)
        : []

      // Parse branches filter
      const branchesFilter = this.gitlabConfig.branches
        ? this.gitlabConfig.branches.split(',').map((b) => b.trim()).filter(Boolean)
        : []

      // If no specific projects, fetch from user's projects
      let projectsToFetch: string[] = projects
      if (projectsToFetch.length === 0) {
        const userProjects = await this.gitlab.Projects.all({
          membership: true,
          perPage: 10,
          orderBy: 'last_activity_at',
          sort: 'desc',
        } as any)
        projectsToFetch = userProjects.map((p: any) => p.id.toString())
      }

      for (const projectId of projectsToFetch) {
        console.log(`[GitLab] Fetching from project ${projectId}...`)

        // Fetch merge requests
        eventsStored += await this.fetchMergeRequests(connectionId, projectId)

        // Fetch pipelines
        eventsStored += await this.fetchPipelines(connectionId, projectId)

        // Fetch commits
        if (branchesFilter.length > 0) {
          for (const branch of branchesFilter) {
            eventsStored += await this.fetchCommits(connectionId, projectId, branch)
          }
        }

        // Fetch releases
        eventsStored += await this.fetchReleases(connectionId, projectId)

        // Fetch container registry images
        try {
          eventsStored += await this.fetchContainerImages(connectionId, projectId)
        } catch (error) {
          console.log(`[GitLab] No container registry for project ${projectId}`)
        }
      }

      return {
        success: true,
        eventsStored,
        details: { message: `Synced ${eventsStored} events from GitLab` },
      }
    } catch (error) {
      return {
        success: false,
        eventsStored: 0,
        details: { error: error.message },
      }
    }
  }

  private async fetchMergeRequests(
    connectionId: number,
    projectId: string,
  ): Promise<number> {
    let stored = 0

    try {
      const mergeRequests = await this.gitlab.MergeRequests.all({
        projectId,
        orderBy: 'updated_at',
        sort: 'desc',
        perPage: 50,
      } as any)

      for (const mr of mergeRequests) {
        const externalId = `mr-${projectId}-${mr.iid}`

        const existing = await this.prisma.changeEvent.findFirst({
          where: {
            connectionId,
            externalId,
          },
        })

        if (existing) continue

        // Fetch MR details
        const changes = await this.gitlab.MergeRequests.showChanges(projectId, mr.iid)
        const filesChanged = (changes as any).changes?.slice(0, 20).map((c: any) => c.new_path) || []

        // Fetch approvals
        let approvedBy: string[] = []
        let approvalsCount = 0
        try {
          const approvals = await this.gitlab.MergeRequestApprovals.showApprovalState(projectId, mr.iid)
          approvedBy = (approvals as any).approved_by?.map((a: any) => a.user?.username).filter(Boolean) || []
          approvalsCount = approvedBy.length
        } catch (error) {
          // Approvals might not be available
        }

        const event: CreateChangeEventDto = {
          connectionId,
          externalId,
          source: 'gitlab',
          eventType: 'MR',
          title: `[MR] ${mr.title}`,
          description: (mr.description as string) || '',
          timestamp: new Date((mr as any).updated_at || (mr as any).updatedAt),
          url: (mr as any).web_url || (mr as any).webUrl,
          status: (mr as any).state,
          metadata: {
            project_id: projectId,
            author: mr.author?.username || 'unknown',
            labels: mr.labels || [],
            files_changed: filesChanged,
          },
          eventMetadata: {
            mr_iid: mr.iid,
            merged: mr.merged_at !== null,
            source_branch: mr.source_branch,
            target_branch: mr.target_branch,
            approved_by: approvedBy,
            approvals_count: approvalsCount,
            upvotes: mr.upvotes || 0,
            downvotes: mr.downvotes || 0,
            user_notes_count: mr.user_notes_count || 0,
          },
        }

        await this.prisma.changeEvent.create({
          data: event as any,
        })

        stored++
      }
    } catch (error) {
      console.error(`[GitLab] Error fetching MRs from project ${projectId}:`, error.message)
    }

    return stored
  }

  private async fetchPipelines(connectionId: number, projectId: string): Promise<number> {
    let stored = 0

    try {
      const pipelines = await this.gitlab.Pipelines.all(projectId, {
        orderBy: 'updated_at',
        sort: 'desc',
        perPage: 50,
      })

      for (const pipeline of pipelines) {
        const externalId = `pipeline-${projectId}-${pipeline.id}`

        const existing = await this.prisma.changeEvent.findFirst({
          where: {
            connectionId,
            externalId,
          },
        })

        if (existing) continue

        // Calculate duration
        const duration = pipeline.duration || 0

        // Fetch failed jobs if pipeline failed
        let failedJobs: string[] = []
        let failedJobsCount = 0
        if (pipeline.status === 'failed') {
          try {
            const jobs = await this.gitlab.Jobs.all(projectId, { pipelineId: pipeline.id })
            failedJobs = jobs
              .filter((j: any) => j.status === 'failed')
              .map((j: any) => j.name)
              .slice(0, 10)
            failedJobsCount = failedJobs.length
          } catch (error) {
            // Ignore errors
          }
        }

        const event: CreateChangeEventDto = {
          connectionId,
          externalId,
          source: 'gitlab',
          eventType: 'Pipeline',
          title: `[Pipeline] ${pipeline.ref}`,
          description: `Pipeline ${pipeline.status}`,
          timestamp: new Date((pipeline as any).updated_at || (pipeline as any).updatedAt),
          url: (pipeline as any).web_url || (pipeline as any).webUrl,
          status: (pipeline as any).status,
          metadata: {
            project_id: projectId,
            author: ((pipeline as any).user || (pipeline as any).triggeredBy)?.username || 'unknown',
          },
          eventMetadata: {
            pipeline_id: pipeline.id,
            ref: pipeline.ref,
            sha: pipeline.sha,
            source: pipeline.source || 'unknown',
            status: pipeline.status,
            duration,
            failed_jobs_count: failedJobsCount,
            failed_jobs_detail: failedJobs,
          },
        }

        await this.prisma.changeEvent.create({
          data: event as any,
        })

        stored++
      }
    } catch (error) {
      console.error(`[GitLab] Error fetching pipelines from project ${projectId}:`, error.message)
    }

    return stored
  }

  private async fetchCommits(
    connectionId: number,
    projectId: string,
    branch: string,
  ): Promise<number> {
    let stored = 0

    try {
      const commits = await this.gitlab.Commits.all(projectId, {
        refName: branch,
        perPage: 50,
      })

      for (const commit of commits) {
        const externalId = `commit-${projectId}-${commit.id}`

        const existing = await this.prisma.changeEvent.findFirst({
          where: {
            connectionId,
            externalId,
          },
        })

        if (existing) continue

        // Fetch commit details for stats
        const commitDetail = await this.gitlab.Commits.show(projectId, commit.id)

        const event: CreateChangeEventDto = {
          connectionId,
          externalId,
          source: 'gitlab',
          eventType: 'Commit',
          title: `[Commit] ${commit.title}`,
          description: commit.message as string,
          timestamp: new Date((commit as any).created_at || (commit as any).createdAt),
          url: (commit as any).web_url || (commit as any).webUrl,
          status: 'committed',
          metadata: {
            project_id: projectId,
            author: commit.author_name || 'unknown',
          },
          eventMetadata: {
            sha: commit.id,
            short_id: commit.short_id,
            branch,
            stats: commitDetail.stats || {},
          },
        }

        await this.prisma.changeEvent.create({
          data: event as any,
        })

        stored++
      }
    } catch (error) {
      console.error(`[GitLab] Error fetching commits from project ${projectId}:`, error.message)
    }

    return stored
  }

  private async fetchReleases(connectionId: number, projectId: string): Promise<number> {
    let stored = 0

    try {
      const releases = await (this.gitlab as any).ProjectReleases.all(projectId, {
        perPage: 50,
      })

      for (const release of releases) {
        const externalId = `release-${projectId}-${release.tag_name}`

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
          source: 'gitlab',
          eventType: 'Release',
          title: `[Release] ${release.name || release.tag_name}`,
          description: release.description || '',
          timestamp: new Date(release.released_at || release.created_at),
          url: release._links?.self || '',
          status: 'published',
          metadata: {
            project_id: projectId,
            author: release.author?.username || 'unknown',
            assets: (release.assets?.links || []).map((a: any) => a.name),
          },
          eventMetadata: {
            tag_name: release.tag_name,
            upcoming_release: release.upcoming_release || false,
          },
        }

        await this.prisma.changeEvent.create({
          data: event as any,
        })

        stored++
      }
    } catch (error) {
      console.error(`[GitLab] Error fetching releases from project ${projectId}:`, error.message)
    }

    return stored
  }

  private async fetchContainerImages(connectionId: number, projectId: string): Promise<number> {
    let stored = 0

    try {
      const repositories = await (this.gitlab.ContainerRegistry as any).allRepositories({ projectId })

      for (const repo of repositories) {
        const tags = await this.gitlab.ContainerRegistry.allTags(projectId, repo.id, {
          perPage: 20,
        })

        for (const tag of tags) {
          const externalId = `image-${projectId}-${repo.id}-${tag.name}`

          const existing = await this.prisma.changeEvent.findFirst({
            where: {
              connectionId,
              externalId,
            },
          })

          if (existing) continue

          const tagAny = tag as any

          const event: CreateChangeEventDto = {
            connectionId,
            externalId,
            source: 'gitlab',
            eventType: 'Image',
            title: `[Image] ${repo.path}:${tag.name}`,
            description: `Container image published to GitLab Container Registry`,
            timestamp: new Date(tagAny.created_at || tagAny.createdAt || Date.now()),
            url: (tagAny.location as string) || (repo.location as string),
            status: 'published',
            metadata: {
              registry: 'gitlab',
              author: 'unknown',
            },
            eventMetadata: {
              image: repo.path,
              repository_id: repo.id,
              tag_name: tag.name,
              digest: tagAny.digest || '',
              revision: tagAny.revision || '',
              total_size: tagAny.total_size || tagAny.totalSize || 0,
              location: tagAny.location || repo.location,
            },
          }

          await this.prisma.changeEvent.create({
            data: event as any,
          })

          stored++
        }
      }
    } catch (error) {
      console.log(`[GitLab] No container registry for project ${projectId}`)
    }

    return stored
  }
}
