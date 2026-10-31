import bcrypt from "bcryptjs";
import { SignJWT } from "jose";
import { cookies } from "next/headers";
import {
  COOKIE_NAME,
  getSecret,
  readSessionToken,
  type SessionUser,
} from "./session";
export type { SessionUser } from "./session";
export const hashPassword = (password: string) => bcrypt.hash(password, 12);
export const verifyPassword = (password: string, hash: string) =>
  bcrypt.compare(password, hash);
export async function createSessionToken(user: SessionUser) {
  return new SignJWT({
    sub: user.id,
    role: "ADMIN",
    name: user.name,
    email: user.email,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(getSecret());
}
function secureCookie() {
  if (process.env.NODE_ENV !== "production") return false;
  try {
    const url = new URL(process.env.APP_URL || "");
    if (
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    )
      return false;
  } catch {
    /* An unconfigured public deployment keeps Secure cookies. */
  }
  return true;
}
export async function setSessionCookie(token: string) {
  (await cookies()).set({
    name: COOKIE_NAME,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookie(),
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}
export async function clearSessionCookie() {
  (await cookies()).set({
    name: COOKIE_NAME,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookie(),
    path: "/",
    maxAge: 0,
  });
}
export async function getSession() {
  return readSessionToken((await cookies()).get(COOKIE_NAME)?.value);
}
export function canSeeTask(user: SessionUser, ..._unused: unknown[]) {
  return user.role === "ADMIN";
}
