import { useSession, signOut } from "next-auth/react";
import { useRouter } from "next/router";

export default function AuthButtons() {
  const { data: session } = useSession();
  const router = useRouter();

  // If the user is logged in
  if (session) {
    return (
      <div className="flex items-center gap-4">
        <p className="text-white">Welcome, {session.user.name}</p>
        <button
          onClick={() => signOut({ callbackUrl: "/" })}  // Redirect to home after signing out
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
