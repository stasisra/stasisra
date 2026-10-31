import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  createSessionToken,
  setSessionCookie,
  verifyPassword,
} from "@/lib/auth";
const credentials = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(1024),
});
export async function POST(req: Request) {
  const parsed = credentials.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: "Укажите email и пароль" },
      { status: 400 },
    );
  try {
    const user = await prisma.user.findUnique({
      where: { email: parsed.data.email },
    });
    if (
      !user ||
      user.role !== "ADMIN" ||
      !(await verifyPassword(parsed.data.password, user.passwordHash))
    )
      return NextResponse.json(
        { error: "Неверные учётные данные" },
        { status: 401 },
      );
    await setSessionCookie(
      await createSessionToken({
        id: user.id,
        role: "ADMIN",
        name: user.name,
        email: user.email,
      }),
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("Login failed", e);
    return NextResponse.json(
      { error: "Не удалось войти. Проверьте настройки приложения." },
      { status: 500 },
    );
  }
}
