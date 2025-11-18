import { getToken } from "next-auth/jwt";
import { NextResponse } from "next/server";

export async function middleware(req) {
  const url = req.nextUrl;
  const protectedRoutes = ["/dashboard", "/profile", "/token"];

  // Ensure each request has a requestId for logging correlation
  const requestHeaders = new Headers(req.headers);
  const existingReqId = requestHeaders.get('x-request-id');
  const reqId = existingReqId || (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`);

  // Attach requestId to downstream request and response
  requestHeaders.set('x-request-id', reqId);

  // Derive current origin and incoming Origin header
  const currentOrigin = `${url.protocol}//${url.host}`;
  const originHeader = req.headers.get('origin') || '';

  // Bypass middleware entirely for NextAuth endpoints to prevent JSON → HTML issues
  const isAuthApi = url.pathname.startsWith('/api/auth');
  if (isAuthApi) {
    // Do not modify headers for NextAuth routes at all; let NextAuth control response
    // This avoids any chance of content-type/CSP interference causing HTML responses
    const res = NextResponse.next({ request: { headers: requestHeaders } });
    return res;
  }

  // CSRF: Block cross-origin non-GET requests to API
  const isApiRoute = url.pathname.startsWith('/api');
  const isMutationMethod = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
  if (isApiRoute && isMutationMethod) {
    if (originHeader && originHeader !== currentOrigin) {
      return new NextResponse(JSON.stringify({ error: 'Forbidden: CSRF origin mismatch' }), {
        status: 403,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'x-request-id': reqId,
        },
      });
    }
    // Payload size guard (approximate via Content-Length)
    const contentLength = Number(req.headers.get('content-length') || '0');
    const MAX_BYTES = 1_000_000; // ~1MB
    if (contentLength > MAX_BYTES) {
      return new NextResponse(JSON.stringify({ error: 'Payload too large' }), {
        status: 413,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'x-request-id': reqId,
        },
      });
    }
  }

  // CORS preflight handling: allow only same-origin for APIs
  if (isApiRoute && req.method === 'OPTIONS') {
    const allowSameOrigin = originHeader === currentOrigin ? originHeader : '';
    const res = new NextResponse(null, { status: 204 });
    if (allowSameOrigin) {
      res.headers.set('Access-Control-Allow-Origin', allowSameOrigin);
      res.headers.set('Access-Control-Allow-Credentials', 'true');
      res.headers.set('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
      res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-CSRF-Token, x-request-id');
      res.headers.set('Access-Control-Max-Age', '86400');
    }
    res.headers.set('x-request-id', reqId);
    return res;
  }

  let token = null;
  try {
    token = await getToken({
      req,
      secret: process.env.NEXTAUTH_SECRET,
    });
  } catch (err) {
    // Gracefully handle missing/invalid NEXTAUTH_SECRET or token decoding errors
    if (protectedRoutes.some((route) => url.pathname.startsWith(route))) {
      const res = NextResponse.redirect(new URL("/login", req.url));
      // Security headers for redirect
      applySecurityHeaders(res, currentOrigin);
      res.headers.set('x-request-id', reqId);
      return res;
    }
    const res = NextResponse.next({ request: { headers: requestHeaders } });
    applySecurityHeaders(res, currentOrigin);
    res.headers.set('x-request-id', reqId);
    return res;
  }

  const isAuth = !!token;

  const tryingToAccessProtected = protectedRoutes.some((route) =>
    url.pathname.startsWith(route)
  );

  if (!isAuth && tryingToAccessProtected) {
    const res = NextResponse.redirect(new URL("/login", req.url));
    applySecurityHeaders(res, currentOrigin);
    res.headers.set('x-request-id', reqId);
    return res;
  }

  const res = NextResponse.next({ request: { headers: requestHeaders } });
  applySecurityHeaders(res, currentOrigin);
  res.headers.set('x-request-id', reqId);
  return res;
}

function applySecurityHeaders(res, currentOrigin) {
  const isProd = process.env.NODE_ENV === 'production';

  // Content-Security-Policy (connect-src derived from SUPABASE_URL)
  const supabaseUrl = process.env.SUPABASE_URL || '';
  let supabaseOrigin = '';
  try { supabaseOrigin = supabaseUrl ? new URL(supabaseUrl).origin : ''; } catch (_) { supabaseOrigin = ''; }
  const extraConnect = (process.env.CSP_CONNECT_EXTRA || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  const connectSrc = [
    "'self'",
    "https:",
    "wss:",
  ];
  if (supabaseOrigin) connectSrc.push(supabaseOrigin);
  if (extraConnect.length) connectSrc.push(...extraConnect);

  const cspDirectives = [
    "default-src 'self'",
    isProd
      ? "script-src 'self' 'unsafe-inline'"
      : "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    `connect-src ${connectSrc.join(' ')}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');

  res.headers.set('Content-Security-Policy', cspDirectives);
  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('X-Frame-Options', 'DENY');
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.headers.set('Permissions-Policy', 'accelerometer=(), camera=(), microphone=(), geolocation=(), gyroscope=(), magnetometer=(), payment=(), usb=()');

  // HSTS only in production
  if (isProd) {
    res.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  }

  // CORS for API responses (same origin only)
  // If Origin equals currentOrigin, reflect it; otherwise, do not set
  if (res.headers.get('content-type')?.includes('application/json')) {
    const originSet = res.headers.get('Access-Control-Allow-Origin');
    if (!originSet && currentOrigin) {
      res.headers.set('Access-Control-Allow-Origin', currentOrigin);
      res.headers.set('Access-Control-Allow-Credentials', 'true');
    }
  }
}

export const config = {
  matcher: ["/dashboard", "/profile", "/token/:path*", "/api/:path*"],
};
