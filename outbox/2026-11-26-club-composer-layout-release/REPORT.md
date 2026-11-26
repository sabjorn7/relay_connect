# Компактный клубный композер — опубликовано

26.11.2026. DEPLOYED / checks PASS.

- Согласованный пакет: `dc842dc/outbox/2026-11-26-club-composer-layout`.
- Проверенная база main: `792626888b8088df1040f465d214d149adb8afbb`.
- Коммит ветки: `2ad30f412c83440af9deff3d6961b96bf00b8f3e`.
- [PR #13](https://github.com/sabjorn7/meetclone/pull/13), squash merge.
- Production release SHA: `dd1214f843b73aa1e444516053e50745bd7321e0`.
- [Deploy App #445](https://github.com/sabjorn7/meetclone/actions/runs/45783029922) — SUCCESS, завершён 26.11.2026 08:26:25 UTC / 11:26:25 МСК. Успешны npm ci, build/postbuild, обе фазы публикации ресурсов и HTML, штатная сборка/публикация лендинга.

Четыре согласованных файла совпали с manifest пакета. Повторная локальная Vite-сборка PASS. В JSON только rows/placeholder двух полей; workflows и cacheVersion вручную не менялись. Сервер, SQL, capability, Storage, push, Auth и платежи не изменены.

Production загрузил `/assets/ClubChatAttachments-BOvktDVk.js`. Chrome/WebKit 390/1280 — 4/4 PASS: одна строка, textarea 46px, круглая кнопка справа, отсутствие avatar/legacy photo picker; пустой/пробельный ввод disabled; многострочный текст сохраняется и отправляется через прежний workflow; после отправки кнопка disabled. Проверены история, прокрутка, удаление, PDF/PNG, просмотр файла/фото и profile links. Ошибки JS/CSS — 0. Главная HTTP 200. Пользователь подтвердил видимость нового интерфейса.

Это проверка реального опубликованного frontend с синтетическими Auth/API/Storage и отключёнными WebSocket; реальные записи/файлы не создавались. Настоящая серверная отправка после релиза и физический Safari microphone — NOT TESTED. Локальные проверки голоса Chrome и обычных чатов описаны в исходном пакете. Наличие успешного UI-теста не заявляется проверкой реальной доставки push или записи микрофона Safari.

Откат при подтверждённой регрессии: отдельная ветка от актуального main, `git revert dd1214f843b73aa1e444516053e50745bd7321e0`, проверка четырёх файлов/build/тестов, PR и штатный Deploy App. Не сбрасывать main и не трогать данные. База возврата — `792626888b8088df1040f465d214d149adb8afbb`. Откат не выполнялся.
