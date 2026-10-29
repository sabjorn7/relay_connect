sha256(payload below): 4b2573ea5f51ae9ba51bd884a35c3d3e39b2339509910852c6072a4696a9c190

# Промокоды → реферальная программа + «Бонусы»: разведка (только анализ)

Ничего не менял. Данные пользователей/ключи/реквизиты не печатаю. ⚠️ = трогает webhook/цены/доступ — без твоего ОК не меняем.

## 1. Где хранятся промокоды, кто создаёт, какие RPC
`supabase/migrations/pending_promo_codes.sql`:
- Таблица **`promo_codes`** (L26–41): `code` (unique по `upper(code)`), `discount_type` percent|fixed (L29), `discount_value` (L30; percent ≤100), `scope_type` all|course + `scope_course_id` (L31–32), `usage_limit`+`used_count` (L33–34), `expires_at` (L37), `created_by` (L37). Применимость к курсам/мероприятиям — через `scope`; к эфирам — тоже (общий `shop`/`course_id`).
- **`promo_redemptions`** (L45–53) — аудит активаций (loose `promo_id`, без FK).
- Колонки `order.promo_code_id` + `order.promo_discount` (L56–57, аудит; BuyCourse их не читает).
- Доступ: `revoke all … from anon, authenticated` (L61–62) → только через SECURITY DEFINER RPC.
- **Создаёт только админ/суперадмин**: `admin_create_promo` (L77+, гейт admin), `admin_list_promos` (L66), `admin_delete_promo` (L117); UI — `src/_front/views/SuperadminPage.vue` (вкладка «Промокоды»). `preview_promo(code, shop_ids)` (L141) — для залогиненных, валидирует и считает скидку read-only.

## 2. Как применяется при покупке (цена, Prodamus, sales/order, webhook)
- **Цена/скидка считается серверно** в `preview_promo` (L141–214): проверяет expires/`usage_limit`, берёт `shop.price` строк корзины (owner=auth.uid, status='cart'), считает per-line `new_price`.
- **Запись итоговой цены — КЛИЕНТОМ** в `src/_front/chrome/headerAccount.js:222` `checkoutCart`: `preview_promo` (L231) → для каждой строки `shop.update({price:new_price})` (≈L243) → `order.insert({summ, course_positions, promo_code_id, promo_discount})` (≈L248). Аналогично мероприятия: `src/_front/streams/eventsApi.js:325` `purchaseEvent` (промо — только полная оплата, L377–393). **Эфиры — серверно**: `supabase/functions/stream-pay-link/index.ts:189–193` (тот же `preview_promo`, запись цены в edge-функции под JWT).
- **Prodamus**: скидка уходит как **пониженная `products[i][price]`** (headerAccount ≈L260–270) — отдельного discount/custom-поля нет; сумма к оплате = Σ сниженных цен. `urlSuccess`, `order_id` в ссылке.
- **sales/order**: n8n BuyCourse биллит комиссию автора на `shop.price` (уже со скидкой) → `sales.amount` уже с учётом скидки; `order.summ` = сумма со скидкой. `order.promo_code_id/promo_discount` — аудит.
- **Webhook/n8n (BuyCourse)** промокоды **не читает** (прозрачно). Активация считается **триггером** `tg_order_paid_promo` (L≈214+) на переходе `order.paid` → `used_count+1` (в пределах лимита) + строка в `promo_redemptions`.

## 3. Можно ли добавить владельца кода (user_id) без поломок
Да, минимально:
- Добавить nullable `owner_user_id uuid` в `promo_codes`. Существующие коды → `null` (не меняются). BuyCourse/webhook `promo_codes` не читают → **не затрагиваются**. `order.promo_code_id` уже есть → владельца резолвим при начислении.
- Опционально: отдать владельца в `admin_list_promos` + новый **пользовательский** RPC для генерации личного кода (`owner_user_id = auth.uid()`).
- Изменить минимально: 1 колонка (+ при желании 1 user-RPC). Ни цены, ни webhook, ни доступ.

## 4. Что менять для реферальной программы
**(а) Начисление бонусов владельцу кода после оплаты** — расширить триггер `tg_order_paid_promo` (или новый) в `pending_promo_codes.sql`: при `order.paid` с `promo_code_id`, у которого есть `owner_user_id`, кредитовать **бонусный** баланс владельца. Хранить ОТДЕЛЬНО от денег: новая `users.bonus` ИЛИ таблица `bonus_ledger` (append-only). Только серверно (definer). **⚠️ трогает путь `order.paid` (webhook-смежно, деньги).**
**(б) Списание бонусов в чекауте (часть цены бонусами, остаток в Prodamus)** — итоговую цену и списание бонусов считать **серверно-авторитетно** (сейчас корзина/мероприятия пишут цену клиентом!). Нужно вынести расчёт цены+бонусов в SECURITY DEFINER RPC (как уже сделано для эфиров в stream-pay-link). Места: `headerAccount.js:222`, `eventsApi.js:325`, `streamsApi.js:111`+`stream-pay-link`. **⚠️ трогает ЦЕНЫ + сумму в Prodamus + запись order/shop.**
**(в) Страница «Бонусы»** — новый `src/_front/views/BonusesPage.vue` + PAGE_OVERRIDE в `router.js`; user-RPC `get_my_bonuses` (баланс+история) и `get_my_referral_code` (создать личный код, owner=self). Чтение + генерация своего кода → **низкий риск** (webhook/цены/доступ не трогает).

## 5. Риски
- **Подделка баланса/цены с фронта.** Сейчас корзина/мероприятия пишут `shop.price`+`order.summ` **клиентом** (`headerAccount.js`/`eventsApi.js`); `preview_promo` серверный, но ЗАПИСЬ клиентская → подменённый фронт может занизить сумму к оплате или «списать» несуществующие бонусы. **Списание бонусов обязано идти через серверный RPC**; желательно и цену корзины/мероприятий перевести на сервер (эфиры уже так). Существующая латентная дыра — отметить.
- **Двойное начисление при повторном webhook.** Prodamus/n8n могут прислать `order.paid` повторно. Начисление и активация должны быть **идемпотентны по `order_id`** (уникальный guard / одна `promo_redemptions`/`bonus_ledger` на order). Текущий триггер завязан на переход `paid`; для бонусов нужен такой же guard + уникальность по order.
- **Возврат покупки.** Нет потока, откатывающего бонусы: при возврате надо снять начисленное владельцу и вернуть покупателю списанное. Сейчас не обрабатывается → нужен сценарий (или ручной).
- **Самоприменение своего кода.** Владелец кода покупает по своему коду = скидка+самоначисление. Блокировать в `preview_promo`/чекауте: `owner_user_id == auth.uid()` → отказ (серверно).

## Итог
Промо-инфраструктура (promo_codes/redemptions/preview_promo/триггер order.paid) переиспользуема. Для рефералки минимально: `+owner_user_id` (п.3, безопасно) → бонус-ledger + начисление в триггере (4а ⚠️) → серверный чекаут со списанием бонусов (4б ⚠️, самое объёмное и рискованное) → страница «Бонусы» (4в, низкий риск). Перед 4а/4б — отдельный дизайн с идемпотентностью, серверными ценами, анти-self-use и возвратами; без ОК не трогаю.
