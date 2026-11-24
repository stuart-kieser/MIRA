import { ArrowLeft, ArrowRight, CheckCircle2, Eye, EyeOff, LoaderCircle, LockKeyhole, Mail } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { authClient } from '../auth-client'
import { Brand } from './Brand'
import { SplatArtwork } from './SplatArtwork'

type AuthMode = 'login' | 'register' | 'forgot' | 'reset'

const copy: Record<AuthMode, { eyebrow: string; title: string; description: string }> = {
  login: { eyebrow: 'WELCOME BACK', title: 'Sign in to Mira.', description: 'Manage your scans, check progress, and explore finished scenes.' },
  register: { eyebrow: 'YOUR FIRST SCAN IS FREE', title: 'Create your Mira account.', description: 'Reconstruct objects and scenes in 3D from phone video.' },
  forgot: { eyebrow: 'ACCOUNT RECOVERY', title: 'Reset your password.', description: 'Enter your account email and we will send a secure reset link.' },
  reset: { eyebrow: 'CHOOSE A NEW PASSWORD', title: 'Secure your account.', description: 'Use at least 10 characters and avoid a password you use elsewhere.' },
}

function PasswordInput({ value, onChange, label = 'Password', autoComplete = 'current-password' }: { value: string; onChange: (value: string) => void; label?: string; autoComplete?: string }) {
  const [visible, setVisible] = useState(false)
  return <label className="auth-field"><span>{label}</span><div><LockKeyhole size={17} /><input required minLength={10} type={visible ? 'text' : 'password'} value={value} onChange={(event) => onChange(event.target.value)} autoComplete={autoComplete} /><button type="button" aria-label={visible ? 'Hide password' : 'Show password'} onClick={() => setVisible((current) => !current)}>{visible ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></label>
}

export function AuthPage({ mode }: { mode: AuthMode }) {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const session = authClient.useSession()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [accepted, setAccepted] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [complete, setComplete] = useState(false)
  const returnTo = searchParams.get('returnTo') === '/admin' ? '/admin' : '/app'

  if (!session.isPending && session.data && (mode === 'login' || mode === 'register')) return <Navigate to={returnTo} replace />

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    if ((mode === 'register' || mode === 'reset') && password !== confirmPassword) {
      setError('The passwords do not match.')
      return
    }
    if (mode === 'register' && !accepted) {
      setError('Please accept the terms to create an account.')
      return
    }
    setPending(true)
    try {
      if (mode === 'login') {
        const result = await authClient.signIn.email({ email, password, rememberMe: true })
        if (result.error) throw new Error(result.error.message)
        navigate(returnTo, { replace: true })
      } else if (mode === 'register') {
        const result = await authClient.signUp.email({ name, email, password, callbackURL: returnTo })
        if (result.error) throw new Error(result.error.message)
        navigate(returnTo, { replace: true })
      } else if (mode === 'forgot') {
        const result = await authClient.requestPasswordReset({ email, redirectTo: `${window.location.origin}/reset-password` })
        if (result.error) throw new Error(result.error.message)
        setComplete(true)
      } else {
        const token = searchParams.get('token')
        if (!token) throw new Error('This reset link is missing its security token. Request a new link.')
        const result = await authClient.resetPassword({ newPassword: password, token })
        if (result.error) throw new Error(result.error.message)
        setComplete(true)
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Something went wrong. Try again.')
    } finally {
      setPending(false)
    }
  }

  const content = copy[mode]
  return (
    <div className="auth-page">
      <aside className="auth-aside">
        <Link to="/"><Brand /></Link>
        <SplatArtwork />
      </aside>
      <main className="auth-main">
        <div className="auth-panel">
          <Link className="auth-back" to={mode === 'login' || mode === 'register' ? '/' : '/login'}><ArrowLeft size={15} /> Back</Link>
          <span className="auth-eyebrow">{content.eyebrow}</span>
          <h1>{content.title}</h1>
          <p className="auth-description">{content.description}</p>

          {complete ? (
            <div className="auth-success"><CheckCircle2 size={28} /><h2>{mode === 'forgot' ? 'Check your inbox' : 'Password updated'}</h2><p>{mode === 'forgot' ? `If an account exists for ${email}, its reset link is on the way.` : 'You can now sign in with your new password.'}</p><Link to="/login">Return to sign in <ArrowRight size={15} /></Link></div>
          ) : (
            <form className="auth-form" onSubmit={submit}>
              {mode === 'register' && <label className="auth-field"><span>Full name</span><div><input required value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" placeholder="Stuart Kieser" /></div></label>}
              {mode !== 'reset' && <label className="auth-field"><span>Email address</span><div><Mail size={17} /><input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" placeholder="you@example.com" /></div></label>}
              {(mode === 'login' || mode === 'register' || mode === 'reset') && <PasswordInput value={password} onChange={setPassword} label={mode === 'reset' ? 'New password' : 'Password'} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />}
              {(mode === 'register' || mode === 'reset') && <PasswordInput value={confirmPassword} onChange={setConfirmPassword} label="Confirm password" autoComplete="new-password" />}
              {mode === 'login' && <div className="auth-form-links"><label><input type="checkbox" defaultChecked /> Remember me</label><Link to="/forgot-password">Forgot password?</Link></div>}
              {mode === 'register' && <label className="terms-check"><input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} /><span>I agree to Mira’s Terms of Service and Privacy Policy.</span></label>}
              {error && <div className="auth-error" role="alert">{error}</div>}
              <button className="auth-submit" disabled={pending}>{pending ? <LoaderCircle className="spin" size={18} /> : null}{mode === 'login' ? 'Sign in' : mode === 'register' ? 'Create account' : mode === 'forgot' ? 'Send reset link' : 'Update password'}{!pending && <ArrowRight size={16} />}</button>
            </form>
          )}

          {!complete && (mode === 'login' || mode === 'register') && <p className="auth-switch">{mode === 'login' ? 'New to Mira?' : 'Already have an account?'} <Link to={mode === 'login' ? '/register' : '/login'}>{mode === 'login' ? 'Create an account' : 'Sign in'}</Link></p>}
        </div>
      </main>
    </div>
  )
}
