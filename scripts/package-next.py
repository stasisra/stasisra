"""Reproducible Windows-readable source release, excluding local/user data."""
from pathlib import Path
import hashlib, json, zipfile
root=Path(__file__).resolve().parent.parent
prefixes=('app/','components/','lib/','types/','styles/','public/','tests/','prisma/migrations/','config/')
files={'package.json','package-lock.json','README.md','START-HERE.ru.txt','CHECKS.md','FIXES.md','middleware.ts','next.config.mjs','next-env.d.ts','tsconfig.json','tailwind.config.ts','postcss.config.mjs','postcss.config.js','eslint.config.mjs','playwright.config.ts','.env.example','setup-next.cmd','start-next.cmd','workspace/index.html','prisma/schema.prisma','docs/product-description-ru.md','docs/data-structure.md'}
files.update(p.relative_to(root).as_posix() for base in prefixes for p in (root/base).rglob('*') if p.is_file())
files.update('scripts/'+n for n in ['init-db.ts','admin.ts','generate-client.cjs','setup-next.cjs','e2e-server.ts','export-review.cjs','migrate-workspace.ts','package-next.py','update-next.cjs','package-card-update.py','remove-kozub.cjs','setup-local.cjs','setup-workspace.cjs','package-review-export.py'])
files.update(p.relative_to(root).as_posix() for p in (root/'assets/fonts').rglob('*') if p.is_file())
files={f for f in files if (root/f).is_file() and not f.endswith(('.db','.db-wal','.db-shm'))}
out=root/'downloads/task-gantt-app-next.zip'
out.parent.mkdir(exist_ok=True)
with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as archive:
 for name in sorted(files):
  data=(root/name).read_bytes()
  if name.endswith('.cmd'):data=data.replace(b'\r\n',b'\n').replace(b'\n',b'\r\n')
  info=zipfile.ZipInfo('task-gantt-app-next/'+name,date_time=(2026,11,3,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;info.external_attr=0o100644<<16
  archive.writestr(info,data,compress_type=zipfile.ZIP_DEFLATED,compresslevel=9)
with zipfile.ZipFile(out) as archive:
 assert archive.testzip() is None
 assert not any('/node_modules/' in n or '/.env' in n and not n.endswith('/.env.example') for n in archive.namelist())
sha=hashlib.sha256(out.read_bytes()).hexdigest();out.with_suffix('.sha256').write_text(sha+'  '+out.name+'\n')
print(json.dumps({'file':out.name,'bytes':out.stat().st_size,'files':len(files),'sha256':sha}))
