import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "./lib/session";

const PUBLIC_PATHS = [
  "/login",
  "/register",
  "/api/auth/login",
  "/api/auth/register",
  "/_next",
  "/favicon.ico",
];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (
    PUBLIC_PATHS.some(
      (p) =>
        pathname === p ||
        pathname.startsWith(p + "/") ||
        pathname.startsWith("/_next"),
    )
  ) {
    return NextResponse.next();
  }

  const session = await getSessionFromRequest(req);
  if (!session) {
    if (pathname.startsWith("/api/"))
      return NextResponse.json(
        { error: "Требуется вход администратора" },
        { status: 401 },
      );
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("next", pathname + req.nextUrl.search);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/:path*"],
};
