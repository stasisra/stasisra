import { PrismaClient } from "@prisma/client";
import { PrismaBetterSQLite3 } from "@prisma/adapter-better-sqlite3";
import path from "node:path";
declare global {
  var prisma: PrismaClient | undefined;
}
const configured = process.env.DATABASE_URL || "file:./dev.db";
if (!configured.startsWith("file:"))
  throw new Error("DATABASE_URL должен указывать на SQLite-файл");
const filename = configured.slice(5);
const url =
  "file:" +
  (path.isAbsolute(filename)
    ? filename
    : path.resolve(process.cwd(), "prisma", filename));
export const prisma =
  global.prisma ||
  new PrismaClient({
    adapter: new PrismaBetterSQLite3(
      { url },
      { timestampFormat: "unixepoch-ms" },
    ),
  });
if (process.env.NODE_ENV !== "production") global.prisma = prisma;
