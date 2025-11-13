import Image from 'next/image';
import Link from 'next/link';
import { useSession, signOut } from 'next-auth/react';
import { Button } from '@/components/ui/button';

export default function AppHeader({ title = "CryptoLens" }) {
  const { data: session } = useSession();

  const handleSignOut = async () => {
    try {
      if (typeof window !== 'undefined') {
        localStorage.removeItem('favorites');
        localStorage.removeItem('lastFavoriteTokens');
      }
    } catch (_) { /* noop */ }
    await signOut({ callbackUrl: '/' });
  };

  return (
    <header className="sticky top-0 z-40 w-full border-b border-white/10 bg-black/60 backdrop-blur supports-[backdrop-filter]:bg-black/40">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-14 items-center justify-between">
          {/* Brand / Title */}
          <div className="flex items-center gap-3">
            <Link href="/dashboard" className="flex items-center gap-2" prefetch>
              <Image src="/logo.svg" width={24} height={24} alt="CryptoLens Logo" className="opacity-90" />
              {title ? (
                <span className="text-sm sm:text-base font-semibold tracking-wide text-white">{title}</span>
              ) : null}
            </Link>
            <nav className="hidden md:flex items-center gap-4 text-sm text-zinc-400">
              <Link href="/dashboard" className="hover:text-white transition" prefetch>
                Dashboard
              </Link>
              <Link href="/profile" className="hover:text-white transition" prefetch>
                Profile
              </Link>
            </nav>
          </div>

          {/* Right side: user + sign out */}
          <div className="flex items-center gap-3">
            {session?.user && (
              <div className="flex items-center gap-3">
                {/* Avatar hidden when signed in with Google */}
                <Button onClick={handleSignOut} className="bg-red-600 hover:bg-red-500 text-white">Sign out</Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}