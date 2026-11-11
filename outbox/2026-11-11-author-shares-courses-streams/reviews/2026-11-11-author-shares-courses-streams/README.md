# Доли авторов: только курсы и трансляции

Основа: проверенный пакет 5db66c9ec861f6b9399f0a0ddd2aa7e07bca38f8.
Frontend base: 36d3798f151cc9706d4921536e4eda6ad5d5a67a.
Production не изменён. Этот пакет ЗАМЕНЯЕТ трёхкатегорийный вариант для текущего релиза.
**Не применять старый pending_author_shares.sql.**

## Состав изменения
- Только authorCommissionCourses и authorCommissionStreams; первоначально копируются из authorCommission.
- Административный интерфейс показывает две редактируемые ставки с причиной изменения и существующим audit log.
- BuyCourse получает серверные ставки одним read RPC и передаёт полный план в существующую транзакционную RPC.
- Трансляция через backing_course использует streams. Отдельная продажа recording_course использует courses.
- Мероприятия (ссылка events.backing_course_id или Category=Мероприятия) используют прежний authorCommission.
- subscription, Sub_ON_OFF, клубные платежи и автопродления НЕ меняются. Прежние фиксированные 82% остаются.
- Нет authorCommissionClub, settle_club_author_share, club_receipts и маркировки исторических клубных заказов.
- Суммы, округление, промокоды, состав заказа, сроки/продления, доступы и идемпотентность остаются прежними.
- checkout_complete_zero получает только соответствующую ставку для совместимости с fulfillment; checkout не перерабатывается.
- Прошлые продажи, балансы, receipts и доступы не пересчитываются.

## SQL для ручного применения владельцем
supabase/migrations/pending_author_shares_courses_streams.sql
Проверка: supabase/migrations/verify_author_shares_courses_streams.sql
Откат до использования: supabase/migrations/rollback_author_shares_courses_streams_before_use.sql
SQL никем автоматически не применяется. NOTIFY pgrst уже включён в миграцию.

## Код и воспроизведение
changes.diff применяется к указанному frontend base командой `git apply --unidiff-zero changes.diff`. Полные файлы приложены с теми же путями.
Baseline в reviews/2026-11-10-author-shares/baseline — исходные очищенные определения из прежнего review,
а не инструкции применения старой миграции. subscription baseline используется только для теста неизменности 82%.
Существующие tests/helpers/checkout_stand.py, fixtures и pending_unified_checkout.sql берутся из source base;
последняя миграция загружается ТОЛЬКО в синтетическую тестовую БД для восстановления её fixture, НЕ в production.
Не запускать npm build/postbuild для локальной проверки: они обращаются к production.

Команды из корня подготовленного source checkout:
```
node tests/author-shares.unit.mjs
node tests/author-shares.n8n190.mjs
python3 tests/author-shares.integration.py
node tests/author-shares.browser.mjs
./node_modules/.bin/vite build -l warn --outDir /private/tmp/mg-author-shares-two-build
```
Нужны ранее установленные PostgreSQL15/PostgREST, Node24 для pinned n8n-source теста и Chrome для browser теста.
Ничего автоматически не устанавливается. Тестовая БД loopback и синтетические JWT; процессы останавливаются finally.
n8n-source тест использует реальные pinned исходники 1.90.2, но HTTP и VM-граница заменены тестовыми.
Полный production n8n/Prodamus и реальные платежи этим не подтверждаются.

## Результаты 11 ноября 2026
46 PASS, 0 FAIL: unit10 + PostgreSQL/PostgREST22 + n8n-source5 + browser9.
Сборка Vite без npm postbuild прошла. Детали — test-results.json и integration.log.
Проверены: 1000*82%=820 (курс), 1000*90%=900 (эфир), legacy82%=820 (мероприятие),
82%=820 (отдельная запись), sales/баланс/buy=true, receipt/paid, дубли/параллельность,
rollback всей транзакции при ошибке, защита старых заказов, права RPC и двухкатегорийный UI 390/1366px.

## Read-only production preflight
Два заменяемых определения совпали с baseline MD5. author_share_private ещё отсутствует.
Невалидных legacy ставок нет; широких INSERT/UPDATE users у anon/authenticated нет.
Оба финансовых workflow активны и соответствуют проверенному baseline на момент подготовки.
Защищённый актуальный экспорт BuyCourse преобразован успешно, webhook/settings/credentials сохранены.
Секреты и защищённые экспорты в этом пакете отсутствуют.
