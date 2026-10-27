sha256(payload below): ade3d02641a043de638bd4242d9fd14baa47c794218606ee60903b1914902429

# VOD: проверка HLS-плейлистов через /vod/ (относительные ссылки) + правки diff v2 + тест-URL

## 3. master.m3u8 и media-playlist через /vod/ — ссылки ОТНОСИТЕЛЬНЫЕ (абсолютных video.meetgu.ru = 0)

Видео урока uuid `7575db47-4953-4b42-8c2e-6f1586577ad4`.

### master (https://app.meetgu.ru/vod/static/streaming-playlists/hls/7575db47…/…-master.m3u8)
```
#EXTM3U
#EXT-X-VERSION:3

#EXT-X-STREAM-INF:BANDWIDTH=1032887,RESOLUTION=1280x720,FRAME-RATE=25,CODECS="avc1.64001f,mp4a.40.2"
5a6047f5-8080-4b1a-a3a1-232774596fab-720.m3u8
```
→ variant указан ОТНОСИТЕЛЬНО (`…-720.m3u8`, без хоста). Абсолютных `video.meetgu.ru` в master: **0**.

### media-playlist (variant 720, первые 30 строк)
```
#EXTM3U
#EXT-X-VERSION:7
#EXT-X-TARGETDURATION:6
#EXT-X-MEDIA-SEQUENCE:0
#EXT-X-PLAYLIST-TYPE:VOD
#EXT-X-MAP:URI="5a6047f5-8080-4b1a-a3a1-232774596fab-720-fragmented.mp4",BYTERANGE="1375@0"
#EXTINF:4.000000,
#EXT-X-BYTERANGE:124821@1375
5a6047f5-8080-4b1a-a3a1-232774596fab-720-fragmented.mp4
#EXTINF:4.000000,
#EXT-X-BYTERANGE:132415@126196
5a6047f5-8080-4b1a-a3a1-232774596fab-720-fragmented.mp4
#EXTINF:4.400000,
#EXT-X-BYTERANGE:779494@258611
5a6047f5-8080-4b1a-a3a1-232774596fab-720-fragmented.mp4
#EXTINF:4.000000,
#EXT-X-BYTERANGE:433643@1038105
5a6047f5-8080-4b1a-a3a1-232774596fab-720-fragmented.mp4
#EXTINF:4.000000,
#EXT-X-BYTERANGE:458202@1471748
5a6047f5-8080-4b1a-a3a1-232774596fab-720-fragmented.mp4
#EXTINF:4.000000,
#EXT-X-BYTERANGE:531444@1929950
5a6047f5-8080-4b1a-a3a1-232774596fab-720-fragmented.mp4
```
→ и `#EXT-X-MAP`, и сегменты — ОТНОСИТЕЛЬНЫЙ файл `…-720-fragmented.mp4` (один fragmented-mp4, сегменты через BYTERANGE). Абсолютных `video.meetgu.ru` в media-playlist: **0**.

**Вывод:** HLS полностью относительный. При запросе плейлиста через `https://app.meetgu.ru/vod/.../master.m3u8`
плеер резолвит variant и сегменты относительно этого URL → всё остаётся под `/vod/` (same-origin) автоматически.
**sub_filter / переписывание не нужно.** (Если бы ссылки были абсолютными на video.meetgu.ru — тогда понадобился
бы узкий `sub_filter` только на `application/vnd.apple.mpegurl`; здесь не требуется.)

## Правки diff v2 (приняты из ревью)
1. Пока `vodNativeOn && !vodFailed` — iframe НЕ монтируется (ни во время resolve, ни пока нет nativeSrc):
   `<iframe v-else-if="!vodNativeOn || vodFailed">`. В это время показывается спиннер; iframe на video.meetgu.ru
   параллельно НЕ ходит (не искажает тест, не гасит таймеры). iframe монтируется только при выключенном флаге
   или после отката (vodFailed).
2. `<video>` слушает `@loadedmetadata` (+ `@loadeddata`, `@canplay`), добавлены `preload="metadata"` и `playsinline`.
   Готовность = loadedmetadata | loadeddata | canplay — ожидание нажатия play сбоем НЕ считается
   (на iOS Safari по мобильным данным до play приходит именно loadedmetadata).

## 4. Точный URL урока для теста (владельцу)
Открыть на iPhone/Tele2 (нужен доступ к курсу — он платный, открывать из своей библиотеки):
```
https://app.meetgu.ru/my_courses?course=21f96711-3fc5-4642-853b-3db75bb22a8c&vod=1
```
(курс «Рефлексотерапия. Модуль 3…», у урока включён HLS 720p). `?vod=1` запоминается в localStorage
(`mg_vod`) — остаётся включённым до `?vod=0`. Если этого курса нет в твоей библиотеке — подойдёт ЛЮБОЙ твой
курс с видео: открыть `/my_courses?course=<id>` и дописать `&vod=1`.

Проверять: нативный `<video>` играет, без 15-сек спиннера, перематывается; в DevTools media-запросы идут на
`app.meetgu.ru/vod/...` (206, X-Vod-Proxy:1); в client_error_log у событий появится `player:"native"`.
Выключить тест: тот же URL с `&vod=0`.
