import { Tenant } from '@prisma/client';

export interface AuthUser {
  userId: string;
  email: string;
  tenantId: string;
  role: string;
  sessionId: string;
  tenant: Tenant;
}
