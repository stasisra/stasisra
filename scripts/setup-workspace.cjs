// Creates an independent snapshot of the current fixed installation, never overwriting a database.
const fs = require("node:fs");
const path = require("node:path");
const { parseEnv } = require("node:util");
const { execFileSync } = require("node:child_process");
const Database = require("better-sqlite3");
try {
  const root = process.cwd();
  const envFile = path.join(root, ".env"),
    dbFile = path.join(root, "prisma", "dev.db");
  if (
    [
      ".env.local",
      ".env.development",
      ".env.production",
      ".env.production.local",
      ".env.development.local",
    ].some((f) => fs.existsSync(path.join(root, f)))
  )
    throw Error(
      "Remove conflicting local environment overrides from the NEW folder before setup.",
    );
  if (fs.existsSync(envFile) || fs.existsSync(dbFile)) {
    if (!fs.existsSync(envFile) || !fs.existsSync(dbFile))
      throw Error(
        "Partial setup: .env and prisma/dev.db must both exist. Nothing was overwritten.",
      );
    const config = parseEnv(fs.readFileSync(envFile, "utf8"));
    if (
      config.DATABASE_URL !== "file:./dev.db" ||
      config.APP_URL !== "http://127.0.0.1:3002" ||
      (config.AUTH_JWT_SECRET || "").length < 32
    )
      throw Error(
        "Existing configuration differs from this installer. Nothing was overwritten.",
      );
    const db = new Database(dbFile, { readonly: true, fileMustExist: true });
    try {
      if (!db.prepare("SELECT 1 FROM User WHERE role='ADMIN' LIMIT 1").get())
        throw Error("Existing database has no administrator.");
      if (db.pragma("quick_check", { simple: true }) !== "ok")
        throw Error("Existing database integrity check failed.");
    } finally {
      db.close();
    }
    console.log(
      "Existing workspace database and settings retained. Continuing the update.",
    );
  } else {
    const source =
      process.argv[2] || path.join(root, "..", "task-gantt-app-fixed");
    execFileSync(
      process.execPath,
      [
        path.join(__dirname, "setup-local.cjs"),
        "--target",
        root,
        "--source",
        source,
        "--port",
        "3002",
        "--no-launcher",
      ],
      { stdio: "inherit" },
    );
    console.log(
      "Workspace snapshot prepared on port 3002. The source installation was not changed.",
    );
  }
} catch (error) {
  console.error("Setup stopped: " + error.message);
  process.exitCode = 1;
}
