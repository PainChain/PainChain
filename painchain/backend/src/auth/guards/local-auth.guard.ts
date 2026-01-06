import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Local Authentication Guard
 *
 * This guard uses the LocalStrategy to validate username/password
 * Apply to the login endpoint to authenticate users with basic auth
 *
 * Usage:
 * @Post('login')
 * @UseGuards(LocalAuthGuard)
 * async login(@CurrentUser() user) {
 *   return this.authService.login(user);
 * }
 */
@Injectable()
export class LocalAuthGuard extends AuthGuard('local') {}
