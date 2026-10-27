#!/usr/bin/env bash
# deploy-vod-proxy.sh (под mg-deploy) — добавить location-блок /vod/ в nginx app.meetgu.ru.
# Делает: бэкап РЕАЛЬНОГО конфига (readlink -f) в /var/backups/mg-deploy/ с таймстампом; ИДЕМПОТЕНТНАЯ
# вставка блока /vod/ ПЕРЕД первым 'location ^~ /sb/' (сборка во временном файле в /tmp, запись в целевой
# через `cat >` — сохраняя права/симлинк); nginx -t (при ошибке восстановить из бэкапа и FAIL, reload НЕ
# делать); nginx -s reload (НЕ restart); самопроверки; проверка, что в include-папках нет лишних файлов.
# НИКАКИЕ .bak/.new/.prerollback рядом с конфигом (sites-enabled/conf.d) НЕ создаются. PeerTube не трогает.
# Запуск через mg-deploy (ставит MG_CONFIRM=yes) или --yes.
set -uo pipefail
fail(){ echo; echo "DEPLOY FAIL: $*"; exit 1; }
[ "${MG_CONFIRM:-}" = "yes" ] || [ "${1:-}" = "--yes" ] || fail "нужно MG_CONFIRM=yes (mg-deploy) или --yes"
command -v nginx >/dev/null || fail "нет nginx"
command -v curl  >/dev/null || fail "нет curl"
MARK="# ---- /vod/ : same-origin"
TS="$(date +%Y%m%d%H%M%S)"
BAKDIR="/var/backups/mg-deploy"
BAK=""

echo "[1/7] поиск ЖИВОГО конфига app.meetgu.ru (только активные: sites-enabled/conf.d, без .bak)…"
# ВАЖНО: ищем только среди ПОДКЛЮЧЁННЫХ конфигов и исключаем бэкап-файлы — иначе grep может выбрать
# старый app.bak.* из sites-available (в нём тоже есть server_name app.meetgu.ru). sites-available НЕ
# сканируем напрямую (это хранилище, не активные конфиги; активное подключается симлинком из sites-enabled).
CONF=""; REAL=""; N=0; HITS=""
while IFS= read -r f; do
  [ -n "$f" ] || continue
  r="$(readlink -f "$f" 2>/dev/null)"; [ -n "$r" ] && [ -f "$r" ] || continue
  grep -qE 'server_name[[:space:]]+app\.meetgu\.ru' "$r" || continue
  [ -z "$CONF" ] && { CONF="$f"; REAL="$r"; }
  N=$((N+1)); HITS="$HITS  $f -> $r"$'\n'
done < <(find /etc/nginx/sites-enabled /etc/nginx/conf.d -maxdepth 1 \( -type f -o -type l \) \
            ! -name '*.bak' ! -name '*.bak-*' ! -name '*.bak.*' ! -name '*.new' ! -name '*.prerollback*' \
            ! -name '*.save' ! -name '*~' ! -name '*.dpkg-*' ! -name '*.orig' 2>/dev/null)
[ "$N" -ge 1 ] || fail "активный конфиг с server_name app.meetgu.ru не найден в sites-enabled/conf.d"
[ "$N" -eq 1 ] || { printf '%s' "$HITS" >&2; fail "НЕОДНОЗНАЧНО: несколько активных конфигов с app.meetgu.ru — уточни вручную"; }
grep -q 'location \^~ /sb/' "$REAL" || fail "в $REAL нет якоря 'location ^~ /sb/' — не тот файл/структура"
echo "       CONF=$CONF  REAL=$REAL"

if grep -q "$MARK" "$REAL"; then
  echo "[2/7] блок /vod/ уже установлен — вставку пропускаю (идемпотентно)."
else
  echo "[2/7] бэкап в $BAKDIR…"
  mkdir -p "$BAKDIR" || fail "не создать $BAKDIR"
  BAK="$BAKDIR/$(basename "$REAL").bak-$TS"
  cp -a "$REAL" "$BAK" || fail "бэкап не удался"
  echo "       $BAK"
  echo "[3/7] сборка новой версии во /tmp и запись через cat >…"
  BLK="$(mktemp /tmp/vodblk.XXXXXX)"
  cat > "$BLK" <<'VODBLOCK'
    # ---- /vod/ : same-origin доставка ПУБЛИЧНОГО медиа PeerTube (шаг 1, без кэша) ----
    location ~ ^/vod/static/(webseed|web-videos|streaming-playlists/hls)/private/ { return 403; }
    location ~ ^/vod/(download|api/v1/videos/[^/]+/token) { return 403; }
    location ~ ^/vod/static/(webseed|web-videos|redundancy|streaming-playlists)/ {
        root /var/www/peertube/storage;
        sendfile on;
        sendfile_max_chunk 1M;
        aio threads;
        limit_rate_after 5M;
        limit_rate 5M;
        add_header X-Vod-Proxy 1 always;
        rewrite ^/vod/static/webseed/(.*)$ /web-videos/$1 break;
        rewrite ^/vod/static/(.*)$         /$1            break;
        try_files $uri =404;
    }
    location ~ ^/vod/api/v1/videos/ {
        limit_except GET HEAD { deny all; }
        proxy_pass              http://127.0.0.1:9000;
        proxy_http_version      1.1;
        proxy_set_header        Host video.meetgu.ru;
        proxy_set_header        X-Forwarded-Proto https;
        proxy_set_header        Cookie "";
        proxy_hide_header       Set-Cookie;
        proxy_set_header        Range $http_range;
        proxy_set_header        If-Range $http_if_range;
        proxy_buffering         off;
        proxy_connect_timeout   5s;
        proxy_send_timeout      60s;
        proxy_read_timeout      60s;
        add_header              X-Vod-Proxy 1 always;
        rewrite ^/vod/(.*)$ /$1 break;
    }
    location /vod/ { return 404; }
    # ---- /vod/ end ----
