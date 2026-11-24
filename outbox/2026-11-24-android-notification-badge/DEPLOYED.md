# Опубликовано

Production SHA: 123cdab5222d42803adc310f53bdfccfde4cc9a9.
Коммит ветки: 942ba7b5f7c6006dd19b9019ec245048ddca692f.
PR: https://github.com/sabjorn7/meetclone/pull/7
Deploy App SUCCESS: https://github.com/sabjorn7/meetclone/actions/runs/45410066439 . Все сборки и фазы assets/HTML завершены.

Main перед merge совпал с базой d64d36b7a6e678a64cb80118f6ed4315f000a3cd, diff совпал с согласованным. Вошли только новый PNG и строка badge; другие локальные черновики исключены.

Production: HTML, /serviceworker.js и /images/notification-badge-mg-v2.png отвечают 200. SHA HTML совпадает с выпуском; PNG побайтово совпадает с проверенным 96×96 прозрачным badge (1673 байта). Ссылка badge обновлена, color icon остался прежним. Результат в production-check.json.

Физическая системная шторка Android NOT TESTED; пользовательская проверка: открыть PWA заново для обновления service worker, затем получить новое уведомление. Ранее показанные уведомления не обновятся. Подписки и данные пользователей не менялись; тестовые сообщения другим пользователям не отправлялись.

Откат при необходимости: revert 123cdab5222d42803adc310f53bdfccfde4cc9a9 через PR и штатный Deploy App. Сейчас откат не выполнялся.
