# Единая корзина — локальный результат

Убрана вся отменённая функциональность резервов мероприятий. Сохранена цепочка shop → order → Prodamus → BuyCourse и курсы-подложки. n8n, медиапоток, production и исходная рабочая копия не изменялись.

- architecture.md — реализация и совместимость.
- acceptance.md — реальные тесты и ограничения.
- deployment.md — порядок ручного SQL / schema cache / Edge / frontend и безопасная остановка.
- files.md — явный список файлов.
- postgres-results.json, browser-results.json — синтетические результаты.

SQL: supabase/migrations/pending_unified_checkout.sql; verify_unified_checkout.sql; rollback_unified_checkout.sql.

SHA-256 pending_unified_checkout.sql: `eaf98d014ced4f157f44535caf95b3871101c5e47e51ab4bf1d63aecb3bbc78d`.

66 локальных проверок PASS, 0 FAIL, сборка без postbuild успешна. Новые файлы проверены на whitespace и типичные токены/private keys без вывода значений; реальные env/backup/credentials не включены. Перед релизом нужны независимое ревью SQL/ACL и согласованный полный платёжный smoke-тест. Commit/push/deploy не выполнялись.

Уточнение UX: добавление оставляет пользователя на текущей странице. Кнопка становится «В корзине»; она и значок шапки открывают корзину только вручную. Добавлен набор настоящих страниц на локальных моках — pages-browser-results.json. Сохраняется последняя опубликованная правка строки продления бессрочных курсов; релиз собирать от актуального main.
