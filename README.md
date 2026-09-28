# Dayly

Agenda y centro de productividad (tareas, calendario, notas, hábitos, recordatorios, chat, cofre de contraseñas, integraciones…). Servidor Express + Prisma + MariaDB y cliente React/Vite.

Este paquete está **limpio**: sin claves, sin `.env`, sin base de datos, sin usuarios ni datos, sin adjuntos y sin dominios ni IPs propias. Todo se configura con variables de entorno.

## Requisitos

- Node.js ≥ 20
- MariaDB 11 / MySQL 8 (o Docker)

## Puesta en marcha (desarrollo)

```bash
npm install
cp .env.example .env        # edita DATABASE_URL y APP_SECRET (openssl rand -base64 48)
npm run db:migrate
npm run dev                 # web http://localhost:5173 · API http://localhost:4000
```

Con base de datos vacía, define `ADMIN_EMAIL` y `ADMIN_PASSWORD` en `.env` para crear el primer administrador en el primer arranque (cámbiala al entrar). `SEED_DEMO=true` + `npm run db:seed` crea usuarios y datos de ejemplo con contraseñas conocidas: **solo para local**. Las pruebas del servidor (`npm run test`) necesitan ese seed (`SEED_DEMO=true npm run db:seed`) y una base de datos de pruebas en `DATABASE_URL`.

## Producción

**Docker (recomendado):**

```bash
export MYSQL_PASSWORD=$(openssl rand -hex 16) MYSQL_ROOT_PASSWORD=$(openssl rand -hex 16)
# crea .env con APP_SECRET, PUBLIC_URL, CLIENT_ORIGIN, ADMIN_EMAIL, ADMIN_PASSWORD, TRUST_PROXY=1 ...
docker compose -f docker-compose.portainer.yml up -d --build
```

El contenedor web escucha en `127.0.0.1:18087`; ponlo detrás de tu proxy inverso con HTTPS. El perfil `tunnel` (Cloudflare Tunnel) es opcional y requiere tu propio `CLOUDFLARE_TUNNEL_TOKEN`.

**Sin Docker:** `npm run build && npm run start` con `NODE_ENV=production`.

Variables importantes (ver [.env.example](.env.example)): `DATABASE_URL`, `APP_SECRET`, `PUBLIC_URL`, `CLIENT_ORIGIN`, `TRUST_PROXY`, `ALLOW_PUBLIC_REGISTRATION`, SMTP, `VAPID_*` (`node scripts/gen-vapid.mjs`). Las integraciones (WhatsApp, Telegram, Gmail, Spotify…) se explican en [integraciones.md](integraciones.md) y son opcionales.

## Comandos

```bash
npm run build      # server + client
npm run test       # pruebas del servidor
npm run typecheck
npm run db:migrate
```

## Créditos y licencia

**Dayly** es un fork, mucho más ampliado, de [DAYLY](https://github.com/PoxiiTV/Dayly), el proyecto original de **Alexis (PoxiiTV)**, que sirvió de base. Esta versión, con sus mejoras y extensiones, la mantiene **[Kristianesp](https://github.com/Kristianesp)**.

Licencia: **PolyForm Noncommercial 1.0.0** (uso personal y no comercial), la misma del proyecto original. Ver [LICENSE](LICENSE).
