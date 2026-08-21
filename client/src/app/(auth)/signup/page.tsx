'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabase/client';
import type { UserRole } from '@/hooks/use-session';
import styles from '../auth.module.css';

const ROLES: { value: UserRole; title: string; hint: string }[] = [
  { value: 'CUSTOMER', title: 'Buy products', hint: 'Browse the marketplace and place orders.' },
  { value: 'SELLER', title: 'Sell products', hint: 'Open a store and list your own products.' },
];

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<UserRole>('CUSTOMER');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);

    const { error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { role, full_name: fullName } },
    });

    setBusy(false);

    if (signUpError) {
      setError(signUpError.message);
      return;
    }

    router.push(role === 'SELLER' ? '/seller' : '/');
  }

  return (
    <main className={styles.page}>
      <h1 className={styles.heading}>Create your account</h1>
      <p className={styles.subheading}>
        One account, either side of the marketplace.
      </p>

      <form className={styles.form} onSubmit={handleSubmit}>
        <label className={styles.field}>
          <span className={styles.label}>Full name</span>
          <input
            className={styles.input}
            autoComplete="name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
          />
        </label>

        <label className={styles.field}>
          <span className={styles.label}>Email</span>
          <input
            className={styles.input}
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>

        <label className={styles.field}>
          <span className={styles.label}>Password</span>
          <input
            className={styles.input}
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>

        <fieldset>
          <legend className={styles.rolesLegend}>I want to</legend>
          <div className={styles.roles}>
            {ROLES.map((option) => (
              <label
                key={option.value}
                className={`${styles.role} ${
                  role === option.value ? styles.roleSelected : ''
                }`}
              >
                <input
                  type="radio"
                  name="role"
                  checked={role === option.value}
                  onChange={() => setRole(option.value)}
                />
                <span>
                  <span className={styles.roleTitle}>{option.title}</span>
                  <span className={styles.roleHint}>{option.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}

        <button
          type="submit"
          className={styles.submit}
          disabled={busy || !email || !password || !fullName}
        >
          {busy ? 'Creating…' : 'Create account'}
        </button>
      </form>

      <p className={styles.alt}>
        Already have an account?{' '}
        <Link href="/login" className={styles.altLink}>
          Log in
        </Link>
      </p>
    </main>
  );
}
