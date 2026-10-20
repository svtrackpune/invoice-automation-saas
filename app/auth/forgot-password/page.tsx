'use client';

import Link from 'next/link';
import { useState } from 'react';
import { supabase } from '@/lib/supabase';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function submit() {
    const normalizedEmail = email.trim().toLowerCase();
    setError('');
    setNotice('');
    if (!normalizedEmail) {
      setError('Enter the email address for your account.');
      return;
    }

    setBusy(true);
    try {
      const result = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
        // Root route handles Supabase's recovery session/hash using the existing client.
        redirectTo: window.location.origin + '/',
      });
      if (result.error) {
        setError(result.error.message);
        return;
      }
      setNotice('If an account exists for that email address, a password reset link will be sent. Check your inbox and spam folder.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The password reset email could not be requested.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-[radial-gradient(circle_at_top_left,#ede9fe,transparent_34%),linear-gradient(135deg,#fafafa,#f5f3ff)] p-5">
      <section className="w-full max-w-lg rounded-3xl border border-white bg-white p-8 shadow-2xl">
        <p className="text-sm font-bold tracking-widest text-violet-600">MONEYMATTERS</p>
        <h1 className="mt-3 text-2xl font-semibold">Forgot password?</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">Enter your account email. We will send a secure password-reset link to your inbox.</p>
        <label className="mt-6 block">
          <span className="mb-1.5 block text-xs font-semibold text-slate-600">Email address</span>
          <input
            required
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@company.com"
            className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
          />
        </label>
        {error && <p role="alert" className="mt-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
        {notice && <p role="status" className="mt-4 rounded-xl border border-sky-100 bg-sky-50 p-3 text-sm text-sky-800">{notice}</p>}
        <button type="button" disabled={busy} onClick={submit} className="mt-6 w-full rounded-xl bg-violet-600 px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">
          {busy ? 'Sending…' : 'Send password reset link'}
        </button>
        <Link href="/" className="mt-5 inline-block text-sm font-semibold text-violet-700 hover:text-violet-900">Back to sign in</Link>
      </section>
    </main>
  );
}
