import Database from "better-sqlite3";
import { productAction } from "../lib/product/service";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
const dir = mkdtempSync(path.join(tmpdir(), "task-gantt-browser-"));
const env = {
  ...process.env,
  DATABASE_URL: "file:" + path.join(dir, "test.db"),
  AUTH_JWT_SECRET: "synthetic-browser-test-secret-at-least-32-characters",
  ADMIN_EMAIL: "browser-admin@example.test",
  ADMIN_PASSWORD: "synthetic-browser-password",
  NEXT_TELEMETRY_DISABLED: "1",
};
for (const file of ["scripts/init-db.ts", "scripts/admin.ts"])
  execFileSync(process.execPath, ["--import", "tsx", file], {
    env,
    stdio: "inherit",
  });
// Synthetic directories for browser tests only; production setup starts empty.

const db = new Database(path.join(dir, "test.db"));
const admin = db
  .prepare("SELECT id,name,email FROM User WHERE role='ADMIN' LIMIT 1")
  .get() as { id: string; name: string; email: string };
const actor = { ...admin, role: "ADMIN" as const };
for (const [id, name] of [
  ["sp", "SP"],
  ["web", "web"],
  ["vnz", "ВНЖ"],
])
  productAction(db, actor, {
    action: "saveDirectory",
    data: { id, mode: "projects", name },
  });
for (const [id, name] of [
  ["patrick", "Патрик"],
  ["melikantova", "Меликантова"],
  ["arkady", "Аркадий"],
  ["natasha", "Наташа архитектор"],
  ["juraj", "Юрай"],
])
  productAction(db, actor, {
    action: "saveDirectory",
    data: { id, mode: "contacts", name, responsible: true },
  });
db.close();
const server = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    "3100",
  ],
  { env, stdio: "inherit" },
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => server.kill(signal));
server.on("exit", (code) => {
  rmSync(dir, { recursive: true, force: true });
  process.exit(code || 0);
});
