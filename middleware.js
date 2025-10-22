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
      res.headers.set('x-request-id', reqId);
      return res;
    }
    const res = NextResponse.next({ request: { headers: requestHeaders } });
    res.headers.set('x-request-id', reqId);
    return res;
  }

  const isAuth = !!token;

  const tryingToAccessProtected = protectedRoutes.some((route) =>
    url.pathname.startsWith(route)
  );

  if (!isAuth && tryingToAccessProtected) {
    const res = NextResponse.redirect(new URL("/login", req.url));
    res.headers.set('x-request-id', reqId);
    return res;
  }

  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set('x-request-id', reqId);
  return res;
}

export const config = {
  matcher: ["/dashboard", "/profile", "/token/:path*"],
};
