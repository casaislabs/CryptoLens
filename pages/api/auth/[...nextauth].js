import NextAuth from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";
import { createHmac } from 'node:crypto';
import { recoverMessageAddress } from 'viem';
import { createLogger } from '@/lib/logger';

function base64urlDecodeToString(b64) {
  const pad = 4 - (b64.length % 4);
  const b64p = b64.replace(/-/g, '+').replace(/_/g, '/') + (pad < 4 ? '='.repeat(pad) : '');
  return Buffer.from(b64p, 'base64').toString('utf8');
}
function getHmacSecret() {
  const raw = (process.env.NEXTAUTH_SECRET || process.env.SUPABASE_JWT_SECRET || '').trim();
  if (!raw) throw new Error('HMAC secret required');
  return raw;
}
function hmacSign(input) {
  return createHmac('sha256', getHmacSecret()).update(input).digest('base64url');
}
function readChallengeCookie(req) {
  const header = req.headers.cookie || '';
  const cookies = header.split(';').map((c) => c.trim());
  const name = 'wallet_challenge';
  let raw = null;
  for (const c of cookies) {
    if (!c) continue;
    const eq = c.indexOf('=');
    if (eq === -1) continue;
    const k = c.slice(0, eq);
    if (k === name) raw = decodeURIComponent(c.slice(eq + 1));
  }
  if (!raw) return { ok: false, code: 'NO_CHALLENGE' };
  const parts = raw.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return { ok: false, code: 'INVALID_COOKIE' };
  const json = base64urlDecodeToString(parts[1]);
  const sig = parts[2];
  const expected = hmacSign(json);
  if (sig !== expected) return { ok: false, code: 'TAMPERED' };
  let payload;
  try { payload = JSON.parse(json); } catch { return { ok: false, code: 'INVALID_JSON' }; }
  if (payload.expiresAt && Date.now() > new Date(payload.expiresAt).getTime()) {
    return { ok: false, code: 'EXPIRED' };
  }
  return { ok: true, payload };
}
function parseSiweMessage(msg) {
  const lines = msg.split('\n');
  const m1 = /^([^\n]+) wants you to sign in with your Ethereum account:/.exec(lines[0] || '');
  const domain = m1 ? m1[1] : null;
  const address = (lines[1] || '').trim();
  const nonceMatch = msg.match(/(?:^|\n)Nonce:\s*([^\n]+)/);
  const issuedMatch = msg.match(/(?:^|\n)Issued At:\s*([^\n]+)/);
  const expMatch = msg.match(/(?:^|\n)Expiration Time:\s*([^\n]+)/);
  const uriMatch = msg.match(/(?:^|\n)URI:\s*([^\n]+)/);
  const versionMatch = msg.match(/(?:^|\n)Version:\s*([^\n]+)/);
  const chainIdMatch = msg.match(/(?:^|\n)Chain ID:\s*([^\n]+)/);
  return {
    domain,
    address,
    nonce: nonceMatch?.[1]?.trim() || null,
    issuedAt: issuedMatch?.[1]?.trim() || null,
    expirationTime: expMatch?.[1]?.trim() || null,
    uri: uriMatch?.[1]?.trim() || null,
    version: versionMatch?.[1]?.trim() || null,
    chainId: chainIdMatch?.[1]?.trim() || null,
  };
}
function getDomainFromReq(req) {
  const host = req.headers.host || '';
  return host.split(':')[0];
}

/**
 * Wrapper for NextAuth that allows access to req and res.
 */
