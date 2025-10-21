import { getToken } from "next-auth/jwt";
import { NextResponse } from "next/server";

export async function middleware(req) {
  const url = req.nextUrl;
  const protectedRoutes = ["/dashboard", "/profile", "/token"];

  let token = null;
  try {
    token = await getToken({
      req,
      secret: process.env.NEXTAUTH_SECRET,
    });
  } catch (err) {
    // Gracefully handle missing/invalid NEXTAUTH_SECRET or token decoding errors
    if (protectedRoutes.some((route) => url.pathname.startsWith(route))) {
      return NextResponse.redirect(new URL("/login", req.url));
    }
    return NextResponse.next();
  }

  const isAuth = !!token;

  const tryingToAccessProtected = protectedRoutes.some((route) =>
    url.pathname.startsWith(route)
  );

  if (!isAuth && tryingToAccessProtected) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard", "/profile", "/token/:path*"],
};
