"""Build an offline Windows update from the current source."""
import argparse
import hashlib
import json
from pathlib import Path
import runpy

ROOT = Path(__file__).resolve().parent.parent
helpers = runpy.run_path(str(ROOT / "scripts/package-next.py"))
parser = argparse.ArgumentParser()
parser.add_argument("--output", type=Path, default=ROOT / "downloads")
args = parser.parse_args()
version = json.loads((ROOT / "package.json").read_text())["version"]
folder = f"task-gantt-update-{version}"
launcher = r"""@echo off
setlocal
cd /d "%~dp0"
if exist "C:\Distr_Local\node-v22.23.4-win-x64\node.exe" set "PATH=C:\Distr_Local\node-v22.23.4-win-x64;%PATH%"
node scripts\update-next.cjs %*
if errorlevel 1 goto failed
echo Update finished. Run start-next.cmd in task-gantt-app-next.
pause
exit /b 0
:failed
echo Update stopped. Keep this window open and copy the error above.
pause
exit /b 1
"""
payload = helpers["source_payload"]()
manifest = {
    "format": "task-gantt-update/v1",
    "version": version,
    "files": {name: hashlib.sha256(data).hexdigest() for name, data in payload.items()},
}
guide = (ROOT / "docs/install-update-ru.txt").read_text(encoding="utf-8")
assets = {
    "update-manifest.json": json.dumps(manifest, ensure_ascii=False, indent=2).encode(),
    "update-next.cmd": helpers["windows_lines"](launcher.encode("ascii")),
    "START-HERE.ru.txt": helpers["windows_lines"](guide.encode("utf-8-sig")),
    "scripts/update-next.cjs": payload["scripts/update-next.cjs"],
    **{f"payload/{name}": data for name, data in payload.items()},
}
helpers["write_zip"](args.output / f"{folder}.zip", folder, assets)
