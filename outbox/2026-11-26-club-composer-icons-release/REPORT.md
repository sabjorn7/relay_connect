# Club composer: production release

Статус: DEPLOYED, 26.11.2026 МСК.

- Согласованный пакет: [f514584](https://github.com/sabjorn7/relay_connect/tree/f514584/outbox/2026-11-26-club-composer-icons).
- База main перед публикацией: `6acdce1a5a17427f6fdbfbf866fff458aa30b258`; совпала с пакетом.
- Коммит ветки: `54a08a5b5f21a795b51bb246dc0bbb0cda2345dc`.
- [PR #12](https://github.com/sabjorn7/meetclone/pull/12), squash merge.
- Опубликованный релиз: `792626888b8088df1040f465d214d149adb8afbb`.
- [Deploy App #444](https://github.com/sabjorn7/meetclone/actions/runs/45702610743): SUCCESS, все шаги ресурсов/HTML приложения и лендинга успешны. Завершён 25.11.2026 21:16:05 UTC / 26.11.2026 00:16:05 МСК.

## Состав и проверки

Только `ClubChatAttachments.vue` и `clubChat.css`, 75 добавлений / 10 удалений. Before/after SHA совпали с согласованным manifest. Script setup неизменен. Повторная локальная Vite-сборка PASS; штатный CI npm ci/build/postbuild/build:landing PASS. Серверные настройки, capability, SQL, Storage, push и Auth не изменялись.

После деплоя загружен реальный `/assets/ClubChatAttachments-BOawXQZ3.js` с app.meetgu.ru. Chrome/WebKit, 390/1280: PASS — иконки, выравнивание, выбор файла, история/прокрутка, текст, удаление, PDF/PNG, открытие файла/фото, ссылки профиля. Ошибки JS и HTTP ошибки JS/CSS: 0. Главная: HTTP 200.

Это проверка опубликованного frontend с синтетическими Auth/API/Storage; все записи и внешние WebSocket перехвачены. Реальные сообщения, загрузки и production-данные не создавались. Capability в fixture включена только внутри браузерного теста; состояние сервера тест не меняет. Реальная серверная отправка и микрофон Safari после релиза не тестировались. Локальная запись синтетического аудио Chrome ранее PASS; успешная запись физическим Safari остаётся NOT TESTED.

Первый post-deploy прогон остановился на просмотре mock-картинки: fixture возвращал абсолютный signedURL, тогда как SDK добавлял свой Storage prefix. Исправлен только тестовый ответ на относительный signedURL. Повторный полный прогон 4/4 PASS; продуктовый код не менялся.

## Откат

При подтверждённой регрессии создать ветку от актуального main и выполнить `git revert 792626888b8088df1040f465d214d149adb8afbb`; проверить, что откатываются только два указанных файла, сборку и браузерные тесты; PR/squash merge запускает штатный Deploy App. Предыдущая рабочая база `6acdce1a5a17427f6fdbfbf866fff458aa30b258`. Не сбрасывать main и не удалять сообщения/вложения. SQL/Storage rollback не нужен. Откат в этой задаче не выполнялся.
