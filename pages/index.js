import { useRouter } from "next/router";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import Head from "next/head";
import Image from "next/image";

export default function Home() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const handleGetStarted = () => {
    if (status === "authenticated") {
      router.push("/dashboard");
    } else {
      router.push("/login");
    }
  };

  return (
    <main className="min-h-screen bg-gradient-to-b from-black via-zinc-900 to-zinc-800 text-white flex flex-col items-center justify-center px-6 py-12">
      <Head>
        <title>CryptoLens — Web3 Dashboard</title>
        <meta name="description" content="Discover and track crypto tokens, manage favorites, and explore Web3 with CryptoLens." />
        <meta name="keywords" content="CryptoLens, crypto dashboard, web3, tokens, price tracking, favorites, blockchain" />
        <link rel="canonical" href="https://cryptolens.casaislabs.com/" />
      </Head>
      <div className="text-center animate-fade-in">
        <div className="inline-flex items-center gap-3 px-4 py-2 rounded-full border border-white/10 bg-white/5 backdrop-blur-sm mb-4">
          <Image src="/logo.svg" width={32} height={32} alt="CryptoLens Logo" className="opacity-90" />
          <span className="text-white font-semibold tracking-wide">CryptoLens</span>
        </div>
        <h1 className="text-6xl leading-[1.15] font-extrabold mb-6 text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 via-cyan-300 to-violet-400 tracking-tight pb-1">
          Welcome to CryptoLens
        </h1>
        <p className="text-lg text-zinc-300 mb-12 text-center max-w-2xl mx-auto">
          Manage your tokens and favorites with ease. Explore the power of Web3 today.
        </p>
        <Button
          onClick={handleGetStarted}
          className="bg-gradient-to-r from-indigo-500 via-cyan-500 to-violet-500 text-white px-12 py-4 text-lg font-semibold rounded-full shadow-lg hover:shadow-2xl hover:from-indigo-400 hover:via-cyan-400 hover:to-violet-400 transition-all animate-slide-up ring-1 ring-white/20"
        >
          Get Started
        </Button>
      </div>
      <div className="mt-16 flex flex-col items-center gap-4 animate-fade-in">
        <p className="text-sm text-zinc-400 max-w-xl text-center">
          Start your journey into the world of Web3 and unlock endless possibilities!
        </p>
      </div>
    </main>
  );
}