# Read-only preflight: не включает push

Сначала скачать скрипт из этой папки на рабочий компьютер. Передать через существующий SSH alias:

```sh
scp meetguru-club-push-env-read-20261126.sh sb-edge:/home/mgdeploy/staging/meetguru-club-push-env-read-20261126.sh
```

На sb от администратора после просмотра скрипта:

```sh
sha256sum /home/mgdeploy/staging/meetguru-club-push-env-read-20261126.sh
```

Ожидаемый SHA: `105e110fb10a2a79970e3c67d130a647599069ae1973e6da30be4c1eeb823e64`.

Только при совпадении и одобрении:

```sh
printf '%s\n' '105e110fb10a2a79970e3c67d130a647599069ae1973e6da30be4c1eeb823e64 meetguru-club-push-env-read-20261126.sh' >> /etc/mg-deploy/approved.sha
/usr/local/sbin/mg-deploy meetguru-club-push-env-read-20261126.sh
```

Скрипт только читает Docker inspect, main/helper и эффективную Compose config, SQL выполняется BEGIN READ ONLY. Нет запросов отправки push, DDL, restart или замены файлов. Сам mg-deploy штатно пишет административный журнал.

Вернуть JSON результата. Он не содержит значений секретов, email, endpoints и токенов. В нём есть SHA, пути Compose/service, наличие флага, его boolean значение, сравнение контейнера с Compose и структурные признаки main worker.

Если compose_mapping_confirmed=false или env-path не подтверждается, не включать флаг и триггеры. Булевы строковые признаки main сами по себе не доказывают полную семантику; потребуется точечное административное чтение структуры при расхождении SHA.

## Последующие шаги — пока не выполнять

Ревизия одного получателя уже подготовлена в e04c1f2/outbox/2026-11-26-club-push-single-account. Её install/enable/disable и SHA не менялись.

После подтверждения пути флага: проверить исходные SHA и D/D; одобрить installer; установить scoped helper при false flag и выключенных событиях; сохранить backup. Передача true-флага допускается только через подтверждённую текущую конфигурацию. Restart сам по себе не меняет env контейнера. Затем отдельное разрешение на ограниченный enable и реальную доставку.

До результата preflight точную правку передачи флага и окончательный rollback конфигурации составить нельзя. Не подменять это предположительной правкой Compose. Аварийный disable существующего пакета подготовлен; он не является полным rollback ещё неизвестной настройки.
