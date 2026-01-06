export class AuthResponseDto {
  access_token: string;
  user: {
    id: string;
    email: string;
    tenantId: string;
    role: string;
    displayName?: string;
    firstName?: string;
    lastName?: string;
    avatarUrl?: string;
  };
}

export class AuthMethodsDto {
  basicAuth: boolean;
  allowRegistration: boolean;
  oidcProviders: {
    id: string;
    name: string;
    iconUrl?: string;
    displayOrder: number;
  }[];
}
