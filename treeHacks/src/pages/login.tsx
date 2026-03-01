import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { fetchProfile, getLoginUrl } from '@/lib/auth'

export default function LoginPage() {
  const [redirectUrl, setRedirectUrl] = useState('')
  const location = useLocation()
  const navigate = useNavigate()

  const fromPath = (location.state as { from?: string } | null)?.from ?? '/dashboard'

  useEffect(() => {
    let isMounted = true

    async function checkSession() {
      const profile = await fetchProfile()
      if (!isMounted) return

      if (profile?.user) {
        navigate(fromPath, { replace: true })
        return
      }

      const loginUrl = getLoginUrl(fromPath)
      setRedirectUrl(loginUrl)
      window.location.replace(loginUrl)
    }

    checkSession()

    return () => {
      isMounted = false
    }
  }, [fromPath, navigate])

  return (
    <div className='app-shell'>
      <div className='app-card app-card-sm app-center'>
        <div>
          <h1 className='app-title'>TreeHacks</h1>
          <p className='app-subtitle'>Redirecting to Auth0 login...</p>
        </div>

        <p className='app-note'>
          If you are not redirected,{' '}
          <a
            className='app-link'
            href={redirectUrl || getLoginUrl(fromPath)}
          >
            continue to Auth0
          </a>
          .
        </p>
      </div>
    </div>
  )
}