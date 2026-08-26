#!/bin/bash
set -euo pipefail
cd /opt/agenda
APP_SECRET=$(openssl rand -hex 48)
MYSQL_PASSWORD=$(openssl rand -hex 16)
MYSQL_ROOT_PASSWORD=$(openssl rand -hex 16)
ADMIN_PASSWORD="Ag$(openssl rand -hex 8)9A"
umask 077
cat > .env <<EOF
DATABASE_URL=mysql://dayly:${MYSQL_PASSWORD}@db:3306/dayly
PORT=4000
CLIENT_ORIGIN=https://agenda.kristianesp.com
PUBLIC_URL=https://agenda.kristianesp.com
NODE_ENV=production
APP_SECRET=${APP_SECRET}
TRUST_PROXY=1
SESSION_TTL_MS=604800000
ALLOW_PUBLIC_REGISTRATION=false
SEED_DEMO=false
ADMIN_EMAIL=admin@agenda.kristianesp.com
ADMIN_PASSWORD=${ADMIN_PASSWORD}
MYSQL_PASSWORD=${MYSQL_PASSWORD}
MYSQL_ROOT_PASSWORD=${MYSQL_ROOT_PASSWORD}
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=Dayly <no-reply@agenda.kristianesp.com>
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:admin@agenda.kristianesp.com
CLOUDFLARE_TUNNEL_TOKEN=
EOF
chmod 600 .env
rm -f /opt/agenda/scripts/gen-prod-env.sh
echo ENV_READY
