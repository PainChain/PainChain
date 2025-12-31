import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '../api/client';
import type { Event } from '../types/api';

interface UseEventsParams {
  connector?: string;
  project?: string;
  tags?: string[];
  limit?: number;
  startDate?: Date;
  endDate?: Date;
  autoRefresh?: boolean;
  refreshInterval?: number; // in milliseconds
}

interface UseEventsReturn {
  events: Event[];
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

export function useEvents(params?: UseEventsParams): UseEventsReturn {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchEvents = useCallback(async () => {
    try {
      setError(null);
      const startTime = performance.now();
      const response: any = await apiClient.getTimeline({
        connector: params?.connector,
        project: params?.project,
        tags: params?.tags,
        limit: params?.limit || 50,
        startDate: params?.startDate,
        endDate: params?.endDate,
      });
      const endTime = performance.now();
      console.log(`API Call: ${(endTime - startTime).toFixed(2)}ms - ${response.events?.length || 0} events`);
      setEvents(response.events || []);
    } catch (err) {
      setError(err as Error);
      console.error('Failed to fetch events:', err);
    } finally {
      setLoading(false);
    }
  }, [params?.connector, params?.project, params?.tags, params?.limit, params?.startDate, params?.endDate]);

  useEffect(() => {
    fetchEvents();

    // Set up auto-refresh if enabled
    if (params?.autoRefresh) {
      const interval = setInterval(
        fetchEvents,
        params?.refreshInterval || 30000
      );
      return () => clearInterval(interval);
    }
  }, [fetchEvents, params?.autoRefresh, params?.refreshInterval]);

  return {
    events,
    loading,
    error,
    refetch: fetchEvents,
  };
}
