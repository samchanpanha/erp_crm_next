'use client'

import { useState, type FormEvent } from 'react'
import { motion } from 'framer-motion'
import {
  Boxes,
  ChartColumn,
  CircleAlert,
  Loader2,
  UsersRound,
  Wand2,
} from 'lucide-react'
import { useAuthStore } from '@/lib/auth-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

const DEMO_EMAIL = 'admin@dolinext.com'
const DEMO_PASSWORD = 'demo123'

const FEATURES = [
  {
    icon: UsersRound,
    title: 'CRM & invoicing',
    text: 'From first contact to paid invoices.',
  },
  {
    icon: Boxes,
    title: 'Stock & projects',
    text: 'Warehouses, tasks and timesheets.',
  },
  {
    icon: ChartColumn,
    title: 'Reports & printable documents',
    text: 'KPIs plus PDF-ready quotes and bills.',
  },
] as const

function LogoMark({ size = 'md' }: { size?: 'md' | 'lg' }) {
  return (
    <div
      aria-hidden="true"
      className={
        size === 'lg'
          ? 'flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-foreground font-black text-xl text-primary shadow-lg'
          : 'flex h-10 w-10 items-center justify-center rounded-xl bg-primary font-black text-sm text-primary-foreground shadow-sm'
      }
    >
      DN
    </div>
  )
}

function ErrorAlert({ message }: { message: string }) {
  return (
    <Alert variant="destructive">
      <CircleAlert className="h-4 w-4" aria-hidden="true" />
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  )
}

