# Внедрение — только после отдельного подтверждения

1. Проверить свежесть защищённого BuyCourse backup и MD5, встроенные в SQL. Не применять SQL при несовпадении.
2. Владелец вручную применяет pending_author_shares_courses_streams.sql и выполняет verify_author_shares_courses_streams.sql.
   Старую pending_author_shares.sql НЕ использовать. Клуб не переключается и не требует остановки.
3. До замены BuyCourse новые ставки НЕ редактировать: они равны legacy, поэтому старый план BuyCourse совместим
   с новой RPC в промежутке SQL → workflow. Никаких изменений существующей оплаты/выдачи доступов не требуется.
4. Локально из свежего защищённого полного экспорта подготовить только BuyCourse:
   node scripts/prepare-course-stream-share-workflow.mjs /secure/BuyCourse.json /secure/BuyCourse.two-shares.json
   Скрипт откажет при изменении baseline. Output 0600, новый файл. Review JSON НЕ импортировать.
   Изменения: BuildAllAccesses, один GetAuthorShares, связи UsersBuyer → GetAuthorShares → BuildAllAccesses.
   Все прочие nodes/settings/webhooks/credentials должны остаться идентичными.
5. После подтверждения SQL обновить только BuyCourse штатным API. Проверить активность, опубликованный граф,
   webhook и read RPC; не вызывать выдачу доступа с фиктивными production-данными.
   Не обновлять subscription, Sub_ON_OFF, n8n credentials, Prodamus и Edge Functions.
6. Выпустить только SuperadminPage.vue от актуального main через Deploy App, проверить две категории.
   Разрешить редактуру ставок после завершения старых BuyCourse execution, чтобы старый legacy-план не получил
   отказ author_commission_changed при одновременной редактуре. Платежи не используются как тест без разрешения.
7. По отдельному разрешению проверить новый платёж и receipt, затем сверить с реестром Prodamus окно обновления.
   HTTP200 callback не доказательство начисления. Не переобрабатывать старые платежи автоматически.

## Откат
До использования: вернуть BuyCourse из защищённого backup, старый frontend; владелец выполняет
rollback_author_shares_courses_streams_before_use.sql. Guard запрещает откат после новых ставок/receipts.
Колонки и финансовые данные не удаляются. Во время rollback также не редактировать ставки.
После использования разных ставок не возвращать старый legacy-план вслепую: он не соответствует новым ставкам.
Нужен адресный совместимый rollback; не переписывать продажи, балансы, доступы и старые receipts.
Клуб/мероприятия не требуют отката, так как их обработчики и legacy ставка не изменялись.
