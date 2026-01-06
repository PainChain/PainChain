import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { AuthUser } from '../interfaces/auth-user.interface';

/**
 * Tenant Guard - Critical for Multi-Tenancy Security
 *
 * This guard:
 * 1. Skips validation for public routes
 * 2. Validates x-tenant-id header matches authenticated user's tenant
 * 3. Prevents cross-tenant data access
 * 4. Injects validatedTenantId into request for controllers
 *
 * Applied globally in app.module.ts after JwtAuthGuard
 *
 * Security Note:
 * This guard ensures users cannot access other tenants' data by
 * modifying the x-tenant-id header. The tenantId is always enforced
 * to match the authenticated user's tenant.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  /**
   * Validate tenant access for authenticated requests
   * @param context - Execution context containing request
   * @returns boolean - True if tenant is valid
   * @throws ForbiddenException if tenant mismatch
   */
  canActivate(context: ExecutionContext): boolean {
    // Check if route is marked as public
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      // Skip tenant validation for public routes
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user as AuthUser;

    // If no user, JwtAuthGuard should have already blocked this
    // But we'll handle it gracefully here
    if (!user) {
      return true; // Let JwtAuthGuard handle authentication
    }

    const tenantIdHeader = request.headers['x-tenant-id'];

    // If x-tenant-id header is provided, validate it matches user's tenant
    if (tenantIdHeader && tenantIdHeader !== user.tenantId) {
      throw new ForbiddenException(
        `Access denied: x-tenant-id header (${tenantIdHeader}) does not match your tenant (${user.tenantId})`
      );
    }

    // Inject validated tenant ID into request
    // Controllers can use this instead of the header
    request.validatedTenantId = user.tenantId;

    return true;
  }
}
