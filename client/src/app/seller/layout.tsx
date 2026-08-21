'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from '@/hooks/use-session';

export default function SellerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, role, isLoading } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;
    if (!user) router.replace('/login');
    else if (role !== 'SELLER') router.replace('/');
  }, [user, role, isLoading, router]);

  if (isLoading) return <p>Loading…</p>;
  if (!user || role !== 'SELLER') return null;

  return <>{children}</>;
}