sha256(payload below): 44e2292aae69b144cc7915fe0f229fb1f047db1f785d6b80264fd38d0c0f3fc6

# Видео-прокси, шаг 1 (вариант B): факты, nginx /vod/ без кэша, ручной тест mp4

Статус: **только анализ и конфиг на ревью.** nginx не трогал, не релоадил, фронт не деплоил.

## 1. Ответы на вопросы

**Где живёт nginx для app.meetgu.ru.** На хосте `app.meetgu.ru` (SSH `mg-jump` = root@…:2222; это та же машина
95.143.220.169). Конфиг в `/etc/nginx/` (split по `sites-enabled/`): server-блок `server_name app.meetgu.ru`
(в дампе `nginx -T` ~строки 240–351), `root /home/arseny/www-app`, API-прокси `proxy_pass http://kong/`.
Точный файл: `grep -rl "app.meetgu.ru" /etc/nginx/sites-enabled/`.

**Можно ли проксировать прямо на backend PeerTube (а не на публичный video.meetgu.ru).** ДА, и это даже лучше:
- **PeerTube и nginx app — на ОДНОМ хосте.** PeerTube (`pid 956`) слушает **`127.0.0.1:9000`** (nginx-апстрим
  `upstream backend { server 127.0.0.1:9000; }`). Значит `/vod/` ходит на localhost — никакого публичного
  video.meetgu.ru, никакого SNI/нового внешнего соединения (ровно то, что ломалось на Tele2).
- Ещё лучше: **публичное медиа PeerTube раздаёт nginx прямо с диска** `root /var/www/peertube/storage`
  (локация `^/static/(webseed|web-videos|redundancy|streaming-playlists)/`, `sendfile`, нативный Range).
  Приватное (`.../private/`, `/download`) идёт через node с авторизацией. Наши курсовые видео — публичные
  (см. ниже), поэтому для `/vod/` раздаём публичное **с диска напрямую** (быстрее, нативный 206), а
  `/vod/api/v1/videos/` (метаданные для фронта) проксируем на `127.0.0.1:9000`.

**Свободное место на диске.** `/` — 56 ГБ свободно (97 ГБ, занято 40%). **`/video` — 5.8 ТБ свободно**
(8.9 ТБ, 33%); хранилище PeerTube `/var/www/peertube/storage` на этом томе. Для шага 1 кэш НЕ включаем —
место под прокси не расходуется.

**Публичные видео или закрыты токеном; как сейчас защищён платный контент.** Эмбед формируется как
`video.meetgu.ru/videos/embed/<uuid>?title=0&warningTitle=0&peertubeLink=0&p2p=0` — **токена/плейбэк-токена
в URL НЕТ**. То есть видео в PeerTube **публичные/unlisted** (играются по UUID кем угодно, кто знает ссылку).
Кэшированный токен `Peertube_System` используется ТОЛЬКО для загрузки/создания (системный аккаунт), не для
воспроизведения. **Платный доступ защищён исключительно на уровне приложения**: `MyCoursePage` рендерит
iframe только владельцу (ownership-гейт); сами media-URL открыты и сейчас на video.meetgu.ru.
→ **`/vod/` не ослабляет защиту**: отдаёт ровно то же публичное медиа, что уже открыто (status-quo, не
регрессия). Приватные пути (`/private/`, `/download`) через `/vod/` **запрещаем** (deny), чтобы точно ничего
не открыть сверх текущего. Если когда-то захотим настоящую пер-юзер защиту — это отдельная большая история
(signed URLs / PeerTube private + токены), не в этом шаге.

**Слушает ли MyCoursePage/ArticlePage события из iframe (postMessage).** НЕТ. По коду:
- `MyCoursePage` — только `<iframe @load="onVideoLoaded">` (событие загрузки iframe для watchdog/авто-ретрая),
  **никаких `addEventListener('message')` / PeerTube player events**. Прогресс урока не трекается:
  `users.last_open = course.id` ставится при открытии курса (не из плеера), «просмотрено/позиция/конец
  урока» вообще не слушаются.
- `ArticlePage` — тоже без message-листенеров.
→ **При замене на нативный `<video>` ничего не ломается** из трекинга (его нет). Единственное, что надо
перенести — load-watchdog `onVideoLoaded` на нативные события (`loadeddata`/`canplay` + `error` + `timeupdate`),
и сохранить существующий авто-ретрай/пробу. Полноэкран/PiP/AirPlay нативный `<video>` умеет (не хуже iframe).

## 2. nginx-конфиг /vod/ (добавление в server-блок app.meetgu.ru) — БЕЗ кэша

Чистое **добавление** (ничего не удаляем). Вставить внутрь `server { server_name app.meetgu.ru; … }`
(файл из `grep -rl "app.meetgu.ru" /etc/nginx/sites-enabled/`). Порядок важен: deny-приватного ПЕРЕД публичным.

