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
TZ_NAME="${TZ_NAME:-Asia/Irkutsk}"
APP_DIR=/opt/boomcrm
DATA_DIR=/var/lib/boomcrm
PORT=3000
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONF="$DATA_DIR/domain.conf"

# Домен запоминается: при обновлении без параметров берём сохранённый
if [ -z "$DOMAIN" ] && [ -f "$CONF" ]; then
  DOMAIN="$(sed -n 1p "$CONF" | tr -cd 'a-zA-Z0-9.-')"
  EMAIL="$(sed -n 2p "$CONF" | tr -cd 'a-zA-Z0-9.@_+-')"
fi

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
APTOPT="-o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold -o DPkg::Lock::Timeout=300"
# если прошлая установка была прервана — довести dpkg до порядка
systemctl stop unattended-upgrades 2>/dev/null || true
dpkg --force-confdef --force-confold --configure -a >/dev/null 2>&1 || true
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

# --- Корневой сертификат Минцифры (нужен для Bot API мессенджера MAX) ---
# Ставим только проверенные PEM-файлы и всегда проверяем, что системный набор сертификатов цел.
CA_DIR=/usr/local/share/ca-certificates
rm -f "$CA_DIR/russian_trusted_ca.crt"   # файл старой версии установщика
for n in root sub; do
  F="$CA_DIR/russian_trusted_${n}_ca.crt"
  if [ ! -s "$F" ]; then
    T=$(mktemp)
    if curl -fsSL --max-time 30 "https://gu-st.ru/content/lending/russian_trusted_${n}_ca_pem.crt" -o "$T" && openssl x509 -noout -in "$T" 2>/dev/null; then
      install -m 644 "$T" "$F"
    fi
    rm -f "$T"
  fi
done
update-ca-certificates >/dev/null 2>&1 || true
if [ ! -s /etc/ssl/certs/ca-certificates.crt ]; then
  apt-get install -y -qq --reinstall ca-certificates >/dev/null 2>&1 || true
  update-ca-certificates --fresh >/dev/null 2>&1 || true
fi
[ -s "$CA_DIR/russian_trusted_root_ca.crt" ] && c_ok "Сертификат Минцифры установлен (для MAX)" || c_inf "Сертификат Минцифры не установлен — MAX будет работать через резервный адрес API"

# --- Пользователь и файлы ---
id boomcrm >/dev/null 2>&1 || useradd --system --home "$DATA_DIR" --shell /usr/sbin/nologin boomcrm
# чтение системных журналов для «Настройки → Диагностика» (только чтение)
usermod -aG systemd-journal,adm boomcrm 2>/dev/null || true
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
Environment=CRM_TZ=$TZ_NAME
Environment=NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt
ExecStart=/usr/bin/node --max-old-space-size=768 server.js
Restart=always
RestartSec=3
MemoryMax=1536M
# при переполнении памяти — быстрый перезапуск CRM, а не уход в swap (сервер «замирал» целиком)
MemorySwapMax=128M
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
# Если сертификат для домена уже есть — сразу пишем конфиг с HTTPS. Раньше при каждом обновлении конфиг
# перезаписывался «только HTTP», и сайт/CRM были недоступны по https, пока certbot заново не вписывал SSL (минуты).
SERVER_NAME="${DOMAIN:-_}"
if [ -n "$DOMAIN" ]; then LISTEN="80"; else LISTEN="80 default_server"; fi
CERT_DIR="/etc/letsencrypt/live/$DOMAIN"
HAVE_CERT=""
[ -n "$DOMAIN" ] && [ -s "$CERT_DIR/fullchain.pem" ] && [ -s "$CERT_DIR/privkey.pem" ] && HAVE_CERT=1
PROXY="
    client_max_body_size 60m;
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
    }"
NGX=/etc/nginx/sites-available/boomcrm
cp -f "$NGX" "$NGX.bak" 2>/dev/null || true
if [ -n "$HAVE_CERT" ]; then
  SSLOPT=""; [ -f /etc/letsencrypt/options-ssl-nginx.conf ] && SSLOPT="include /etc/letsencrypt/options-ssl-nginx.conf;"
  DH=""; [ -f /etc/letsencrypt/ssl-dhparams.pem ] && DH="ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;"
  cat > "$NGX" <<NGXEOF
