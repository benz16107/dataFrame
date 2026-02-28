import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { fetchProfile, getLoginUrl } from '@/lib/auth'

export default function LoginPage() {
  const [redirectUrl, setRedirectUrl] = useState('')
  const location = useLocation()
  const navigate = useNavigate()

  const fromPath = (location.state as { from?: string } | null)?.from ?? '/canvas'

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
    <div className='min-h-screen flex items-center justify-center p-6 bg-slate-950'>
      <div className='w-full max-w-md border border-slate-800 rounded-2xl bg-slate-900 p-8 flex flex-col gap-4'>
        <div className='text-center'>
          <h1 className='text-3xl font-bold text-white'>TreeHacks</h1>
          <p className='text-slate-400 text-sm mt-2'>Redirecting to Auth0 login...</p>
        </div>

        <p className='text-xs text-slate-400 text-center'>
          If you are not redirected,{' '}
          <a
            className='text-slate-200 underline'
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