VODBLOCK
  TMPNEW="$(mktemp /tmp/vodconf.XXXXXX)"
  awk -v blk="$BLK" 'BEGIN{while((getline l<blk)>0)B=B l"\n"} !ins&&/location \^~ \/sb\//{printf "%s",B;ins=1} {print}' "$REAL" > "$TMPNEW" || { rm -f "$BLK" "$TMPNEW"; fail "awk-сборка не удалась"; }
  rm -f "$BLK"
  grep -q "$MARK" "$TMPNEW" || { rm -f "$TMPNEW"; fail "в собранной версии нет маркера (якорь /sb/ не найден?)"; }
  # Запись через cat > (НЕ mv): сохраняем inode/права/симлинк целевого файла.
  cat "$TMPNEW" > "$REAL" || { rm -f "$TMPNEW"; fail "запись в $REAL не удалась"; }
  rm -f "$TMPNEW"
fi

echo "[4/7] nginx -t…"
if ! nginx -t 2>/tmp/vod_ngt.$$; then
  sed 's/^/       /' /tmp/vod_ngt.$$ >&2; rm -f /tmp/vod_ngt.$$
  if [ -n "$BAK" ] && [ -f "$BAK" ]; then cat "$BAK" > "$REAL" && nginx -t >/dev/null 2>&1 && echo "       восстановлен из $BAK (reload НЕ делал)"; fi
  fail "nginx -t не прошёл — изменения откатаны, reload НЕ делал"
fi
rm -f /tmp/vod_ngt.$$

echo "[5/7] nginx -s reload (не restart)…"
nginx -s reload || fail "reload не удался (конфиг валиден; проверь мастер-процесс nginx)"
sleep 1

echo "[6/7] самопроверки…"
chk(){ local name="$1" exp="$2"; shift 2; local code; code="$(curl -s -m 10 -o /dev/null -w '%{http_code}' "$@" 2>/dev/null)"; echo "       $name → $code (ждём $exp)"; case ",$exp," in *",$code,"*) return 0;; *) return 1;; esac; }
OK=1
chk "/vod private → 403"        "403"         "https://app.meetgu.ru/vod/static/streaming-playlists/hls/private/zzz" || OK=0
chk "/vod мусор → 404"          "404"         "https://app.meetgu.ru/vod/garbage-xyz-123"                           || OK=0
chk "GET / → 200"               "200"         "https://app.meetgu.ru/"                                              || OK=0
chk "video.meetgu.ru → 2xx/3xx" "200,301,302" "https://video.meetgu.ru/"                                            || OK=0
chk "POST /vod api → 403/405"   "403,405"     -X POST "https://app.meetgu.ru/vod/api/v1/videos/"                    || OK=0
if [ "$OK" != 1 ]; then
  if [ -n "$BAK" ] && [ -f "$BAK" ]; then cat "$BAK" > "$REAL" && nginx -t >/dev/null 2>&1 && nginx -s reload && echo "       самопроверка упала → откатано из $BAK + reload"; fi
  fail "самопроверки не прошли"
fi

echo "[7/7] проверка include-папок на лишние файлы (.bak/.new/.prerollback)…"
STRAY="$(find /etc/nginx/sites-enabled /etc/nginx/conf.d /etc/nginx/sites-available -maxdepth 1 -type f \( -name '*.bak' -o -name '*.bak-*' -o -name '*.new' -o -name '*.prerollback-*' \) 2>/dev/null)"
if [ -n "$STRAY" ]; then
  echo "       ⚠️ ВНИМАНИЕ: лишние файлы в include-папках (убрать вручную):"; echo "$STRAY" | sed 's/^/         /'
else
  echo "       чисто (лишних файлов нет; бэкапы только в $BAKDIR)"
fi

echo "DEPLOY OK (REAL=$REAL; бэкап: ${BAK:-<не создавался: было уже установлено>})"
