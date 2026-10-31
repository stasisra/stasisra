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
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    const origin = req.headers.get("origin");
    const allowed = [req.nextUrl.origin, process.env.APP_URL].filter(Boolean);
    if (
      (origin && !allowed.includes(origin)) ||
      req.headers.get("sec-fetch-site") === "cross-site"
    )
      return NextResponse.json(
        { error: "Запрос с другого сайта отклонён" },
        { status: 403 },
      );
  }

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

  // The normalized workspace is the only mutation contract. Old writes would
  // bypass project inheritance, contact relations and optimistic revisions.
  if (
    !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
    (pathname === "/api/tasks" ||
      /^\/api\/tasks\/[^/]+(?:\/comments)?$/.test(pathname) ||
      /^\/api\/(comments|dictionaries|name-policy)(?:\/|$)/.test(pathname))
  )
    return NextResponse.json(
      {
        error:
          "Этот способ изменения устарел. Откройте обновлённый интерфейс задач.",
      },
      { status: 410 },
    );
  return NextResponse.next();
}

export const config = {
  matcher: ["/:path*"],
};
