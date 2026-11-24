# Операция администратора

Проверить пакет и согласовать SHA. Уже загружены:

- /home/mgdeploy/staging/meetguru-club-chat-install-20261124.sh
- /home/mgdeploy/staging/meetguru-club-chat-rollback-20261124.sh

На sb от root:

```sh
sha256sum /home/mgdeploy/staging/meetguru-club-chat-install-20261124.sh /home/mgdeploy/staging/meetguru-club-chat-rollback-20261124.sh
```

Ожидаются:

```text
906edd31a9cd9e00267022f5bc0b1b6e6b413f2d7a4c0c8580df2b7130fbecf3  meetguru-club-chat-install-20261124.sh
e9a6e0fd2c4c4f5e9605afd733453947ab67d9b2f3ff2bab0b032517d5bbaa3a  meetguru-club-chat-rollback-20261124.sh
```

После проверки администратором:

```sh
printf '%s\n' \
'906edd31a9cd9e00267022f5bc0b1b6e6b413f2d7a4c0c8580df2b7130fbecf3 meetguru-club-chat-install-20261124.sh' \
'e9a6e0fd2c4c4f5e9605afd733453947ab67d9b2f3ff2bab0b032517d5bbaa3a meetguru-club-chat-rollback-20261124.sh' \
>> /etc/mg-deploy/approved.sha
/usr/local/sbin/mg-deploy meetguru-club-chat-install-20261124.sh
```

Передать результат и BACKUP для последующих проверок. Повторный install при существующих объектах остановится, не перезапишет их.

При необходимости только отключить уже установленное:

```sh
/usr/local/sbin/mg-deploy meetguru-club-chat-rollback-20261124.sh
```

Rollback не запускать до установки. Это не восстановление старых публичных прав и не удаление схемы/данных. Включение новых функций, Edge/frontend deployment не входит в эти команды.
