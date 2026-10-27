#!/usr/bin/env bash
# rollback-vod-proxy.sh (под mg-deploy) — откат /vod/: восстановить nginx-конфиг app.meetgu.ru из
# ПОСЛЕДНЕГО бэкапа deploy-vod-proxy.sh, nginx -t, reload (НЕ restart). PeerTube не трогает.
# Запуск через mg-deploy (MG_CONFIRM=yes) или --yes.
set -uo pipefail
fail(){ echo; echo "ROLLBACK FAIL: $*"; exit 1; }
[ "${MG_CONFIRM:-}" = "yes" ] || [ "${1:-}" = "--yes" ] || fail "нужно MG_CONFIRM=yes (mg-deploy) или --yes"
command -v nginx >/dev/null || fail "нет nginx"

CONF="$(grep -rlE 'server_name[[:space:]]+app\.meetgu\.ru' /etc/nginx/sites-enabled/ /etc/nginx/conf.d/ /etc/nginx/sites-available/ 2>/dev/null | head -1)"
[ -n "$CONF" ] && [ -f "$CONF" ] || fail "конфиг app.meetgu.ru не найден"
BK="$(ls -1t "$CONF".bak-* 2>/dev/null | head -1)"
[ -n "$BK" ] && [ -f "$BK" ] || fail "бэкап $CONF.bak-* не найден — откатывать нечего"

echo "восстанавливаю $CONF из $BK…"
cp -a "$CONF" "$CONF.prerollback-$(date +%Y%m%d%H%M%S)" || fail "страховочная копия не удалась"
cp -a "$BK" "$CONF" || fail "восстановление из бэкапа не удалось"

if ! nginx -t 2>/tmp/vod_rb.$$; then
  sed 's/^/       /' /tmp/vod_rb.$$ >&2; rm -f /tmp/vod_rb.$$
  fail "nginx -t после восстановления НЕ прошёл — reload НЕ делал, проверь конфиг вручную"
fi
rm -f /tmp/vod_rb.$$

nginx -s reload || fail "reload не удался"
if grep -q "# ---- /vod/ : same-origin" "$CONF"; then
  echo "ВНИМАНИЕ: в восстановленном конфиге всё ещё есть блок /vod/ (бэкап был уже с блоком?) — проверь вручную."
fi
echo "ROLLBACK OK (восстановлен из $BK)"
