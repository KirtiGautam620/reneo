'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabase/client';
import type { UserRole } from '@/hooks/use-session';

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<UserRole>('CUSTOMER');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit() {
    setError(null);
    setBusy(true);

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { role, full_name: fullName },
      },
    });

    setBusy(false);

    if (error) {
      setError(error.message);
      return;
    }

    router.push(role === 'SELLER' ? '/seller' : '/');
  }

  return (
    <main>
      <h1>Create account</h1>

      <label>
        Full name
        <input value={fullName} onChange={(e) => setFullName(e.target.value)} />
      </label>

      <label>
        Email
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>

      <label>
        Password
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>

      <fieldset>
        <legend>I want to</legend>
        <label>
          <input
            type="radio"
            checked={role === 'CUSTOMER'}
            onChange={() => setRole('CUSTOMER')}
          />
          Buy products
        </label>
        <label>
          <input
            type="radio"
            checked={role === 'SELLER'}
            onChange={() => setRole('SELLER')}
          />
          Sell products
        </label>
      </fieldset>

      {error && <p role="alert">{error}</p>}

      <button onClick={handleSubmit} disabled={busy || !email || !password}>
        {busy ? 'Creating…' : 'Create account'}
      </button>

      <p>
        Already have an account? <Link href="/login">Log in</Link>
      </p>
    </main>
  );
}