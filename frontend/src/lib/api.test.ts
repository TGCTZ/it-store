import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api, clearTokens, hasSession, login, saveTokens } from './api'

const storage = new Map<string, string>()
const localStorageMock = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => { storage.set(key, value) },
  removeItem: (key: string) => { storage.delete(key) },
}

beforeEach(() => {
  storage.clear()
  vi.unstubAllGlobals()
  vi.stubGlobal('localStorage', localStorageMock)
})

describe('API session', () => {
  it('saves a token pair after Superadmin sign-in', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      access: 'access-1', refresh: 'refresh-1',
      user: { id: 1, name: 'Superadmin', email: 'admin@example.test', is_active: true },
    }), { status: 200 })))
    const user = await login('admin@example.test', 'password123')
    expect(user.name).toBe('Superadmin')
    expect(hasSession()).toBe(true)
  })

  it('rotates the refresh token and retries once after an expired access token', async () => {
    saveTokens('old-access', 'old-refresh')
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ access: 'new-access', refresh: 'new-refresh' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ count: 2, next: null, previous: null, results: [] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const data = await api<{ count: number }>('/assets/')
    expect(data.count).toBe(2)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(storage.get('itstore_refresh')).toBe('new-refresh')
    clearTokens()
    expect(hasSession()).toBe(false)
  })
})
