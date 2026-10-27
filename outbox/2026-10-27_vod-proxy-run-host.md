sha256(payload below): 0cc6c5a9fa02aad5be3e836db41d70a391642abec8a92112c75e8a38cb6212b5

# Видео-прокси: где и как запускать deploy/rollback-vod-proxy.sh

## 1. Хост и наличие mg-deploy

Скрипты меняют **nginx app.meetgu.ru**, а он (и `/var/www/peertube/storage → /video/storage`) стоит на
**app-хосте**: `hostname = tube`, доступ `ssh mg-jump` (= `root@app.meetgu.ru`, порт 2222, IP 95.143.220.169).
Я там **root**.

**mg-deploy на этом хосте НЕТ** (проверено):
- `/usr/local/sbin/mg-deploy` — нет
- `/etc/mg-deploy/approved.sha` — нет
- пользователь `mgdeploy` / `/home/mgdeploy/staging` — нет
- `/etc/sudoers.d/mg-deploy` — нет

mg-deploy развёрнут только на **sb** (192.168.1.24, mgdeploy) — для edge-функций. На app-хосте его инфры нет.

## 2. Как запускать — два варианта

### Вариант B (рекомендую): прямой запуск под root на app-хосте + ручная сверка sha
У меня уже есть прямой root-SSH на app-хост (`mg-jump`). Контроль «запускается ровно одобренное» сохраняем
так: **перед запуском сверяю sha256 файла на хосте с одобренным тобой** (deploy `aa7511a2…dd74`,
rollback `93f27148…e1e5`) и показываю это в журнале. Approved.sha-файл для этого НЕ нужен — гейтом служит
твой явный «ОК» в чате + совпадение sha. Бэкапы пишутся в `/var/backups/mg-deploy/` (скрипт создаёт сам).
Плюс: ничего не ставим, минимальный радиус. Минус: нет автоматического approved.sha-гейта (но sha сверяется
вручную и виден тебе в журнале).

### Вариант A (если хочешь тот же approved.sha-гейт, что на sb)
Подготовлю **отдельным файлом на ревью** `install-mg-deploy.sh` — реплику sb-инфры на app-хост (пользователь
`mgdeploy`, `/home/mgdeploy/staging`, `/etc/mg-deploy/approved.sha`, `/etc/sudoers.d/mg-deploy`,
`/usr/local/sbin/mg-deploy`). После установки — поток как на sb (scp в staging → ты добавляешь sha в
approved.sha → `sudo mg-deploy <файл>`). Минус: это новый security-компонент на втором хосте ради двух
nginx-скриптов (на мой взгляд, для разовой nginx-правки избыточно).

**Моя рекомендация — B** (у меня там root, скрипт маленький и уже одобрен по sha). Если хочешь A — скажи,
подготовлю `install-mg-deploy.sh` на ревью следующим файлом.

## 3. Точные команды

### Если выбираешь B (рекомендую)
От тебя — ничего в approved.sha (его тут нет). Просто ответь «ОК, запускай B». Дальше я (по этому ОК):
```
# с моей машины (у меня есть ssh-алиас mg-jump = root@app.meetgu.ru:2222):
scp outbox/deploy-vod-proxy.sh mg-jump:/root/deploy-vod-proxy.sh
ssh mg-jump 'sha256sum /root/deploy-vod-proxy.sh'     # ДОЛЖНО быть aa7511a2…dd74 — покажу тебе
ssh mg-jump 'bash /root/deploy-vod-proxy.sh --yes'    # журнал до DEPLOY OK (самопроверки)
```
Откат при необходимости (по отдельному ОК): так же `rollback-vod-proxy.sh` (сверка sha `93f27148…e1e5`).

Проверить самому (ты, с любой машины или с хоста), что именно одобренные байты:
```
ssh -p 2222 root@app.meetgu.ru 'sha256sum /root/deploy-vod-proxy.sh'
```

### Если выбираешь A
1. Я присылаю `install-mg-deploy.sh` на ревью → ты одобряешь по sha → он ставит mg-deploy на app-хост.
2. Заходишь на app-хост: `ssh -p 2222 root@app.meetgu.ru`
3. Добавляешь две строки в `/etc/mg-deploy/approved.sha` (формат `sha␠␠имя`, как `sha256sum`):
```
aa7511a2b76f10e0907f5c27295280e8429d46b8be4625ab4409b954d3d6dd74  deploy-vod-proxy.sh
93f27148754a5b74ca19cc5e8afe16a4f5954e09417387a78b1873f22954e1e5  rollback-vod-proxy.sh
```
4. Я кладу `deploy-vod-proxy.sh` в `/home/mgdeploy/staging`, сверяю sha на хосте, запускаю
   `ssh mg-jump 'sudo /usr/local/sbin/mg-deploy deploy-vod-proxy.sh'` — журнал до DEPLOY OK.

## Итог
- app-хост = `tube` (root@app.meetgu.ru:2222, `mg-jump`); mg-deploy там нет.
- Рекомендую **вариант B** (прямой root + сверка sha, approved.sha не нужен).
- Жду: выбор B или A + явный «ОК запускай». Без этого ничего не запускаю.
