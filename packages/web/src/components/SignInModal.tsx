/**
 * Single sign-in entry point: one button, one modal holding every option.
 *
 * Built on the native <dialog> so open/closed state, the backdrop, Escape-to-
 * close and the focus trap all come from the platform - no React state, no
 * click-outside handler, no modal library.
 */

import { useRef, useState } from 'react';
import { passwordAuthRequest } from '../api/client';

// Each provider links to its generic OAuth entry point; the API redirects on.
const PROVIDERS: { id: string; label: string }[] = [
  { id: 'google', label: 'Continue with Google' },
  { id: 'facebook', label: 'Continue with Facebook' },
  { id: 'github', label: 'Continue with GitHub' },
];

interface SignInButtonProps {
  /** Override the trigger's classes; defaults to the header's button style. */
  className?: string;
  children?: React.ReactNode;
}

export function SignInButton({ className, children }: SignInButtonProps) {
  const ref = useRef<HTMLDialogElement>(null);

  return (
    <>
      <button
        type="button"
        onClick={() => ref.current?.showModal()}
        className={
          className ??
          'px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800 whitespace-nowrap'
        }
      >
        {children ?? 'Sign in'}
      </button>

      <dialog
        ref={ref}
        // Clicks land on the <dialog> itself only when they hit the backdrop -
        // anything inside the card targets a child.
        onClick={(e) => {
          if (e.target === ref.current) ref.current.close();
        }}
        className="w-80 max-w-[calc(100vw-2rem)] p-0 bg-white rounded-lg border border-gray-200 shadow-xl backdrop:bg-black/40"
      >
        <div className="p-5">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="text-base font-semibold text-gray-900">Sign in</h2>
              <p className="text-xs text-gray-500">or create an account</p>
            </div>
            <button
              type="button"
              onClick={() => ref.current?.close()}
              aria-label="Close"
              className="text-gray-400 hover:text-gray-600 text-lg leading-none"
            >
              ×
            </button>
          </div>

          <div className="space-y-2">
            {PROVIDERS.map((p) => (
              <a
                key={p.id}
                href={`/api/auth/login/${p.id}`}
                className="block w-full px-4 py-2 text-sm font-medium text-center text-white bg-gray-900 rounded-lg hover:bg-gray-800"
              >
                {p.label}
              </a>
            ))}
          </div>

          <p className="my-4 text-center text-xs text-gray-400">or with email</p>

          <EmailAuthForm />
        </div>
      </dialog>
    </>
  );
}

/**
 * Email + password. On success the whole app reloads - auth, org, role and
 * health all have to refetch anyway.
 *
 * No "forgot password" link: there's no mailer yet, so a reset flow can't
 * exist. The OAuth buttons above are the recovery path.
 */
function EmailAuthForm() {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await passwordAuthRequest(mode, email, password);
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="text-left">
      <div className="flex gap-1 mb-3">
        {(['login', 'signup'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => {
              setMode(m);
              setError(null);
            }}
            className={`flex-1 py-1.5 text-xs font-medium rounded ${
              mode === m ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {m === 'login' ? 'Sign in' : 'Create account'}
          </button>
        ))}
      </div>

      <label className="block text-xs text-gray-500 mb-1" htmlFor="auth-email">
        Email
      </label>
      <input
        id="auth-email"
        type="email"
        required
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="w-full mb-3 px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
      />

      <label className="block text-xs text-gray-500 mb-1" htmlFor="auth-password">
        Password
      </label>
      <input
        id="auth-password"
        type="password"
        required
        minLength={8}
        autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      <p className="mt-1 text-[11px] text-gray-400">At least 8 characters.</p>

      {error && (
        <p role="alert" className="mt-2 text-xs text-red-600">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="w-full mt-3 py-2 text-sm text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50"
      >
        {busy ? 'Working…' : mode === 'login' ? 'Sign in' : 'Create account'}
      </button>
    </form>
  );
}
