# Production-выпуск

- PR: https://github.com/sabjorn7/meetclone/pull/5
- Коммит ветки: 816b8b9b02502ae6d64b0d03753c161447b82071.
- Squash/main и фактический SHA HTML: ff891768c043849c99e28973f52090d0a57b6768.
- Deploy App SUCCESS: https://github.com/sabjorn7/meetclone/actions/runs/45405305958 . Все сборки, assets и HTML завершены.
- Перед merge main совпал с базой 78c74681f7e73ad0312932dbebf916aa4271d85e; diff побайтово совпал с согласованным пакетом. Только App.vue и тест.
- Локально BEFORE воспроизведён, AFTER 8 PASS Chrome/WebKit, Vite PASS.
- Production: 8/8 проверок публичного интерфейса Chrome/WebKit PASS: /, /all_course/, /login/, /registration/. Правильный SHA, HTTP 200, Vue mount, прелоадер скрыт. Гостевой / корректно уходит в каталог. Ошибок JS приложения и собственных JS/CSS не обнаружено.
- В Chrome сохраняются сетевые ошибки внешних Google Fonts/Метрики; они отдельно записаны в JSON и не считаются успешной загрузкой внешних ресурсов.
- Возврат с подтверждённой сессией проверен локально. Production-аккаунт недоступен, реальный авторизованный переход NOT TESTED; нужна пользовательская проверка после обновления вкладки. Регистрации/платежи/заказы не выполнялись.
- Откат при подтверждённой необходимости: revert ff891768c043849c99e28973f52090d0a57b6768 через PR и Deploy App, без отката всего Auth-релиза. Сейчас rollback не выполнялся.
