#!/usr/bin/env bash
# Восстановление CRM из копии boomexport на НОВОМ сервере: boomimport /root/boomcrm-transfer-....tar.gz
# Текущая база нового сервера не удаляется, а откладывается в backups/before-import-….
# Пробный перенос (старый сервер продолжает работать): boomimport --test ФАЙЛ — отключает боты MAX/Telegram/ВК,
# кассу Saby, банк, SMS и Метрику, чтобы копия не слала уведомления и не задваивала операции.
set -euo pipefail
DATA_DIR="${DATA_DIR:-/var/lib/boomcrm}"; PORT="${PORT:-3000}"; NOSVC="${NOSVC:-}"
TEST=""; [ "${1:-}" = "--test" ] && { TEST=1; shift; }
F="${1:-}"
[ -n "$F" ] && [ -f "$F" ] || { echo "✘ Укажите файл копии: boomimport /root/boomcrm-transfer-ДАТА.tar.gz"; exit 1; }
tar -tzf "$F" | grep -x './crm.sqlite' >/dev/null || { echo "✘ В архиве нет базы crm.sqlite — это не копия boomexport"; exit 1; }
echo "→ Останавливаю CRM…"; [ -n "$NOSVC" ] || systemctl stop boomcrm
STAMP="$(date +%Y-%m-%d_%H-%M)"; mkdir -p "$DATA_DIR/backups"
for f in "$DATA_DIR"/crm.sqlite "$DATA_DIR"/crm.sqlite-wal "$DATA_DIR"/crm.sqlite-shm; do
  [ -f "$f" ] && mv "$f" "$DATA_DIR/backups/before-import-$STAMP-$(basename "$f")"
done
echo "→ Распаковываю базу и файлы…"
tar -xzf "$F" -C "$DATA_DIR"
rm -f "$DATA_DIR/FIRST_ADMIN_PASSWORD.txt"   # теперь действуют прежние логины и пароли
if [ -n "$TEST" ]; then
  echo "→ Пробный режим: отключаю боты, кассу, банк, SMS и Метрику на этой копии…"
  node -e "
    const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync(process.argv[1] + '/crm.sqlite');
    const keys = ['max_token','tg_token','vk_token','saby_client_id','saby_app_secret','saby_secret_key','alfa_access_token','alfa_refresh_token','alfa_client_secret','alfa_auto','sms_provider','smsru_api_id','sms_gate_pass','sms_auto_ready','sms_auto_remind','sms_auto_review','ym_id'];
    const st = db.prepare(\"UPDATE settings SET value='' WHERE key=?\"); for (const k of keys) st.run(k);
    db.prepare(\"INSERT OR REPLACE INTO settings(key,value) VALUES('test_copy','1')\").run();
  " "$DATA_DIR" 2>/dev/null
fi
id boomcrm >/dev/null 2>&1 && chown -R boomcrm:boomcrm "$DATA_DIR"
echo "→ Запускаю CRM…"; [ -n "$NOSVC" ] || systemctl start boomcrm
sleep 3
CODE=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/api/me" || true)
if [ "$CODE" = "401" ]; then echo "✔ Готово: CRM работает с перенесёнными данными. Входите со своими прежними логинами и паролями."
  [ -n "$TEST" ] && echo "  Это ПРОБНАЯ копия: изменения здесь не попадут на основной сервер. Боты, касса, банк и SMS отключены."
else echo "✘ CRM не отвечает (код $CODE). Посмотрите: journalctl -u boomcrm -n 50"; fi
