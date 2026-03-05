// src/App.tsx
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import './App.css'
import LoginPage from './pages/login'
import CanvasPage from './pages/canvas'
import DashboardPage from './pages/dashboard'
import { fetchProfile } from './lib/auth'
import { APP_TITLE, LOGO_URL } from './lib/brand'

function RequireAuth({ children }: { children: ReactNode }) {
  const [isLoading, setIsLoading] = useState(true)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const location = useLocation()

  useEffect(() => {
    let isMounted = true

    async function verifySession() {
      const profile = await fetchProfile()
      if (!isMounted) return
      setIsAuthenticated(Boolean(profile?.user))
      setIsLoading(false)
    }

    verifySession()

    return () => {
      isMounted = false
    }
  }, [])

  if (isLoading) {
    return (
      <div className='app-shell'>
        <div className='app-card app-card-sm app-center'>
          {LOGO_URL && <img src={LOGO_URL} alt="" className="app-logo" />}
          <h1 className='app-title'>{APP_TITLE}</h1>
          <p className='app-subtitle'>Loading session...</p>
        </div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return <Navigate to='/dashboard' replace state={{ from: location.pathname }} />
  }

  return children
}

function App() {
  useEffect(() => {
    if (LOGO_URL) {
      let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
      if (!link) {
        link = document.createElement('link')
        link.rel = 'icon'
        document.head.appendChild(link)
      }
      link.href = LOGO_URL
    }
  }, [])

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path='/canvas'
          element={
            <RequireAuth>
              <CanvasPage />
            </RequireAuth>
          }
        />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/" element={<DashboardPage />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
