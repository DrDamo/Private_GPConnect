import { useApi } from './useApi'

export interface Health {
  status: 'ok' | 'degraded'
  version: string
  commit: string | null
  store: 'memory' | 'postgres'
  database: 'ok' | 'unavailable'
}

export const useApiHealth = () => useApi<Health>('/api/health')
