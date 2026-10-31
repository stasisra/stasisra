import { NextResponse } from "next/server";
export async function POST() {
  return NextResponse.json(
    {
      error:
        "Регистрация отключена: приложение работает с одним администратором",
    },
    { status: 403 },
  );
}
