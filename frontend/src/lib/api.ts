import type { User } from './types'

const API_BASE = import.meta.env.VITE_API_URL || '/api/v1'
const ACCESS_KEY = 'itstore_access'
const REFRESH_KEY = 'itstore_refresh'

export class ApiError extends Error {
  constructor(public status: number, public details: unknown) {
    super(errorMessage(details))
  }
}

export function errorMessage(details: unknown): string {
  if (typeof details === 'string') return details
  if (!details || typeof details !== 'object') return 'Something went wrong.'
  const record = details as Record<string, unknown>
  return Object.values(record).map((value) => Array.isArray(value) ? value.join(', ') : String(value)).join(' ')
}

export function saveTokens(access: string, refresh: string) {
  sessionStorage.setItem(ACCESS_KEY, access)
  sessionStorage.setItem(REFRESH_KEY, refresh)
}

export function clearTokens() {
  sessionStorage.removeItem(ACCESS_KEY)
  sessionStorage.removeItem(REFRESH_KEY)
}

function expireSession() {
  clearTokens()
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('itstore:session-expired'))
}

export function hasSession() {
  return Boolean(sessionStorage.getItem(REFRESH_KEY))
}

let refreshInFlight: Promise<string | null> | null = null

async function refreshAccess(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight
  refreshInFlight = (async () => {
    const refresh = sessionStorage.getItem(REFRESH_KEY)
    if (!refresh) return null
    try {
      const response = await fetch(`${API_BASE}/auth/refresh/`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh }),
      })
      if (!response.ok) throw new Error('Session expired')
      const data = await response.json() as { access: string; refresh?: string }
      saveTokens(data.access, data.refresh || refresh)
      return data.access
    } catch {
      expireSession()
      return null
    } finally {
      refreshInFlight = null
    }
  })()
  return refreshInFlight
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const send = (token: string | null) => fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  })
  let response = await send(sessionStorage.getItem(ACCESS_KEY))
  if (response.status === 401 && !path.startsWith('/auth/')) {
    const newAccess = await refreshAccess()
    if (newAccess) response = await send(newAccess)
    else expireSession()
  }
  if (response.status === 204) return undefined as T
  const data: unknown = await response.json().catch(() => ({}))
  if (!response.ok) throw new ApiError(response.status, data)
  return data as T
}

export async function login(email: string, password: string): Promise<User> {
  const response = await api<{ access: string; refresh: string; user: User }>('/auth/login/', {
    method: 'POST', body: JSON.stringify({ email, password }),
  })
  saveTokens(response.access, response.refresh)
  return response.user
}

export async function logout() {
  const refresh = sessionStorage.getItem(REFRESH_KEY)
  try {
    await api('/auth/logout/', { method: 'POST', body: JSON.stringify({ refresh }) })
  } finally {
    clearTokens()
  }
}
