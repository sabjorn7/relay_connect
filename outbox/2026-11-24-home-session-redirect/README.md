# Возврат из купленного курса в «Мои курсы»

База: 78c74681f7e73ad0312932dbebf916aa4271d85e. Локальная ветка fix/home-session-redirect-20261124. Production не менялся; коммит приложения и Deploy App не выполнялись.

Причина: ссылка MyCoursePage ведёт правильно на /. Но App.vue синхронно вызывал isLikelyLoggedIn(), который после auth-v2 читает только snapshot профиля. Пустой snapshot во время восстановления SDK ошибочно считался гостем и вызывал router.replace('/all_course').

BEFORE: реальный App.vue + headerAccount, синтетический SDK с действующей сессией B и задержкой 350 мс; ошибочный переход в каталог воспроизведён Chrome/WebKit.

Исправление: только App.vue ожидает getSession() существующего SDK; перенаправляет лишь при успешном результате session=null. Ошибки/неготовность SDK не считаются гостевым состоянием. Cleanup watcher отменяет запоздалое решение при смене маршрута. HomePage продолжает самостоятельно подтверждать сессию перед показом личных данных. Хранилище, SDK, cookies, покупки, backend/SQL/RLS не меняются. Нет новых таймеров, циклов или повторов.

AFTER: 8 PASS (Chrome/WebKit × сессия B, настоящий гость, ошибка Auth, уход со страницы до ответа). Vite build без postbuild PASS; git diff --check PASS. API синтетические, внешняя сеть блокируется. Production-аккаунт и физический PWA NOT TESTED. Зависший getSession не блокирует публичный рендер App, но гостевой redirect ожидает его результат.

Публикация после отдельного согласования: сверить main с базой, применить changes.diff, выполнить штатный PR/Deploy App. Откат только нового коммита через revert, не откатывать весь Auth-релиз. Данные и серверные сессии не затрагиваются.

Запуск: PLAYWRIGHT_MODULE=<playwright/index.mjs> node tests/home-session-redirect.browser.mjs; BEFORE=1 проверяет базовый App.vue из HEAD.
