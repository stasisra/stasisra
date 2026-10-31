import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { getSession } from "../auth";
export async function workspaceDocument(req: Request) {
  if (!(await getSession()))
    return NextResponse.redirect(
      new URL(
        "/login?next=" +
          encodeURIComponent(
            new URL(req.url).pathname + new URL(req.url).search,
          ),
        req.url,
      ),
    );
  const html = await readFile(
    path.join(process.cwd(), "workspace/index.html"),
    "utf8",
  );
  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "same-origin",
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' blob:; worker-src 'self'; frame-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'",
    },
  });
}
