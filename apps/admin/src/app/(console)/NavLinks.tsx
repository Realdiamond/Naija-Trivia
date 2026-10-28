'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function NavLinks({ links }: { links: Array<{ href: string; label: string }> }) {
  const pathname = usePathname();
  return (
    <nav className="nav" aria-label="Console">
      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          aria-current={pathname === link.href || pathname.startsWith(`${link.href}/`) ? 'page' : undefined}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
