import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount, useDisconnect, useChainId, useSignMessage } from 'wagmi';
import { useSession } from 'next-auth/react';
import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Wallet, Link, Unlink, CheckCircle } from 'lucide-react';
import { toast } from 'sonner';
import { parseApiError, getFriendlyErrorMessage, formatValidationDetails } from '@/lib/apiErrors';

export default function WalletConnection({ onWalletLinked }) {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { signMessageAsync } = useSignMessage();
  const { disconnect } = useDisconnect();
  const { data: session } = useSession();
  const [isLinking, setIsLinking] = useState(false);
  const [isLinked, setIsLinked] = useState(false);
  const [linkedAddress, setLinkedAddress] = useState(null);

  const toastDarkStyle = { backgroundColor: '#111', color: '#fff' };

  useEffect(() => {
    if (session?.user?.id) {
      checkWalletLink();
    }
  }, [session, address]);

  const checkWalletLink = async () => {
    if (!session?.user?.id) return;

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
      } else {
        const errInfo = await parseApiError(response);
        toast.error(getFriendlyErrorMessage(errInfo.code, 'Could not verify wallet'), {
          description: errInfo.message || formatValidationDetails(errInfo.details) || 'Try again later.',
          style: toastDarkStyle,
        });
      }
    } catch (error) {
      console.error('Error checking wallet link:', error);
    }
  };

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
      const err = new Error(errInfo.message || 'Link (siwe) failed');
      err.code = errInfo.code || linkRes.status;
      err.info = errInfo;
      throw err;
    }
    return linkRes.json();
  };

  const linkWithPersonalSign = async () => {
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
      const err = new Error(errInfo.message || 'Link (personal_sign) failed');
      err.code = errInfo.code || linkRes.status;
      err.info = errInfo;
      throw err;
    }
    return linkRes.json();
  };

  const linkWallet = async () => {
    if (!address || !session?.user?.id) {
      toast.error('Sign in and connect your wallet first', { style: toastDarkStyle });
      return;
    }
    setIsLinking(true);
    try {
      // Check if the wallet is already linked to the profile
      await checkWalletLink();
      if (isLinked) {
        toast.info('This wallet is already linked to your account', { style: toastDarkStyle });
        return;
      }

      // Attempt SIWE by default
      const data = await linkWithSiwe();
      setIsLinked(true);
      setLinkedAddress(data.walletAddress || address);
      toast.success('Wallet linked successfully', { style: toastDarkStyle });
      onWalletLinked?.(data.walletAddress || address);
    } catch (err) {
      // Treat 409 as a business conflict: show toast and stop
      if (err?.code === 409 || /WALLET_TAKEN/i.test(String(err?.message))) {
        toast.error('This wallet is already linked to another account', { style: toastDarkStyle });
        return;
      }
      // Signature rejected: no fallback, inform the user and exit
      if (isUserRejectedError(err)) {
        toast.info('Signature rejected', { description: 'Wallet was not linked.', style: toastDarkStyle });
        return;
      }
      console.warn('SIWE linking failed, attempting personal_sign fallback:', err);
      try {
        const data2 = await linkWithPersonalSign();
        setIsLinked(true);
        setLinkedAddress(data2.walletAddress || address);
        toast.success('Wallet linked successfully', { style: toastDarkStyle });
        onWalletLinked?.(data2.walletAddress || address);
      } catch (err2) {
        if (err2?.code === 409 || /WALLET_TAKEN/i.test(String(err2?.message))) {
          toast.error('This wallet is already linked to another account', { style: toastDarkStyle });
          return;
        }
        if (isUserRejectedError(err2)) {
          toast.info('Signature rejected', { description: 'Wallet was not linked.', style: toastDarkStyle });
          return;
        }
        console.error('Linking failed:', err2);
        toast.error('Could not link wallet', {
          description: String(err2?.message || '').slice(0, 200) || 'Please try again later.',
          style: toastDarkStyle,
        });
      }
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
      console.error('Error unlinking wallet:', error);
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
          <ConnectButton.Custom>
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
                                <img
                                  alt={chain.name ?? 'Chain icon'}
                                  src={chain.iconUrl}
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
          </ConnectButton.Custom>
        </div>

        {/* Linking buttons */}
        {isConnected && session?.user && (
          <div className="space-y-2">
            {!isLinked ? (
              <Button
                onClick={linkWallet}
                disabled={isLinking}
                className="w-full"
                variant="default"
              >
                <Link className="h-4 w-4 mr-2" />
                {isLinking ? 'Linking...' : 'Link Wallet to Profile'}
              </Button>
            ) : (
              <Button
                onClick={unlinkWallet}
                disabled={isLinking}
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