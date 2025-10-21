import { getToken } from "next-auth/jwt";
import { NextResponse } from "next/server";

export async function middleware(req) {
  const token = await getToken({
    req,
    secret: process.env.NEXTAUTH_SECRET,
  });

  const isAuth = !!token;
  const url = req.nextUrl;

  const protectedRoutes = ["/dashboard", "/profile", "/token"];

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
