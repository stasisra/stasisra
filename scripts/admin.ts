import { prisma } from "../lib/db";
import bcrypt from "bcryptjs";
async function main() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password || password.length < 12)
    throw new Error(
      "Задайте ADMIN_EMAIL и ADMIN_PASSWORD (минимум 12 символов) через окружение",
    );
  const other = await prisma.user.findFirst({
    where: { role: "ADMIN", email: { not: email } },
    select: { id: true },
  });
  if (other) throw new Error("Администратор уже существует с другим email");
  await prisma.user.upsert({
    where: { email },
    create: {
      email,
      name: "Admin",
      role: "ADMIN",
      passwordHash: await bcrypt.hash(password, 12),
    },
    update: { role: "ADMIN", passwordHash: await bcrypt.hash(password, 12) },
  });
  console.log("Administrator configured");
}
main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
