sha256(payload below): 8936da0f48719b92643771c003b99cb8dda8d3630571d2e6648a27495198c88c

# План: same-origin доставка видео под app.meetgu.ru (борьба с «белыми экранами» на iOS/Tele2)

Статус: **только план на ревью.** Ничего не меняется, не деплоится, не рестартится.
Цель: media-трафик VOD-уроков идёт по уже рабочему соединению `app.meetgu.ru`, а не по
`video.meetgu.ru` (который на части мобильных путей — Tele2/CGNAT — не поднимает новое соединение/SNI).

## 0. Важная вводная (меняет постановку)

Сейчас видео играет **iframe-эмбед PeerTube**: `https://video.meetgu.ru/videos/embed/<id>` (ArticlePage,
StreamsPage, MyCoursePage — `<iframe :src="embedUrl(video_id)">`). Это НЕ наш плеер.

**У PeerTube нет режима «относительные URL».** Эмбед-страница, её JS/CSS, API-ответы (`fileUrl`,
`playlistUrl`, `segmentsSha256Url`) и HLS-плейлисты генерируются с **абсолютными** URL из
`webserver.hostname`. Поэтому «просто добавить nginx-локацию» НЕ сработает: даже если проксировать саму
embed-страницу, плеер внутри iframe всё равно полезет на `video.meetgu.ru` (абсолютные URL) → та же
проблема. Отсюда ровно два пути сделать origin единым:

- **A. Сменить `webserver.hostname` PeerTube на app.meetgu.ru** + реверс-проксить нужные префиксы
  PeerTube под app. PeerTube сам начнёт отдавать app-URL. Чисто, но меняет канонический хост (риски ниже).
- **B. Не трогать PeerTube; уйти от embed на VOD и играть файл нативно**, подменяя URL на свой
  same-origin прокси. Изолированно, обратимо по-странично, не ломает `video.meetgu.ru`/ссылки/эмбеды.

**Рекомендация: начать с B** (целит ровно в симптом — VOD-урок на iOS/Safari, минимальный радиус
поражения, живые эфиры не трогаем). A держать как «полный» вариант, если позже захотим и live
same-origin — там выше цена и риск.

---

## 1. Что меняем в PeerTube и чем это грозит

### Вариант B (рекомендуемый) — PeerTube НЕ меняем
- `webserver.hostname` остаётся `video.meetgu.ru`. **Ноль изменений в PeerTube-конфиге, ноль рестартов
  PeerTube, федерация/ссылки/существующие эмбеды/БД-URL не трогаются.**
- Единственное требование к контенту: у VOD должен быть проигрываемый ресурс по HTTP — HLS-плейлист
  (`.../streaming-playlists/hls/<uuid>/master.m3u8`) и/или исходный `.mp4` (`files[].fileUrl`). По нашим
  замерам включено «только исходное» → `.mp4` есть всегда; HLS есть не у всех. План это учитывает (ниже).

### Вариант A (полный) — смена `webserver.hostname`
Файл: `config/production.yaml` → `webserver: { https: true, hostname: app.meetgu.ru, port: 443 }` + рестарт
PeerTube. Чем грозит:
- **Канонические URL меняются на app.meetgu.ru** во всём: embed-страница, client-JS, API, HLS, RSS,
  sitemap, письма, ActivityPub-актёры. Если инстанс когда-либо федерировался — ломается идентичность
  актёров (для приватного инстанса обычно не критично, но это необратимо «чисто»).
- **Существующие эмбеды в статьях** (`video.meetgu.ru/videos/embed/<id>`) продолжат открываться (nginx на
  video-хосте жив), но внутри будут тянуть ассеты/медиа с app.meetgu.ru → из iframe с origin
  video.meetgu.ru это cross-origin fetch (нужны CORS-заголовки PeerTube на /static — обычно уже `*`).
- **Коллизии путей**: app владеет корнем app.meetgu.ru и своими маршрутами (/course, /articles, /streams,
  /my_courses…). Проксировать на PeerTube нужно строго ALLOW-LIST префиксов PeerTube (/videos, /w, /client,
  /api, /static, /lazy-static, /plugins, /download, /socket.io, /live, /.well-known, /manifest.webmanifest,
  /tracker). Проверить, что ни один не пересекается с маршрутами SPA (на вид — не пересекаются; /superadmin
  ≠ /admin, /articles ≠ /a). Любая новая SPA-страница с коротким путём в будущем → риск коллизии.
- **Торренты/magnet** содержат старый трекер-хост, но P2P в наших эмбедах выключен (`p2p=0`) → неважно.

---

## 2. nginx same-origin прокси под app.meetgu.ru

Общий для B (и ядро для A). Отдельный `location`, проксирующий медиа на PeerTube, с Range/HLS/кэшем.