```nginx
    # ---- /vod/ : same-origin доставка ПУБЛИЧНОГО медиа PeerTube (шаг 1, без кэша) ----
    # Allow-list: только публичное media + videos-API. Приватное и всё прочее под /vod/ запрещено.

    # (a) deny приватного медиа через /vod/ (эти пути требуют node-авторизации — наружу не отдаём):
    location ~ ^/vod/static/(webseed|web-videos|streaming-playlists/hls)/private/ { return 403; }
    location ~ ^/vod/(download|api/v1/videos/[^/]+/token) { return 403; }

    # (b) публичное медиа — ОТДАЁМ С ДИСКА напрямую (как делает video.meetgu.ru), нативный Range/206:
    location ~ ^/vod/static/(webseed|web-videos|redundancy|streaming-playlists)/ {
        root /var/www/peertube/storage;
        sendfile on;
        sendfile_max_chunk 1M;
        aio threads;
        limit_rate_after 5M;
        limit_rate 5M;
        add_header X-Vod-Proxy 1 always;          # маркер прокси (для проверки)
        # маппинг URL → путь на диске (как в конфиге video.meetgu.ru):
        rewrite ^/vod/static/webseed/(.*)$ /web-videos/$1 break;
        rewrite ^/vod/static/(.*)$         /$1            break;
        try_files $uri =404;                       # НЕ уходим в node; нет файла → 404
    }

    # (c) videos-API (метаданные: fileUrl/playlistUrl) → локальный backend, БЕЗ Cookie/Set-Cookie:
    location ~ ^/vod/api/v1/videos/ {
        proxy_pass              http://127.0.0.1:9000;
        proxy_http_version      1.1;
        proxy_set_header        Host video.meetgu.ru;   # PeerTube ждёт свой канонический Host
        proxy_set_header        X-Forwarded-Proto https;
        proxy_set_header        Cookie "";              # не пробрасываем cookie клиента
        proxy_hide_header       Set-Cookie;             # и не отдаём set-cookie наружу
        proxy_set_header        Range $http_range;
        proxy_set_header        If-Range $http_if_range;
        proxy_buffering         off;
        proxy_connect_timeout   5s;
        proxy_send_timeout      60s;
        proxy_read_timeout      60s;
        add_header              X-Vod-Proxy 1 always;
        rewrite ^/vod/(.*)$ /$1 break;                  # /vod/api/... → /api/...
    }

    # (d) всё остальное под /vod/ — запрещено:
    location /vod/ { return 404; }
    # ---- /vod/ end ----
```

Применение (по отдельному ОК, НЕ сейчас): `nginx -t` → при OK `nginx -s reload` (**reload, не рестарт** —
активные соединения/эфиры не рвутся). Откат: удалить блок `/vod/` → `nginx -t` → `reload`.

Заметки:
- **Range/206** для (b) даёт сам nginx при отдаче файла (`sendfile`) — ровно как video.meetgu.ru; отдельные
  proxy-директивы не нужны. Для (c) Range пробрасывается в backend.
- **Cookie**: статика с диска (b) куки не трогает вовсе; в прокси (c) куки срезаны в обе стороны.
- **CORS**: при same-origin (фронт на app.meetgu.ru → /vod/ на app.meetgu.ru) CORS не нужен; поэтому
  ACAO-заголовки намеренно НЕ добавляю (в отличие от кросс-доменного video.meetgu.ru).
- **Кэш**: в шаге 1 нет (как просил). Позже — отдельным шагом (`proxy_cache`/`slice`).

## 3. Ручной тест ОДНОГО mp4 через /vod/ (после применения nginx; без деплоя фронта)

Фронт НЕ трогаем — тестируем сам прокси «голым» URL.

**Шаг A. Узнать путь к mp4 публичного видео** (с десктопа; `<UUID>` = `video_id` любого урока):
```
curl -s "https://video.meetgu.ru/api/v1/videos/<UUID>" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print('files:', [f.get('fileUrl') for f in d.get('files',[])]); print('hls:', [p.get('playlistUrl') for p in d.get('streamingPlaylists',[])])"
# берём fileUrl вида  https://video.meetgu.ru/static/web-videos/<name>.mp4
# его /vod/-аналог:    https://app.meetgu.ru/vod/static/web-videos/<name>.mp4
```

**Шаг B. Проверка 206/заголовков с десктопа** (ждём `206`, `Content-Range`, `X-Vod-Proxy: 1`, НЕТ `Set-Cookie`):
```
curl -sI -r 0-99 "https://app.meetgu.ru/vod/static/web-videos/<name>.mp4"
# сравнить с прямым video-хостом:
curl -sI -r 0-99 "https://video.meetgu.ru/static/web-videos/<name>.mp4"
# проверить, что приватное через /vod/ закрыто (ждём 403):
curl -sI "https://app.meetgu.ru/vod/static/streaming-playlists/hls/private/zzz"
```

**Шаг C. iPhone на Tele2 (мобильные данные, без Wi-Fi)** — открыть в Safari ПРЯМО URL (Safari играет mp4 с Range):
```
https://app.meetgu.ru/vod/static/web-videos/<name>.mp4      ← должен играть/перематываться
https://video.meetgu.ru/static/web-videos/<name>.mp4        ← для сравнения (обычно стоит/таймаут на Tele2)
```
Критерий успеха: `/vod/`-URL стартует и перематывается на Tele2, а прямой video-URL — нет (или заметно хуже).
Это подтверждает гипотезу «media по рабочему app-соединению проходит, по video-хосту — нет», ещё до фронта.

(Опц.) HLS той же проверкой: `https://app.meetgu.ru/vod/static/streaming-playlists/hls/<uuid>/master.m3u8`
в Safari (нативный HLS) — если у видео есть HLS.

## Резюме
- Проксируем на **локальный backend/диск** (127.0.0.1:9000 и `/var/www/peertube/storage`), не на публичный
  video.meetgu.ru — это и есть суть фикса (media идёт по app-соединению, без SNI к video-хосту).
- Видео публичные, защита — app-слой; `/vod/` отдаёт только публичное, приватное deny → без регрессии.
- postMessage/трекинг не используется → нативный `<video>` безопасен (перенести лишь load-watchdog).
- Диска вдоволь; кэш в шаге 1 не нужен.
- Ждём ОК на применение nginx-блока (nginx -t + reload) и прогон теста по §3; фронт — отдельным шагом.
