#!/usr/bin/env bash
# =====================================================================
#  Посредник для Telegram API — ставится на НЕБОЛЬШОЙ СЕРВЕР ЗА РУБЕЖОМ (Ubuntu 22/24),
#  когда CRM стоит на сервере в России, где api.telegram.org заблокирован.
#  Запуск под root на зарубежном сервере:
#    curl -sL https://raw.githubusercontent.com/zeus199191/boomcrm/main/scripts/tg-relay.sh | bash
#  В конце выдаст адрес — вставить в CRM: Настройки → Telegram-бот → «Адрес Telegram API».
#  Посредник пропускает только запросы к Telegram по секретному пути и работает по HTTPS
#  (бесплатный сертификат на имя вида 1-2-3-4.sslip.io — домен не нужен).
# =====================================================================
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Запустите от root"; exit 1; }
export DEBIAN_FRONTEND=noninteractive
echo "→ Ставлю nginx и certbot…"
apt-get update -qq && apt-get install -y -qq nginx certbot python3-certbot-nginx curl ufw >/dev/null
IP="$(curl -fsS4 --max-time 10 https://ifconfig.me || hostname -I | awk '{print $1}')"
HOST="$(echo "$IP" | tr '.' '-').sslip.io"
CONF=/etc/nginx/sites-available/tg-relay
if [ -f /etc/tg-relay.secret ]; then SECRET="$(cat /etc/tg-relay.secret)"; else SECRET="$(head -c 18 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9' | head -c 24)"; echo "$SECRET" > /etc/tg-relay.secret; chmod 600 /etc/tg-relay.secret; fi
cat > "$CONF" <<NGX
server {
    listen 80;
    server_name $HOST;
    server_tokens off;
    client_max_body_size 60m;
    location /$SECRET/ {
        proxy_pass https://api.telegram.org/;
        proxy_ssl_server_name on;
        proxy_set_header Host api.telegram.org;
        proxy_read_timeout 120s;
        proxy_send_timeout 300s;
        proxy_request_buffering off;
    }
    location / { return 404; }
}
NGX
ln -sf "$CONF" /etc/nginx/sites-enabled/tg-relay
rm -f /etc/nginx/sites-enabled/default
nginx -t -q && systemctl reload nginx
ufw allow OpenSSH >/dev/null; ufw allow 'Nginx Full' >/dev/null; ufw --force enable >/dev/null
echo "→ Получаю сертификат для $HOST…"
certbot --nginx -d "$HOST" --non-interactive --agree-tos --register-unsafely-without-email --redirect -q || { echo "✘ Сертификат не получен — проверьте, что порт 80 открыт у хостинга"; exit 1; }
CODE=$(curl -s -o /dev/null -w '%{http_code}' "https://$HOST/$SECRET/bot0:test/getMe" || true)
echo
echo "=============================================================="
[ "$CODE" = "401" ] || [ "$CODE" = "404" ] && echo "✔ Посредник работает (Telegram отвечает через него)." || echo "⚠ Проверка вернула код $CODE — проверьте позже."
echo "  Адрес для CRM (Настройки → Telegram-бот → «Адрес Telegram API»):"
echo
echo "     https://$HOST/$SECRET"
echo
echo "  Держите адрес в секрете: через него можно обращаться к Telegram."
echo "=============================================================="
