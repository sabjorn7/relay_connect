#!/usr/bin/env bash
# rollback-vod-proxy.sh (под mg-deploy) — откат /vod/: восстановить nginx-конфиг app.meetgu.ru из
# ПОСЛЕДНЕГО бэкапа в /var/backups/mg-deploy/, nginx -t, reload (НЕ restart). PeerTube не трогает.
# Правит РЕАЛЬНЫЙ файл (readlink -f) записью через `cat >` (сохраняя права/симлинк). Страховочную копию
# текущего состояния кладёт тоже в /var/backups/mg-deploy/ (НЕ рядом с конфигом).
# Запуск через mg-deploy (MG_CONFIRM=yes) или --yes.
set -uo pipefail
fail(){ echo; echo "ROLLBACK FAIL: $*"; exit 1; }
[ "${MG_CONFIRM:-}" = "yes" ] || [ "${1:-}" = "--yes" ] || fail "нужно MG_CONFIRM=yes (mg-deploy) или --yes"
command -v nginx >/dev/null || fail "нет nginx"
BAKDIR="/var/backups/mg-deploy"
TS="$(date +%Y%m%d%H%M%S)"

CONF="$(grep -rlE 'server_name[[:space:]]+app\.meetgu\.ru' /etc/nginx/sites-enabled/ /etc/nginx/conf.d/ /etc/nginx/sites-available/ 2>/dev/null | head -1)"
[ -n "$CONF" ] && [ -f "$CONF" ] || fail "конфиг app.meetgu.ru не найден"
REAL="$(readlink -f "$CONF")"
[ -n "$REAL" ] && [ -f "$REAL" ] || fail "readlink -f не разрешил $CONF"

BK="$(ls -1t "$BAKDIR/$(basename "$REAL").bak-"* 2>/dev/null | head -1)"
[ -n "$BK" ] && [ -f "$BK" ] || fail "бэкап $BAKDIR/$(basename "$REAL").bak-* не найден — откатывать нечего"

echo "восстанавливаю $REAL из $BK…"
mkdir -p "$BAKDIR" || fail "не создать $BAKDIR"
cp -a "$REAL" "$BAKDIR/$(basename "$REAL").prerollback-$TS" || fail "страховочная копия не удалась"
cat "$BK" > "$REAL" || fail "восстановление из бэкапа не удалось"

if ! nginx -t 2>/tmp/vod_rb.$$; then
  sed 's/^/       /' /tmp/vod_rb.$$ >&2; rm -f /tmp/vod_rb.$$
  fail "nginx -t после восстановления НЕ прошёл — reload НЕ делал, проверь конфиг вручную"
fi
rm -f /tmp/vod_rb.$$

nginx -s reload || fail "reload не удался"
if grep -q "# ---- /vod/ : same-origin" "$REAL"; then
  echo "ВНИМАНИЕ: в восстановленном конфиге всё ещё есть блок /vod/ (бэкап был уже с блоком?) — проверь вручную."
fi
echo "ROLLBACK OK (восстановлен из $BK; страховка: $BAKDIR/$(basename "$REAL").prerollback-$TS)"
