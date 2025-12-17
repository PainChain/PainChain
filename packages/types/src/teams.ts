/**
 * Team and team connection types
 */

export interface Team {
  id: number
  name: string
  description: string | null
  createdAt: Date
  updatedAt: Date
}

export interface TeamConnection {
  id: number
  teamId: number
  connectionId: number
}

export interface CreateTeamDto {
  name: string
  description?: string
}

export interface UpdateTeamDto {
  name?: string
  description?: string
}
