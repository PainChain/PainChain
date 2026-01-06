import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './auth/auth.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { EventsModule } from './events/events.module';
import { ApiModule } from './api/api.module';
import { TeamsModule } from './teams/teams.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { TenantGuard } from './auth/guards/tenant.guard';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    DatabaseModule,
    AuthModule,          // Authentication module
    IntegrationsModule,
    EventsModule,
    ApiModule,
    TeamsModule,
  ],
  providers: [
    // Global guards (applied to ALL routes unless @Public())
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,  // First: Authentication
    },
    {
      provide: APP_GUARD,
      useClass: TenantGuard,   // Second: Tenant validation
    },
  ],
})
export class AppModule {}
