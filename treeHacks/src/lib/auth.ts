const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:8000'

function normalizePath(path: string, fallback: string) {
  if (!path) return fallback
  return path.startsWith('/') ? path : fallback
}

function getBackendPostLoginUrl(nextPath: string) {
  const url = new URL(`${API_BASE}/post-login`)
  url.searchParams.set('next', normalizePath(nextPath, '/canvas'))
  return url.toString()
}

function getBackendPostLogoutUrl(nextPath: string) {
  const url = new URL(`${API_BASE}/post-logout`)
  url.searchParams.set('next', normalizePath(nextPath, '/login'))
  return url.toString()
}

export type AuthProfileResponse = {
  user?: {
    name?: string
    nickname?: string
    email?: string
    sub?: string
    picture?: string
  }
}

export function getApiBaseUrl() {
  return API_BASE
}

export async function fetchProfile() {
  const response = await fetch(`${API_BASE}/profile`, {
    credentials: 'include',
  })

  if (!response.ok) {
    return null
  }

  const data = (await response.json()) as AuthProfileResponse
  return data
}

export function getLoginUrl(nextPath: string, signUp = false) {
  const url = new URL(`${API_BASE}/auth/login`)
  url.searchParams.set('returnTo', getBackendPostLoginUrl(nextPath))

  if (signUp) {
    url.searchParams.set('screen_hint', 'signup')
  }

  return url.toString()
}

export function getLogoutUrl(returnTo: string) {
  const url = new URL(`${API_BASE}/auth/logout`)
  url.searchParams.set('returnTo', getBackendPostLogoutUrl(returnTo))
  return url.toString()
}
