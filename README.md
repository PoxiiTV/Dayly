<div align="center">

<img src="client/public/brand/icon-512.png" width="110" alt="Dayly" />

# 🗓️ Dayly

**Tu agenda y centro de productividad.** · *Your agenda and productivity hub.*

Tareas · Calendario · Notas · Proyectos · Hábitos · Mensajes · Chat · Cofre — todo en un solo sitio, pensado primero para el móvil.

**🤖 Calen**, la mascota con IA, habla español, usa tu zona horaria, **escribe en tu agenda de verdad** y cada mañana te manda el resumen del día.

[![Licencia](https://img.shields.io/badge/Licencia-PolyForm%20NC-22c55e?style=for-the-badge)](LICENSE)
[![Demo](https://img.shields.io/badge/Demo_en_vivo-GitHub_Pages-8b5cf6?style=for-the-badge)](https://poxiitv.github.io/Dayly/)
![React](https://img.shields.io/badge/React_18-20232a?style=for-the-badge&logo=react&logoColor=61dafb)
![Node](https://img.shields.io/badge/Node_%E2%89%A520-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![MariaDB](https://img.shields.io/badge/MariaDB-003545?style=for-the-badge&logo=mariadb&logoColor=white)

[Demo](https://poxiitv.github.io/Dayly/) · [Novedades](CHANGELOG.md) · [Issues](https://github.com/PoxiiTV/Dayly/issues)

*La demo es solo front (datos de ejemplo en memoria, se borran al recargar).*

</div>

---

## 🇪🇸 Español

### ✨ Qué puedes hacer

| Sitio | Para qué sirve |
|---|---|
| 📊 **Inicio** | Pendientes, atrasadas, agenda de hoy, tareas importantes, reloj con el tiempo y radio |
| ☀️ **Mi día** | Qué toca ahora, qué viene después, lo atrasado y una línea de horas |
| 📅 **Calendario** | Mes, semana, día y agenda. En el móvil: mes compacto con puntos y la agenda del día elegido |
| ✅ **Tareas** | Prioridad, fechas con rango, etiquetas, subtareas, recurrencia, adjuntos, tablero y lista, aviso por Telegram |
| 📨 **Mensajes** | Correo (IMAP/Gmail), WhatsApp Business y Telegram Business en una bandeja, con envíos programados |
| 💬 **Chat** | Amigos y grupos, GIFs, envío de archivos, estados y zumbidos |
| 📁 **Proyectos · 📝 Notas** | Progreso real por proyecto; notas en Markdown con imágenes, fijadas y archivadas |
| 🔥 **Hábitos y objetivos** | Rachas, calendario mensual, recordatorios y metas con tareas vinculadas |
| 💳 **Suscripciones** | Lo que te cobran solo: coste mensual, próximos cargos y gasto por etiqueta |
| 🔐 **Cofre** | Contraseñas y códigos 2FA cifrados en tu navegador; importa desde Bitwarden o 1Password |
| 🌐 **Apps** | Navegador integrado, calculadora, radio, Spotify y visualizador de música |

Además: búsqueda global y creación en lenguaje natural (`Ctrl+K`), temas claro/oscuro con 12 paletas y fondos, avisos push, PWA instalable, PIN rápido, passkeys, 2FA, papelera e import/export **JSON · CSV · ICS**.

### 🤖 Calen

Se activa en **Ajustes › Mascota** con tu proveedor de IA (OpenCode, OpenRouter o uno compatible con OpenAI). La clave se cifra en el servidor y nunca vuelve al navegador.

- Crea, completa, mueve y borra tareas, eventos, notas, proyectos, hábitos, objetivos y recordatorios **en tu base de datos**.
- **Recuerda** lo que le cuentas entre conversaciones y conoce tu día antes de responder.
- **Resumen matinal** a la hora que elijas: campana, push y Telegram.
- Te pregunta antes de borrar nada, y nunca confirma una acción que no se haya guardado.
- En el móvil vive en la barra superior y abre su chat como una hoja desde abajo.

### 🚀 Puesta en marcha

**Requisitos:** Node.js ≥ 20 · MariaDB 11 (o MySQL 8)

```bash
npm install
# crea .env con DATABASE_URL y APP_SECRET (openssl rand -base64 48)
npm run db:migrate
SEED_DEMO=true npm run db:seed   # datos de ejemplo, solo en local
```

🪟 En Windows: `setup-mariadb.bat` levanta una MariaDB local y `start.bat` arranca la API (http://localhost:4000) y la web (http://localhost:5173).

| Rol (solo local) | Email | Contraseña |
|---|---|---|
| 🛠️ Admin | `admin@dayly.dev` | `Admin123456` |
| 🧪 Demo | `demo@dayly.dev` | `Demo123456` |

```bash
npm run build        # producción (server + client)
npm run test         # tests del servidor (usa TEST_DATABASE_URL para no tocar tu base)
npm run typecheck
npm run build:demo   # regenera demo/ para GitHub Pages
```

Variables opcionales en `.env`: SMTP, `VAPID_*` (`node scripts/gen-vapid.mjs`), `ALLOW_PUBLIC_REGISTRATION`. Las integraciones (WhatsApp, Telegram, Gmail, Spotify…) se explican en [integraciones.md](integraciones.md).

### ⬆️ Actualizar desde Dayly 1.x

Tus datos se conservan. Con el **mismo `APP_SECRET`** de siempre y una copia de seguridad hecha:

```bash
node scripts/migrar-desde-dayly.mjs
```

El script detecta una base del Dayly 1.x, adapta lo que cambia (ciudad del tiempo, bot de Telegram, avisos) y aplica las migraciones. Se puede repetir sin riesgo. Después, en **Ajustes › Integraciones**, pulsa «Activar» en tu bot de Telegram para registrar su nueva dirección.

### 🚢 Producción

- **Plesk / Passenger:** `deploy.bat` compila y deja en `deploy-hosting/` lo necesario (`app.mjs`, `plesk-package.json` como `package.json`, `server/dist`, `client/dist`, migraciones, `.env`). En el servidor: `npm install`, `npm run migrar-dayly` y reinicia la app.
- **Docker:** `docker compose -f docker-compose.portainer.yml up -d --build`, detrás de tu proxy con HTTPS.

---

## 🇬🇧 English

### ✨ What it does

**Dayly** is a self-hosted agenda built on Express + Prisma + MariaDB and React, designed mobile-first.

- **Home & My Day:** pending, overdue, today's agenda, important tasks, clock with weather, radio.
- **Calendar:** month, week, day and agenda views; on phones, a compact month with dots plus the picked day's agenda.
- **Tasks:** priorities, date ranges, tags, subtasks, recurrence, attachments, board and list views, Telegram alerts.
- **Messages:** email (IMAP/Gmail), WhatsApp Business and Telegram Business in one inbox, with scheduled sends.
- **Chat:** friends and groups, GIFs, file transfers, presence.
- **Projects, notes, habits, goals, subscriptions, reminders, trash.**
- **Vault:** passwords and 2FA codes encrypted in your browser; imports from Bitwarden and 1Password.
- **Apps:** built-in browser, calculator, radio, Spotify, music visualizer.
- Global search and natural-language creation (`Ctrl+K`), light/dark themes with 12 palettes, push notifications, installable PWA, quick PIN, passkeys, 2FA, JSON/CSV/ICS import/export.

**Calen**, the AI mascot, works with your own provider key (OpenCode, OpenRouter or any OpenAI-compatible API). It edits your real data, remembers what you tell it, knows your day, sends a **morning briefing** (bell, push, Telegram), asks before deleting and never claims an action that wasn't saved.

### 🚀 Getting started

Node.js ≥ 20 and MariaDB 11 / MySQL 8:

```bash
npm install
# create .env with DATABASE_URL and APP_SECRET
npm run db:migrate
SEED_DEMO=true npm run db:seed   # sample data, local only
npm run dev                      # web :5173 · API :4000
```

**Upgrading from Dayly 1.x:** back up, keep the same `APP_SECRET`, run `node scripts/migrar-desde-dayly.mjs`, then re-activate your Telegram bot in Settings › Integrations. No data is lost.

**Production:** `deploy.bat` builds a Plesk/Passenger bundle in `deploy-hosting/`; Docker users can run `docker-compose.portainer.yml` behind an HTTPS reverse proxy.

---

## 📄 Licencia · License

**PolyForm Noncommercial License 1.0.0**: uso personal y no comercial · personal and non-commercial use. Ver · see [LICENSE](LICENSE).

Copyright © 2026 Alexis ([PoxiiTV](https://github.com/PoxiiTV)). Incluye mejoras y extensiones de [Kristianesp](https://github.com/Kristianesp) · Includes improvements and extensions by Kristianesp.

<div align="center">

**Dayly** · hecho con ☕ y cariño por Alexis

</div>
