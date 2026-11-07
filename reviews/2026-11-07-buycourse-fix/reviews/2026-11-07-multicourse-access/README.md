# BuyCourse: окончательный локальный патч атомарной обработки

Заменяет прежний access-only NO-GO. Production БД/workflow/балансы/продажи/доступы не изменялись. Старые платежи не запускались. Commit/push/deploy не выполнялись.

## Проверенная основа

Active BuyCourse: 6rEQ42XwaLMFcvbB, updatedAt 2026-10-29T14:14:01.485Z. Сверены Code1, Create_Sales, Supabase1, Supabase5, UpdateUserCourse и production-поля:

- sales: id, created_at, user, amount, price, position, position_name, position_category; остальные DB defaults сохраняются.
- users: id, Ammount (numeric, default 0), authorCommission (numeric, default 100).
- user_course: id, created_at, course, user, Free, end_period, buy, updated_at.
- order.owner/course_positions/paid/payment_id и payment_audit.

На sales нет пользовательских триггеров начисления; на users только BEFORE INSERT set_users_num_dog, не связанный с UPDATE баланса. DurationLong в production: 0, 6, 12. Новые receipt-таблица и RPC в production отсутствуют.

Первичные дефекты: PickBuyerRow возвращал один item; ранний paid блокировал восстановление; Code1 начислял сумму всех комиссий первому автору и перезаписывал баланс старым снимком. Продление NOW+DurationLong теряло оставшийся срок.

## Окончательная цепочка

Shop/CheckPaid/IF_AlreadyPaid и VerifySign/VerifySignRPC/VerifyAmount/AuditWarn сохранены. Историческая paid=true ветка по-прежнему AuditDuplicate. Supabase теперь только читает order. BuildAllAccesses формирует полный план, FulfillAllAccesses вызывает одну RPC. На этом ветка заканчивается: отдельных пост-транзакционных финансовых writers больше нет.

RPC одной транзакцией:

1. Блокирует заказ и проверяет completion receipt/proof успешной проверки платежа.
2. Проверяет все shop IDs, покупателя, курсы, авторов, цены и ставки.
3. Выдаёт/продлевает доступы и создаёт sales для каждой позиции.
4. Начисляет каждому автору через Ammount=coalesce(Ammount,0)+amount, без старого снимка.
5. Ставит paid/payment_id и receipt с позициями, sales/access IDs и начислениями.

Заказ/авторы/доступы блокируются в стабильном порядке. Исключение откатывает всё, включая ранее сделанное начисление другому автору, paid, receipt и транзакционную очередь уведомлений. PK(order_id) и UNIQUE(payment_id) receipt защищают от повторов/параллельных callback. Потерянный ответ безопасен: повтор возвращает already_completed, вся обработка уже зафиксирована вместе.

paid=true без receipt считается историческим заказом: legacy_paid_skipped. Нет backfill и вызова старых платежей. Legacy/in-flight sales без receipt останавливают операцию вместо повторного начисления; автоматически доделывать такую историю нельзя.

Существующие проверки подписи/суммы не переписываются. RPC требует конкретный AuditWarn proof с event=ok, sig_valid=true, payment_status=success и verify.ok=true. Отрицательный WARN-результат не может пометить заказ оплаченным — это намеренный fail-closed барьер.

## Экономика и сроки

Сохранена точная формула Create_Sales: (shop.price * authorCommission / 100).toFixed(2). Нет 100-authorCommission, замены Shop.price на Course.Price или новых ставок. JS/toFixed остаётся в доверенном Code node: SQL round(numeric) отличается на полукопейках (1.005 в JS даёт 1.00). RPC сверяет цену/ставку под блокировками и допустимую погрешность округления. EXECUTE только service_role; план нельзя принимать от браузера. Балансы складываются как numeric без нового округления прежнего баланса.

- Новый конечный доступ сохраняет прежний JS setMonth rollover и UTC date-only окончание.
- Продление конечного доступа: от max(transaction_timestamp(), end_period), с полным оставшимся timestamp. Срок не сокращается.
- DurationLong=0/NULL и существующие NULL/infinity остаются бессрочными с end_period=NULL.
- Legacy same-day sentinel сохраняется как бессрочность при совпадении дат в UTC или Europe/Moscow. Это сохраняет старое соглашение сервера и московского интерфейса; frontend sameDay зависел от браузерного timezone. Новые NULL-записи от неоднозначности не зависят.
- При нескольких позициях одного курса — sales на каждую, но одно право и одно продление курса.
- Free/created_at существующего доступа сохраняются, buy=true. Неоднозначные дубли buyer/course останавливают операцию для точечного разбора.

Purchase INSERT-триггер user_course не меняется. Повторный callback не делает INSERT и не ставит повторное уведомление. Продление сохраняет отсутствие INSERT-уведомления. Exactly-once внешней доставки не обещается.

## Файлы

