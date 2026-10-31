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