```nginx
# В server-блоке app.meetgu.ru (443). Префикс /vod/ не пересекается с маршрутами SPA.
# Кэш HLS-сегментов (immutable) — экономит трафик и ускоряет повторные открытия.
proxy_cache_path /var/cache/nginx/vod levels=1:2 keys_zone=vod_cache:50m
                 max_size=20g inactive=7d use_temp_path=off;

location /vod/ {
    # trailing slash: /vod/static/... → https://video.meetgu.ru/static/...
    proxy_pass              https://video.meetgu.ru/;
    proxy_http_version      1.1;
    proxy_set_header        Host video.meetgu.ru;     # upstream ждёт свой Host
    proxy_ssl_server_name   on;                        # SNI к апстриму (видео-хост)
    proxy_set_header        X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header        X-Forwarded-Proto https;

    # Range/seek (критично для <video> на iOS — требует 206 Partial Content):
    proxy_set_header        Range $http_range;
    proxy_set_header        If-Range $http_if_range;
    proxy_force_ranges      on;

    # Потоковая отдача, не буферизуем весь файл:
    proxy_buffering         off;
    proxy_request_buffering off;

    # Кэш ТОЛЬКО для полных (не-Range) ответов сегментов/плейлистов; Range-партиалы не кэшируем:
    proxy_cache             vod_cache;
    proxy_cache_valid       200 206 7d;
    proxy_cache_key         $scheme$proxy_host$uri;     # без query (PeerTube media без query)
    proxy_no_cache          $http_range;                # не класть partial как полный
    proxy_cache_bypass      $http_range;
    add_header              X-Vod-Cache $upstream_cache_status always;

    # Таймауты: VOD быстрый; connect короткий, read средний:
    proxy_connect_timeout   10s;
    proxy_send_timeout      60s;
    proxy_read_timeout      60s;

    # HLS/медиа content-type отдаёт апстрим; НИЧЕГО не переписываем (sub_filter не нужен в B).
    add_header              X-Vod-Proxy 1 always;
}
```

Замечания:
- **Range**: nginx и так проксирует `Range`/отдаёт `206`; явные директивы — страховка. Без 206
  `<video>` на iOS не перематывает и часто вообще не стартует.
- **HLS**: master/media `.m3u8` у PeerTube ссылаются на сегменты **относительно** своего URL → при запросе
  плейлиста через `/vod/...` сегменты резолвятся тоже под `/vod/...` (same-origin) автоматически. Если у
  части плейлистов окажутся абсолютные URL — добавим узкий `sub_filter` ТОЛЬКО на `application/vnd.apple.mpegurl`
  (это маленький текст, безопасно), но по умолчанию не требуется.
- **Кэш**: сегменты immutable → `proxy_cache` даёт быстрый повтор и снимает нагрузку с video-хоста.
  Range-партиалы не кэшируем как полные (во избежание битых объектов); для полноценного Range-кэша можно
  позже включить `slice` — не в первом шаге.
- **Отдельный `location` для live** (если когда-нибудь проксировать эфир): `proxy_buffering off` обязателен,
  `proxy_read_timeout` ↑ (например 1h), кэш выключить. В варианте B эфиры НЕ проксируем — остаются на embed.

### Фронт (вариант B)
- В плеере VOD (MyCoursePage, опц. ArticlePage) заменить `<iframe embed>` на нативный `<video>`:
  1. Получить media-URL через PeerTube API: `GET https://video.meetgu.ru/api/v1/videos/<id>` →
     `streamingPlaylists[0].playlistUrl` (HLS) или `files[0].fileUrl` (mp4).
  2. Подменить хост: `https://video.meetgu.ru` → `https://app.meetgu.ru/vod` (same-origin).
  3. Плеер:
     - **iOS/Safari** (целевая группа): `<video src="…/master.m3u8">` играет HLS нативно — этого достаточно.
     - **Chrome/Android**: HLS нативно не умеет → либо ленивая `hls.js` (грузить только при не-Safari),
       либо fallback на `<video src="…/original.mp4">` (исходник всегда есть).
     - Общий fallback при любой ошибке → старый iframe-embed (не хуже, чем сейчас).
- API-запрос `/api/v1/videos/<id>` тоже можно пустить через `/vod/api/...` (same-origin), чтобы и метаданные
  шли по рабочему соединению.

---

## 3. Порядок выкатки и откат

Вариант B (рекомендуемый), по шагам, каждый — отдельно и обратимо:
1. **nginx**: добавить `location /vod/` + `proxy_cache_path` (на app-хосте). Проверить `nginx -t`,
   reload (не рестарт). Смоук: `curl -I https://app.meetgu.ru/vod/` и `curl -r 0-99 .../vod/static/...mp4`
   → ждём `206` + `X-Vod-Proxy:1`. **Откат**: убрать `location`, reload.
