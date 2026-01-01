import axios, { AxiosInstance } from 'axios';
import { Integration, PainChainEvent } from './types';

export class BackendClient {
  private client: AxiosInstance;

  constructor(baseURL: string) {
    this.client = axios.create({
      baseURL,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Fetch all Kubernetes integrations from the backend
   */
  async getKubernetesIntegrations(tenantId?: string): Promise<Integration[]> {
    try {
      const headers = tenantId ? { 'x-tenant-id': tenantId } : {};
      const response = await this.client.get<Integration[]>('/integrations', { headers });

      // Filter only Kubernetes integrations
      return response.data.filter((integration) => integration.type === 'kubernetes');
    } catch (error) {
      console.error('Error fetching integrations:', error);
      throw error;
    }
  }

  /**
   * Post an event to the backend
   */
  async postEvent(event: PainChainEvent, tenantId?: string): Promise<void> {
    try {
      const headers = tenantId ? { 'x-tenant-id': tenantId } : {};
      await this.client.post('/events', event, { headers });
    } catch (error: any) {
      // Only log if it's not a duplicate error (409 or 500 with duplicate message)
      if (error.response?.status !== 409 &&
          !(error.response?.status === 500 && error.response?.data?.message?.includes('duplicate'))) {
        console.error('Error posting event:', error.response?.data || error.message);
      }
      // Don't throw - we want to continue watching even if some events fail
    }
  }

  /**
   * Update integration last sync time
   */
  async updateIntegrationSync(integrationId: string, tenantId?: string): Promise<void> {
    try {
      const headers = tenantId ? { 'x-tenant-id': tenantId } : {};
      await this.client.put(
        `/integrations/${integrationId}`,
        { lastSync: new Date() },
        { headers }
      );
    } catch (error) {
      console.error('Error updating integration sync:', error);
      // Don't throw - this is not critical
    }
  }
}
