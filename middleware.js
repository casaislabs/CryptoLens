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

  // Content-Security-Policy
  const cspDirectives = [
    "default-src 'self'",
    isProd ? "script-src 'self'" : "script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    "connect-src 'self' https://api.coingecko.com https://pro-api.coinmarketcap.com https://djfdrpmtjfzatoahfgqp.supabase.co",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');

  res.headers.set('Content-Security-Policy', cspDirectives);
  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('X-Frame-Options', 'DENY');
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.headers.set('Permissions-Policy', 'accelerometer=(), camera=(), microphone=(), geolocation=(), gyroscope=(), magnetometer=(), payment=(), usb=()');

  // HSTS solo en prod
  if (isProd) {
    res.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  }

  // CORS para respuestas API (solo mismo origen)
  // Si hay Origin igual a currentOrigin, reflejarlo; si no, no setear
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
