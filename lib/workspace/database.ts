import Database from "better-sqlite3";
import path from "node:path";
export function databaseFilename() {
  const configured = process.env.DATABASE_URL || "file:./dev.db";
  if (!configured.startsWith("file:"))
    throw new Error("DATABASE_URL должен указывать на SQLite");
  const raw = configured.slice(5);
  return path.isAbsolute(raw)
    ? raw
    : path.resolve(process.cwd(), "prisma", raw);
}
let database: Database.Database | undefined;
export function workspaceDb() {
  if (!database) {
    database = new Database(databaseFilename(), {
      fileMustExist: true,
      timeout: 5000,
    });
    database.pragma("foreign_keys = ON");
    database.pragma("journal_mode = WAL");
  }
  if (
    !database
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='WorkspaceMeta'",
      )
      .get()
  )
    throw new Error(
      "Выполните npm run db:init и npm run db:upgrade перед запуском",
    );
  return database;
}
export const cleanName = (value: string) =>
  value.normalize("NFC").replace(/\s+/g, " ").trim();
export const nameKey = (value: string) =>
  cleanName(value).toLocaleLowerCase("ru-RU");
export const tokens = (value: unknown) =>
  String(value || "")
    .split(/[,;]/)
    .map(cleanName)
    .filter(Boolean);
export function touch(db: Database.Database) {
  db.prepare(
    "UPDATE WorkspaceMeta SET value=CAST(value AS INTEGER)+1 WHERE key='revision'",
  ).run();
}
export class WorkspaceError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
