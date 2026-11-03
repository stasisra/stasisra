"""Offline in-place update for the existing next installation; no user data."""
from pathlib import Path
import hashlib,json,zipfile,runpy
root=Path(__file__).resolve().parent.parent
version=json.loads((root/'package.json').read_text())['version']
folder='task-gantt-update-'+version
# Reuse the complete source release file selection.
runpy.run_path(str(root/'scripts/package-next.py'))
launcher='''@echo off
setlocal
cd /d "%~dp0"
if exist "C:\\Distr_Local\\node-v22.23.4-win-x64\\node.exe" set "PATH=C:\\Distr_Local\\node-v22.23.4-win-x64;%PATH%"
node scripts\\update-next.cjs %*
if errorlevel 1 goto failed
echo Update finished. Run start-next.cmd in task-gantt-app-next.
pause
exit /b 0
:failed
echo Update stopped. Keep this window open and copy the error above.
pause
exit /b 1
'''
guide=f'''Обновление рабочей программы на 3003 — версия {version}

1. Остановите только новую программу на порту 3003: Ctrl+C в её окне.
2. Распакуйте этот архив ОТДЕЛЬНО, например в C:\\Distr_Local\\{folder}.
3. Запустите update-next.cmd. Дождитесь Update complete.
4. В прежней папке C:\\Distr_Local\\task-gantt-app-next запустите start-next.cmd.
5. Откройте http://localhost:3003 и обновите страницу Ctrl+F5.

Исправлена ошибка сборки из _updates/.../previous-build/types.
После Update rolled back закройте прежнее окно ошибки и запустите этот новый пакет.
Папку _updates с резервными копиями удалять не требуется.

Текущая база, импортированные задачи, тестовая тема, комментарии и файлы сохраняются.
Заново импортировать Excel не нужно. Вход и настройки остаются прежними.
Перед изменениями создаётся согласованная копия SQLite и копия программы в _updates.
При ошибке миграции или сборки помощник восстанавливает прежнюю базу и программу.
Используются уже установленные библиотеки; npm и Интернет после скачивания не нужны.
Не удаляйте task-gantt-app-workspace: её node_modules используются новой программой.

Для другого пути программы: update-next.cmd "C:\\путь\\к\\task-gantt-app-next"
Прямой запуск .cmd на Windows в облаке не проверялся; помощник проверяется на Linux.
'''
with zipfile.ZipFile(root/'downloads/task-gantt-app-next.zip') as z:
 payload={n.removeprefix('task-gantt-app-next/'):z.read(n) for n in z.namelist()}
for name in ['scripts/update-next.cjs','scripts/package-card-update.py']:
 payload[name]=(root/name).read_bytes()
manifest={'format':'task-gantt-update/v1','version':version,'files':{n:hashlib.sha256(b).hexdigest() for n,b in sorted(payload.items())}}
assets={'update-manifest.json':json.dumps(manifest,ensure_ascii=False,indent=2).encode(),'update-next.cmd':launcher.replace('\n','\r\n').encode('ascii'),'START-HERE.ru.txt':guide.encode(),'scripts/update-next.cjs':(root/'scripts/update-next.cjs').read_bytes()}
assets.update({'payload/'+n:b for n,b in payload.items()})
out=root/('downloads/'+folder+'.zip')
with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
 for name,data in sorted(assets.items()):
  info=zipfile.ZipInfo(folder+'/'+name,date_time=(2026,11,3,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;info.external_attr=0o100644<<16
  z.writestr(info,data,compress_type=zipfile.ZIP_DEFLATED,compresslevel=9)
with zipfile.ZipFile(out) as z:assert z.testzip() is None
sha=hashlib.sha256(out.read_bytes()).hexdigest();out.with_suffix('.sha256').write_text(sha+'  '+out.name+'\n');print(json.dumps({'file':out.name,'bytes':out.stat().st_size,'sha256':sha}))
