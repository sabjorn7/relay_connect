# Следующий шаг — отдельное согласование публикации интерфейса

Сначала убедиться, что GitHub main всё ещё 123cdab5222d42803adc310f53bdfccfde4cc9a9. При изменении базы остановить автоматическое применение и проверить diff.

В отдельной чистой ветке от этой базы:

```sh
git apply --check /path/to/frontend/changes.diff
git apply /path/to/frontend/changes.diff
python3 /path/to/frontend/apply-page.py
npm ci
./node_modules/.bin/vite build -l warn
```

Тесты full-club используют ATTACHMENTS=0 для состояния первой публикации и стандартный режим только для локального включённого mock. Все API перехватываются; реальные записи не выполняются.
После отдельного разрешения: stage только FILES.json list, conventional commit, PR, review diff, merge в main. Push main запускает существующий Deploy App на Node 24.14.0 с npm ci, postbuild и двухфазной публикацией assets→HTML. Workflow не менялся. До нового разрешения commit/PR/merge/Deploy не выполнять.

После будущей публикации: проверить /club и /chats, JS/CSS и ручной текстовый сценарий согласованного тестового аккаунта. Повторно запросить capability=false и оба trigger D. Не включать функции по факту успешного Deploy автоматически.

Откат UI: вернуть заранее подтверждённый production frontend SHA штатным Deploy App после решения об откате. База кандидата — 123cdab5; фактический deployed SHA перед публикацией нужно зафиксировать отдельно. Новые nullable серверные поля совместимы со старым UI; их не удалять. Для функций — server-next/disable.sql и PUSH_CLUB_ENABLED=false (по отдельному разрешению); не удалять данные/файлы и не менять прежнюю RLS.