export default async function auth(req, res) {
  let log = createLogger('api:auth');
  const requestId = req.headers['x-request-id'] || req.headers['X-Request-Id'] || null;
  if (requestId) log = log.child('request', { requestId });
  log.info('Auth route received');

  const providers = [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      authorization: {
        params: {
          prompt: "consent",
          access_type: "offline",
          response_type: "code",
        },
      },
    }),
  ];

  providers.push(
    CredentialsProvider({
      id: 'ethereum',
      name: 'Ethereum',
      credentials: {
        method: { label: 'Method', type: 'text' },
        signature: { label: 'Signature', type: 'text' },
        siweMessage: { label: 'SIWE Message', type: 'text' },
      },
      async authorize(credentials, reqCtx) {
        const method = credentials?.method;
        log.info('Authorize start', { method });
        const signature = credentials?.signature;
        const siweMessage = credentials?.siweMessage;
        if (!method) throw new Error('Missing method');
        const chall = readChallengeCookie(reqCtx);
        if (!chall.ok) throw new Error(`Invalid challenge: ${chall.code}`);
        const payload = chall.payload;
        const reqDomain = getDomainFromReq(req);
        if (payload.domain !== reqDomain) throw new Error('Domain mismatch');
        if (payload.method !== method) throw new Error('Method mismatch');

        let recovered;
        if (method === 'personal_sign') {
          if (!signature) throw new Error('Missing signature');
          const message = payload.message;
          if (!message) throw new Error('Missing challenge message');
          recovered = await recoverMessageAddress({ message, signature });
        } else if (method === 'siwe') {
          if (!signature || !siweMessage) throw new Error('Missing SIWE message or signature');
          const parsed = parseSiweMessage(siweMessage);
          if (!parsed?.nonce || parsed.nonce !== payload.nonce) throw new Error('SIWE nonce mismatch');
          if (!parsed?.domain || parsed.domain !== payload.domain) throw new Error('SIWE domain mismatch');
          recovered = await recoverMessageAddress({ message: siweMessage, signature });
          if (!parsed.address || recovered.toLowerCase() !== parsed.address.toLowerCase()) {
            throw new Error('SIWE address does not match recovered address');
          }
          if (parsed.expirationTime && Date.now() > new Date(parsed.expirationTime).getTime()) {
            throw new Error('SIWE message expired');
          }
        } else {
          throw new Error('Unsupported method');
        }

        const wallet = recovered.toLowerCase();
        log.info('Authorize success', { wallet });
        const user = {
          id: `wallet:${wallet}`,
          name: `Wallet ${wallet.slice(2, 6)}`,
          email: null,
          walletAddress: wallet,
        };
        return user;
      }
    })
  );

  return await NextAuth(req, res, {
    providers,
    session: {
      strategy: "jwt",
    },
    jwt: {
      encryption: false,
    },
    secret: process.env.NEXTAUTH_SECRET,
    trustHost: true,
    callbacks: {
      async signIn() {
        return true;
      },
      async jwt({ token, account, profile, user }) {
        if (account && profile) {
          const idFromGoogle = profile?.sub ?? account?.providerAccountId;
          token.id = idFromGoogle ?? token.id ?? token.sub;
          token.email = token.email ?? profile?.email ?? null;
          token.name = token.name ?? profile?.name ?? null;
          token.picture = token.picture ?? profile?.picture ?? null;
        }
        if (user && user.id?.startsWith('wallet:')) {
          token.id = user.id;
          token.walletAddress = user.walletAddress;
          token.name = token.name ?? user.name ?? null;
          token.email = token.email ?? user.email ?? null;
        }
        token.id = token.id ?? token.sub ?? null;
        return token;
      },
      async session({ session, token }) {
        session.user = session.user || {};
        session.user.id = token?.id ?? token?.sub ?? null;
        session.user.email = token?.email ?? session.user.email ?? null;
        session.user.name = token?.name ?? session.user.name ?? null;
        session.user.image = token?.picture ?? session.user.image ?? null;
        if (token?.walletAddress) session.user.walletAddress = token.walletAddress;
        return session;
      },
      async redirect({ url, baseUrl }) {
        if (url.startsWith(baseUrl)) return url;
        if (url.startsWith("/")) return `${baseUrl}${url}`;
        return baseUrl;
      },
    },
    pages: {
      signIn: "/login",
    },
    trustHost: true,
  });
}