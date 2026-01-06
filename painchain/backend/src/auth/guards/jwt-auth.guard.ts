import { Injectable, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * JWT Authentication Guard
 *
 * This guard:
 * 1. Checks if the route is marked as @Public()
 * 2. If public, allows access without authentication
 * 3. If not public, validates JWT token via JwtStrategy
 * 4. Attaches user object to request.user on success
 *
 * Applied globally in app.module.ts, so all routes require auth by default
 * unless marked with @Public()
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  /**
   * Determine if the request can proceed
   * @param context - Execution context containing request/response
   * @returns boolean or Promise<boolean>
   */
  canActivate(context: ExecutionContext) {
    // Check if route is marked as public
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(), // Check method-level decorator
      context.getClass(),   // Check controller-level decorator
    ]);

    if (isPublic) {
      // Skip authentication for public routes
      return true;
    }

    // Proceed with JWT authentication via JwtStrategy
    return super.canActivate(context);
  }
}
