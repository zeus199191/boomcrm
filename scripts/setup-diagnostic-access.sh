#!/usr/bin/env bash
# Run once as root on the VPS. Creates a diagnostics-only SSH identity.
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Run as root"; exit 1; }
id boomdiag >/dev/null 2>&1 || useradd --create-home --shell /bin/bash boomdiag
install -d -m 700 -o boomdiag -g boomdiag /home/boomdiag/.ssh
install -d -m 755 /usr/local/libexec
cat >/usr/local/libexec/boomcrm-health <<'HEALTH'
#!/usr/bin/env bash
set -euo pipefail
export LC_ALL=C
echo "timestamp_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
for svc in boomcrm nginx; do
  if systemctl is-active --quiet "$svc"; then echo "service_${svc}=active"; else echo "service_${svc}=inactive"; fi
done
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 http://127.0.0.1:3000/crm || true)
echo "crm_http_status=${code:-unavailable}"
awk '/MemTotal:/ {t=$2} /MemAvailable:/ {a=$2} END {if(t>0) printf "memory_available_percent=%.0f\n",a*100/t}' /proc/meminfo
df -P /var/lib/boomcrm | awk 'NR==2 {print "disk_used_percent="$5}'
echo "diagnostics_complete=true"
HEALTH
chown root:root /usr/local/libexec/boomcrm-health
chmod 755 /usr/local/libexec/boomcrm-health
KEY=/root/boomcrm-diag-ed25519
if [ ! -e "$KEY" ]; then ssh-keygen -q -t ed25519 -N '' -f "$KEY" -C boomcrm-github-diagnostics; fi
printf 'restrict,command="/usr/local/libexec/boomcrm-health" %s\n' "$(cat "$KEY.pub")" >/home/boomdiag/.ssh/authorized_keys
chown boomdiag:boomdiag /home/boomdiag/.ssh/authorized_keys
chmod 600 /home/boomdiag/.ssh/authorized_keys
echo "Created restricted SSH access for boomdiag."
echo "Private key location: $KEY (DO NOT paste it into chat)."
echo "Public SSH host key fingerprints:"
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
echo "Next: add the private key as a GitHub Actions secret and pin the host key."
