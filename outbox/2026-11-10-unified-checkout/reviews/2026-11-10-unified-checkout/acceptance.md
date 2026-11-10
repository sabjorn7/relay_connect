# Результаты локальных проверок

2026-11-10. Production не изменялась. Все покупатели/продукты/платежи в тестах синтетические.

| Набор | Результат | Что проверено |
|---|---|---|
| node tests/unified-checkout.unit.mjs | 13 PASS, 0 FAIL | Общий typed API, нет клиентской цены/owner, стабильный request_id, смешанный payload Prodamus, повтор ссылки, zero checkout, timeout/CORS/авторизация, отсутствие booking-механизмов, идентичность финансового цикла production-базе |
| python3 tests/unified-checkout.integration.py | 28 PASS, 0 FAIL | Реальный временный PG15/PostgREST, каждый тип и mixed3, несколько авторов, атомарный rollback/retry, duplicate/parallel callback, promos/копейки/deposit, free, renewal/lifetime, старые заказы, чат/recording, доступы/ACL/RLS, nominal capacity=0, verify и stop SQL |
| node tests/unified-checkout.browser.mjs | 13 PASS, 0 FAIL | Настоящий AppHeader + CheckoutOrders, курс через настоящий coursesApi, mixed cart/labels/total, quote, checkout/retry, удаление, free enrollment, pending resume/cancel, 390/1366 px, отказ cart RPC без fallback |
| node tests/unified-checkout.pages.browser.mjs | 12 PASS, 0 FAIL | Настоящие CoursePage / EventsPage / EventDetailPage / StreamsPage, Vue Router, AppHeader и API helpers: mixed cart через SPA-навигацию, нет автоперехода/раскрытия, ручная корзина, повторное открытие, existing/free/guest gates |
| vite build -l warn --outDir /private/tmp/mg-unified-cart-no-auto-checkout-final-20261110 | PASS | Сборка приложения без npm postbuild и без SEO-запросов к production |
| git diff --check + проверка whitespace новых файлов | PASS | Без staging/commit |

Подробные результаты: postgres-results.json, browser-results.json, pages-browser-results.json. Скриншоты корзины: путь artifacts в browser-results.json. Временные PG/PostgREST/Chrome/HTTP процессы остановлены.

## Подтверждённые сценарии

- Все три продукта используют shop/order и одну settlement RPC. Три позиции дают три sales и корректные начисления каждому автору.
- Ошибка начисления откатывает доступы/продажи/регистрации; повтор безопасен.
- Повторный и два параллельных callback дают один receipt, без повторных денег/доступов.
- capacity=0 допускает покупателей; изменение capacity не блокирует оплату. Нет таблиц/сроков/процедур резервирования.
- Отмена неоплаченного заказа не создаёт доступ; последующий подлинный платёж нормально завершается, без специальной процедуры поздней оплаты.
- Предоплата сохраняется и не получает промокод, остальные eligible строки получают скидку. Нулевая итоговая сумма завершается на сервере без фиктивной оплаты.
- Временный stop SQL запрещает новые оформления, сохраняет обработку уже созданного заказа. Данные не удаляются.

## Что не подтверждено этими тестами

- Реальный callback Prodamus → активный n8n → production Supabase и реальные уведомления: не запускались, нужна отдельная авторизация на контрольную покупку.
- Новый набор запускает настоящие страницы, API helpers и Vue Router с синтетическим Supabase. Полный main.js / WeWeb bootstrap / Service Worker и реальный медиаплеер в этот набор не входят.
- Safari/iPhone, возвраты у провайдера, production-права SQL Editor/внешних интеграций не тестировались изменяющими операциями.
- Строгая квота promo usage_limit для нескольких одновременно существующих платёжных ссылок не добавлялась; сохранена текущая проверка used_count.

Локальная разработка завершена для ревью. Автоматического разрешения на production это не даёт. Миграцию применяет владелец вручную только после отдельного согласования.
