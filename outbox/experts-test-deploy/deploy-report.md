sha256(payload below): d29855a86fedbf7649ba3b4c40a6f6bb75d918a5b4e9ba137eb339478437d0ef

# Выкладка тестовой страницы эксперт-лендинга — отчёт

## Адрес
https://app.meetgu.ru/experts-test.html  (HTTP/2 200, проверено снаружи 3/3)

## Что именно изменено (минимум, SPA/маршруты/вебхуки/платежи не тронуты)
1. Файл залит в ИЗОЛИРОВАННЫЙ каталог вне rsync-webroot: `/home/arseny/www-lptest/experts-test.html` (владелец arseny, 644). Это копия `2026-10-29_meetguru-landing.html` (sha 6f1621ce…f0ce) + твоя одна строка `@media (max-width:820px){#live>.dd{display:none}}` перед `</style>`. sha выложенного: `ab151fe7aa57aa47d25d8c5351d224882087cba371d07c8b2a797ba25dd730c9`.
2. В nginx `/etc/nginx/sites-available/app` (server app.meetgu.ru:443) добавлен один точечный блок:
   ```
   location = /experts-test.html {
       root /home/arseny/www-lptest;
       add_header X-Robots-Tag "noindex, nofollow" always;
       add_header Cache-Control "no-store" always;
       try_files $uri =404;
   }
   ```
   `nginx -t` ок → `systemctl reload nginx` (без рестарта, без пересоздания контейнеров).
   Бэкап конфига перед правкой: `/etc/nginx/sites-available/app.bak.20261029-184458`.

## Условия — выполнено
- Отдельный адрес, exact-match `location =` — полностью изолирован от SPA (`location /`) и его маршрутов; каталог вне webroot → деплои фронта (rsync --delete) его не трогают.
- Не индексируется: заголовок `X-Robots-Tag: noindex, nofollow` (проверено снаружи) + `<meta name="robots" content="noindex,nofollow">` уже в файле; ссылок с сайта нет, в sitemap не добавлял.
- CSP/заголовки: на сайте CSP-заголовка нет → Google Fonts (CSS 200) и вшитые `data:`-картинки не блокируются; исключение не потребовалось.
- Окно: на момент выкладки live-эфиров нет, оплат за 30 мин нет.
- Перезапуск edge-runtime/контейнеров не требовался и не делался. Только reload nginx.
- Проверка снаружи: 200, нет ошибок страницы в консоли (только шум headless-GPU `CVDisplayLink`, к странице не относится). Скриншоты: `live-desktop-1366.png`, `live-mobile-400.png` (ровно 400px, без горизонтального скролла).

## Наблюдение (не критично, не менял)
В hero на 400px длинный тег и слово «продажи» подрезаются краем (overflow-x:hidden, скролла не создаёт) — поведение исходного hero-блока. Скажи, если поправить.

## Откат — одной строкой
```
ssh mg-jump 'cp /etc/nginx/sites-available/app.bak.20261029-184458 /etc/nginx/sites-available/app && nginx -t && systemctl reload nginx && rm -rf /home/arseny/www-lptest'
```
