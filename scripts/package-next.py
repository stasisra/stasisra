"""Package the source needed for a local installation, excluding runtime data."""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parent.parent
RELEASE_DATE = (2026, 11, 25, 0, 0, 0)


def source_payload():
    prefixes = ("app", "components", "lib", "types", "styles", "public", "tests",
                "prisma/migrations", "config", "assets/fonts")
    paths = set("""
        package.json package-lock.json README.md START-HERE.ru.txt CHECKS.md FIXES.md
        middleware.ts next.config.mjs next-env.d.ts tsconfig.json tailwind.config.ts
        postcss.config.mjs postcss.config.js eslint.config.mjs playwright.config.ts
        .env.example setup-next.cmd start-next.cmd workspace/index.html
        prisma/schema.prisma docs/product-description-ru.md docs/data-structure.md
        docs/install-update-ru.txt
    """.split())
    paths.update(p.relative_to(ROOT).as_posix() for folder in prefixes
                 for p in (ROOT / folder).rglob("*") if p.is_file())
    paths.update("scripts/" + p for p in """
        init-db.ts admin.ts generate-client.cjs setup-next.cjs e2e-server.ts
        export-review.cjs migrate-workspace.ts package-next.py update-next.cjs
        package-card-update.py remove-kozub.cjs setup-local.cjs setup-workspace.cjs
        package-review-export.py
    """.split())
    payload = {}
    for name in sorted(paths):
        parts = name.split("/")
        if (not (ROOT / name).is_file()
                or any(part in {"node_modules", ".next", "_updates", "__pycache__"}
                       or (part.startswith(".env") and part != ".env.example")
                       for part in parts)
                or name.endswith((".db", ".db-wal", ".db-shm", ".db-journal"))):
            continue
        data = (ROOT / name).read_bytes()
        if name.endswith(".cmd"):
            data = windows_lines(data)
        payload[name] = data
    return payload


def windows_lines(data):
    return data.replace(b"\r\n", b"\n").replace(b"\n", b"\r\n")


def write_zip(destination, folder, payload):
    destination.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(destination, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name, data in sorted(payload.items()):
            info = zipfile.ZipInfo(f"{folder}/{name}", date_time=RELEASE_DATE)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, data, compresslevel=9)
    with zipfile.ZipFile(destination) as archive:
        assert archive.testzip() is None
    digest = hashlib.sha256(destination.read_bytes()).hexdigest()
    destination.with_suffix(".sha256").write_text(f"{digest}  {destination.name}\n", encoding="ascii")
    print(json.dumps({"file": destination.name, "bytes": destination.stat().st_size,
                      "files": len(payload), "sha256": digest}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=ROOT / "downloads")
    args = parser.parse_args()
    write_zip(args.output / "task-gantt-app-next.zip", "task-gantt-app-next", source_payload())
