#!/usr/bin/env bash
# Самоконтроль сервера раз в минуту (systemd-таймер boomcrm-mon): CRM, nginx, сеть IPv4/IPv6, соединения.
# Пишет в «Диагностику» при любом изменении состояния и раз в час — сводку. Если nginx не отвечает
# изнутри 2 проверки подряд — перезапускает nginx (вместо перезагрузки всего сервера).
DATA_DIR="${DATA_DIR:-/var/lib/boomcrm}"; PORT="${PORT:-3000}"; DOMAIN="${DOMAIN:-}"
LOG="$DATA_DIR/diag.log"; ST=/run/boommon.state; FAILS=/run/boommon.fails
ts() { date '+%d.%m %H:%M:%S'; }
log() { echo "$(ts) $*" >> "$LOG"; }

crm=$(curl -s -m 5 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/api/me")
chk_ngx() { if [ -n "$DOMAIN" ]; then curl -s -m 8 -o /dev/null -w '%{http_code}' --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/crm"
  else curl -s -m 8 -o /dev/null -w '%{http_code}' "http://127.0.0.1/crm"; fi; }
ngx=$(chk_ngx)
v4=$(ip -4 route show default 2>/dev/null | grep -q . && echo есть || echo НЕТ)
a6=$(ip -6 addr show scope global 2>/dev/null | grep -c 'inet6')
r6=$(ip -6 route show default 2>/dev/null | grep -q . && echo есть || echo нет)
p4=$(ping -4 -c1 -W2 77.88.8.8 >/dev/null 2>&1 && echo ok || echo НЕТ)
p6=$( [ "$a6" -gt 0 ] && (ping -6 -c1 -W2 2a02:6b8::feed:0ff >/dev/null 2>&1 && echo ok || echo НЕТ) || echo — )
est=$(ss -Htn state established '( sport = :443 or sport = :80 )' 2>/dev/null | wc -l)
syn=$(ss -Htn state syn-recv '( sport = :443 or sport = :80 )' 2>/dev/null | wc -l)
cw=$(ss -Htn state close-wait '( sport = :443 or sport = :80 )' 2>/dev/null | wc -l)
ct=$(cat /proc/sys/net/netfilter/nf_conntrack_count 2>/dev/null || echo ?); ctm=$(cat /proc/sys/net/netfilter/nf_conntrack_max 2>/dev/null || echo ?)
mem=$(awk '/MemAvailable/{printf "%d", $2/1024}' /proc/meminfo)
dns=""; [ -n "$DOMAIN" ] && dns="DNS: $(getent ahostsv4 "$DOMAIN" | awk 'NR==1{print $1}')/$(getent ahostsv6 "$DOMAIN" 2>/dev/null | awk 'NR==1{print $1}')"

state="CRM $crm · nginx $ngx · IPv4 $v4/$p4 · IPv6 адресов $a6, маршрут $r6, связь $p6"
line="$state · соединений $est, недоустановленных $syn, зависших $cw · conntrack $ct/$ctm · память $mem МБ · $dns"
prev=$(cat "$ST" 2>/dev/null || true)
if [ "$state" != "$prev" ]; then
  [ -n "$prev" ] && log "СЕРВЕР: состояние изменилось → $line" || log "СЕРВЕР: самоконтроль запущен → $line"
  echo "$state" > "$ST"
elif [ "$(date +%M)" = "00" ]; then log "СЕРВЕР: ежечасная сводка → $line"; fi
[ "$syn" -gt 50 ] && log "СЕРВЕР: много недоустановленных соединений ($syn) — возможно, обрываются ответы сервера или идёт атака"
[ "$cw" -gt 50 ] && log "СЕРВЕР: много зависших соединений ($cw)"
[ "$ct" != "?" ] && [ "$ctm" != "?" ] && [ "$ct" -gt $(( ctm * 9 / 10 )) ] && log "СЕРВЕР: таблица соединений почти заполнена ($ct из $ctm) — новые подключения могут отбрасываться"

# самолечение: nginx не отвечает изнутри 2 раза подряд → перезапуск nginx
ok=0; case "$ngx" in 200|301|302) ok=1;; esac
if [ "$ok" = 1 ]; then rm -f "$FAILS"; else
  n=$(( $(cat "$FAILS" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$FAILS"
  RS=/run/boommon.restarts; recent=$(awk -v t=$(( $(date +%s) - 3600 )) '$1>t' "$RS" 2>/dev/null | wc -l)
  if [ "$n" -ge 2 ] && [ "$recent" -ge 3 ]; then [ "$n" = 2 ] && log "СЕРВЕР: nginx не отвечает, но уже перезапускался 3 раза за час — больше не трогаю, нужна проверка (boomcheck)"
  elif [ "$n" -ge 2 ]; then
    date +%s >> "$RS"
    log "СЕРВЕР: nginx не отвечает ($ngx) $n мин подряд — перезапускаю nginx. Соединений $est, недоустановленных $syn, зависших $cw"
    systemctl restart nginx; sleep 2
    log "СЕРВЕР: nginx после перезапуска — $(chk_ngx)"
    rm -f "$FAILS"
  fi
fi
