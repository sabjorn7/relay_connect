sha256(payload below): 81e65e3d40992b9ae47b76907122696336bb1051b45a77fdb948ad4643372b63

# Видео-прокси, шаг 1 — доработка: анализ перехвата /vod/, правка (c), скрипты deploy/rollback

Статус: **только анализ и файлы на ревью.** nginx на проде не трогал, не релоадил, фронт не деплоил.
Запуск скриптов — ТОЛЬКО по ОК владельца + после добавления их sha в approved.sha. Файл в репо
разрешением не является.

## 1. Проверка перехвата /vod/ (по `nginx -T`, 443-блок app.meetgu.ru)

Все `location` 443-блока `server_name app.meetgu.ru` по порядку:
1. `location ^~ /sb/` → proxy на kong (prefix `^~`)
2. `location = /_l` (beacon, exact)
3. `location = /serviceworker.js` (exact)
4. **`location ~* \.html$`** (regex) — ловит ТОЛЬКО `.html`
5. `location = /` (exact)
6. `location ^~ /_t/` (www-diag, prefix `^~`)
7. `location /data/` (prefix)
8. `location /assets/` (prefix, immutable-кэш)
9. `location /dep` (prefix; вложенно `~ \.php$`)
10. **`location ~ ^/(articles|course|event)/[^/]+/?$`** (regex) — ловит ТОЛЬКО эти префиксы (OG-пререндер)
11. `location @og` (named)
12. `location /` (prefix — SPA-fallback, `root /home/arseny/www-app`, `index.html`)

**Вывод: перехвата `/vod/` НЕТ.**
- Нет generic-regex по расширениям (нет `~* \.(mp4|m3u8|ts|js|css|…)$`) — именно такой блок перехватывал бы
  `/vod/*.mp4|m3u8` раньше наших. Его нет.
- Два существующих regex не трогают `/vod/`: `~* \.html$` матчит лишь `.html`; `~ ^/(articles|course|event)/…`
  — лишь эти префиксы.
- SPA `location /` — префикс; любой наш `/vod/`-regex специфичнее и выигрывает у него.

**Решение по порядку:** на всякий случай (на будущее, если позже появится generic-regex статики) блок
`/vod/` вставляется **ПЕРВЫМ location** в server-блоке — перед `location ^~ /sb/`. Так наши `/vod/`-regex
гарантированно проверяются раньше любых будущих regex (среди regex побеждает первый по порядку в файле).
Отдельный `^~`-вариант не нужен: regex-формы требуются для разделения public/private/api внутри `/vod/`.

## 2. Правка (c): limit_except

В локацию `~ ^/vod/api/v1/videos/` добавлено:
```nginx
    limit_except GET HEAD { deny all; }
```
→ любые методы кроме GET/HEAD (POST/PUT/DELETE/…) получают 403. Проверяется самотестом
«POST /vod/api/v1/videos/ → 403/405».

## 3. Скрипты (в outbox/) и их sha256 (для approved.sha)

> Примечание по формату: у .sh первой строкой обязан быть shebang (`#!/usr/bin/env bash`), поэтому sha
> внутрь скрипта не вшиваю (было бы циклично и/или сломало бы запуск). sha256 целого файла — здесь и в
> строке в чате; именно их владелец кладёт в `approved.sha` для mg-deploy.

- **`deploy-vod-proxy.sh`** — sha256 `73dbe1da078579d4e541e46ffd92ecae479f044457b2e8ca6c3ffa38ea8ae139`
  - находит конфиг: `grep -rlE 'server_name\s+app\.meetgu\.ru' /etc/nginx/{sites-enabled,conf.d,sites-available}`;
  - проверяет якорь `location ^~ /sb/` (иначе FAIL — не тот файл);
  - **идемпотентно**: если маркер `# ---- /vod/` уже есть — вставку пропускает;
  - **бэкап** `CONF.bak-<таймстамп>` перед изменением;
  - вставка блока `/vod/` ПЕРЕД первым `location ^~ /sb/` (через awk);
  - `nginx -t`; **при ошибке — восстановить бэкап и выйти FAIL, reload НЕ делать**;
  - `nginx -s reload` (НЕ restart);
  - самопроверки (curl, -m 10): private→403, мусор→404, `GET /`→200, `https://video.meetgu.ru/`→200,
    `POST /vod/api/v1/videos/`→403/405; при провале — откат из бэкапа + reload + FAIL;
  - финал: **`DEPLOY OK`** (с путём бэкапа) или **`DEPLOY FAIL`**.
- **`rollback-vod-proxy.sh`** — sha256 `cf04139e73a45bb472a8768d627c350cf413d83488f89ab5d8d6ac5b4d6ddead`
  - находит конфиг и **последний** `CONF.bak-*`; делает страховочную `CONF.prerollback-*`; восстанавливает
    из бэкапа; `nginx -t` (при ошибке reload НЕ делает, FAIL); `nginx -s reload`; **`ROLLBACK OK/FAIL`**.

Оба: `bash -n` чисто; `set -uo pipefail`; гейт `MG_CONFIRM=yes` или `--yes`; PeerTube/video.meetgu.ru не трогают.

## Порядок (по твоему ОК)
1. Ты добавляешь sha `deploy-vod-proxy.sh` (и `rollback-vod-proxy.sh`) в `approved.sha` на sb-хосте.
2. Я (по явному ОК) кладу `deploy-vod-proxy.sh` в staging, сверяю sha, запускаю через mg-deploy; присылаю
   вывод до `DEPLOY OK` (самопроверки).
3. Затем — ручной тест одного mp4 с iPhone/Tele2 (см. предыдущий файл step1, §3).
Если что-то не так — `rollback-vod-proxy.sh` тем же путём. Без ОК ничего не запускаю.
