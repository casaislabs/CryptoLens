import jwt from 'jsonwebtoken';

// Enforce server-only usage: JWT signing and secrets must not be used client-side
if (typeof window !== 'undefined') {
  throw new Error('Do not import `lib/jwt.js` in the browser. Use server/API only.');
}

function base64urlToBuffer(input) {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padLength = (4 - (normalized.length % 4)) % 4;
  const padded = normalized + '='.repeat(padLength);
  return Buffer.from(padded, 'base64');
}

function resolveSupabaseSecret() {
  const raw = process.env.SUPABASE_JWT_SECRET || process.env.NEXTAUTH_SECRET;
  if (!raw) throw new Error('JWT secret required: set SUPABASE_JWT_SECRET or NEXTAUTH_SECRET');

  const trimmed = raw.trim();

  // If JSON (JWK / JWKS), try extracting kty:oct and decoding k (base64url)
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed?.keys)) {
        const octKey = parsed.keys.find((k) => k.kty === 'oct' && typeof k.k === 'string');
        if (!octKey) throw new Error('No oct key found in JWKS');
        return base64urlToBuffer(octKey.k);
      }
      if (parsed?.kty === 'oct' && typeof parsed?.k === 'string') {
        return base64urlToBuffer(parsed.k);
      }
      throw new Error('Unsupported JWK format for HMAC');
    } catch (e) {
      throw new Error(`Invalid JWK/JWKS in secret: ${e.message}`);
    }
  }

  // Otherwise, use the string as-is (Supabase often stores legacy secret as plain string)
  return trimmed;
}

// Create a signed JWT (JWS, 3 parts) from NextAuth token
// To use it as Bearer with Supabase/PostgREST under RLS
export function makeSupabaseJwsFromToken(token) {
  const hmacSecret = resolveSupabaseSecret();

  const payload = {
    // Claim used by RLS policies: auth.jwt() ->> 'sub'
    id: token?.id ?? token?.sub ?? null,
    email: token?.email ?? null,
    name: token?.name ?? null,
    picture: token?.picture ?? token?.image ?? null,
    sub: token?.id ?? token?.sub ?? null,
  };

  // HS256 signature with short expiration (15 min)
  return jwt.sign(payload, hmacSecret, {
    algorithm: 'HS256',
    expiresIn: '15m',
  });
}