export default function AuthScreen() {
  const login = useAuthStore((s) => s.login)
  const register = useAuthStore((s) => s.register)

  const [tab, setTab] = useState<'signin' | 'signup'>('signin')

  // Sign in
  const [signinEmail, setSigninEmail] = useState('')
  const [signinPassword, setSigninPassword] = useState('')
  const [signinError, setSigninError] = useState('')
  const [signingIn, setSigningIn] = useState(false)

  // New organization
  const [organization, setOrganization] = useState('')
  const [signupName, setSignupName] = useState('')
  const [signupEmail, setSignupEmail] = useState('')
  const [signupPassword, setSignupPassword] = useState('')
  const [signupError, setSignupError] = useState('')
  const [registering, setRegistering] = useState(false)

  function fillDemo() {
    setTab('signin')
    setSigninError('')
    setSigninEmail(DEMO_EMAIL)
    setSigninPassword(DEMO_PASSWORD)
  }

  async function handleSignIn(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (signingIn) return
    setSigninError('')
    setSigningIn(true)
    const res = await login(signinEmail, signinPassword)
    setSigningIn(false)
    if (!res.ok) setSigninError(res.error ?? 'Sign in failed. Please try again.')
    // on success the store flips to 'authed' and ErpRoot swaps this screen out
  }

  async function handleRegister(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (registering) return
    setSignupError('')
    setRegistering(true)
    const res = await register({ organization, name: signupName, email: signupEmail, password: signupPassword })
    setRegistering(false)
    if (!res.ok) setSignupError(res.error ?? 'Registration failed. Please try again.')
  }

  return (
    <main className="flex min-h-screen bg-background">
      {/* ------------------------- Brand panel (desktop) ------------------------- */}
      <motion.aside
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className="relative hidden shrink-0 flex-col justify-between overflow-hidden bg-primary p-10 text-primary-foreground lg:flex lg:w-[44%] xl:w-[46%]"
      >
        {/* Decorative CSS-only pattern */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-[0.14]"
          style={{
            backgroundImage: 'radial-gradient(currentColor 1px, transparent 1px)',
            backgroundSize: '22px 22px',
          }}
        />
        <div aria-hidden="true" className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-primary-foreground/10 blur-3xl" />
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-32 -left-16 h-80 w-80 rounded-full bg-primary-foreground/10 blur-3xl" />

        <div className="relative">
          <div className="flex items-center gap-4">
            <LogoMark size="lg" />
            <div>
              <p className="text-2xl font-bold tracking-tight">DoliNext</p>
              <p className="text-sm text-primary-foreground/80">ERP &amp; CRM</p>
            </div>
          </div>
          <p className="mt-6 max-w-sm text-lg font-medium leading-relaxed text-primary-foreground/95">
            The open ERP &amp; CRM, rebuilt for the web.
          </p>
        </div>

        <div className="relative space-y-8">
          <ul className="space-y-5">
            {FEATURES.map((f) => (
              <li key={f.title} className="flex items-start gap-3.5">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-primary-foreground/25 bg-primary-foreground/15">
                  <f.icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <span>
                  <span className="block text-sm font-semibold">{f.title}</span>
                  <span className="block text-sm text-primary-foreground/75">{f.text}</span>
                </span>
              </li>
            ))}
          </ul>

          <div className="rounded-xl border border-primary-foreground/30 bg-primary-foreground/10 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-primary-foreground/70">
                  Demo account
                </p>
                <p className="mt-1 font-mono text-sm">{DEMO_EMAIL}</p>
                <p className="font-mono text-sm text-primary-foreground/80">{DEMO_PASSWORD}</p>
              </div>
              <Button
                type="button"
                size="sm"
                onClick={fillDemo}
                className="h-11 gap-1.5 border border-primary-foreground/40 bg-transparent px-4 text-primary-foreground shadow-none hover:bg-primary-foreground/20"
                aria-label="Fill the sign-in form with the demo account"
              >
                <Wand2 className="h-4 w-4" aria-hidden="true" />
                Fill
              </Button>
            </div>
          </div>
        </div>
      </motion.aside>

      {/* ------------------------------ Form panel ------------------------------ */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-1 items-center justify-center px-4 py-10 sm:px-8">
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="w-full max-w-md"
          >
            {/* Compact brand for mobile / tablet */}
            <div className="mb-8 flex items-center gap-3 lg:hidden">
              <LogoMark />
              <div className="leading-tight">
                <p className="text-lg font-bold tracking-tight">DoliNext</p>
                <p className="text-xs text-muted-foreground">The open ERP &amp; CRM, rebuilt for the web</p>
              </div>
            </div>

            <Tabs
              value={tab}
              onValueChange={(v) => {
                setTab(v as 'signin' | 'signup')
                setSigninError('')
                setSignupError('')
              }}
            >
              <TabsList className="grid h-11 w-full grid-cols-2">
                <TabsTrigger value="signin">Sign in</TabsTrigger>
                <TabsTrigger value="signup">New organization</TabsTrigger>
              </TabsList>

              {/* ------------------------------ Sign in ------------------------------ */}
              <TabsContent value="signin" className="mt-6">
                <form onSubmit={handleSignIn} className="space-y-4" noValidate>
                  {signinError ? <ErrorAlert message={signinError} /> : null}

                  <div className="space-y-2">
                    <Label htmlFor="signin-email">Email</Label>
                    <Input
                      id="signin-email"
                      type="email"
                      autoComplete="email"
                      placeholder="you@company.com"
                      value={signinEmail}
                      onChange={(e) => setSigninEmail(e.target.value)}
                      required
                      aria-invalid={signinError ? true : undefined}
                      className="h-11"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="signin-password">Password</Label>
                    <Input
                      id="signin-password"
                      type="password"
                      autoComplete="current-password"
                      placeholder="••••••••"
                      value={signinPassword}
                      onChange={(e) => setSigninPassword(e.target.value)}
                      required
                      aria-invalid={signinError ? true : undefined}
                      className="h-11"
                    />
                  </div>

                  <Button type="submit" disabled={signingIn} className="h-11 w-full" aria-busy={signingIn}>
                    {signingIn ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                    {signingIn ? 'Signing in…' : 'Sign in'}
                  </Button>

                  {/* Demo hint (mobile — brand panel is hidden below lg) */}
                  <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/50 px-3 py-2.5 lg:hidden">
                    <p className="text-xs leading-snug text-muted-foreground">
                      Demo: <span className="font-mono">{DEMO_EMAIL}</span> /{' '}
                      <span className="font-mono">{DEMO_PASSWORD}</span>
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={fillDemo}
                      className="h-11 shrink-0 gap-1.5 px-3"
                      aria-label="Fill the sign-in form with the demo account"
                    >
                      <Wand2 className="h-4 w-4" aria-hidden="true" />
                      Fill
                    </Button>
                  </div>
                </form>
              </TabsContent>

              {/* --------------------------- New organization --------------------------- */}
              <TabsContent value="signup" className="mt-6">
                <form onSubmit={handleRegister} className="space-y-4" noValidate>
                  {signupError ? <ErrorAlert message={signupError} /> : null}

                  <div className="space-y-2">
                    <Label htmlFor="signup-organization">Organization name</Label>
                    <Input
                      id="signup-organization"
                      autoComplete="organization"
                      placeholder="Acme Corp"
                      value={organization}
                      onChange={(e) => setOrganization(e.target.value)}
                      required
                      aria-invalid={signupError ? true : undefined}
                      className="h-11"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="signup-name">Your name</Label>
                    <Input
                      id="signup-name"
                      autoComplete="name"
                      placeholder="Jane Doe"
                      value={signupName}
                      onChange={(e) => setSignupName(e.target.value)}
                      required
                      aria-invalid={signupError ? true : undefined}
                      className="h-11"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="signup-email">Email</Label>
                    <Input
                      id="signup-email"
                      type="email"
                      autoComplete="email"
                      placeholder="you@company.com"
                      value={signupEmail}
                      onChange={(e) => setSignupEmail(e.target.value)}
                      required
                      aria-invalid={signupError ? true : undefined}
                      className="h-11"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="signup-password">Password</Label>
                    <Input
                      id="signup-password"
                      type="password"
                      autoComplete="new-password"
                      placeholder="••••••••"
                      value={signupPassword}
                      onChange={(e) => setSignupPassword(e.target.value)}
                      required
                      minLength={8}
                      aria-invalid={signupError ? true : undefined}
                      aria-describedby="signup-password-hint"
                      className="h-11"
                    />
                    <p id="signup-password-hint" className="text-xs text-muted-foreground">
                      At least 8 characters. You become this organization&apos;s Administrator.
                    </p>
                  </div>

                  <Button type="submit" disabled={registering} className="h-11 w-full" aria-busy={registering}>
                    {registering ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                    {registering ? 'Creating…' : 'Create organization'}
                  </Button>
                </form>
              </TabsContent>
            </Tabs>
          </motion.div>
        </div>

        <footer className="px-4 pb-6 text-center text-xs text-muted-foreground sm:px-8">
          DoliNext — an open rebuild of the Dolibarr feature set
        </footer>
      </div>
    </main>
  )
}
