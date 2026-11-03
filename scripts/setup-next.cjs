// Independent, offline-friendly next-model installation. Reuses libraries read-only.
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const { parseEnv } = require("node:util");
const { randomBytes } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { fileURLToPath } = require("node:url");

function prepareNext({
  root = process.cwd(),
  source = path.join(root, "..", "task-gantt-app-workspace"),
  build = true,
} = {}) {
  root = fs.realpathSync(root);
  source = fs.realpathSync(source);
  if (root.toLowerCase() === source.toLowerCase())
    throw Error("Source and new folders must differ.");
  const major = Number(process.versions.node.split(".")[0]);
  if (
    major < 22 ||
    major > 24 ||
    (major === 22 && Number(process.versions.node.split(".")[1]) < 12)
  )
    throw Error("Use Node.js 22.12+ or 24.");
  if (
    JSON.parse(fs.readFileSync(path.join(root, "package.json"))).name !==
    "task-gantt-app"
  )
    throw Error("Run setup from the new app folder.");
  if (
    [
      ".env.local",
      ".env.production",
      ".env.production.local",
      ".env.development",
      ".env.development.local",
    ].some((f) => fs.existsSync(path.join(root, f)))
  )
    throw Error("Conflicting environment overrides in the NEW folder.");
  const modules = path.join(root, "node_modules");
  if (!fs.existsSync(modules)) {
    const installed = path.join(source, "node_modules");
    if (!fs.existsSync(installed))
      throw Error(
        "Installed libraries were not found in the source application.",
      );
    fs.symlinkSync(
      installed,
      modules,
      process.platform === "win32" ? "junction" : "dir",
    );
  }
  const requireApp = createRequire(path.join(root, "package.json"));
  const Database = requireApp("better-sqlite3");
  for (const name of [
    "next/package.json",
    "tsx/package.json",
    "exceljs/package.json",
    "@prisma/client/package.json",
  ])
    requireApp.resolve(name);
  const filename = path.join(root, "prisma", "dev.db"),
    envFile = path.join(root, ".env");
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  if (fs.existsSync(filename) || fs.existsSync(envFile)) {
    if (!fs.existsSync(filename) || !fs.existsSync(envFile))
      throw Error(
        "Partial setup: .env and prisma/dev.db must both exist. Nothing was overwritten.",
      );
    const config = parseEnv(fs.readFileSync(envFile, "utf8"));
    if (
      config.DATABASE_URL !== "file:./dev.db" ||
      config.APP_URL !== "http://127.0.0.1:3003" ||
      (config.AUTH_JWT_SECRET || "").length < 32
    )
      throw Error("Existing configuration differs. Nothing was overwritten.");
    const db = new Database(filename, { readonly: true, fileMustExist: true });
    try {
      if (
        !db
          .prepare(
            "SELECT 1 FROM WorkspaceMeta WHERE key='product-model' AND value='1'",
          )
          .get() ||
        !db.prepare("SELECT 1 FROM User WHERE role='ADMIN'").get() ||
        db.pragma("quick_check", { simple: true }) !== "ok"
      )
        throw Error("Existing database failed verification.");
      if (
        !db
          .prepare(
            "SELECT 1 FROM WorkspaceMeta WHERE key='contact-profiles' AND value='1'",
          )
          .get()
      )
        throw Error(
          "For the existing 0.3 installation use update-next.cmd. The database was retained.",
        );
    } finally {
      db.close();
    }
    console.log("Existing next-model data and login retained.");
  } else {
    const config = {};
    for (const name of [
      ".env",
      ".env.production",
      ".env.local",
      ".env.production.local",
    ]) {
      const file = path.join(source, name);
      if (fs.existsSync(file))
        Object.assign(config, parseEnv(fs.readFileSync(file, "utf8")));
    }
    const url = config.DATABASE_URL || "file:./dev.db";
    if (!url.startsWith("file:")) throw Error("Source must use SQLite.");
    const raw = decodeURIComponent(url.slice(5).split("?")[0]);
    const sourceFile = url.startsWith("file://")
      ? fileURLToPath(new URL(url))
      : path.isAbsolute(raw)
        ? raw
        : path.resolve(source, "prisma", raw);
    const old = new Database(sourceFile, {
      readonly: true,
      fileMustExist: true,
    });
    let admin;
    try {
      admin = old
        .prepare(
          "SELECT id,name,email,passwordHash,createdAt FROM User WHERE role='ADMIN' ORDER BY createdAt LIMIT 1",
        )
        .get();
    } finally {
      old.close();
    }
    if (!admin)
      throw Error("No administrator found in the source application.");
    const temporary = path.join(
      root,
      "prisma",
      "setup-next-" + randomBytes(6).toString("hex") + ".db",
    );
    try {
      execFileSync(
        process.execPath,
        ["--import", "tsx", path.join(root, "scripts", "init-db.ts")],
        {
          cwd: root,
          env: { ...process.env, DATABASE_URL: "file:" + temporary },
          stdio: "pipe",
        },
      );
      const fresh = new Database(temporary);
      try {
        fresh
          .prepare(
            "INSERT INTO User(id,name,email,passwordHash,role,createdAt) VALUES(?,?,?,?,'ADMIN',?)",
          )
          .run(
            admin.id,
            admin.name,
            admin.email,
            admin.passwordHash,
            admin.createdAt,
          );
        if (fresh.pragma("foreign_key_check").length)
          throw Error("New database integrity check failed.");
      } finally {
        fresh.close();
      }
      fs.writeFileSync(
        envFile,
        [
          'DATABASE_URL="file:./dev.db"',
          'AUTH_JWT_SECRET="' + randomBytes(32).toString("hex") + '"',
          'APP_URL="http://127.0.0.1:3003"',
          'NEXT_TELEMETRY_DISABLED="1"',
          "",
        ].join("\n"),
        { flag: "wx", mode: 0o600 },
      );
      fs.renameSync(temporary, filename);
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
    console.log(
      "Fresh database created. Only the administrator login was copied; no tasks imported.",
    );
  }
  if (build) {
    execFileSync(
      process.execPath,
      [requireApp.resolve("next/dist/bin/next"), "build"],
      {
        cwd: root,
        env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
        stdio: "inherit",
      },
    );
    fs.writeFileSync(path.join(root, ".next-setup-ready"), "0.4.0\n");
  }
  console.log("Ready: start-next.cmd; http://127.0.0.1:3003.");
  return { database: filename };
}
module.exports = { prepareNext };
if (require.main === module) {
  try {
    prepareNext({ source: process.argv[2] || undefined });
  } catch (error) {
    console.error("Setup stopped: " + error.message);
    process.exitCode = 1;
  }
}
