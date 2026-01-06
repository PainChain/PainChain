import { SetMetadata } from '@nestjs/common';

/**
 * Metadata key for marking routes as public (skip authentication)
 */
export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Decorator to mark a route as public (skip authentication)
 *
 * Usage:
 * @Public()
 * @Get('health')
 * healthCheck() {
 *   return { status: 'ok' };
 * }
 *
 * Can be applied to entire controllers:
 * @Public()
 * @Controller('public')
 * export class PublicController { ... }
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
