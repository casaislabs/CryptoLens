import { useSession, signOut } from "next-auth/react";
import { useRouter } from "next/router";

export default function AuthButtons() {
  const { data: session } = useSession();
  const router = useRouter();

  const handleSignOut = async () => {
    try {
      if (typeof window !== 'undefined') {
        localStorage.removeItem('favorites');
        localStorage.removeItem('lastFavoriteTokens');
      }
    } catch (_) { /* noop */ }
    await signOut({ callbackUrl: "/" });
  };

  // If the user is logged in
  if (session) {
    return (
      <div className="flex items-center gap-4">
        <p className="text-white">Welcome, {session.user.name}</p>
        <button
          onClick={handleSignOut}
          className="text-red-400 underline hover:text-red-300 transition"
        >
          Sign out
        </button>
      </div>
    );
  }

  // If the user is not logged in
  return (
    <button
      onClick={() => router.push("/login")}
      className="text-blue-400 underline hover:text-blue-300 transition"
    >
      Sign in
    </button>
  );
}
