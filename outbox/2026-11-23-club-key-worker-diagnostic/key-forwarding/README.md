# Подтверждённая причина 503 и точечная передача ключа

Администратор выполнил диагностику внутри worker:

```json
{"env_error":null,"env_nonempty":false,"env_present":false,"event":"club_key_load_v1","file_error":"PermissionDenied","file_read":false,"json_error":null,"json_object":false,"json_valid":false,"key_nonempty":false,"key_present":false,"source":"none"}
```

**Причина подтверждена:** sandbox checkout-pay-link запрещает чтение файла через Deno, а PRODAMUS_SECRET_KEY в окружении worker отсутствует. clubPaymentLink выбрасывает club_signing_not_configured до RPC и обращения к Prodamus. Это не доказательство ошибки JSON: JSON вообще не был прочитан. Linux-права 0400/root менять не нужно.

## Подготовленное минимальное решение

`club-key-env.mjs` вызывается в доверенном MAIN worker перед созданием checkout-pay-link. Читает прежний защищённый файл, добавляет ключ только в отдельную копию envVars этого worker. Не использует глобальный Deno.env.set, не передаёт ключ другим функциям, не меняет сам ключ. Существующее чтение env в checkout-pay-link уже поддерживает такой способ.

Подключение **после сверки фактического main/index.ts**:

```js
import { clubWorkerEnv } from './club-key-env.mjs';
// В существующем EdgeRuntime.userWorkers.create сохранить все остальные параметры.
// Только свойство envVars заменить на:
envVars: await clubWorkerEnv(servicePath, envVars),
```

Не заменять весь main/index.ts шаблоном. Не менять маршрутизацию, проверку JWT и параметры других worker. При ошибке загрузки ключа helper сохраняет прежнее окружение: клуб останется недоступным, но обычный checkout не будет заблокирован дополнительным исключением.

## Проверки

`node club-key-env.test.mjs` — 8 локальных тестов на синтетических данных. Реальный main worker не запускался. После согласованного внедрения текущая диагностика должна показать `env_present=true`, `env_nonempty=true`, `source=env`. `file_error=PermissionDenied` при этом может остаться: ключ уже берётся из окружения.

## Что требуется до установочного пакета

Нужен текущий main/index.ts (секреты не присылать) либо его закрытая административная копия, чтобы сверить место вызова, фактический servicePath и сформировать точный diff/SHA. У mgdeploy нет доступа к Docker и найденного читаемого main/index.ts. Это **кандидат точечного исправления, не готовый установщик**: не импортировать его автоматически и не запускать старые установщики повторно.

После сверки: root-only backup main/index.ts; установка helper и одной правки envVars; согласованный перезапуск Edge Runtime; анонимная проверка 401 и безопасной записи source=env; затем проверка клубного пути без реального списания. Откат — только изменённый main/index.ts/helper. SQL, n8n, frontend, ключ и платёжная история не меняются.

Production в ходе подготовки не изменён.

## Получение фактического main

[Read-only пакет через mg-deploy: SHA и точное действие администратора](main-read/README.md). Финальная установка заблокирована до получения фактического исходника; шаблон вместо него не используется.
