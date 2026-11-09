# Реальные медиа-испытания: ещё не выполнены

Использовать отдельный изолированный LiveKit + Egress + RTMP/PeerTube стенд без production env, аккаунтов и пользовательских данных. Нужны отдельно согласованные ресурсы и камеры/браузеры. Не выдавать DOM fixture или mocked SDK за медиатест.

Для каждого прогона записывать timestamp, желаемый/активный профиль, actual capture, outbound layers, received Egress input, actual encoded width/height/FPS/bitrate и HLS manifest variants. На зрительской стороне измерить decoded videoWidth/videoHeight и playback dropped frames штатными диагностическими средствами тестового плеера; один quality label недостаточен.

| Сценарий | Что подтвердить | Сейчас |
|---|---|---|
| A HD | Сохранён hd, capture 720, Egress 720, RTMP/HLS просмотр, данные панели | Настройки/SQL/моки PASS; media BLOCKED |
| B Full HD | Capture/outbound/Egress/decoded HLS 1920×1080, 25–30 FPS камеры, читаемость мелких деталей | Настройки/SQL/моки PASS; media BLOCKED |
| C Слабая сеть | Ограничить upload/ввести потери на тестовом хосте; измерить адаптацию, не путать maxBitrate с гарантией | BLOCKED |
| D Несколько ведущих | 2/4 участника, одна слабая камера, экран/PDF spotlight, остальные источники не перенастраиваются | Layout PASS; реальное media BLOCKED |
| E Совместимость | Старый HD без quality/snapshot, edit live → next run, повторный старт, USB/UVC/виртуальная камера, rollback | SQL/моки PASS; устройства/media BLOCKED |
| Ошибки API | Embed API отсутствует/timeout; чужой origin/source; смена маршрута/размонтирование | PASS изолированно |
| Сбои control plane | Потеря ответа reserve/start/commit/stop; отсутствие orphan Egress и ручной путь reconciliation | Частично проверены локально; внешние отказы BLOCKED |
| Нагрузка | HD + Full HD параллельно, дополнительные HLS варианты, CPU/RAM/swap/диск/исходящий трафик | BLOCKED |
| Safari/iPhone | Реальные камеры, getDisplayMedia где поддерживается, permissions/fallback, возврат из фона, Embed API | BLOCKED |

PDF canvas остаётся постоянным 1920×1080 с requestFrame на смене страницы и каждые 2 секунды: статическим слайдам не нужны искусственные 30 FPS. Проверить позднего подписчика, смену слайда и читаемость после HLS encode; не менять размер canvas во время публикации.

Повтор локальных проверок:

```sh
node tests/stream-video-quality.unit.mjs
node --experimental-vm-modules tests/stream-video-quality.orchestrator.mjs
python3 tests/stream-video-quality.integration.py
node tests/stream-video-quality.browser.mjs
```

PG-тест использует уже установленный PostgreSQL 15/PostgREST и существующий launcher: временный кластер только на loopback, синтетические данные, остановка в finally. Browser fixture требует установленный Chrome, ничего не скачивает; не является Safari-тестом.
