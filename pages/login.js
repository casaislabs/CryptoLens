import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/router";
import { signIn, signOut, useSession } from "next-auth/react";
import { useAccount, useChainId, useSignMessage } from 'wagmi';
import dynamic from 'next/dynamic';
import { createLogger } from '@/lib/logger';
const log = createLogger('client:login');

// Client-only wrapper for ConnectButton.Custom to avoid SSR import of RainbowKit
const ConnectButtonCustom = dynamic(async () => {
  const mod = await import('@rainbow-me/rainbowkit');
  const C = mod.ConnectButton;
  function CustomWrapper({ children }) {
    return <C.Custom>{children}</C.Custom>;
  }
  CustomWrapper.displayName = 'ConnectButtonCustom';
  return CustomWrapper;
}, { ssr: false });
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Wallet } from "lucide-react";
import { toast } from "sonner";
import { parseApiError, getFriendlyErrorMessage } from '@/lib/apiErrors';
import Head from "next/head";
import Image from "next/image";

export default function LoginPage() {
  const router = useRouter();
  const { error: queryError } = router.query;

  const { data: session, status } = useSession();

  const [loading, setLoading] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [walletSigning, setWalletSigning] = useState(false);
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { signMessageAsync } = useSignMessage();

  // Consistent and accessible style for toasts (without changing UI/sonner)
  const toastDarkStyle = useMemo(() => ({ backgroundColor: "#111", color: "#fff" }), []);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 640);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  useEffect(() => {
    if (status === "authenticated") {
      router.replace("/dashboard");
    }
  }, [status, router]);

  useEffect(() => {
    if (queryError) {
      toast.error("An unexpected error occurred", {
        description: "Please try again later.",
        style: toastDarkStyle,
      });
    }
  }, [queryError, toastDarkStyle]);

  const handleGoogleLogin = async () => {
    setLoading(true);
    try {
      // Clear any previous session cookies to avoid desynchronized secrets
      await signOut({ redirect: false });
      // Let NextAuth handle the full OAuth redirect flow
      await signIn("google", { callbackUrl: "/dashboard" });
    } catch (err) {
      log.error('Error during Google authentication', { error: err });
      toast.error("Unexpected error", {
        description: "Please try again later.",
        style: toastDarkStyle,
      });
    } finally {
      setLoading(false);
    }
  };

  function buildSiweMessage({ domain, address, statement, uri, version, chainId, nonce, issuedAt, expiresAt }) {
    const header = `${domain} wants you to sign in with your Ethereum account:`;
    const uriLine = `\n\nURI: ${uri}`;
    const verLine = `\nVersion: ${version || '1'}`;
    const chainLine = `\nChain ID: ${chainId}`;
    const nonceLine = `\nNonce: ${nonce}`;
    const issuedLine = issuedAt ? `\nIssued At: ${issuedAt}` : '';
    const expLine = expiresAt ? `\nExpiration Time: ${expiresAt}` : '';
    const stmt = statement ? `\n${statement}` : '';
    return `${header}\n${address}${stmt}${uriLine}${verLine}${chainLine}${nonceLine}${issuedLine}${expLine}`;
  }

  // Detect whether the user explicitly rejected the signature request (EIP-1193)
  const isUserRejectedError = (err) => {
    const code = err?.code ?? err?.cause?.code;
    if (code === 4001) return true; // EIP-1193 User rejected request
    const name = err?.name ?? err?.cause?.name;
    if (name && /UserRejected|UserRejectedRequestError|Rejected Request|Cancel|Cancelled|Canceled/i.test(name)) return true;
    const msg = String(err?.shortMessage ?? err?.message ?? '');
    return /rejected|denied|user denied|user rejected|cancelled|canceled/i.test(msg);
  };

  const requestChallenge = async (method) => {
    const res = await fetch('/api/wallet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'challenge', method }),
      credentials: 'include',
    });
    if (!res.ok) {
      try {
        const errInfo = await parseApiError(res);
        const err = new Error(errInfo.message || getFriendlyErrorMessage(errInfo.code, 'Challenge failed'));
        err.code = errInfo.code || res.status;
        err.info = errInfo;
        throw err;
      } catch (_) {
        const txt = await res.text();
        throw new Error(`Challenge failed: ${res.status} ${txt}`);
      }
    }
    return res.json();
  };

  const linkAfterLogin = async () => {
    try {
      // Link wallet using session (no second signature)
      const linkRes = await fetch('/api/wallet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action: 'link', method: 'session' }),
      });
      if (!linkRes.ok) {
        const errInfo = await parseApiError(linkRes);
        // If wallet is already linked to another account, proceed without linking
        if (errInfo.code === 'WALLET_TAKEN' || linkRes.status === 409) {
          // Silent success: keep session and continue to dashboard
          return true;
        }
        toast.error(getFriendlyErrorMessage(errInfo.code, 'Could not link wallet'), {
          description: errInfo.message?.slice(0, 200),
          style: toastDarkStyle,
        });
        return false;
      }
      return true;
    } catch (e) {
      toast.error('Could not link wallet', { description: e?.message?.slice(0, 200) || 'Try again later.', style: toastDarkStyle });
      return false;
    }
  };

  const handleWalletLogin = async () => {
    if (walletSigning) return; // Guard against re-entry
    setWalletSigning(true);
    try {
      if (!isConnected) {
        toast.error('Connect your wallet first', { style: toastDarkStyle });
        return;
      }
      if (!address || !chainId) {
        toast.error('Missing address or chainId', { style: toastDarkStyle });
        return;
      }

      // Try SIWE first
      const chall = await requestChallenge('siwe');
      const message = buildSiweMessage({
        domain: chall.domain,
        address,
        statement: chall.siwe?.statement || 'Sign to sign in',
        uri: chall.siwe?.uri || (typeof window !== 'undefined' ? window.location.origin : ''),
        version: chall.siwe?.version || '1',
        chainId,
        nonce: chall.nonce,
        issuedAt: chall.issuedAt,
        expiresAt: chall.expiresAt,
      });

      const signature = await signMessageAsync({ message });
      const res = await signIn('ethereum', {
        redirect: false,
        method: 'siwe',
        siweMessage: message,
        signature,
      });
      if (res?.ok) {
        try {
          const linked = await linkAfterLogin();
          if (linked) {
            router.replace('/dashboard');
          }
          return;
        } catch (e) {
          log.error('Post-login link failed', { error: e });
          toast.error('Could not link wallet', { description: e.message?.slice(0,200) || 'Try again later.', style: toastDarkStyle });
          await signOut({ redirect: false });
          return;
        }
      }
      throw new Error(res?.error || 'Sign-in failed');
    } catch (err) {
      if (isUserRejectedError(err)) {
        log.info('User rejected signature (SIWE)');
        toast.info('Signature rejected', { description: 'No session started.', style: toastDarkStyle });
        return;
      }
      log.warn('SIWE failed, trying personal_sign', { error: err });
      try {
        const chall2 = await requestChallenge('personal_sign');
        const signature2 = await signMessageAsync({ message: chall2.message });
        const res2 = await signIn('ethereum', {
          redirect: false,
          method: 'personal_sign',
          signature: signature2,
        });
        if (res2?.ok) {
          try {
            const linked2 = await linkAfterLogin();
            if (linked2) {
              router.replace('/dashboard');
            }
            return;
          } catch (e2) {
            log.error('Post-login link failed', { error: e2 });
            toast.error('Could not link wallet', { description: e2.message?.slice(0,200) || 'Try again later.', style: toastDarkStyle });
            await signOut({ redirect: false });
            return;
          }
        }
        throw new Error(res2?.error || 'Sign-in failed');
      } catch (err2) {
        if (isUserRejectedError(err2)) {
          log.info('User rejected signature (personal_sign)');
          toast.info('Signature rejected', { description: 'No session started.', style: toastDarkStyle });
          return;
        }
        log.error('Wallet sign-in failed', { error: err2 });
        toast.error('Failed to sign in with wallet', {
          description: err2?.message?.slice(0, 200) || 'Try again or use Google.',
          style: toastDarkStyle,
        });
      }
    } finally {
      setWalletSigning(false);
    }
  };

  const LoginForm = () => (
    <div className="space-y-6 animate-fade-in">
      <Button
        onClick={handleGoogleLogin}
        className="w-full bg-gradient-to-r from-indigo-500 via-cyan-500 to-violet-500 text-white px-5 py-3 text-base font-semibold rounded-xl shadow-lg hover:shadow-2xl hover:from-indigo-400 hover:via-cyan-400 hover:to-violet-400 transition-all ring-1 ring-white/20"
        disabled={loading}
      >
        {loading ? "Loading..." : (
          <>
            <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-white text-black text-[11px] font-bold">G</span>
            Continue with Google
          </>
        )}
      </Button>

      <ConnectButtonCustom>
        {({ openConnectModal, account, chain, mounted, authenticationStatus }) => {
          const ready = mounted && authenticationStatus !== 'loading';
          const connected = ready && account && chain;
          return (
            <Button
              onClick={() => {
                if (walletSigning) return; // extra guard
                if (!connected) openConnectModal(); else handleWalletLogin();
              }}
              className="w-full bg-white/5 hover:bg-white/10 text-white border-white/20 ring-1 ring-white/10"
              variant="outline"
              disabled={!ready || walletSigning}
            >
              <Wallet className="mr-2 h-4 w-4" />
              {walletSigning ? 'Signing…' : (!connected ? 'Connect Wallet' : 'Sign-In with Wallet')}
            </Button>
          );
        }}
      </ConnectButtonCustom>
    </div>
  );

  return (
    <main className="min-h-screen bg-gradient-to-b from-black via-zinc-900 to-zinc-800 text-white flex items-center justify-center px-6 py-24 relative overflow-hidden">
      <Head>
        <title>CryptoLens — Sign In</title>
        <meta name="description" content="Sign in to CryptoLens to sync your favorites and personalize your dashboard." />
        <link rel="canonical" href="https://cryptolens.casaislabs.com/login" />
      </Head>
      {status === "loading" ? (
        <div className="text-center text-white p-10">Checking session...</div>
      ) : (
        !isMobile ? (
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl p-6 shadow-2xl animate-fade-in">
            <div className="inline-flex items-center gap-3 px-4 py-2 rounded-full border border-white/10 bg-white/5 backdrop-blur-sm mb-4">
              <Image src="/logo.svg" width={24} height={24} alt="CryptoLens Logo" className="opacity-90" />
              <span className="text-white font-semibold tracking-wide">CryptoLens</span>
            </div>
            <h2 className="text-3xl font-bold text-center text-white">Sign In</h2>
            <p className="text-sm text-zinc-400 text-center">Access your dashboard</p>
            <Separator className="my-6 bg-white/10" />
            {LoginForm()}
            <p className="text-xs text-zinc-400 text-center mt-4">Continue with Google · Sign-In with Wallet</p>
          </div>
        ) : (
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline" size="lg">Sign In</Button>
            </SheetTrigger>
            <SheetContent
              side="bottom"
              className="bg-black/80 backdrop-blur-xl border-t border-white/10 rounded-t-2xl p-6 animate-slide-up"
            >
              <div className="inline-flex items-center gap-3 px-3 py-2 rounded-full border border-white/10 bg-white/5 backdrop-blur-sm mb-3">
                <Image src="/logo.svg" width={20} height={20} alt="CryptoLens Logo" className="opacity-90" />
                <span className="text-white text-sm font-semibold tracking-wide">CryptoLens</span>
              </div>
              <SheetHeader>
                <SheetTitle className="text-white text-xl font-bold">Sign In</SheetTitle>
                <SheetDescription className="text-zinc-400">
                  Access your dashboard
                </SheetDescription>
              </SheetHeader>
              {LoginForm()}
              <SheetFooter className="pt-4 text-center text-xs text-zinc-400" />
            </SheetContent>
          </Sheet>
        )
      )}
    </main>
  );
}