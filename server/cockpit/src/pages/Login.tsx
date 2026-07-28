import * as React from 'react'

export default function Login() {
  React.useEffect(() => {
    window.location.href = '/auth/login?redirect=/backoffice/'
  }, [])
  return (
    <div className="flex items-center justify-center h-screen text-sm text-muted-foreground">
      Redirecting to sign in…
    </div>
  )
}
