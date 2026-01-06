import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthUser } from '../interfaces/auth-user.interface';

/**
 * Decorator to extract the current authenticated user from the request
 *
 * Usage:
 * @Get('profile')
 * getProfile(@CurrentUser() user: AuthUser) {
 *   return user;
 * }
 *
 * @Get('email')
 * getEmail(@CurrentUser('email') email: string) {
 *   return email;
 * }
 */
export const CurrentUser = createParamDecorator(
  (data: keyof AuthUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user as AuthUser;

    // If a specific property is requested, return that property
    return data ? user?.[data] : user;
  },
);
