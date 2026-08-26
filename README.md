<div align="center">

<img src="client/public/brand/icon-512.png" width="110" alt="Dayly" />

# 🗓️ Dayly

**Tu agenda y centro de productividad.**

Tareas · Calendario · Notas · Proyectos · Hábitos · Objetivos — todo en un solo sitio, con cuenta propia.

**🤖 Calen**, la mascota, habla español, usa tu zona horaria y **escribe en tu agenda de verdad** (no solo charla).

[![Licencia](https://img.shields.io/badge/Licencia-PolyForm%20NC-22c55e?style=for-the-badge)](LICENSE)
[![Demo](https://img.shields.io/badge/Demo_en_vivo-GitHub_Pages-8b5cf6?style=for-the-badge)](https://poxiitv.github.io/Dayly/)
![React](https://img.shields.io/badge/React_18-20232a?style=for-the-badge&logo=react&logoColor=61dafb)
![Node](https://img.shields.io/badge/Node_%E2%89%A520-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![MariaDB](https://img.shields.io/badge/MariaDB-003545?style=for-the-badge&logo=mariadb&logoColor=white)

[Demo](https://poxiitv.github.io/Dayly/) · [Issues](https://github.com/PoxiiTV/Dayly/issues)

*La demo es solo front (mock en memoria, se borra al recargar). La app completa lleva API, base de datos y sesión.*

</div>

---

## ✨ Qué puedes hacer

### 🎯 Tu día, bajo control

| Sitio | Para qué sirve |
|--------|----------------|
| 📊 **Dashboard** | Saludo, pendientes, hechas hoy, atrasadas, tiempo enfocado, proyectos y objetivos activos, agenda del día. Completar una tarea lanza confeti 🎉 |
| ☀️ **Mi día** | Qué toca ahora, qué viene después, qué está atrasado. Línea de horas 8:00–20:00 y posponer a mañana |
| 📅 **Calendario** | Mes, semana, día y agenda. Cuadrícula 00:00–24:00, clic en un hueco para crear con esa hora, arrastrar para mover. En móvil, semana táctil sin scroll |

### ✅ Tareas

- Crear, editar, completar, cancelar, posponer y papelera 🗑️
- Prioridad (urgente / alta / normal / baja), fecha con o sin hora, proyecto, etiquetas y color
- ✔️ Subtareas con recuento hecho/total
- 🔁 Recurrencia diaria, semanal o mensual (afecta a la serie)
- Filtros rápidos: hoy, próximas, atrasadas, prioridad alta, sin fecha
- 📎 **Adjuntos**: JPEG, PNG, WebP, GIF, PDF, texto, CSV, zip, DOCX y XLSX — tipo real verificado, 2 MB por fichero, 5 por tarea, cuota de 200 MB por cuenta

### 📥 Bandeja · 📁 Proyectos · 📝 Notas

- **Bandeja de entrada**: captura rápida de ideas → convierte cada una en tarea, evento o nota
- **Proyectos**: color, estado editable, barra de progreso real, ficha con sus tareas
- **Notas**: fijar, archivar, buscar, carpetas… y adjuntos de imágenes (hasta 8 por nota)

### 🔥 Hábitos · 🎯 Objetivos · ⏱️ Foco

- **Hábitos**: días de la semana, recordatorio a una hora, marca del día y calendario mensual 🔥
- **Objetivos**: meta con fecha, progreso visual y tareas asociadas
- **Estadísticas**: hoy / semana / mes — completadas, tasa, foco, hábitos, atrasadas
- **Modo concentración** (`/pomodoro`): 25/5, 50/10 o 90/20 — el tiempo suma a la tarea que elijas
- **Recordatorios**: aviso puntual o diario, campana en la app

El botón **+** crea tarea, evento, nota, proyecto o recordatorio desde cualquier pantalla.

### 🔔 Avisos y búsqueda

- Toast, notificación del navegador y campana con la app abierta
- 📲 **Web Push** opcional (`VAPID_*`) con la pestaña cerrada *(en Safari/iOS a menudo no llega)*
- 🔍 **Ctrl+K**: busca tareas, eventos, notas, proyectos, objetivos y hábitos
- ⌨️ Atajos: `Alt+M` Mi día · `Alt+C/E` calendario · `Alt+T/N` tareas · `+` alta rápida · `Esc` cerrar

### 🎨 Apariencia y cuenta

- 🌗 Tema claro, oscuro o sistema (con transición de ola desde el clic)
- 🎨 **12 paletas**: Tinta, Grafito, Pizarra, Bosque, Arcilla, Vino, Cobre, Mar, Dorado, Royal, Amatista, Hielo
- 📏 Ancho de panel configurable · idioma ES/EN · zona horaria · reloj 24 h
- 👤 Perfil con foto · contraseñas · sesiones activas
- 🔐 **2FA TOTP** con QR y códigos de recuperación de un uso
- 📤📥 Import/export **JSON · CSV · ICS** (tareas, eventos y notas; lo importado se añade)
- ♻️ **Papelera**: restaura o borra para siempre — y limpia también los adjuntos del disco

### 🛠️ Administración (rol admin)

Panel `/admin`: altas de usuarios, roles, suspender, borrar cuentas y métricas. Los datos de cada usuario están **aislados**: nadie ve la agenda de otro.

---

## 🤖 Calen, la mascota

Un calendario kawaii flotante que se arrastra, se redimensiona (clic derecho) y **chatea contigo**. No es un chatbot decorativo: tiene *herramientas* que tocan tu agenda real.

> ⚙️ Se activa en **Ajustes → Mascota**: eliges proveedor (**OpenCode** con modo gratis automático, **OpenRouter** o el tuyo propio), pegas **tu** API key y listo. La key se cifra en el servidor y nunca vuelve al navegador.

| Le dices… | Y ella… |
|-----------|---------|
| «Crea tarea dentista mañana a las 10» | 🦷 La crea en tu BD, con fecha local — sale en Hoy y calendario |
| «Tacha la del super» / «cancela las de hoy» | ✔️ Cambia estados como la UI |
| «Muévela al viernes» | 📆 Actualiza fechas y prioridades |
| «Crea proyecto *Casa* y una tarea dentro» | 📁 Proyecto + tarea vinculada |
| «¿Qué tengo esta semana?» / «avísame a las 21» | 📋 Lista y crea eventos y recordatorios |
| «¿Qué tiempo hace mañana?» | 🌤️ Open-Meteo, sin gastar tu crédito de IA |
| «¿Cuándo juega el Betis?» | ⚽ football-data.org (+ te crea el recordatorio si quieres) |
| «Cena sana para tonight» / «estiramientos 5 min» | 🥗🏃 Ideas y rutinas cortas |

**Y lo que NO hace** (y no puede hacer, porque esas herramientas no existen):

> ❌ Programar código · noticias · deberes · temas generales · hábitos · objetivos · subtareas · bandeja · vaciar la papelera · ver datos de otros usuarios.

🔒 **Anti-invento**: nunca confirma una acción si la herramienta no devolvió `OK id=…`. Si dice que creó algo, es que existe.

---

## 🔐 Privacidad y seguridad

- 🧱 Cada cuenta ve **solo** sus datos · sesión en cookie **HttpOnly**
- 🔑 Contraseñas con **Argon2id** · 2FA opcional (TOTP + códigos de recuperación)
- 🕵️ Adjuntos con sniffing MIME real: nada de ejecutables disfrazados de imagen
- 🚪 Registro público desactivable (`ALLOW_PUBLIC_REGISTRATION`) — modo "solo invita"
- 🛡️ Helmet · rate limiting · CORS acotado · queries parametrizadas (Prisma) · RBAC
- ⚠️ Límites honestos: Push/iOS depende de Safari · sin SMTP no salen correos de reset

<details>
<summary><b>🌐 English</b></summary>

**Dayly** is a real Express + Prisma + MariaDB agenda (not the in-memory GitHub Pages demo). Public signup can be disabled so an admin creates accounts; first login of admin-created accounts requires choosing a new password (10+ chars, upper, lower, number).

You get a dashboard and My Day, a full calendar (click-to-create, drag & drop), tasks with subtasks/recurrence/disk attachments (2 MB/file, 5/task, 200 MB quota), inbox capture, projects with real progress, notes (images, 8/note), habits with a month calendar, goals, stats, a Pomodoro page that logs time to tasks, reminders, Ctrl+K search, 12 color skins, PWA, 2FA (TOTP + recovery codes), and a trash that purges files. Import/export covers **tasks, events and notes** (JSON / CSV / ICS).

**Calen** is a draggable AI mascot. With your own LLM key (OpenCode / OpenRouter / custom OpenAI-compatible) she creates, completes, cancels, trashes and edits tasks, projects, notes, events and reminders in **your timezone**, streams replies, fetches weather (Open-Meteo), looks up football fixtures, suggests meals and basic fitness, and refuses everything else. If a tool doesn't return `OK id=…`, nothing was saved.

</details>

---

## 🧱 Stack

| Capa | Tecnología |
|---|---|
| 🖥️ Front | React 18 · TypeScript · Vite 6 · React Router · TanStack Query · Tailwind CSS · PWA |
| ⚙️ Back | Node.js ≥ 20 · Express · Prisma · MariaDB · Argon2id · cookies HttpOnly · Zod · Helmet · rate limit · Multer |
| 🤖 Calen | Function calling en servidor · SSE streaming · Open-Meteo · football-data.org |

## 📂 Estructura

```
dayly/
├── server/                  # API (Express + Prisma)
│   ├── prisma/              # schema + migraciones
│   ├── src/                 # rutas, mascota, correo, avisos, push, uploads
│   └── tests/
├── client/                  # React + Vite
├── demo/                    # build estático para GitHub Pages
├── app.mjs                  # entrada Passenger/Plesk
├── docker-compose.portainer.yml · Dockerfile
└── start.bat · deploy.bat · setup-mariadb.bat
```

## 🚀 Puesta en marcha

**Requisitos:** Node.js ≥ 20 · MariaDB 11 (o MySQL 8)

```bash
git clone https://github.com/PoxiiTV/Dayly.git && cd Dayly
npm install
# copia .env.example → .env y rellena DATABASE_URL y APP_SECRET
npm run db:migrate
npm run db:seed
```

🪟 En Windows: `setup-mariadb.bat` levanta una MariaDB local y `start.bat` arranca todo.

- Web: http://localhost:5173 · API: http://localhost:4000

```bash
npm run dev          # desarrollo (API + web)
npm run build        # producción
npm run test         # tests del servidor
npm run typecheck    # TS en server + client
npm run db:studio    # explorador de BD
npm run build:demo   # regenera demo/ para Pages
```

### 👤 Cuentas seed (solo local)

| Rol | Email | Contraseña |
|-----|-------|------------|
| 🛠️ Admin | `admin@dayly.dev` | `Admin123456` |
| 🧪 Demo | `alexis@dayly.dev` | `Demo123456` |

*Cámbialas si sales de tu PC.*

`node scripts/gen-vapid.mjs` genera las claves `VAPID_*` para Web Push.

## 📄 Licencia

**PolyForm Noncommercial License 1.0.0** — uso personal y no comercial.
Copyright © Alexis ([PoxiiTV](https://github.com/PoxiiTV)), 2026. Ver [LICENSE](LICENSE).

---

<div align="center">

**Dayly** · hecho con ☕ y cariño por Alexis

</div>
