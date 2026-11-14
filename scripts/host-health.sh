#!/usr/bin/env bash
# Read-only BoomCRM host health snapshot. No customer data, environment variables or logs.
set -euo pipefail
export LC_ALL=C
echo "BoomCRM host diagnostics"
echo "timestamp_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "hostname=$(hostname -s)"
echo "kernel=$(uname -r)"
for service in boomcrm nginx; do
  if systemctl is-active --quiet "$service"; then state=active; else state=inactive; fi
  echo "service_${service}=${state}"
done
if command -v curl >/dev/null 2>&1; then
  code=$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 8 http://127.0.0.1:3000/crm || true)
  echo "local_crm_http_status=${code:-unavailable}"
fi
awk '/MemTotal:/ {total=$2} /MemAvailable:/ {available=$2} END {if(total>0) printf "memory_available_percent=%.0f\n", available*100/total}' /proc/meminfo
df -P /var/lib/boomcrm 2>/dev/null | awk 'NR==2 {gsub(/%/,"",$5); print "data_disk_used_percent="$5}'
if [ -d /var/lib/boomcrm/backups ]; then
  count=$(find /var/lib/boomcrm/backups -maxdepth 1 -type f -name 'crm-*.sqlite' | wc -l)
  echo "sqlite_backup_count=${count}"
  newest=$(find /var/lib/boomcrm/backups -maxdepth 1 -type f -name 'crm-*.sqlite' -printf '%T@\n' | sort -nr | head -n1 || true)
  if [ -n "$newest" ]; then
    now=$(date +%s)
    echo "newest_sqlite_backup_age_hours=$(( (now - ${newest%.*}) / 3600 ))"
  fi
else
  echo "sqlite_backup_directory=missing_or_inaccessible"
fi
echo "diagnostics_complete=true"
