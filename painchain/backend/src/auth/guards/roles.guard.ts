import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { AuthUser } from '../interfaces/auth-user.interface';

/**
 * Roles Guard - Role-Based Authorization
 *
 * This guard:
 * 1. Checks if the route has @Roles() decorator
 * 2. If no roles specified, allows access
 * 3. If roles specified, validates user has at least one required role
 * 4. Throws ForbiddenException if user lacks required role
 *
 * Usage:
 * Applied per-route or per-controller (not globally)
 *
 * Example:
 * @Roles('admin', 'owner')
 * @UseGuards(RolesGuard)
 * @Delete('user/:id')
 * deleteUser() { ... }
 *
 * Available roles: 'owner', 'admin', 'member', 'viewer'
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  /**
   * Validate user has required role
   * @param context - Execution context containing request
   * @returns boolean - True if user has required role
   * @throws ForbiddenException if user lacks required role
   */
  canActivate(context: ExecutionContext): boolean {
    // Get required roles from @Roles() decorator
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(), // Check method-level decorator
      context.getClass(),   // Check controller-level decorator
    ]);

    // If no roles specified, allow access
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user as AuthUser;

    // If no user, should have been blocked by JwtAuthGuard
    if (!user) {
      throw new ForbiddenException('Authentication required');
    }

    // Check if user has at least one of the required roles
    const hasRole = requiredRoles.includes(user.role);

    if (!hasRole) {
      throw new ForbiddenException(
        `Access denied: Required role(s): ${requiredRoles.join(', ')}. Your role: ${user.role}`
      );
    }

    return true;
  }
}
