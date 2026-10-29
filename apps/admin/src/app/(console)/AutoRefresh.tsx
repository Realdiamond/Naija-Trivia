'use client';
/** Reloads the page's server data every few seconds (the Overview's tiles, doc 18 §5). */
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export function AutoRefresh({ seconds }: { seconds: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), seconds * 1000);
    return () => clearInterval(timer);
  }, [router, seconds]);
  return null;
}
