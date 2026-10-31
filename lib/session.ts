import { jwtVerify } from "jose";
import type { NextRequest } from "next/server";
export const COOKIE_NAME = "taskapp_session";
export type SessionUser = {
  id: string;
  role: "ADMIN";
  name: string;
  email: string;
};
export function getSecret() {
  const secret = process.env.AUTH_JWT_SECRET;
  if (
    !secret ||
    secret.length < 32 ||
    secret === "change-me-to-a-long-random-string"
  )
    throw new Error(
      "Задайте случайный AUTH_JWT_SECRET длиной минимум 32 символа",
    );
  return new TextEncoder().encode(secret);
}
export async function readSessionToken(
  token: string | undefined,
): Promise<SessionUser | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      algorithms: ["HS256"],
    });
    if (!payload.sub || payload.role !== "ADMIN") return null;
    return {
      id: payload.sub,
      role: "ADMIN",
      name: String(payload.name || ""),
      email: String(payload.email || ""),
    };
  } catch {
    return null;
  }
}
export async function getSessionFromRequest(req: NextRequest) {
  return readSessionToken(req.cookies.get(COOKIE_NAME)?.value);
}
