#!/usr/bin/env bash
# Полная копия CRM для переноса на другой сервер: база (целостный снимок), фото заказов, публикации,
# картинки маркетинга, логотипы брендов. Запуск на СТАРОМ сервере: boomexport
set -euo pipefail
DATA_DIR="${DATA_DIR:-/var/lib/boomcrm}"; APP_DIR="${APP_DIR:-/opt/boomcrm}"; OUT_DIR="${OUT_DIR:-/root}"
STAMP="$(date +%Y-%m-%d_%H-%M)"; OUT="$OUT_DIR/boomcrm-transfer-$STAMP.tar.gz"
SNAP="$DATA_DIR/migrate-db.sqlite"
echo "→ Снимок базы данных…"
rm -f "$SNAP"
RUNAS=""; [ "$(id -u)" -eq 0 ] && id boomcrm >/dev/null 2>&1 && RUNAS="runuser -u boomcrm --"
(cd "$APP_DIR" && $RUNAS env CRM_DATA="$DATA_DIR" node -e "
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(process.env.CRM_DATA + '/crm.sqlite');
  db.exec(\"VACUUM INTO '\" + process.env.CRM_DATA + \"/migrate-db.sqlite'\");
" 2>/dev/null)
[ -s "$SNAP" ] || { echo "✘ Не удалось сделать снимок базы"; exit 1; }
echo "→ Упаковываю базу и файлы…"
tar -czf "$OUT" -C "$DATA_DIR" \
  --exclude=./backups --exclude='./crm.sqlite' --exclude='./crm.sqlite-*' --exclude=./download-backup.sqlite \
  --exclude=./heartbeat --exclude=./update.request --exclude=./update.log --exclude=./domain.conf \
  --exclude=./FIRST_ADMIN_PASSWORD.txt --exclude='./*.bak' \
  --transform 's#^\./migrate-db\.sqlite$#./crm.sqlite#' .
rm -f "$SNAP"
SIZE="$(du -h "$OUT" | cut -f1)"
echo "✔ Готово: $OUT ($SIZE)"
echo
echo "Дальше — на НОВОМ сервере (под root):"
echo "  1) установить CRM:   curl -sL https://raw.githubusercontent.com/zeus199191/boomcrm/main/go.sh | bash"
echo "  2) забрать копию:    scp root@$(hostname -I | awk '{print $1}'):$OUT /root/"
echo "  3) восстановить:     boomimport /root/$(basename "$OUT")"
