sha256(payload below): 1000524e6494d6aeff1fb3d68023d7a3110db0fb3618f00225048dc27f4a321a

# Единый checkout + реферальная программа + автозаполнение Prodamus — анализ и дизайн

Только анализ/дизайн. Ничего не применял/не выкатывал. Данные людей/ключи/реквизиты не печатаю.
⚠️ = трогает webhook / цены / доступ / выплаты авторам (без явного ОК не меняем).

---

## ЭТАП 0 — факты: webhook и цена ⚠️⚠️ (критично)

### Сверяет ли BuyCourse оплаченную сумму? — НЕТ.
n8n **BuyCourse**, вебхук Prodamus-колбэка — нода **«Shop»** (webhook path `61b3e175-…`) → нода **«Supabase»**:
`update order set paid=true, payment_id={{$json.body.order_id}} where id={{$json.body.order_num}}`.
- **Сумму оплаты НЕ сверяет** с `order.summ`/`shop.price`/прайсом из БД. Просто помечает `paid=true` по `order_num` из тела колбэка.
- **Подпись Prodamus НЕ проверяется** (в вебхуке нет HMAC/сверки). Защита — только непубличный UUID пути.
- Далее доступ и деньги строятся на **клиент-записанной `shop.price`**: `Create_Sales` (`amount = shop.price × authorCommission/100`), `UpdateUserCourse`/user_course (`end_period` = now + `course.DurationLong` мес, `buy=true`), `Supabase1` (`users."Ammount"` автора += amount).

### Можно ли оплатить меньше и получить доступ? — ДА (две дыры).
1. **Клиентская запись цены.** `src/_front/chrome/headerAccount.js:222` `checkoutCart` пишет `shop.update({price})` и `order.insert({summ})` С КЛИЕНТА; ссылку Prodamus строит тоже клиент (`products[i][price]` ≈L260). То же в `src/_front/streams/eventsApi.js:325` `purchaseEvent`. Подменённый фронт → заниженные `shop.price`/`order.summ`/`products[].price` → платит меньше, вебхук помечает paid и выдаёт доступ, автору капает комиссия с заниженной цены.
2. **Неаутентифицированный колбэк.** POST на вебхук `…/webhook/61b3e175-…` с `{order_num, order_id}` помечает ЛЮБОЙ order как paid → доступ без оплаты (подпись не проверяется).
- **Эфиры безопаснее**: `supabase/functions/stream-pay-link/index.ts` считает цену и пишет `shop`/`order` СЕРВЕРНО (под JWT), промо через `preview_promo`. Но тот же вебхук «Shop» всё равно без сверки суммы/подписи.

### По видам покупки (где цена, order/shop, ссылка, доступ, что нельзя потерять)
| Вид | Цена/order/shop | Ссылка Prodamus | Доступ после оплаты | Нельзя потерять при унификации |
|---|---|---|---|---|
| **Курсы (корзина)** | КЛИЕНТ: `headerAccount.js:222` (`shop.update price`, `order.insert summ`, promo через `preview_promo`) | КЛИЕНТ (`products[].price`) | user_course `end_period`=now+`DurationLong`, `buy=true`; `sales`; баланс автора | срок доступа (DurationLong), инвариант `order.summ==Σshop.price==charged`, комиссия автора, курс-запись эфира |
| **Мероприятия** | КЛИЕНТ: `eventsApi.js:325` (full/deposit; promo — только full, L373–393; пишет `shop.price`, `order.event_id`, `promo_*`) | КЛИЕНТ | через backing-курс (order.event_id-триггер); депозит = частичная оплата | депозит (частичная оплата), backing-course grant, event_id-триггер |
| **Эфиры** | СЕРВЕР: `stream-pay-link` edge (цена/shop/order/promo серверно) | СЕРВЕР (edge) | через backing_course_id; курс-запись; групп-чат | backing-course grant, курс-запись эфира, групп-чат, server-only invite |
| **Все** | вебхук «Shop» BuyCourse: paid без сверки суммы/подписи | — | sales+user_course+баланс на `shop.price` | идемпотентность, триггеры order.paid (промо/event/курс-запись) |

**Вывод:** унификация ДОЛЖНА включать (⚠️) серверный расчёт цены для ВСЕХ видов + усиление вебхука (сверка суммы с `order.summ` из БД + проверка подписи Prodamus). Это и закрывает обе дыры.

---

## АРХИТЕКТУРА единого checkout

