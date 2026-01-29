import { useState, useCallback } from 'react';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

interface UseApiReturn<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  execute: (...args: any[]) => Promise<T | null>;
  reset: () => void;
}

export function useApi<T>(
  endpoint: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET'
): UseApiReturn<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const execute = useCallback(async (body?: any, pathParams?: string): Promise<T | null> => {
    setLoading(true);
    setError(null);

    try {
      const url = pathParams 
        ? `${API_BASE_URL}${endpoint}/${pathParams}`
        : `${API_BASE_URL}${endpoint}`;

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
      });

      const result: ApiResponse<T> = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Request failed');
      }

      setData(result as unknown as T);
      return result as unknown as T;
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : 'Unknown error';
      setError(errorMessage);
      return null;
    } finally {
      setLoading(false);
    }
  }, [endpoint, method]);

  const reset = useCallback(() => {
    setData(null);
    setError(null);
    setLoading(false);
  }, []);

  return { data, loading, error, execute, reset };
}

// Convenience hooks for common API calls
export function useCreateTask() {
  return useApi<{ taskId: number; message: string }>('/tasks', 'POST');
}

export function useTasks() {
  return useApi<{ tasks: any[]; count: number; pendingApprovals: number }>('/tasks', 'GET');
}

export function useTask(taskId: number) {
  return useApi<{ task: any }>(`/tasks/${taskId}`, 'GET');
}

export function useApproveTask(taskId: number) {
  return useApi<{ message: string }>(`/tasks/${taskId}/approve`, 'POST');
}

export function useCancelTask(taskId: number) {
  return useApi<{ message: string }>(`/tasks/${taskId}/cancel`, 'POST');
}

export function useAgentStatus() {
  return useApi<{ stats: any; agents: any[] }>('/agents/status', 'GET');
}
