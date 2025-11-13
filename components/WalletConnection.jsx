import dynamic from 'next/dynamic';
import { useAccount, useDisconnect, useChainId, useSignMessage } from 'wagmi';
import { useSession } from 'next-auth/react';
import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Wallet, Link, Unlink, CheckCircle } from 'lucide-react';
import { toast } from 'sonner';
import { parseApiError, getFriendlyErrorMessage, formatValidationDetails } from '@/lib/apiErrors';
import Image from 'next/image';
import { createLogger } from '@/lib/logger';
const log = createLogger('client:wallet');

// Client-only RainbowKit ConnectButton.Custom wrapper
const ConnectButtonCustom = dynamic(async () => {
  const mod = await import('@rainbow-me/rainbowkit');
  const C = mod.ConnectButton;
  function CustomWrapper({ children }) {
    return <C.Custom>{children}</C.Custom>;
  }
  CustomWrapper.displayName = 'ConnectButtonCustom';
  return CustomWrapper;
}, { ssr: false });

export default function WalletConnection({ onWalletLinked }) {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { signMessageAsync } = useSignMessage();
  const { disconnect } = useDisconnect();
  const { data: session } = useSession();
  const [isLinking, setIsLinking] = useState(false);
  const [isLinked, setIsLinked] = useState(false);
  const [linkedAddress, setLinkedAddress] = useState(null);
  const [isChecking, setIsChecking] = useState(false);

  const toastDarkStyle = useMemo(() => ({ backgroundColor: '#111', color: '#fff' }), []);
  const CHECK_COOLDOWN_MS = 1500;
  const checkCooldownRef = useRef(0);
  const checkInFlightRef = useRef(false);

  const checkWalletLink = useCallback(async (immediate = false) => {
    if (!session?.user?.id) return null;

    const now = Date.now();
    if (!immediate) {
      if (checkInFlightRef.current) return null;
      if (now - checkCooldownRef.current < CHECK_COOLDOWN_MS) return null;
    }
    checkInFlightRef.current = true;
    setIsChecking(true);

    try {
      const response = await fetch('/api/wallet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'check' }),
      });
      if (response.ok) {
        const data = await response.json();
        setIsLinked(data.isLinked);
        setLinkedAddress(data.walletAddress);
        return data;
      } else {
        const errInfo = await parseApiError(response);
        toast.error(getFriendlyErrorMessage(errInfo.code, 'Could not verify wallet'), {
          description: errInfo.message || formatValidationDetails(errInfo.details) || 'Try again later.',
          style: toastDarkStyle,
        });
        return null;
      }
    } catch (error) {
      log.error('Error checking wallet link', { error });
      return null;
    } finally {
      checkInFlightRef.current = false;
      checkCooldownRef.current = now;
      setIsChecking(false);
    }
  }, [session?.user?.id, toastDarkStyle]);

  // Avoid extra checks while linking; refresh once after link/unlink completes
  useEffect(() => {
    // Verify only when session exists and not linking
    if (session?.user?.id && !isLinking) {
      checkWalletLink(false);
    }
  }, [session?.user?.id, isLinking, checkWalletLink]);

  function buildSiweMessage({ domain, address, statement, uri, version, chainId, nonce, issuedAt, expiresAt }) {
    const header = `${domain} wants you to sign in with your Ethereum account:`;
    const addr = address;
    const stmt = statement ? `\n${statement}` : '';
    const uriLine = `\n\nURI: ${uri}`;
    const verLine = `\nVersion: ${version || '1'}`;
    const chainLine = `\nChain ID: ${chainId}`;
    const nonceLine = `\nNonce: ${nonce}`;
    const issuedLine = issuedAt ? `\nIssued At: ${issuedAt}` : '';
    const expLine = expiresAt ? `\nExpiration Time: ${expiresAt}` : '';
    return `${header}\n${addr}${stmt}${uriLine}${verLine}${chainLine}${nonceLine}${issuedLine}${expLine}`;
  }

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
      const txt = await res.text();
      throw new Error(`Challenge failed: ${res.status} ${txt}`);
    }
    return res.json();
  };

  const linkWithSiwe = async () => {
    try {
      const chall = await requestChallenge('siwe');
      const domain = chall.domain;
      const nonce = chall.nonce;
      const issuedAt = chall.issuedAt;
      const expiresAt = chall.expiresAt;
      const uri = chall.siwe?.uri || (typeof window !== 'undefined' ? window.location.origin : '');
      const statement = chall.siwe?.statement || 'Sign to link your wallet to your account';
      if (!address) throw new Error('No wallet address');
      if (!chainId) throw new Error('No chainId');

      const message = buildSiweMessage({
        domain,
        address,
        statement,
        uri,
        version: chall.siwe?.version || '1',
        chainId,
        nonce,
        issuedAt,
        expiresAt,
      });

      const signature = await signMessageAsync({ message });

      const linkRes = await fetch('/api/wallet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action: 'link', method: 'siwe', siweMessage: message, signature }),
      });
      if (!linkRes.ok) {
        const errInfo = await parseApiError(linkRes);
        return { ok: false, code: errInfo.code || linkRes.status, message: errInfo.message };
      }
      const json = await linkRes.json();
      return { ok: true, data: json };
    } catch (err) {
      if (isUserRejectedError(err)) {
        return { ok: false, code: 'SIGNATURE_REJECTED', message: 'User rejected the signature' };
      }
      return { ok: false, code: 'LINK_FAILED', message: err?.shortMessage || err?.message || 'Failed to link wallet' };
    }
  };

  const linkWithPersonalSign = async () => {
    try {
      const chall = await requestChallenge('personal_sign');
      const message = chall.message;
      if (!message) throw new Error('No challenge message');
      const signature = await signMessageAsync({ message });

      const linkRes = await fetch('/api/wallet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action: 'link', method: 'personal_sign', signature }),
      });
      if (!linkRes.ok) {
        const errInfo = await parseApiError(linkRes);
        return { ok: false, code: errInfo.code || linkRes.status, message: errInfo.message };
      }
      const json = await linkRes.json();
      return { ok: true, data: json };
    } catch (err) {
      if (isUserRejectedError(err)) {
        return { ok: false, code: 'SIGNATURE_REJECTED', message: 'User rejected the signature' };
      }
      return { ok: false, code: 'LINK_FAILED', message: err?.shortMessage || err?.message || 'Failed to link wallet' };
    }
  };

  const linkWallet = async () => {
    if (!address || !session?.user?.id) {
      toast.error('Sign in and connect your wallet first', { style: toastDarkStyle });
      return;
    }
    setIsLinking(true);
    try {
      const status = await checkWalletLink(true);
      if (status?.isLinked) {
        toast.info('This wallet is already linked to your account', { style: toastDarkStyle });
        return;
      }

      const r1 = await linkWithSiwe();
      if (!r1.ok) {
        if (r1.code === 'WALLET_TAKEN' || r1.code === 409) {
          toast.error('This wallet is already linked to another account', { style: toastDarkStyle });
          return;
        }
        if (r1.code === 'SIGNATURE_REJECTED') {
          toast.info('Signature rejected', { description: 'Wallet was not linked.', style: toastDarkStyle });
          return;
        }
        // Try fallback
        const r2 = await linkWithPersonalSign();
        if (!r2.ok) {
          if (r2.code === 'WALLET_TAKEN' || r2.code === 409) {
            toast.error('This wallet is already linked to another account', { style: toastDarkStyle });
            return;
          }
          if (r2.code === 'SIGNATURE_REJECTED') {
            toast.info('Signature rejected', { description: 'Wallet was not linked.', style: toastDarkStyle });
            return;
          }
          toast.error('Could not link wallet', { description: String(r2.message || '').slice(0, 200) || 'Please try again later.', style: toastDarkStyle });
          return;
        }
        setIsLinked(true);
        setLinkedAddress(r2.data.walletAddress || address);
        toast.success('Wallet linked successfully', { style: toastDarkStyle });
        onWalletLinked?.(r2.data.walletAddress || address);
        await checkWalletLink(true);
        return;
      }

      setIsLinked(true);
      setLinkedAddress(r1.data.walletAddress || address);
      toast.success('Wallet linked successfully', { style: toastDarkStyle });
      onWalletLinked?.(r1.data.walletAddress || address);
      await checkWalletLink(true);
    } catch (err) {
      const unexpected = err?.shortMessage || err?.message || 'Unexpected error during wallet linking';
      toast.error('Could not link wallet', { description: unexpected, style: toastDarkStyle });
      log.error('Link wallet unexpected error', { error: err });
    } finally {
      setIsLinking(false);
    }
  };

  const unlinkWallet = async () => {
    if (!session?.user?.id) return;
    setIsLinking(true);
    try {
      const response = await fetch('/api/wallet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'unlink' }),
      });
      if (response.ok) {
        setIsLinked(false);
        setLinkedAddress(null);
        disconnect();
        toast.success('Wallet unlinked', { style: toastDarkStyle });
        await checkWalletLink(true);
      } else {
        const errInfo = await parseApiError(response);
        if (errInfo.status === 401 || errInfo.code === 'NOT_AUTHENTICATED') {
          toast.error('Your session has expired. Please sign in.', { style: toastDarkStyle });
          if (typeof window !== 'undefined') window.location.href = '/login';
          return;
        }
        toast.error(getFriendlyErrorMessage(errInfo.code, 'Could not unlink'), {
          description: errInfo.message || formatValidationDetails(errInfo.details) || 'Please try again.',
          style: toastDarkStyle,
        });
      }
    } catch (error) {
      log.error('Error unlinking wallet', { error });
      toast.error('Failed to unlink wallet', { style: toastDarkStyle });
    } finally {
      setIsLinking(false);
    }
  };

  const formatAddress = (addr) => {
    if (!addr) return '';
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wallet className="h-5 w-5" />
          Wallet Connection
        </CardTitle>
        <CardDescription>
          Connect your wallet to access Web3 features
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isChecking && (
          <div className="flex justify-center">
            <Badge variant="secondary">Verifying…</Badge>
          </div>
        )}
        {/* Linked wallet status */}
        {isLinked && linkedAddress && (
          <div className="flex items-center justify-between p-3 bg-green-50 rounded-lg border border-green-200">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-green-600" />
              <span className="text-sm font-medium text-green-800">
                Wallet Linked
              </span>
            </div>
            <Badge variant="secondary" className="text-xs">
              {formatAddress(linkedAddress)}
            </Badge>
          </div>
        )}

        {/* RainbowKit connection button */}
        <div className="flex justify-center">
          <ConnectButtonCustom>
            {({
              account,
              chain,
              openAccountModal,
              openChainModal,
              openConnectModal,
              authenticationStatus,
              mounted,
            }) => {
              const ready = mounted && authenticationStatus !== 'loading';
              const connected =
                ready &&
                account &&
                chain &&
                (!authenticationStatus ||
                  authenticationStatus === 'authenticated');

              return (
                <div
                  {...(!ready && {
                    'aria-hidden': true,
                    style: {
                      opacity: 0,
                      pointerEvents: 'none',
                      userSelect: 'none',
                    },
                  })}
                >
                  {(() => {
                    if (!connected) {
                      return (
                        <Button onClick={openConnectModal} className="w-full">
                          Connect Wallet
                        </Button>
                      );
                    }

                    if (chain.unsupported) {
                      return (
                        <Button onClick={openChainModal} variant="destructive" className="w-full">
                          Unsupported network
                        </Button>
                      );
                    }

                    return (
                      <div className="flex gap-2 w-full">
                        <Button
                          onClick={openChainModal}
                          variant="outline"
                          size="sm"
                          className="flex-1"
                        >
                          {chain.hasIcon && (
                            <div
                              style={{
                                background: chain.iconBackground,
                                width: 12,
                                height: 12,
                                borderRadius: 999,
                                overflow: 'hidden',
                                marginRight: 4,
                              }}
                            >
                              {chain.iconUrl && (
                                <Image
                                  alt={chain.name ?? 'Chain icon'}
                                  src={chain.iconUrl}
                                  width={12}
                                  height={12}
                                  unoptimized
                                  style={{ width: 12, height: 12 }}
                                />
                              )}
                            </div>
                          )}
                          {chain.name}
                        </Button>

                        <Button
                          onClick={openAccountModal}
                          variant="outline"
                          size="sm"
                          className="flex-1"
                        >
                          {account.displayName}
                          {account.displayBalance
                            ? ` (${account.displayBalance})`
                            : ''}
                        </Button>
                      </div>
                    );
                  })()}
                </div>
              );
            }}
          </ConnectButtonCustom>
        </div>

        {/* Linking buttons */}
        {isConnected && session?.user && (
          <div className="space-y-2">
            {!isLinked ? (
              <Button
                onClick={linkWallet}
                disabled={isLinking || isChecking}
                className="w-full"
                variant="default"
              >
                <Link className="h-4 w-4 mr-2" />
                {isLinking ? 'Linking...' : 'Link Wallet to Profile'}
              </Button>
            ) : (
              <Button
                onClick={unlinkWallet}
                disabled={isLinking || isChecking}
                className="w-full"
                variant="destructive"
              >
                <Unlink className="h-4 w-4 mr-2" />
                {isLinking ? 'Unlinking...' : 'Unlink Wallet'}
              </Button>
            )}
          </div>
        )}

        {/* Informational message */}
        {!session?.user && (
          <p className="text-sm text-muted-foreground text-center">
            Sign in to link your wallet to your profile
          </p>
        )}
      </CardContent>
    </Card>
  );
}