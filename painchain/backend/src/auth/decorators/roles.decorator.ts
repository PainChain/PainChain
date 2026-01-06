import { SetMetadata } from '@nestjs/common';

/**
 * Metadata key for role-based authorization
 */
export const ROLES_KEY = 'roles';

/**
 * Decorator to restrict access to specific roles
 *
 * Usage:
 * @Roles('admin', 'owner')
 * @Delete('user/:id')
 * deleteUser(@Param('id') id: string) {
 *   // Only admins and owners can access this
 * }
 *
 * Available roles: 'owner', 'admin', 'member', 'viewer'
 */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
