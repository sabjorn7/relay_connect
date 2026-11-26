# Процедура mg-deploy — НЕ ВЫПОЛНЯТЬ СЕЙЧАС

Пакет подготовлен только локально и в GitHub. Ничего из него не установлено. Сначала согласовать recipients.json и выпустить финальную ревизию с выбранными аккаунтами. У текущего enable список пуст — он откажет до любых действий.

## После отдельного разрешения

1. Передать проверенные wrapper в `/home/mgdeploy/staging/` под mgdeploy. На sb от root сравнить `sha256sum` каждого wrapper с WRAPPER-SHA256.txt. Не выполнять SQL-файлы напрямую.
2. После ревью добавить точные строки SHA/имени разрешённых wrapper из WRAPPER-SHA256.txt в `/etc/mg-deploy/approved.sha`. Одобрение SHA не обходить.
3. Выполнить только status:

```sh
/usr/local/sbin/mg-deploy meetguru-club-push-pilot-status-20261126.sh
```

Уточнить Compose service/workdir/config_files и как boolean PUSH_CLUB_ENABLED попадает в worker; сами секреты не выводить. На этапе установки должно быть false, оба triggers D, source SHA должны совпасть с manifest. Статус не меняет env или сервисы.

4. После одобрения установки ограничивающего helper:

```sh
/usr/local/sbin/mg-deploy meetguru-club-push-pilot-install-20261126.sh
```

Сохранить BACKUP и exit code. Ожидать INSTALLED_DISABLED. В текущей ревизии recipient count=0, отправка невозможна. Install заменяет только helper и перезапускает общий Edge Runtime; другие функции кратко затрагиваются перезапуском.

5. **Только финальная ревизия с выбранными UUID и отдельным разрешением на реальную отправку:** сохранить global allowlist как есть; обеспечить PUSH_CLUB_ENABLED=true через подтверждённую действующую серверную конфигурацию. Источник этой настройки пока не подтверждён, предположительной команды здесь нет. Scoped helper уже должен быть установлен, triggers остаются D. Если разрешённый env отсутствует/false, enable остановится.

```sh
/usr/local/sbin/mg-deploy meetguru-club-push-pilot-enable-20261126.sh
```

Убедиться, что enabled ровно два triggers с WHEN на указанный клуб. Скрипт сам не создаёт сообщение и не отправляет тестовый callback. Как только triggers активны, новые события реального клуба могут уведомлять выбранные тестовые аккаунты; это должно входить в их согласие на пилот.

6. При ошибке или по окончании короткого согласованного теста:

```sh
/usr/local/sbin/mg-deploy meetguru-club-push-pilot-disable-20261126.sh
```

Ожидать DISABLED_CLUB_ONLY и два triggers D. Отключаются только новые club events, не прежние on_club_chat_notify/on_club_post_notify и не обычные chat push. Глобальный allowlist не менять. Disable фиксирует клубный gate в false внутри index; это сознательная аварийная защита от queued callbacks при оставшемся true в env. Выполняется общий Edge Runtime restart. Уже выполняющийся/доставленный push отозвать невозможно.

## Откат фильтра

Не возвращать baseline-club.mjs автоматически: он не ограничивает получателей. Сначала disable и подтверждение D/false; затем после отдельного решения можно восстановить backup helper при сохранённом false gate. Восстановление данных или удаление PWA-подписок не требуется. При SHA drift остановиться; не перезаписывать чужой index/helper.

## Локальное повторение

`python3 build.py`, `node tests/pilot.unit.mjs`, `node supabase/functions/web-push-send/logic.test.mjs`, `node tests/worker.unit.mjs`, `python3 tests/admin.local.py`, `python3 tests/pilot.postgres.py`.

Последний тест требует локальный pg_config/initdb/pg_ctl/psql; поднимает временный Unix-socket cluster без TCP. Никакого подключения к production. Тестовый serviceworker.fixture.js — снимок существующего service worker для исполнения синтетических событий, не файл для деплоя.
