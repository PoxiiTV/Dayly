<div align="center">

# 🗓️ DAYLY

**Tu agenda y centro de productividad.**  
**Your agenda and productivity hub.**

Tareas · calendario · notas · proyectos · hábitos · objetivos  
API real, sesiones HttpOnly y datos aislados por usuario.

[![Demo](https://img.shields.io/badge/Demo-GitHub%20Pages-4f46e5?style=for-the-badge)](https://poxiitv.github.io/Dayly/)
[![License](https://img.shields.io/badge/License-PolyForm%20NC-0ea5e9?style=for-the-badge)](LICENSE)

👉 **Demo (solo front, se borra al recargar):** https://poxiitv.github.io/Dayly/

</div>

---

## 🇪🇸 Español

### Qué es

DAYLY es un SaaS de agenda: un solo sitio para el día, el calendario, las tareas y el resto. El backend es **Express + Prisma + MariaDB**. La demo de GitHub Pages es un mock en memoria: **no guarda nada al recargar**.

### ✨ Qué incluye

| | Área | Qué hace |
|---|------|----------|
| 🔐 | **Cuenta** | Registro, login, logout, sesiones, cambio de clave. **2FA TOTP** + códigos de recuperación de un uso. |
| 📧 | **Correo HTML** | Tema **claro**. Reset de clave, verificar email, y **bienvenida** si un admin crea la cuenta (usuario + clave temporal). Hace falta SMTP en `.env`. |
| 🔑 | **Primer acceso** | Usuarios creados desde **Admin** deben elegir **otra contraseña** al entrar. La del correo deja de valer. |
| ✅ | **Tareas** | CRUD, prioridad, filtros, papelera. Clic en el calendario = día y hora rellenados. |
| 📅 | **Calendario** | Mes / semana / día / agenda. Grid **00:00–24:00**. En móvil, la semana es tira Lun–Dom + un día (sin scroll horizontal). Clic en un hueco abre el alta con **esa fecha y hora**. Recurrencia (serie completa). |
| 🌓 | **Tema** | Claro, oscuro o sistema. El icono luna/sol **alterna** claro ↔ oscuro. Una ola desde el tap revela la interfaz nueva (no un tapón de color). |
| 🔔 | **Avisos** | Con la app abierta: toast, notificación del navegador y campana. **Web Push** opcional (`VAPID_*`) con la pestaña cerrada. |
| 🔁 | **Recurrencia** | Diaria / semanal / mensual en eventos y tareas. Editar o borrar aplica a **toda la serie**. |
| 🗂️ | **Resto** | Notas, proyectos, hábitos, objetivos, inbox, recordatorios, Pomodoro, import/export (JSON, CSV, ICS). |
| 🛡️ | **Admin** | Panel `/admin`, roles, aislamiento entre usuarios. Alta con email de acceso. |

### ⚠️ Límites

- **Push / iOS:** hace falta `VAPID_*` y permiso. Safari/iOS no siempre entrega.
- **Demo Pages:** mock. No es MariaDB.
- **SMTP vacío:** en desarrollo el mail se loguea; en producción no se envía hasta configurar el `.env`.

### 👤 Cuentas seed (solo local)

| Rol | Email | Contraseña |
|-----|--------|------------|
| 👑 Admin | `admin@dayly.dev` | `Admin123456` |
| ✨ Demo | `alexis@dayly.dev` | `Demo123456` |

Cámbialas si usas esto fuera de tu PC.

---

## 🇬🇧 English

DAYLY is a real Express + Prisma + **MariaDB** agenda. GitHub Pages is an **in-memory demo** (resets on reload).

**Ships with:** auth (HTML email if SMTP is set), forced password change for admin-created users, CRUD, calendar (24h grid; on mobile, week = day strip + one day; click a slot → date + time), light/dark theme with a reveal wave from the tap, recurrence (full series), reminders + optional Web Push, admin panel with welcome email, import/export, TOTP + recovery codes.

**Limits:** Pages demo is mock-only. Push needs VAPID and is flaky on iOS.

---

## 🧰 Stack

**Front:** React 18 · TypeScript · Vite 6 · React Router · TanStack Query · Tailwind · PWA (build normal; not the Pages demo).

**Back:** Node.js ≥ 20 · Express · Prisma · MariaDB / MySQL · Argon2id · cookies HttpOnly · Zod · Helmet · rate limit · RBAC.

---

## 🗂️ Estructura

```
dayly/
├── server/                 # API (Express + Prisma)
│   ├── prisma/             # Esquema, migraciones, seed
│   ├── src/                # Rutas, correo, avisos, push
│   └── tests/              # Vitest + Supertest
├── client/                 # React + Vite
│   └── src/lib/demo.ts     # Mock de la demo Pages
├── demo/                   # Build estático de GitHub Pages
├── app.mjs                 # Entrada Node (Passenger / hosting)
├── scripts/gen-vapid.mjs   # Claves Web Push
├── start.bat               # Desarrollo
├── setup-mariadb.bat       # MariaDB local
└── deploy.bat              # Build → deploy-hosting/
```

---

## 🚀 Puesta en marcha

**Requisitos:** Node.js ≥ 20 · MariaDB ≥ 10.11 (o MySQL 8) en el `DATABASE_URL` del `.env`.

```bash
git clone https://github.com/PoxiiTV/Dayly.git && cd Dayly
npm install
# Copia .env.example → .env (DATABASE_URL mysql://… y APP_SECRET). No se versiona.
npm run db:migrate
npm run db:seed
```

Windows: `setup-mariadb.bat` si no tienes MariaDB, luego `start.bat` (`npm run dev`).

- 🌐 Web: http://localhost:5173
- 🔌 API: http://localhost:4000

### Scripts

```bash
npm run dev            # API + web
npm run build          # producción (server + client)
npm run start          # API de producción
npm run test           # tests backend
npm run typecheck
npm run db:migrate
npm run db:seed
npm run db:generate    # prisma generate (obligatorio tras cambiar el schema)
npm run build:demo     # demo/ para GitHub Pages
```

`node scripts/gen-vapid.mjs` genera `VAPID_*` para push.

`deploy.bat` deja el build en `deploy-hosting\` (incluye `.env` real; excluye `node_modules`).

Tras **cambiar el schema de Prisma en un hosting**, corre `npm run db:generate` en el servidor y reinicia la app. No sustituye a las migraciones; solo regenera el cliente.

---

## 🔐 Seguridad

- Contraseñas **Argon2id**; nunca en texto plano ni en logs.
- Sesiones en cookie **HttpOnly** + SameSite; listado y revocación.
- RBAC en servidor; aislamiento por `userId`.
- Rate limiting, Helmet, CORS acotado, Prisma (queries parametrizadas).
- 2FA TOTP + códigos de un uso.
- Correo HTML claro (reset, verificar, bienvenida admin) si hay SMTP.
- Primer login de cuentas de admin: **obligatorio** cambiar la clave.
- Avisos: poll en la app + Web Push opcional.

---

## 🧪 Tests

```bash
npm run test
```

Auth, RBAC, aislamiento, CRUD, papelera, hábitos, time-tracking, import/export, avisos y recurrencia.

---

## 📄 Licencia

**PolyForm Noncommercial License 1.0.0** — uso personal y no comercial. Ver [LICENSE](LICENSE).

---

<div align="center">

**DAYLY** · Alexis

[Demo](https://poxiitv.github.io/Dayly/) · [Issues](https://github.com/PoxiiTV/Dayly/issues)

</div>
