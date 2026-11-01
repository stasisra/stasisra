"""Package the offline Excel exporter. No application data or npm modules."""
import hashlib,json,zipfile
from pathlib import Path
root=Path(__file__).resolve().parent.parent
launcher='''@echo off
setlocal
cd /d "%~dp0"
if exist "C:\\Distr_Local\\node-v22.23.4-win-x64\\node.exe" set "PATH=C:\\Distr_Local\\node-v22.23.4-win-x64;%PATH%"
where node.exe >nul 2>nul
if errorlevel 1 goto no_node
node export-review.cjs --open
if errorlevel 1 goto failed
echo.
echo Open tasks-review.xlsx in the export folder.
echo Your working database was not changed.
pause
exit /b 0
:no_node
echo Node.js was not found. Use the same Node.js as your working app.
pause
exit /b 1
:failed
echo Export stopped. Keep this window open and copy the error above.
pause
exit /b 1
'''
guide='''Выгрузка актуальных задач в Excel для очистки

1. Распакуйте эту папку отдельно, например в Загрузки.
2. Запустите export-to-excel.cmd.
3. Откроется папка экспорта. Откройте tasks-review.xlsx.
4. На листе «Отбор задач» отмечайте «Оставить» или «Удалить».
   Остальные жёлтые колонки необязательны: новый тип, название, тема, родитель и комментарий.
5. Сохраните изменённый Excel и пришлите его. Остальные файлы экспорта сохраните у себя.

По умолчанию источник: C:\\Distr_Local\\task-gantt-app-workspace.
Выгрузка читает актуальную базу, включая записи работающей программы в WAL.
Останавливать программу не требуется. Ничего из рабочей базы не удаляется.
После скачивания пакета Интернет не нужен: используются установленные библиотеки программы.

Экспорт появится внутри приложения в exports\\review-...:
- tasks-review.xlsx — таблица для разметки и дополнительные листы;
- data.json — полные рабочие данные для последующего импорта;
- files — оригиналы вложений;
- database-full.db — полная резервная копия базы;
- manifest.json — сведения о снимке.

Не удаляйте строки и служебные колонки: отмечайте решение в таблице.
Можно фильтровать и сортировать. Одинаковые названия различаются путём и сохранённым ID.
Длинные описания разбиты на части на листе «Полные тексты» и полностью сохранены в data.json.
Жёлтые поля можно оставить как есть, заполнив только Решение и Комментарий.
Существующие данные программы и её настройки остаются на месте.
Полная копия базы остаётся у вас; для первого этапа достаточно прислать только Excel.

Если программа расположена в другой папке, из Git Bash в папке выгрузки:
node export-review.cjs --source "C:/путь/к/приложению" --open

Непосредственный запуск .cmd на Windows в облаке не выполнялся.
Помощник проверен с настоящей SQLite в WAL, файлами, комментариями и длинными описаниями.
'''
assets={'export-review.cjs':(root/'scripts/export-review.cjs').read_bytes(),'export-to-excel.cmd':launcher.replace('\n','\r\n').encode('ascii'),'START-HERE.ru.txt':guide.encode()}
out=root/'downloads/task-gantt-export-review.zip'
with zipfile.ZipFile(out,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:
 for name,data in assets.items():z.writestr('task-gantt-export-review/'+name,data)
with zipfile.ZipFile(out) as z:assert z.testzip() is None
sha=hashlib.sha256(out.read_bytes()).hexdigest();out.with_suffix('.sha256').write_text(sha+'  '+out.name+'\n');print(json.dumps({'file':out.name,'bytes':out.stat().st_size,'sha256':sha}))
