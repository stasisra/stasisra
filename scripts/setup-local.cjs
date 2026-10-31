// Local setup for the separate Windows test installation. Never prints secrets.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { parseEnv } = require("node:util");
const { fileURLToPath } = require("node:url");
const Database = require("better-sqlite3");

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  if (!process.argv[index + 1]) throw new Error("Missing value: " + name);
  return process.argv[index + 1];
}

async function main() {
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || major > 24 || (major === 22 && minor < 12)) {
    throw new Error("Use Node.js 22.12+ or 24 in this terminal.");
  }
  const root = path.resolve(option("--target", process.cwd()));
  const sourceRoot = path.resolve(
    option("--source", path.join(root, "..", "task-gantt-app")),
  );
  if (root.toLowerCase() === sourceRoot.toLowerCase()) {
    throw new Error("New and old application folders must be different.");
  }
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf8"),
  );
  if (
    manifest.name !== "task-gantt-app" ||
    !fs.existsSync(path.join(root, "prisma"))
  ) {
    throw new Error(
      "Run this command from the new task-gantt-app-fixed folder.",
    );
  }
  const envPath = path.join(root, ".env");
  const destination = path.join(root, "prisma", "dev.db");
  if (fs.existsSync(envPath) || fs.existsSync(destination)) {
    throw new Error(
      "The new folder already contains .env or prisma/dev.db. Nothing was overwritten; check the existing setup first.",
    );
  }
  const previous = {};
  for (const name of [
    ".env",
    ".env.development",
    ".env.local",
    ".env.development.local",
  ]) {
    const filename = path.join(sourceRoot, name);
    if (fs.existsSync(filename))
      Object.assign(previous, parseEnv(fs.readFileSync(filename, "utf8")));
  }
  const configured = previous.DATABASE_URL || "file:./dev.db";
  if (!configured.startsWith("file:"))
    throw new Error("The old application must use SQLite.");
  const raw = decodeURIComponent(configured.slice(5).split("?")[0]);
  const resolved = configured.startsWith("file://")
    ? fileURLToPath(new URL(configured))
    : path.isAbsolute(raw)
      ? raw
      : path.resolve(sourceRoot, "prisma", raw);
  const source = path.resolve(option("--database", resolved));
  if (!fs.existsSync(source)) throw new Error("Database not found: " + source);
  const sourceReal = fs.realpathSync(source);
  const destinationReal = path.join(
    fs.realpathSync(path.dirname(destination)),
    "dev.db",
  );
  if (sourceReal.toLowerCase() === destinationReal.toLowerCase()) {
    throw new Error("Source and destination database must be different.");
  }
  const db = new Database(source, { readonly: true, fileMustExist: true });
  try {
    // SQLite backup reads a consistent snapshot, including WAL, while the old app runs.
    const admin = db
      .prepare("SELECT id FROM User WHERE role = 'ADMIN' LIMIT 1")
      .get();
    if (!admin) throw new Error("The source database has no ADMIN account.");
    db.prepare("SELECT id FROM Task LIMIT 1").get();
    await db.backup(destination);
  } finally {
    db.close();
  }
  fs.writeFileSync(
    envPath,
    [
      'DATABASE_URL="file:./dev.db"',
      'AUTH_JWT_SECRET="' + crypto.randomBytes(32).toString("hex") + '"',
      'APP_URL="http://127.0.0.1:3001"',
      "",
    ].join("\n"),
    { flag: "wx", mode: 0o600 },
  );
  const startFile = path.join(root, "start-new.cmd");
  if (!fs.existsSync(startFile)) {
    fs.writeFileSync(
      startFile,
      [
        "@echo off",
        'cd /d "%~dp0"',
        'set "PATH=' + path.dirname(process.execPath) + ';%PATH%"',
        "call npm.cmd run dev -- --hostname 127.0.0.1 --port 3001",
        "pause",
        "",
      ].join("\r\n"),
      { flag: "wx" },
    );
  }
  console.log("Database copied with SQLite backup: " + source);
  console.log("New database: " + destination);
  console.log(
    "New .env and start-new.cmd are ready. Secrets were not printed.",
  );
  console.log("Next: npm run db:init");
}

main().catch((error) => {
  console.error("Setup stopped: " + error.message);
  process.exitCode = 1;
});
