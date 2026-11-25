# Административный запуск на sb

Скрипты уже в `/home/mgdeploy/staging/`. Текущий этап — **только status**.

## 1. Проверить и одобрить read-only status

На sb от root, после просмотра скрипта:

```sh
sha256sum /home/mgdeploy/staging/meetguru-club-push-status-20261126.sh
# Ожидается c4020e2faf175bc32d13832c5acace46db59f2f52384c61bb6a95f2d37fd4dc9
printf '%s\n' 'c4020e2faf175bc32d13832c5acace46db59f2f52384c61bb6a95f2d37fd4dc9 meetguru-club-push-status-20261126.sh' >> /etc/mg-deploy/approved.sha
/usr/local/sbin/mg-deploy meetguru-club-push-status-20261126.sh
```

Вернуть JSON. Ожидаются `baseline_matches=true`, `helper_exists=false`, `club_env_enabled=false`, два triggers D. Также проверяются running/config и наличие ключей. Если уже `candidate_matches=true`, не выполнять повторную установку, сначала проверить фактическое состояние. При другом SHA/ошибке не применять патч предположительно.

## 2. После успешного status и проверки администратором состава установщика

Этот шаг устанавливает handler и перезапускает общий Edge Runtime. Клубные события остаются выключенными. Администратор должен учитывать кратковременное влияние restart на другие функции.

```sh
sha256sum /home/mgdeploy/staging/meetguru-club-push-install-20261126.sh /home/mgdeploy/staging/meetguru-club-push-rollback-20261126.sh
# install eb8184f33331318212a6e766dc5d0593d38462b546f0039f7ccf4cac0503930e
# rollback e174b9d47439ca165e5921c1da3df68a9207f050b87ba5ccb9244bb2506243c2
printf '%s\n' \
'eb8184f33331318212a6e766dc5d0593d38462b546f0039f7ccf4cac0503930e meetguru-club-push-install-20261126.sh' \
'e174b9d47439ca165e5921c1da3df68a9207f050b87ba5ccb9244bb2506243c2 meetguru-club-push-rollback-20261126.sh' >> /etc/mg-deploy/approved.sha
/usr/local/sbin/mg-deploy meetguru-club-push-install-20261126.sh
```

Только `INSTALLED_DISABLED` с успешными checks и exit 0 означает установку. Сохранить `BACKUP`. При потере соединения сначала запустить status и проверить SHA, не повторять установку вслепую. `ALREADY_INSTALLED_DISABLED` говорит о совпадении файлов/gate/trigger checks, но не заменяет отсутствующие smoke/backup свидетельства прошлого запуска.

## 3. Отдельный откат, только при необходимости

```sh
/usr/local/sbin/mg-deploy meetguru-club-push-rollback-20261126.sh
```

Восстанавливает только исходный push handler; новые triggers должны быть D. Данные не удаляет. При drift останавливается, не перезаписывает другие изменения. При сбое самого rollback администратор использует root-only backup после сверки SHA, не включает события.

Ни один шаг не включает PUSH_CLUB_ENABLED или клубные триггеры. Реальный тест/рассылка требуют отдельного согласования получателей. Не запускать старый массовый enable SQL.
