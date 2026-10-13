import { useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  emailSchema,
  loginSchema,
  passwordSchema,
  type LoginResult,
  type RefreshResult,
} from '@sakthimaan/shared';
import { Field, Spinner } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiError, authCall, errorMessage } from '@/lib/api';
import { BrandMark, useBranding } from '@/lib/branding';
import { applySession } from '@/lib/session';

function AuthCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const brand = useBranding().data;
  return (
    <div className="bg-muted/40 grid min-h-svh place-items-center p-4">
      <div className="bg-card w-full max-w-sm rounded-2xl border p-6 shadow-sm sm:p-8">
        <div className="mb-6 flex items-center gap-2">
          <BrandMark logoUrl={brand?.logoUrl} size={36} />
          <span className="font-semibold">{brand?.storeName ?? 'Store admin'}</span>
        </div>
        <h1 className="text-xl font-semibold">{title}</h1>
        {description ? <p className="text-muted-foreground mt-1 text-sm">{description}</p> : null}
        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}

function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="border-destructive/30 bg-destructive/5 text-destructive rounded-lg border px-3 py-2 text-sm"
    >
      {message}
    </p>
  );
}

// ------------------------------------------------------------------ login

type LoginForm = z.input<typeof loginSchema>;

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/';
  const [error, setError] = useState<string | null>(null);
  const [challenge, setChallenge] = useState<string | null>(null);
  const form = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const finish = (session: RefreshResult) => {
    applySession(session);
    navigate(from, { replace: true });
  };

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      const result = await authCall<LoginResult>('/auth/login', values);
      if (result.twoFactorRequired) setChallenge(result.challengeToken);
      else finish(result);
    } catch (err) {
      setError(errorMessage(err));
      if (err instanceof ApiError && err.code === 'INVALID_CREDENTIALS') form.setValue('password', '');
    }
  });

  if (challenge)
    return <TwoFactorStep challengeToken={challenge} onDone={finish} onCancel={() => setChallenge(null)} />;

  const { errors, isSubmitting } = form.formState;
  return (
    <AuthCard title="Sign in" description="Use your staff account.">
      <form onSubmit={(e) => void onSubmit(e)} noValidate className="grid gap-4">
        <FormError message={error} />
        <Field label="Email" htmlFor="email" error={errors.email?.message}>
          <Input
            id="email"
            type="email"
            autoComplete="username"
            inputMode="email"
            autoFocus
            aria-invalid={!!errors.email}
            {...form.register('email')}
          />
        </Field>
        <Field label="Password" htmlFor="password" error={errors.password?.message}>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            aria-invalid={!!errors.password}
            {...form.register('password')}
          />
        </Field>
        <Button type="submit" size="lg" disabled={isSubmitting}>
          {isSubmitting ? <Spinner /> : null}
          Sign in
        </Button>
        <Link
          to="/forgot-password"
          className="text-muted-foreground hover:text-foreground text-center text-sm underline-offset-4 hover:underline"
        >
          Forgot password?
        </Link>
      </form>
    </AuthCard>
  );
}

function TwoFactorStep({
  challengeToken,
  onDone,
  onCancel,
}: {
  challengeToken: string;
  onDone: (s: RefreshResult) => void;
  onCancel: () => void;
}) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <AuthCard title="Verification code" description="Enter the code from your authenticator or message.">
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          authCall<LoginResult>('/auth/2fa/verify', { challengeToken, code })
            .then((r) => {
              if (!r.twoFactorRequired) onDone(r);
            })
            .catch((err: unknown) => setError(errorMessage(err)))
            .finally(() => setBusy(false));
        }}
      >
        <FormError message={error} />
        <Field label="Code" htmlFor="code">
          <Input
            id="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 8))}
          />
        </Field>
        <Button type="submit" disabled={busy || code.length < 4}>
          {busy ? <Spinner /> : null}
          Verify
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Back
        </Button>
      </form>
    </AuthCard>
  );
}

// ------------------------------------------------------------------ forgot / reset

export function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<{ email: string }>({
    resolver: zodResolver(z.object({ email: emailSchema })),
    defaultValues: { email: '' },
  });
  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await authCall('/auth/forgot-password', values);
      setSent(true);
    } catch (err) {
      setError(errorMessage(err));
    }
  });
  return (
    <AuthCard title="Reset your password" description="We'll email you a link to set a new password.">
      {sent ? (
        <div className="grid gap-4">
          <p className="text-sm" role="status">
            If that email belongs to an active account, a reset link is on its way. It expires in 30 minutes.
          </p>
          <Button asChild variant="outline">
            <Link to="/login">Back to sign in</Link>
          </Button>
        </div>
      ) : (
        <form onSubmit={(e) => void onSubmit(e)} noValidate className="grid gap-4">
          <FormError message={error} />
          <Field label="Email" htmlFor="email" error={form.formState.errors.email?.message}>
            <Input id="email" type="email" autoComplete="email" autoFocus {...form.register('email')} />
          </Field>
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? <Spinner /> : null}
            Send reset link
          </Button>
          <Link to="/login" className="text-muted-foreground text-center text-sm hover:underline">
            Back to sign in
          </Link>
        </form>
      )}
    </AuthCard>
  );
}

const resetForm = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Passwords do not match' });

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<z.input<typeof resetForm>>({
    resolver: zodResolver(resetForm),
    defaultValues: { password: '', confirm: '' },
  });
  const onSubmit = form.handleSubmit(async ({ password }) => {
    setError(null);
    try {
      await authCall('/auth/reset-password', { token, password });
      navigate('/login', { replace: true, state: { reset: true } });
    } catch (err) {
      setError(errorMessage(err));
    }
  });
  const { errors, isSubmitting } = form.formState;
  return (
    <AuthCard title="Choose a new password" description="At least 10 characters, with a letter and a number.">
      <form onSubmit={(e) => void onSubmit(e)} noValidate className="grid gap-4">
        <FormError message={token ? error : 'This reset link is incomplete. Request a new one.'} />
        <Field label="New password" htmlFor="password" error={errors.password?.message}>
          <Input id="password" type="password" autoComplete="new-password" {...form.register('password')} />
        </Field>
        <Field label="Confirm password" htmlFor="confirm" error={errors.confirm?.message}>
          <Input id="confirm" type="password" autoComplete="new-password" {...form.register('confirm')} />
        </Field>
        <Button type="submit" disabled={isSubmitting || !token}>
          {isSubmitting ? <Spinner /> : null}
          Set password
        </Button>
      </form>
    </AuthCard>
  );
}
