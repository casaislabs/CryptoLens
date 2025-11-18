// pages/api/wallet.js
import { createSupabaseClientWithJwt } from '@/lib/supabase';
import { getToken } from 'next-auth/jwt';
import { ensureUserProfile } from '@/lib/profile';
import { makeSupabaseJwsFromToken } from '@/lib/jwt';
import { setNoStore, sendError, ensureMethod } from '@/lib/http';
import { WalletBody, parseOrThrow } from '@/lib/validation';
import { createHmac, randomBytes } from 'node:crypto';
import { recoverMessageAddress, isAddress } from 'viem';
import { createLogger } from '@/lib/logger';
let log = createLogger('api:wallet');

// Valid Ethereum address format (regex used in zod as well)
const isValidEthereumAddress = (address) => /^0x[a-fA-F0-9]{40}$/.test(address);

// Challenge cookie helpers
const CHALLENGE_COOKIE = 'wallet_challenge';
const CHALLENGE_TTL_SECONDS = 10 * 60; // 10 minutes

function base64urlEncode(str) {
  return Buffer.from(str, 'utf8').toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function base64urlDecodeToString(b64) {
  const pad = 4 - (b64.length % 4);
  const b64p = b64.replace(/-/g, '+').replace(/_/g, '/') + (pad < 4 ? '='.repeat(pad) : '');
  return Buffer.from(b64p, 'base64').toString('utf8');
}
function getHmacSecret() {
  const raw = (process.env.NEXTAUTH_SECRET || process.env.SUPABASE_JWT_SECRET || '').trim();
  if (!raw) throw new Error('HMAC secret required. Set NEXTAUTH_SECRET or SUPABASE_JWT_SECRET');
  return raw;
}
function toBase64Url(b64) {
  return b64.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

// Map Supabase/PostgREST errors to HTTP with helpful codes
function mapSupabaseErrorToHttp(error) {
  const status = error?.status;
  const msg = String(error?.message || '').toLowerCase();
  // Auth/JWT issues
  if (status === 401 || msg.includes('jwt') || msg.includes('unauthorized')) {
    return { http: 401, code: 'NOT_AUTHENTICATED', message: 'Supabase auth failed. Check SUPABASE_JWT_SECRET and JWT setup.' };
  }
  // RLS / permissions
  if (status === 403 || msg.includes('permission denied') || msg.includes('forbidden')) {
    return { http: 403, code: 'FORBIDDEN', message: 'Operation not allowed by RLS policies for this user.' };
  }
  // Network / URL
  if (msg.includes('fetch failed') || msg.includes('getaddrinfo') || msg.includes('dns')) {
    return { http: 503, code: 'SUPABASE_UNAVAILABLE', message: 'Supabase unreachable. Verify SUPABASE_URL and platform connectivity.' };
  }
  return { http: 500, code: 'INTERNAL_ERROR', message: 'Failed to process request' };
}
function hmacSign(input) {
  const b64 = createHmac('sha256', getHmacSecret()).update(input).digest('base64');
  return toBase64Url(b64);
}
function serializeCookie(name, value, { maxAge = CHALLENGE_TTL_SECONDS, path = '/', secure, httpOnly = true, sameSite = 'Strict' } = {}) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${path}`,
    `Max-Age=${maxAge}`,
    `SameSite=${sameSite}`,
  ];
  if (httpOnly) parts.push('HttpOnly');
  if (typeof secure === 'boolean' ? secure : process.env.NODE_ENV === 'production') parts.push('Secure');
  return parts.join('; ');
}
function getCookie(req, name) {
  const header = req.headers.cookie || '';
  const cookies = header.split(';').map((c) => c.trim());
  for (const c of cookies) {
    if (!c) continue;
    const eq = c.indexOf('=');
    if (eq === -1) continue;
    const k = c.slice(0, eq);
    if (k === name) return decodeURIComponent(c.slice(eq + 1));
  }
  return null;
}
function clearChallengeCookie(res) {
  res.setHeader('Set-Cookie', serializeCookie(CHALLENGE_COOKIE, '', { maxAge: 0 }));
}
function setChallengeCookie(res, payload) {
  const json = JSON.stringify(payload);
  const v = 'v1.' + base64urlEncode(json) + '.' + hmacSign(json);
  res.setHeader('Set-Cookie', serializeCookie(CHALLENGE_COOKIE, v, {}));
}
function readChallengeCookie(req) {
  const raw = getCookie(req, CHALLENGE_COOKIE);
  if (!raw) return { ok: false, code: 'NO_CHALLENGE' };
  const parts = raw.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return { ok: false, code: 'INVALID_COOKIE' };
  const json = base64urlDecodeToString(parts[1]);
  const sig = parts[2];
  const expected = hmacSign(json);
  if (sig !== expected) return { ok: false, code: 'TAMPERED' };
  let payload;
  try { payload = JSON.parse(json); } catch { return { ok: false, code: 'INVALID_JSON' }; }
  // Expiry check
  if (payload.expiresAt && Date.now() > new Date(payload.expiresAt).getTime()) {
    return { ok: false, code: 'EXPIRED' };
  }
  return { ok: true, payload };
}
function getDomainFromReq(req) {
  const host = req.headers.host || '';
  return host.split(':')[0];
}
function buildPersonalSignMessage({ domain, userId, nonce, issuedAt, expiresAt, intent = 'link' }) {
  const purpose = intent === 'login' ? 'Sign in to Web3 Dashboard' : 'Link your wallet to Web3 Dashboard';
  const userLine = userId ? `User: ${userId}\n` : '';
  return (
    `${purpose}\n` +
    `\n` +
    userLine +
    `Domain: ${domain}\n` +
    `Nonce: ${nonce}\n` +
    `Issued At: ${issuedAt}\n` +
    `Expires At: ${expiresAt}\n`
  );
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

export default async function handler(req, res) {
  const ensure = ensureMethod(req, res, ['POST']);
  if (ensure) return;
  setNoStore(res);

  try {
    const requestId = req.headers['x-request-id'] || null;
     let body;
     try {
       body = parseOrThrow(WalletBody, req.body);
     } catch (e) {
       if (e.name === 'ValidationError') {
         return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid wallet request', e.details);
       }
       throw e;
     }

     const action = body.action;

     // Allow unauthenticated challenge issuance (for wallet sign-in)
     if (action === 'challenge') {
       const method = body.method;
       if (!method) return sendError(res, 400, 'INVALID_METHOD', 'method is required');
       // Try to read token, but do not require it
       const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET }).catch(() => null);
      log = log.child('request', { requestId, userId: token?.id || null });
       const userId = token?.id || null;
       return await handleChallenge(req, res, userId, method);
     }

     // From here on, actions require authentication
     const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
     if (!token?.id) {
       return sendError(res, 401, 'NOT_AUTHENTICATED', 'Not authenticated');
     }
     const userId = token.id;
    log = log.child('request', { requestId, userId });
 
     // Create JWS (3-part) for Supabase
     // Log a safe fingerprint of Supabase env, controlled by LOG_LEVEL
     try {
       const urlRaw = process.env.SUPABASE_URL || '';
       let urlHost = null; try { urlHost = new URL(urlRaw).host; } catch (_) { urlHost = null; }
       const keyRaw = process.env.SUPABASE_KEY || '';
       const keyLen = keyRaw.length;
       const keyTail = keyRaw ? keyRaw.slice(-6) : null;
       const keyShape = keyRaw.startsWith('eyJ') ? 'jwt-like' : (keyRaw ? 'other' : 'empty');
       const lvl = log.level;
       if (lvl === 'debug') {
         // Full fingerprint for debugging
         log.debug('Supabase env fingerprint', { urlHost, keyLen, keyTail: keyTail ? `…${keyTail}` : null, keyShape });
       } else if (lvl === 'info') {
         // Minimal fingerprint in info (omit keyTail)
         log.info('Supabase env fingerprint', { urlHost, keyLen, keyShape });
       }
     } catch (_) { /* ignore */ }
     const jws = makeSupabaseJwsFromToken(token);
     const supabaseClient = createSupabaseClientWithJwt(jws);

    // JIT profile creation if not exists
    await ensureUserProfile(supabaseClient, token);

    switch (action) {
      case 'check':
        return await handleCheck(supabaseClient, userId, res);
      case 'link': {
        const method = body.method;
        if (!method) return sendError(res, 400, 'INVALID_METHOD', 'method is required');

        // Session-based linking: trust verified wallet from NextAuth token (no second signature)
        if (method === 'session') {
          const walletAddressFromToken = (token?.walletAddress || '').toLowerCase();
          if (!walletAddressFromToken) {
            return sendError(res, 400, 'MISSING_WALLET', 'No wallet in session');
          }
          if (!isValidEthereumAddress(walletAddressFromToken)) {
            return sendError(res, 400, 'INVALID_WALLET', 'Recovered invalid Ethereum address');
          }
          const result = await handleLink(supabaseClient, userId, walletAddressFromToken, res);
          clearChallengeCookie(res);
          return result;
        }

        const chall = readChallengeCookie(req);
        if (!chall.ok) {
          return sendError(res, 400, 'CHALLENGE_INVALID', `Challenge not valid: ${chall.code || 'unknown'}`);
        }
        const payload = chall.payload;
        if (payload.userId !== userId) {
          return sendError(res, 400, 'CHALLENGE_MISMATCH', 'Challenge does not belong to this user');
        }
        if (payload.method !== method) {
          return sendError(res, 400, 'CHALLENGE_METHOD_MISMATCH', 'Challenge method mismatch');
        }
        // Verify domain context
        const reqDomain = getDomainFromReq(req);
        if (payload.domain !== reqDomain) {
          return sendError(res, 400, 'DOMAIN_MISMATCH', 'Domain mismatch');
        }

        let recovered;
        if (method === 'personal_sign') {
          if (!body.signature) return sendError(res, 400, 'MISSING_SIGNATURE', 'signature is required');
          const message = payload.message;
          if (!message) return sendError(res, 400, 'CHALLENGE_INVALID', 'Missing challenge message');
          try {
            recovered = await recoverMessageAddress({ message, signature: body.signature });
          } catch (e) {
            return sendError(res, 400, 'SIGNATURE_INVALID', 'Invalid signature');
          }
        } else if (method === 'siwe') {
          if (!body.signature || !body.siweMessage) return sendError(res, 400, 'MISSING_SIGNATURE', 'siweMessage and signature are required');
          const parsed = parseSiweMessage(body.siweMessage);
          if (!parsed?.nonce || parsed.nonce !== payload.nonce) {
            return sendError(res, 400, 'NONCE_MISMATCH', 'SIWE nonce mismatch');
          }
          if (!parsed?.domain || parsed.domain !== payload.domain) {
            return sendError(res, 400, 'DOMAIN_MISMATCH', 'SIWE domain mismatch');
          }
          try {
            recovered = await recoverMessageAddress({ message: body.siweMessage, signature: body.signature });
          } catch (e) {
            return sendError(res, 400, 'SIGNATURE_INVALID', 'Invalid SIWE signature');
          }
          if (!parsed.address || recovered.toLowerCase() !== parsed.address.toLowerCase()) {
            return sendError(res, 400, 'ADDRESS_MISMATCH', 'SIWE recovered address does not match message');
          }
          // Optional expiration check within SIWE message
          if (parsed.expirationTime && Date.now() > new Date(parsed.expirationTime).getTime()) {
            return sendError(res, 400, 'CHALLENGE_EXPIRED', 'SIWE message expired');
          }
        } else {
          return sendError(res, 400, 'INVALID_METHOD', 'Unsupported method');
        }

        if (!recovered || !isAddress(recovered)) {
          return sendError(res, 400, 'SIGNATURE_INVALID', 'Could not recover a valid address');
        }
        const walletAddress = recovered.toLowerCase();
        if (!isValidEthereumAddress(walletAddress)) {
          return sendError(res, 400, 'INVALID_WALLET', 'Recovered invalid Ethereum address');
        }

        const result = await handleLink(supabaseClient, userId, walletAddress, res);
        // Clear challenge cookie on success
        if (result && !res.writableEnded) {
          // if handleLink wrote response, res.writableEnded may be true. We still clear cookie when 200
        }
        clearChallengeCookie(res);
        return result;
      }
      case 'unlink':
        return await handleUnlink(supabaseClient, userId, res);
      case 'getProfile':
        return await handleGetProfile(supabaseClient, userId, res);
      default:
        return sendError(res, 400, 'INVALID_ACTION', 'Invalid action');
    }
  } catch (error) {
    log.error('Wallet API error', { error });
     return sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
}

// Check wallet link status
async function handleCheck(supabaseClient, userId, res) {
  const { data, error } = await supabaseClient
    .from('profiles')
    .select('wallet_address, wallet_linked_at')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    log.error('Error checking wallet', { error });
    const mapped = mapSupabaseErrorToHttp(error);
    return sendError(res, mapped.http, mapped.code, mapped.message);
  }

  // If the user does not exist, return default values
  if (!data) {
    return res.status(200).json({
      isLinked: false,
      walletAddress: null,
      linkedAt: null
    });
  }

  const isLinked = !!data.wallet_address;
  
  return res.status(200).json({
    isLinked,
    walletAddress: data.wallet_address || null,
    linkedAt: data.wallet_linked_at || null
  });
}

// Link wallet to the user's profile
async function handleLink(supabaseClient, userId, walletAddress, res) {
  // Check if the wallet is already linked to another user
  const { data: existingWallet, error: checkError } = await supabaseClient
    .from('profiles')
    .select('user_id')
    .eq('wallet_address', walletAddress)
    .maybeSingle();

  if (checkError) {
    log.error('Error checking existing wallet', { error: checkError });
     return sendError(res, 500, 'DB_ERROR', 'Database error');
  }

  if (existingWallet && existingWallet.user_id !== userId) {
    return sendError(res, 409, 'WALLET_TAKEN', 'Wallet already linked to another user');
  }

  // Confirm that the user exists by user_id
  const { data: existingUser, error: userCheckError } = await supabaseClient
    .from('profiles')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle();

  if (userCheckError) {
    log.error('Error checking user existence', { error: userCheckError });
     return sendError(res, 500, 'DB_ERROR', 'Database error checking user');
  }

  if (!existingUser) {
    return sendError(res, 404, 'PROFILE_NOT_FOUND', 'User profile not found. Please log out and log in again to recreate your profile.', { userId });
  }

  // Link the wallet to the user (always by user_id)
  const { data, error } = await supabaseClient
    .from('profiles')
    .update({
      wallet_address: walletAddress,
      wallet_linked_at: new Date().toISOString()
    })
    .eq('user_id', userId)
    .select()
    .maybeSingle();

  if (error) {
    log.error('Error linking wallet', { error });
     if (error.code === '23505' || /unique/i.test(error.message || '')) {
       return sendError(res, 409, 'WALLET_TAKEN', 'Wallet already linked to another user');
     }
     return sendError(res, 500, 'LINK_FAILED', 'Failed to link wallet');
  }

  if (!data) {
    return sendError(res, 404, 'PROFILE_NOT_FOUND', 'User not found after update');
  }

  return res.status(200).json({
    success: true,
    message: 'Wallet linked successfully',
    walletAddress: data.wallet_address,
    linkedAt: data.wallet_linked_at
  });
}

// Unlink wallet from the user's profile
async function handleUnlink(supabaseClient, userId, res) {
  const { data, error } = await supabaseClient
    .from('profiles')
    .update({
      wallet_address: null,
      wallet_linked_at: null
    })
    .eq('user_id', userId)
    .select()
    .maybeSingle();

  if (error) {
    log.error('Error unlinking wallet', { error });
    const mapped = mapSupabaseErrorToHttp(error);
    return sendError(res, mapped.http, mapped.code, mapped.message);
  }

  if (!data) {
    return sendError(res, 404, 'PROFILE_NOT_FOUND', 'User not found');
  }

  return res.status(200).json({
    success: true,
    message: 'Wallet unlinked successfully'
  });
}

// Get the user's full profile
async function handleGetProfile(supabaseClient, userId, res) {
  const { data, error } = await supabaseClient
    .from('profiles')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    log.error('Error fetching profile', { error });
    const mapped = mapSupabaseErrorToHttp(error);
    return sendError(res, mapped.http, mapped.code, mapped.message);
  }

  if (!data) {
    return sendError(res, 404, 'PROFILE_NOT_FOUND', 'Profile not found');
  }

  return res.status(200).json(data);
}

// Issue challenge for signature (SIWE or personal_sign)
async function handleChallenge(req, res, userId, method) {
  const now = new Date();
  const issuedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + CHALLENGE_TTL_SECONDS * 1000).toISOString();
  const nonce = randomBytes(16).toString('hex');
  const domain = getDomainFromReq(req);
  const intent = userId ? 'link' : 'login';

  if (method === 'personal_sign') {
    const message = buildPersonalSignMessage({ domain, userId, nonce, issuedAt, expiresAt, intent });
    const payload = { version: 1, method, nonce, issuedAt, expiresAt, domain, message };
    if (userId) payload.userId = userId;
    setChallengeCookie(res, payload);
    return res.status(200).json({ method, nonce, message, issuedAt, expiresAt });
  }

  if (method === 'siwe') {
    const payload = { version: 1, method, nonce, issuedAt, expiresAt, domain };
    if (userId) payload.userId = userId;
    setChallengeCookie(res, payload);
    const uri = `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`;
    return res.status(200).json({
      method,
      nonce,
      issuedAt,
      expiresAt,
      domain,
      // These are hints for the client to assemble the SIWE message
      siwe: {
        statement: intent === 'login' ? 'Sign to sign in' : 'Sign to link your wallet to your account',
        uri,
        version: '1'
      }
    });
  }

  return sendError(res, 400, 'INVALID_METHOD', 'Unsupported method');
}