### Серверный расчёт цены
**`create_checkout(p_items jsonb, p_promo text default null, p_bonus numeric default 0)`** — SECURITY DEFINER RPC (search_path=public, revoke anon, grant authenticated). Делает серверно:
1. По `p_items` (тип+id: course/event/stream, qty) берёт **цену из БД** (`course.Price`/`shop`/`event`/`stream.price`), а не из запроса.
2. Применяет промо (уровень %, через расширенный `preview_promo`/новый `preview_checkout`) — только к позициям с `referral_enabled` (п.6 правил).
3. (Этап 4) списание бонусов `p_bonus` ≤ 30% (из `referral_settings`) — проверка баланса по `bonus_ledger`, запись `spent`+резерв.
4. Пишет `shop`-строки (status='cart') и `order` (summ, course_positions, promo_code_id, promo_discount, bonus_used) — **под service_role/definer, не с клиента**.
5. Строит ссылку Prodamus **на сервере** (с `customer_email`/`customer_phone` — см. ниже) и возвращает `{order_id, payLink, summ, breakdown}`.
- Как ложится на текущее: order/shop/BuyCourse схема НЕ меняется (переиспользуем) → BuyCourse читает ту же `shop.price` (теперь серверную) → работает. ⚠️ **вебхук**: добавить сверку `Σ оплачено == order.summ` (из БД) + проверку подписи Prodamus перед выдачей доступа; иначе дыра остаётся. ⚠️ **цены**: клиентские записи `shop.price`/`order.summ` в `headerAccount.js`/`eventsApi.js` убираются (переходят в RPC) — старый клиент сломается → **фронт до миграции** (или RPC добавить, клиент переключить, потом запретить прямую запись).
- Эфиры: `stream-pay-link` сворачивается в `create_checkout` (или остаётся как единая серверная точка — согласовать).

### UI (единый экран оплаты)
- Новый **`src/_front/views/CheckoutPage.vue`** (PAGE_OVERRIDE в `src/_front/router.js`) ИЛИ модалка: список позиций, поле промокода, поле телефона (+7, маска+валидация), поле e-mail (если нет в профиле), чекбокс согласия на ПДн (ссылка на политику), итог, (этап 4) переключатель «списать бонусы», кнопка «Оплатить».
- Кнопки «Купить» открывают его с ОДНОЙ позицией (без корзины): `src/_front/views/CoursePage.vue` (addToCart→checkout), `src/_front/views/StreamsPage.vue` (purchaseStream→checkout), `src/_front/views/EventsPage*.vue`/`eventsApi.js` (purchaseEvent→checkout). Поле промокода **убрать со страницы эфира** (StreamsPage) — переезжает на экран оплаты.
- Корзина (`headerAccount.js` checkoutCart) переводится на `create_checkout`.

---

## АВТОЗАПОЛНЕНИЕ Prodamus (e-mail/телефон) — после единого checkout

По актуальной документации Prodamus payform: параметры ссылки **`customer_email`** и **`customer_phone`** (телефон в формате `79000000000`). Достаточно одного — ссылка становится персональной, пользователь сразу переходит к выбору способа оплаты и **не вводит контакты повторно**. Эти же контакты Prodamus использует для фискального чека (54-ФЗ) — чек уходит на переданные e-mail/телефон; требование «хотя бы один контакт» закрывается автоматически.
- Сейчас `headerAccount.js` их НЕ передаёт (только `order_id`+`products[]`+`urlSuccess`) → Prodamus спрашивает сам. Добавить `&customer_email=…&customer_phone=…` при построении ссылки **на сервере** (в `create_checkout`), значения — из профиля.
- **E-mail**: из аккаунта (`users.email`/auth). Если нет — поле на экране оплаты обязательно.
- **Телефон**: на экране оплаты (маска `+7`, валидация на клиенте и **на сервере** в RPC), подставляется из профиля если есть; в Prodamus — в формате `79…`. **Сохранять в профиль только при согласии** (чекбокс + текст о согласии на обработку ПДн со ссылкой на политику).
- **54-ФЗ/чек**: фискализацию делает Prodamus; передача контактов лишь убирает ручной ввод, на состав чека не влияет (позиции/суммы — из ссылки). Поля, которые Prodamus всё равно может запросить сам: способ оплаты (карта/СБП), иногда подтверждение контакта — но не требует повторного ввода переданных email/phone.
- ⚠️ **Схема профиля**: новая колонка `users.phone` (+ при 6c/column-grant — добавить в safe-grant на запись own-row, RLS). ⚠️ **webhook**: колбэк Prodamus может нести контакты/чек — НЕ логируем, не храним сверх `users.phone` (по согласию).
- **Логи/ошибки/отчёты**: телефон и e-mail — только в маске (`+7••• ••• ••45`, `a••@mail.ru`). Нигде не печатать целиком.