- supabase/migrations/pending_order_access_fulfillment.sql — receipt и единая RPC; заменяет прежний неприменённый draft, не применять оба.
- scripts/lib/order-access-plan.mjs — план и исходное вычисление комиссии.
- scripts/lib/buy-course-workflow-patch.mjs — преобразователь свежего workflow с baseline guard.
- scripts/prepare-buy-course-access-patch.mjs — локальная подготовка API body из защищённого экспорта; без API-вызовов, новый файл 0600, отказ при перезаписи.
- BuyCourse.fixed.review.json — исправленный граф, 31 node. НЕ импортировать: credentials/URLs и посторонние параметры заменены placeholders; active=false — защита review-файла.
- BuyCourse.baseline.redacted.json — безопасный fixture исходного графа, не для импорта.
- tests/order-access-fulfillment.unit.mjs, .fixture.sql, .integration.py — unit и настоящий PostgreSQL.
- Этот README.

## Проверки

8 unit PASS, 0 FAIL. 19 PostgreSQL-сценариев PASS, 0 FAIL; отдельно PASS остановка стенда/закрытие порта (launcher выводит 20 PASS с cleanup).

Все девять сценариев ТЗ покрыты. Дополнительно: параллельные разные заказы одного автора; сбой после доступов/продаж/первого начисления; ошибка третьего курса; потерянный ответ; UTC нового доступа; остаточные часы и month rollover; NULL/infinity/legacy sentinel; JS half-cent/NULL balance; deny ролей/подписи/статуса/суммы; подмена автора/суммы; повторяющийся курс; ошибка на последней записи receipt с полным rollback.

Результаты: /private/tmp/mg-stream-pg-ay7xxr52/order-access-results.json. PostgreSQL 15, новый временный кластер только 127.0.0.1, синтетические данные/роли/уведомления. Переиспользованы установленный PostgreSQL и существующий launcher, ничего не устанавливалось. Процессы остановлены. Production и внешние уведомления для исполнения тестов не использовались.

Промежуточный FAIL нового срока был сравнением JSON timestamp локального timezone стенда со строкой UTC: исправлена нормализация теста, итоговый SQL этого дефекта не имел.

## Внедрение после отдельного разрешения

1. Подтвердить отсутствие drift active/draft, сохранить оригинал в защищённом хранилище. Полный экспорт может содержать секреты — не класть в Git/reviews и не печатать.
2. Завершить старые in-flight исполнения перед переключением: не смешивать старый ранний paid с новой транзакцией. Исторические оплаченные заказы не запускать.
3. Владелец применяет финальный SQL от DDL-владельца с нужными правами. Затем NOTIFY pgrst, 'reload schema';. Миграция не меняет существующие заказы/продажи/балансы/доступы.
4. Подтвердить service_role у существующего серверного supabaseApi credential без вывода ключа. Из имени credential роль не следует; не расширять EXECUTE на anon ради запуска.
5. Подготовить API body: node scripts/prepare-buy-course-access-patch.mjs /protected/BuyCourse.current.json /protected/BuyCourse.atomic.api.json. Команда не публикует; реальные webhook/credentials и остальные ветки сохраняются. Review JSON с placeholders напрямую не импортировать.
6. После проверки diff отдельно разрешённо обновить workflow. Контейнеры/env/SDK не менять, webhook URL сохранить. n8n 1.90.2 может снимать/регистрировать webhook при active update: согласовать короткое окно, не обещать нулевого разрыва/автоматической доставки callback.
7. Разрешённый НОВЫЙ тестовый платёж: проверить все user_course/sales, начисления каждому автору, paid/receipt и уведомления. Повторный callback — только на этом новом согласованном тесте. Старые платежи не переигрывать.

## Откат

Ошибка SQL до COMMIT откатывает DDL. До переключения workflow новые неиспользуемые объекты можно оставить.

Ошибка RPC автоматически откатывает доступы, sales, балансы, paid и receipt. После устранения причины повтор нового согласованного неуспешного callback безопасен. При потере ответа сначала проверить receipt: завершённый заказ повторять не требуется.

После успешных заказов не удалять receipts/доступы/sales, не сбрасывать paid и не вычитать начисления массово. Не возвращать старые отдельные paid/sales/balance writers: это вернёт дефекты. При проблеме остановить rollout и согласовать исправление/операционную паузу новых оплат. Production workflow/источник оплат самостоятельно не останавливать. Автоматического опасного rollback и повторного запуска платежей нет.

## Остаток перед production

Локальных блокеров финансовой атомарности/сроков в проверенной матрице не найдено. Ещё не выполнены: роль credential, фактический импорт/исполнение в n8n/PostgREST и новый разрешённый тестовый платёж. Code/SQL-тесты не выдаются за n8n E2E. Legacy sentinel нельзя массово нормализовать при иных исторических соглашениях.

Готово к ревью и согласованию внедрения. Production не изменялся.