2. **Фронт за флагом**: нативный плеер включить сначала на демо/по query-флагу (как мы делали с
   /my-finanse-demo), проверить, потом раскатать. **Откат**: вернуть iframe-embed (fallback уже встроен).
3. Раскатка по-страничreadyно: сперва MyCoursePage (главный симптом), затем при желании ArticlePage VOD.
   Live/StreamsPage — **не трогаем**.

Вариант A — выкатывать только после успешного B и отдельным решением (меняет канонический хост;
откат = вернуть `webserver.hostname=video.meetgu.ru` + рестарт PeerTube + снять app-прокси префиксы).

Общий принцип: **nginx reload, не рестарт**; PeerTube в варианте B не трогаем вовсе.

---

## 4. Что проверять на iOS/Safari после

- VOD-урок на iPhone (Safari, не standalone и PWA): видео **стартует без 15-сек спиннера**, перемотка
  работает (значит Range/206 проходит через прокси).
- Проверка именно на проблемной сети: мобильные данные Tele2 (где ловились таймауты). Открыть 2–3 урока
  подряд (новые соединения) — не должно быть `video_load_timeout`.
- Сеть в DevTools (или charles на устройстве): медиа-запросы идут на `app.meetgu.ru/vod/...`, статус
  `206`, `X-Vod-Proxy:1`, `X-Vod-Cache: HIT/MISS`.
- Полноэкранный режим, AirPlay/PiP (native `<video>` их умеет; у iframe-embed вели себя иначе — сверить,
  что не хуже).
- Chrome на Android: если включили hls.js — играет; если fallback mp4 — играет; при сбое → iframe-fallback.
- Метрика: в `client_error_log` за 1–3 дня после — падение `video_load_timeout`/`video_auto_retry` у iOS;
  рост доли «сразу успешно».

---

## 5. Как не уронить текущие эфиры и загрузки

- **Эфиры (live)**: в варианте B НЕ проксируются и НЕ меняются — остаются на родном embed
  `video.meetgu.ru`. Нулевой риск для live.
- **Загрузки видео** (PeerTube upload / resumable, наши `peertubeUpload.js`/`peertubeLive.js`): идут на
  `video.meetgu.ru/api/...` напрямую, прокси `/vod/` их не затрагивает. Не трогаем.
- **nginx reload, не рестарт** — активные соединения не рвутся.
- **Кэш-прокси** читает с video-хоста лениво (по запросу) — дополнительной постоянной нагрузки на PeerTube
  нет; при первом MISS один проход, дальше HIT.
- **Не во время эфира/продаж** выкатывать nginx-изменение (reload почти бесшовен, но перестрахуемся).
- Вариант A (если дойдём): рестарт PeerTube роняет и VOD, и live на ~секунды — только в окно без эфиров.

---

## 6. Дешёвое улучшение логов: «ретрай на свежем соединении помог» (без IP)

Сейчас уже есть: `video_load_timeout` (симптом), `video_auto_retry` (re-mount iframe = новое соединение),
`video_auto_retry_ok` (после ретрая загрузилось). То есть «свежее соединение помогло» косвенно уже видно.
Дёшево усилить, **ничего про IP не храня**, только счётчики/флаги в `extra` (JSON в message):

- В `video_auto_retry_ok` добавить `extra`:
  - `attempt` — номер попытки, на которой взлетело (1/2/3);
  - `fresh_conn: true` — ретрай был именно пере-созданием iframe (новое TCP/TLS к video-хосту);
  - `probe_host` / `probe_app` — результаты уже существующих проб (video-хост vs свой origin по открытому
    соединению) на момент сбоя: это прямое доказательство «свой origin отвечал, video-хост — нет».
  - `ms_to_ok` — сколько миллисекунд от таймаута до успешной загрузки.
- Ничего нового в БД не нужно (поля уже `message/stack/extra`), IP/ASN не пишем. Если `video_auto_retry_ok`
  ещё не в CHECK-whitelist `client_error_log.event_type` — добавить его одной `ALTER` (как делали для
  fetch_retry/chunk_retry).

Итог: получим точную долю «помог свежий коннект к video-хосту при живом app-origin» — это и есть численное
подтверждение, что same-origin-прокси закрывает проблему, ещё ДО стройки (и верификация после).

---

## Резюме / рекомендация
1. **Вариант B** (native `<video>` + `/vod/` same-origin прокси, PeerTube не трогаем) — делаем первым:
   целит в симптом, изолирован, обратим, live/загрузки не задевает.
2. **Вариант A** (смена `webserver.hostname`) — только если позже нужно ВСЁ (вкл. live) same-origin;
   выше риск (канонический хост, коллизии путей, федерация).
3. Параллельно — дешёвый апгрейд логов (п.6): подтвердить ROI числами до и после.

Жду выбор варианта (B или A) и ОК на детализацию конкретных диффов (nginx-конфиг + фронт-плеер) —
по шагам, с ревью и без деплоя до твоего слова.
