# Опубликовано

Production SHA: d64d36b7a6e678a64cb80118f6ed4315f000a3cd.
Коммит ветки: 62115d3d2fe8af65446f756697988e01bd94a753.
PR: https://github.com/sabjorn7/meetclone/pull/6
Deploy App SUCCESS: https://github.com/sabjorn7/meetclone/actions/runs/45407021357 . Все сборки и фазы публикации assets/HTML успешны.

Перед merge подтверждена база ff891768c043849c99e28973f52090d0a57b6768, точное совпадение changes.diff, изменён только AppHeader.vue. Локальные desktop/mobile проверки Chrome/WebKit и Vite PASS.

После релиза production HTML содержит правильный SHA. Каталог и вход: 4/4 Chrome/WebKit PASS, Vue mount и собственные JS/CSS без ошибок. В Chrome на каталоге зарегистрированы ранее наблюдавшиеся ошибки внешних Google Fonts и Метрики; они не скрыты в JSON. Меню авторизованного аккаунта проверено локально на синтетических данных; реальный production-аккаунт недоступен. Никаких платежей и записей API не выполнялось.

Для отката при необходимости: revert d64d36b7a6e678a64cb80118f6ed4315f000a3cd через отдельную ветку/PR и штатный Deploy App. Откат сейчас не выполнялся.