---

## ПРАВИЛА РЕФЕРАЛКИ → таблица настроек (без деплоя)
Все параметры — в `referral_settings` (одна строка, правится SQL/через админ-RPC без деплоя): уровни (пороги уникальных покупателей → %: 0–9→5…50+→10), `bonus_spend_pct_cap`=30, `bonus_expiry_months`=12, `refund_window_days`=14, `monthly_accrual_cap`, `author_platform_split`=50 (половина издержек с автора, половина с площадки), master-`enabled`=false.
Уровень = число УНИКАЛЬНЫХ оплативших по коду (каждый покупатель считается один раз). Скидка покупателю = % уровня (реальная, в цене). Бонус владельцу = тот же % от реально оплаченной суммы (без части бонусами), начисляется после `refund_window_days`, идемпотентно по `order_id`. Издержки (скидка+бонус) делятся пополам автор/площадка, резервируются; при трате бонусов автор позиции получает долю из резерва; при сгорании (12 мес) невостребованное возвращается автору/площадке пропорционально. Самоприменение (owner==buyer) запрещено. Баланс — из append-only `bonus_ledger` (accrued/spent/expired/cancelled/reserve/reserve_release; order_id, причина), запись только через SECURITY DEFINER RPC.

---

## ЭТАПЫ (порядок, зависимости, откат; деплой только вне эфиров/продаж)

| Этап | Что | ⚠️ | Зависит | Откат | Фронт-до-миграции? |
|---|---|---|---|---|---|
| **0** | Факты (этот документ) | — | — | — | — |
| **2a (safe foundation)** | **additive-схема**: `promo_codes.owner_user_id` (nullable) + `bonus_ledger` + `referral_settings` (+seed). Ничего не читает/пишет — инертно. | нет | — | drop (прилагается) | нет |
| **1** | Единый серверный `create_checkout` + экран оплаты + кнопки «Купить» + автозаполнение Prodamus (email/phone) + **сверка суммы/подписи в вебхуке** | ⚠️ цены, webhook, доступ | 2a (для phone-колонки частично) | вернуть клиентский checkout; снять RPC; вебхук-откат | **да** (убираем клиентскую запись цены — старый клиент сломается; катить фронт→RPC→затем запрет прямой записи) |
| **2** | `get_my_referral_code` (личный код, 1 на юзера, только подтверждённые), `get_my_bonuses`, страница `BonusesPage.vue`. Код в чекауте ещё НЕ принимается. | нет (чтение + генерация своего кода) | 2a | снять RPC/страницу | нет |
| **3** | Скидка по уровню в `create_checkout`; начисление владельцу в триггере `order.paid` (после refund-окна, идемпотентно); резерв и вычет половины из доли автора; возвраты (минус-записи) | ⚠️ цены, выплаты авторам, webhook/триггер | 1,2 | снять триггер/логику начисления; чекаут без скидки | да (если меняется форма order) |
| **4** | Списание бонусов в `create_checkout` (≤30%, не в той же покупке; только RPC) | ⚠️ цены, выплаты (резерв) | 3 | отключить списание в RPC | нет (аддитивно в RPC) |

Зависимости: 1 требует 2a (phone-колонку — можно вынести в 2a); 3 требует 1+2; 4 требует 3. Деплой фронта — обычным путём (cv-бамп) вне эфиров/продаж; серверные/вебхук-изменения — отдельным ОК, с бэкапом воркфлоу и сверкой суммы перед выдачей доступа.

---

## САМЫЙ ПЕРВЫЙ БЕЗОПАСНЫЙ ЭТАП (без ⚠️) — готов на ревью
**Этап 2a — additive-схема** (ничего не трогает в webhook/ценах/доступе/выплатах; инертна до этапов 2–4):
- `pending_referral_s2a_foundation.sql` — `alter promo_codes add owner_user_id` (+partial unique «один код на владельца»), `create table bonus_ledger` (append-only, RLS on, revoke anon/auth, idempotency-индекс по order_id+user+kind), `create table referral_settings` (одна строка, RLS on, revoke anon/auth) + seed дефолтов (уровни/проценты/лимиты/флаг enabled=false).
- `…_rollback.sql` — drop добавленного (колонка+индексы, обе таблицы).
Запуск — ты, в Studio/psql, по ОК (MCP execute_sql только на чтение). До этого — read-only.

## Источники (Prodamus)
- help.prodamus.ru — параметры `customer_email`/`customer_phone` персональной ссылки и уведомления об оплате.