server {
    listen 443 ssl;
    server_name $DOMAIN;
    ssl_certificate $CERT_DIR/fullchain.pem;
    ssl_certificate_key $CERT_DIR/privkey.pem;
    $SSLOPT
    $DH
$PROXY
}
server {
    listen 80;
    server_name $DOMAIN;
    location / { return 301 https://\$host\$request_uri; }
}
NGXEOF
else
  cat > "$NGX" <<NGXEOF
server {
    listen $LISTEN;
    server_name $SERVER_NAME;
$PROXY
}
NGXEOF
fi
ln -sf "$NGX" /etc/nginx/sites-enabled/boomcrm
[ -z "$DOMAIN" ] && rm -f /etc/nginx/sites-enabled/default
if nginx -t -q 2>/dev/null; then systemctl reload nginx
else c_err "Новый конфиг nginx с ошибкой — оставляю прежний"; cp -f "$NGX.bak" "$NGX" 2>/dev/null && systemctl reload nginx; fi
c_ok "nginx настроен"

# --- Firewall ---
ufw allow OpenSSH >/dev/null
ufw allow 'Nginx Full' >/dev/null
ufw --force enable >/dev/null
c_ok "Firewall: открыты только SSH, HTTP и HTTPS"

# --- Обновление и подключение домена из интерфейса CRM (без консоли) ---
cat > /usr/local/bin/boomcrm-update <<'EOF2'
#!/usr/bin/env bash
REQ=/var/lib/boomcrm/update.request
LOG=/var/lib/boomcrm/update.log
[ -f "$REQ" ] || exit 0
DOMAIN="$(sed -n 1p "$REQ" | tr -cd 'a-zA-Z0-9.-')"
EMAIL="$(sed -n 2p "$REQ" | tr -cd 'a-zA-Z0-9.@_+-')"
rm -f "$REQ"
{
  echo "=== Старт: $(date '+%d.%m.%Y %H:%M') ==="
  if [ ! -s /etc/ssl/certs/ca-certificates.crt ]; then
    echo "Восстанавливаю сертификаты системы…"
    update-ca-certificates --fresh >/dev/null 2>&1 || apt-get install -y -qq --reinstall ca-certificates >/dev/null 2>&1
  fi
  GO=$(mktemp)
  if curl -fsSL https://raw.githubusercontent.com/zeus199191/boomcrm/main/go.sh -o "$GO"; then
    bash "$GO" $DOMAIN $EMAIL; CODE=$?
  else
    CODE=1; echo "Не удалось скачать обновление"
  fi
  rm -f "$GO"
  [ "$CODE" = 0 ] && echo "=== Готово: $(date '+%d.%m.%Y %H:%M') ===" || echo "=== Ошибка (код $CODE): $(date '+%d.%m.%Y %H:%M') ==="
} > "$LOG" 2>&1 < /dev/null
chown boomcrm:boomcrm "$LOG"
EOF2
chmod 755 /usr/local/bin/boomcrm-update
cat > /etc/systemd/system/boomcrm-update.service <<EOF2
[Unit]
Description=Boomsystem CRM self-update
[Service]
Type=oneshot
ExecStart=/usr/local/bin/boomcrm-update
TimeoutStartSec=1800
EOF2
cat > /etc/systemd/system/boomcrm-update.path <<EOF2
[Unit]
Description=Watch for CRM update request
[Path]
PathExists=$DATA_DIR/update.request
[Install]
WantedBy=multi-user.target
EOF2
systemctl daemon-reload
systemctl enable --now boomcrm-update.path >/dev/null 2>&1
c_ok "Обновление из интерфейса CRM включено (Настройки → Обновление)"

# --- Ежедневная резервная копия в 03:30 ---
cat > /etc/cron.d/boomcrm <<EOF
CRM_DATA=$DATA_DIR
30 3 * * * boomcrm cd $APP_DIR && /usr/bin/node scripts/backup.js >> $DATA_DIR/backup.log 2>&1
EOF
chmod 644 /etc/cron.d/boomcrm
c_ok "Резервная копия базы — каждую ночь, хранится 30 дней ($DATA_DIR/backups)"

# --- HTTPS ---
if [ -n "$DOMAIN" ]; then
  c_inf "HTTPS для $DOMAIN"
  command -v certbot >/dev/null || apt-get install -y -qq $APTOPT certbot python3-certbot-nginx >/dev/null
  if [ -n "$EMAIL" ]; then EM="-m $EMAIL"; else EM="--register-unsafely-without-email"; fi
  if [ -n "$HAVE_CERT" ]; then
    c_ok "HTTPS уже настроен (сертификат есть, продлевается автоматически)"
    printf '%s\n%s\n' "$DOMAIN" "$EMAIL" > "$CONF"; chown boomcrm:boomcrm "$CONF"
  elif certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --keep-until-expiring $EM --redirect -q; then
    c_ok "HTTPS включён, сертификат будет продлеваться автоматически"
    printf '%s\n%s\n' "$DOMAIN" "$EMAIL" > "$CONF"; chown boomcrm:boomcrm "$CONF"
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
