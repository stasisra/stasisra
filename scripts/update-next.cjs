// Updates the existing 3003 installation. Never imports legacy task data.
const fs = require("node:fs"),
  path = require("node:path"),
  net = require("node:net");
const { createHash, randomBytes } = require("node:crypto"),
  { createRequire } = require("node:module"),
  { parseEnv } = require("node:util"),
  { execFileSync } = require("node:child_process");
const sha = (b) => createHash("sha256").update(b).digest("hex");
async function portBusy(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: "127.0.0.1" });
    let done = false;
    const end = (value) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(value);
    };
    socket.once("connect", () => end(true));
    socket.once("error", () => end(false));
    socket.setTimeout(800, () => end(true));
  });
}
function allowed(name) {
  return (
    !name.includes("\\") &&
    !name.includes(":") &&
    !name.split("/").some((p) => !p || p === "." || p === "..") &&
    (/^(app|components|lib|types|styles|public|workspace|config|tests|assets|scripts|docs)\//.test(
      name,
    ) ||
      /^prisma\/(migrations\/|schema\.prisma$)/.test(name) ||
      [
        "package.json",
        "package-lock.json",
        "README.md",
        "START-HERE.ru.txt",
        "CHECKS.md",
        "FIXES.md",
        "middleware.ts",
        "next.config.mjs",
        "next-env.d.ts",
        "tsconfig.json",
        "tailwind.config.ts",
        "postcss.config.mjs",
        "eslint.config.mjs",
        "playwright.config.ts",
        ".env.example",
        "setup-next.cmd",
        "start-next.cmd",
      ].includes(name)) &&
    !/\.(db|db-wal|db-shm)$/.test(name) &&
    !name.includes("node_modules") &&
    !name.includes(".next/")
  );
}
async function updateNext({
  source = path.resolve(__dirname, ".."),
  target = "C:/Distr_Local/task-gantt-app-next",
  build = true,
  runCommand,
} = {}) {
  source = fs.realpathSync(source);
  target = fs.realpathSync(target);
  if (source.toLowerCase() === target.toLowerCase())
    throw Error("Unpack the update into a separate folder.");
  const manifest = JSON.parse(
    fs.readFileSync(path.join(source, "update-manifest.json"), "utf8"),
  );
  if (
    manifest.format !== "task-gantt-update/v1" ||
    manifest.version !== "0.4.0" ||
    !manifest.files ||
    Object.keys(manifest.files).length < 10
  )
    throw Error("Invalid update manifest.");
  const files = Object.keys(manifest.files);
  for (const name of files) {
    if (!allowed(name)) throw Error("Forbidden update path: " + name);
    const payload = path.join(source, "payload", name);
    if (
      !fs.statSync(payload).isFile() ||
      sha(fs.readFileSync(payload)) !== manifest.files[name]
    )
      throw Error("Update checksum failed: " + name);
  }
  if (
    JSON.parse(fs.readFileSync(path.join(target, "package.json"), "utf8"))
      .name !== "task-gantt-app"
  )
    throw Error("Wrong application folder.");
  const envBytes = fs.readFileSync(path.join(target, ".env")),
    config = parseEnv(envBytes.toString());
  if (
    config.DATABASE_URL !== "file:./dev.db" ||
    config.APP_URL !== "http://127.0.0.1:3003"
  )
    throw Error(
      "The update requires the existing next-model app on port 3003.",
    );
  if (await portBusy(3003))
    throw Error(
      "Stop ONLY the program on port 3003 (Ctrl+C in its window), then run this update again.",
    );
  const requireApp = createRequire(path.join(target, "package.json")),
    Database = requireApp("better-sqlite3");
  const lock = path.join(target, ".next-update.lock");
  fs.writeFileSync(lock, "Update in progress\n", { flag: "wx" });
  const stamp =
    new Date().toISOString().replace(/[:.]/g, "-") +
    "-" +
    randomBytes(3).toString("hex");
  const backup = path.join(target, "_updates", stamp),
    dbFile = path.join(target, "prisma", "dev.db");
  let touched = false,
    oldBuild = false,
    readyBytes = null;
  const existing = [];
  const run =
    runCommand ||
    ((args, options) => execFileSync(process.execPath, args, options));
  try {
    fs.mkdirSync(path.join(backup, "files"), { recursive: true });
    const db = new Database(dbFile, { readonly: true, fileMustExist: true });
    try {
      if (
        db.pragma("quick_check", { simple: true }) !== "ok" ||
        !db
          .prepare(
            "SELECT 1 FROM WorkspaceMeta WHERE key='product-model' AND value='1'",
          )
          .get()
      )
        throw Error("Database is not the installed next model.");
      await db.backup(path.join(backup, "database-before.db"));
    } finally {
      db.close();
    }
    fs.writeFileSync(path.join(backup, "settings-before.env"), envBytes, {
      mode: 0o600,
    });
    for (const name of files) {
      const from = path.join(target, name);
      if (fs.existsSync(from)) {
        const to = path.join(backup, "files", name);
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.copyFileSync(from, to);
        existing.push(name);
      }
    }
    fs.writeFileSync(
      path.join(backup, "manifest.json"),
      JSON.stringify({ version: "0.4.0", files, existing }, null, 2),
    );
    const ready = path.join(target, ".next-setup-ready");
    if (fs.existsSync(ready)) readyBytes = fs.readFileSync(ready);
    touched = true;
    if (fs.existsSync(ready)) fs.unlinkSync(ready);
    if (fs.existsSync(path.join(target, ".next"))) {
      fs.renameSync(
        path.join(target, ".next"),
        path.join(backup, "previous-build"),
      );
      oldBuild = true;
    }
    for (const name of files) {
      const to = path.join(target, name);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(path.join(source, "payload", name), to);
    }
    const env = {
      ...process.env,
      DATABASE_URL: "file:" + dbFile,
      AUTH_JWT_SECRET: config.AUTH_JWT_SECRET,
      APP_URL: config.APP_URL,
      NEXT_TELEMETRY_DISABLED: "1",
    };
    run(["--import", "tsx", path.join(target, "scripts", "init-db.ts")], {
      cwd: target,
      env,
      stdio: "inherit",
    });
    if (build)
      run([requireApp.resolve("next/dist/bin/next"), "build"], {
        cwd: target,
        env,
        stdio: "inherit",
      });
    const check = new Database(dbFile, { readonly: true, fileMustExist: true });
    try {
      if (
        check.pragma("foreign_key_check").length ||
        check.pragma("quick_check", { simple: true }) !== "ok"
      )
        throw Error("Updated database integrity check failed.");
      if (
        !check
          .prepare(
            "SELECT 1 FROM WorkspaceMeta WHERE key='contact-profiles' AND value='1'",
          )
          .get()
      )
        throw Error("Contact profile migration missing.");
    } finally {
      check.close();
    }
    if (build) fs.writeFileSync(ready, "0.4.0\n");
    console.log(
      "Update complete. Existing tasks, events, contacts, notes and files retained.",
    );
    console.log("Backup: " + backup);
    console.log("Run start-next.cmd; http://127.0.0.1:3003");
    return { backup, database: dbFile };
  } catch (error) {
    if (touched) {
      // Server is stopped; all child commands have completed before rollback.
      for (const suffix of ["-wal", "-shm"])
        fs.rmSync(dbFile + suffix, { force: true });
      fs.copyFileSync(path.join(backup, "database-before.db"), dbFile);
      const old = new Set(existing);
      for (const name of files) {
        const file = path.join(target, name);
        if (old.has(name)) {
          fs.mkdirSync(path.dirname(file), { recursive: true });
          fs.copyFileSync(path.join(backup, "files", name), file);
        } else fs.rmSync(file, { force: true });
      }
      fs.rmSync(path.join(target, ".next"), { recursive: true, force: true });
      if (oldBuild)
        fs.renameSync(
          path.join(backup, "previous-build"),
          path.join(target, ".next"),
        );
      if (readyBytes)
        fs.writeFileSync(path.join(target, ".next-setup-ready"), readyBytes);
      else fs.rmSync(path.join(target, ".next-setup-ready"), { force: true });
      console.error(
        "Update rolled back. Previous database, source files and build restored.",
      );
    }
    throw error;
  } finally {
    fs.rmSync(lock, { force: true });
  }
}
module.exports = { updateNext, allowed };
if (require.main === module)
  updateNext({
    source: path.resolve(__dirname, ".."),
    target: process.argv[2] || undefined,
  }).catch((e) => {
    console.error("Update stopped: " + e.message);
    process.exitCode = 1;
  });
