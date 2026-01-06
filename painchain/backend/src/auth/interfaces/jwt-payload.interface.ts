export interface JwtPayload {
  userId: string;
  email: string;
  tenantId: string;
  role: string;
  sessionId: string; // jti claim for session revocation
}
