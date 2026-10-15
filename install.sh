#!/usr/bin/env bash
# =====================================================================
#  Установка / обновление CRM «Бумсистем» на Ubuntu 22.04 / 24.04
#
#  Запуск (от root, из папки с распакованной CRM):
#     bash install.sh                      — доступ по IP (http://IP-сервера)
#     bash install.sh crm.vash-domen.ru    — с доменом и бесплатным HTTPS
#
#  Повторный запуск = обновление кода. База данных не затрагивается.
#  Часовой пояс студии:  TZ_NAME=Europe/Moscow bash install.sh
# =====================================================================
set -euo pipefail

DOMAIN="${1:-}"
EMAIL="${2:-}"
TZ_NAME="${TZ_NAME:-Asia/Yekaterinburg}"
APP_DIR=/opt/boomcrm
DATA_DIR=/var/lib/boomcrm
PORT=3000
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

c_ok()  { echo -e "\e[32m✔ $*\e[0m"; }
c_inf() { echo -e "\e[36m→ $*\e[0m"; }
c_err() { echo -e "\e[31m✘ $*\e[0m"; }

[ "$(id -u)" -eq 0 ] || { c_err "Запустите от root: sudo bash install.sh"; exit 1; }
[ -f "$SRC_DIR/server.js" ] || { c_err "Не найден server.js рядом со скриптом"; exit 1; }

c_inf "Часовой пояс: $TZ_NAME"
timedatectl set-timezone "$TZ_NAME" 2>/dev/null || ln -sf "/usr/share/zoneinfo/$TZ_NAME" /etc/localtime

# --- Swap: на 1 ГБ RAM он нужен, чтобы apt и certbot не падали ---
if ! swapon --show | grep -q .; then
  c_inf "Создаю swap 1 ГБ"
  fallocate -l 1G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=1024
  chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  sysctl -w vm.swappiness=10 >/dev/null; echo 'vm.swappiness=10' > /etc/sysctl.d/99-boomcrm.conf
  c_ok "Swap включён"
fi

c_inf "Устанавливаю системные пакеты (пару минут)…"
export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a NEEDRESTART_SUSPEND=1
exec </dev/null
APTOPT="-o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold"
apt-get update -qq
apt-get install -y -qq $APTOPT curl ca-certificates gnupg nginx ufw cron rsync >/dev/null

# --- Node.js 22 LTS (в нём встроен SQLite, внешние модули не нужны) ---
NODE_MAJOR=0
command -v node >/dev/null && NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
NODE_MINOR=0
command -v node >/dev/null && NODE_MINOR=$(node -p 'process.versions.node.split(".")[1]')
if [ "$NODE_MAJOR" -lt 22 ] || { [ "$NODE_MAJOR" -eq 22 ] && [ "$NODE_MINOR" -lt 13 ]; }; then
  c_inf "Устанавливаю Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq $APTOPT nodejs >/dev/null
fi
c_ok "Node.js $(node -v)"

# --- Пользователь и файлы ---
id boomcrm >/dev/null 2>&1 || useradd --system --home "$DATA_DIR" --shell /usr/sbin/nologin boomcrm
mkdir -p "$APP_DIR" "$DATA_DIR"
rsync -a --delete --exclude 'data/' --exclude '.git' --exclude '*.tar.gz' "$SRC_DIR"/ "$APP_DIR"/
chown -R root:root "$APP_DIR"
chown -R boomcrm:boomcrm "$DATA_DIR"
chmod 750 "$DATA_DIR"
c_ok "Файлы CRM скопированы в $APP_DIR, данные — в $DATA_DIR"

# --- systemd ---
cat > /etc/systemd/system/boomcrm.service <<EOF
[Unit]
Description=Boomsystem CRM
After=network.target

[Service]
User=boomcrm
WorkingDirectory=$APP_DIR
Environment=NODE_ENV=production
Environment=PORT=$PORT
Environment=HOST=127.0.0.1
Environment=CRM_DATA=$DATA_DIR
Environment=TZ=$TZ_NAME
ExecStart=/usr/bin/node --max-old-space-size=256 server.js
Restart=always
RestartSec=3
MemoryMax=450M
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$DATA_DIR
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable boomcrm >/dev/null 2>&1
systemctl restart boomcrm

# --- nginx ---
SERVER_NAME="${DOMAIN:-_}"
if [ -n "$DOMAIN" ]; then LISTEN="80"; else LISTEN="80 default_server"; fi
cat > /etc/nginx/sites-available/boomcrm <<EOF
server {
    listen $LISTEN;
    server_name $SERVER_NAME;
    client_max_body_size 5m;
    server_tokens off;

    gzip on;
    gzip_types text/css application/javascript application/json;

    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 60s;
    }
}
EOF
ln -sf /etc/nginx/sites-available/boomcrm /etc/nginx/sites-enabled/boomcrm
[ -z "$DOMAIN" ] && rm -f /etc/nginx/sites-enabled/default
nginx -t -q && systemctl reload nginx
c_ok "nginx настроен"

# --- Firewall ---
ufw allow OpenSSH >/dev/null
ufw allow 'Nginx Full' >/dev/null
ufw --force enable >/dev/null
c_ok "Firewall: открыты только SSH, HTTP и HTTPS"

# --- Ежедневная резервная копия в 03:30 ---
cat > /etc/cron.d/boomcrm <<EOF
CRM_DATA=$DATA_DIR
30 3 * * * boomcrm cd $APP_DIR && /usr/bin/node scripts/backup.js >> $DATA_DIR/backup.log 2>&1
EOF
chmod 644 /etc/cron.d/boomcrm
c_ok "Резервная копия базы — каждую ночь, хранится 30 дней ($DATA_DIR/backups)"

# --- HTTPS ---
if [ -n "$DOMAIN" ]; then
  c_inf "Получаю SSL-сертификат для $DOMAIN"
  apt-get install -y -qq $APTOPT certbot python3-certbot-nginx >/dev/null
  if [ -n "$EMAIL" ]; then EM="-m $EMAIL"; else EM="--register-unsafely-without-email"; fi
  if certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos $EM --redirect -q; then
    c_ok "HTTPS включён, сертификат будет продлеваться автоматически"
  else
    c_err "Сертификат не получен. Проверьте, что A-запись $DOMAIN указывает на IP этого сервера, и запустите скрипт снова."
  fi
fi

# --- Проверка ---
sleep 2
CODE=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/api/me" || true)
if [ "$CODE" = "401" ]; then
  c_ok "CRM запущена"
else
  c_err "CRM не отвечает (код $CODE). Лог: journalctl -u boomcrm -n 50"
fi

IP=$(curl -fsS4 --max-time 5 https://ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')
echo
echo "=============================================================="
if [ -n "$DOMAIN" ]; then echo "  Адрес CRM:  https://$DOMAIN"; else echo "  Адрес CRM:  http://$IP"; fi
if [ -f "$DATA_DIR/FIRST_ADMIN_PASSWORD.txt" ]; then
  echo "  Первый вход:"
  sed 's/^/    /' "$DATA_DIR/FIRST_ADMIN_PASSWORD.txt"
  echo "  Смените пароль после входа (кнопка «Пароль» внизу меню),"
  echo "  затем удалите файл: rm $DATA_DIR/FIRST_ADMIN_PASSWORD.txt"
fi
echo "=============================================================="
