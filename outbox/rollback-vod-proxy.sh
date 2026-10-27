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

# Только активные конфиги (sites-enabled/conf.d), без бэкап-файлов (см. deploy-скрипт).
CONF=""; REAL=""; N=0
while IFS= read -r f; do
  [ -n "$f" ] || continue
  r="$(readlink -f "$f" 2>/dev/null)"; [ -n "$r" ] && [ -f "$r" ] || continue
  grep -qE 'server_name[[:space:]]+app\.meetgu\.ru' "$r" || continue
  [ -z "$CONF" ] && { CONF="$f"; REAL="$r"; }
  N=$((N+1))
done < <(find /etc/nginx/sites-enabled /etc/nginx/conf.d -maxdepth 1 \( -type f -o -type l \) \
            ! -name '*.bak' ! -name '*.bak-*' ! -name '*.bak.*' ! -name '*.new' ! -name '*.prerollback*' \
            ! -name '*.save' ! -name '*~' ! -name '*.dpkg-*' ! -name '*.orig' 2>/dev/null)
[ "$N" -ge 1 ] || fail "активный конфиг app.meetgu.ru не найден"
[ "$N" -eq 1 ] || fail "НЕОДНОЗНАЧНО: несколько активных конфигов с app.meetgu.ru"

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
