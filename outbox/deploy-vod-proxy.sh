#!/usr/bin/env bash
# deploy-vod-proxy.sh (под mg-deploy) — добавить location-блок /vod/ в nginx app.meetgu.ru.
# Делает: бэкап найденного конфига с таймстампом; ИДЕМПОТЕНТНАЯ вставка блока /vod/ ПЕРЕД первым
# 'location ^~ /sb/' (чтобы /vod/-regex имели приоритет); nginx -t (при ошибке — восстановить бэкап и
# выйти FAIL, reload НЕ делать); nginx -s reload (НЕ restart); самопроверки. PeerTube не трогает.
# ВНИМАНИЕ: меняет nginx app.meetgu.ru. reload почти бесшовен — активные соединения/эфиры не рвутся.
# Запуск через mg-deploy (ставит MG_CONFIRM=yes) или --yes. Ничего в video.meetgu.ru не меняется.
set -uo pipefail
fail(){ echo; echo "DEPLOY FAIL: $*"; exit 1; }
[ "${MG_CONFIRM:-}" = "yes" ] || [ "${1:-}" = "--yes" ] || fail "нужно MG_CONFIRM=yes (mg-deploy) или --yes"
command -v nginx >/dev/null || fail "нет nginx"
command -v curl  >/dev/null || fail "нет curl"
MARK="# ---- /vod/ : same-origin"
TS="$(date +%Y%m%d%H%M%S)"
BAK=""

echo "[1/6] поиск конфига app.meetgu.ru…"
CONF="$(grep -rlE 'server_name[[:space:]]+app\.meetgu\.ru' /etc/nginx/sites-enabled/ /etc/nginx/conf.d/ /etc/nginx/sites-available/ 2>/dev/null | head -1)"
[ -n "$CONF" ] && [ -f "$CONF" ] || fail "конфиг с server_name app.meetgu.ru не найден"
grep -q 'location \^~ /sb/' "$CONF" || fail "в $CONF нет якоря 'location ^~ /sb/' — не тот файл/структура"
echo "       CONF=$CONF"

if grep -q "$MARK" "$CONF"; then
  echo "[2/6] блок /vod/ уже установлен — вставку пропускаю (идемпотентно)."
else
  echo "[2/6] бэкап…"; cp -a "$CONF" "$CONF.bak-$TS" || fail "бэкап не удался"; BAK="$CONF.bak-$TS"; echo "       $BAK"
  echo "[3/6] вставка блока /vod/ перед первым 'location ^~ /sb/'…"
  BLK="$(mktemp)"
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
  awk -v blk="$BLK" 'BEGIN{while((getline l<blk)>0)B=B l"\n"} !ins&&/location \^~ \/sb\//{printf "%s",B;ins=1} {print}' "$CONF" > "$CONF.new" || { rm -f "$BLK" "$CONF.new"; fail "awk-вставка не удалась"; }
  rm -f "$BLK"
  grep -q "$MARK" "$CONF.new" || { rm -f "$CONF.new"; fail "после вставки маркер не найден"; }
  mv "$CONF.new" "$CONF" || fail "подмена конфига не удалась"
fi

echo "[4/6] nginx -t…"
if ! nginx -t 2>/tmp/vod_ngt.$$; then
  sed 's/^/       /' /tmp/vod_ngt.$$ >&2; rm -f /tmp/vod_ngt.$$
  if [ -n "$BAK" ] && [ -f "$BAK" ]; then cp -a "$BAK" "$CONF" && nginx -t >/dev/null 2>&1 && echo "       восстановлен из $BAK (reload НЕ делал)"; fi
  fail "nginx -t не прошёл — изменения откатаны, reload НЕ делал"
fi
rm -f /tmp/vod_ngt.$$

echo "[5/6] nginx -s reload (не restart)…"
nginx -s reload || fail "reload не удался (конфиг валиден; проверь мастер-процесс nginx)"
sleep 1

echo "[6/6] самопроверки…"
chk(){ local name="$1" exp="$2"; shift 2; local code; code="$(curl -s -m 10 -o /dev/null -w '%{http_code}' "$@" 2>/dev/null)"; echo "       $name → $code (ждём $exp)"; case ",$exp," in *",$code,"*) return 0;; *) return 1;; esac; }
OK=1
chk "/vod private → 403"      "403"     "https://app.meetgu.ru/vod/static/streaming-playlists/hls/private/zzz" || OK=0
chk "/vod мусор → 404"        "404"     "https://app.meetgu.ru/vod/garbage-xyz-123"                           || OK=0
chk "GET / → 200"            "200"     "https://app.meetgu.ru/"                                              || OK=0
chk "video.meetgu.ru → 200"  "200"     "https://video.meetgu.ru/"                                            || OK=0
chk "POST /vod api → 403/405" "403,405" -X POST "https://app.meetgu.ru/vod/api/v1/videos/"                   || OK=0
if [ "$OK" != 1 ]; then
  if [ -n "$BAK" ] && [ -f "$BAK" ]; then cp -a "$BAK" "$CONF" && nginx -t >/dev/null 2>&1 && nginx -s reload && echo "       самопроверка упала → откатано из $BAK + reload"; fi
  fail "самопроверки не прошли"
fi
echo "DEPLOY OK (CONF=$CONF; бэкап: ${BAK:-<не создавался: было уже установлено>})"
