<div align="center">

# Dayly

**Tu agenda y centro de productividad.**

Tareas, calendario, notas, proyectos, hábitos y objetivos — en un solo sitio, con cuenta propia.  
**Calen**, la mascota, habla en español, usa tu zona horaria y **escribe en tu agenda** (no solo charla).

[![En vivo](https://img.shields.io/badge/En_vivo-agenda.example.com-0ea5e9?style=for-the-badge)](https://agenda.example.com)
[![Licencia](https://img.shields.io/badge/Licencia-PolyForm%20NC-22c55e?style=for-the-badge)](LICENSE)

**Instancia:** [https://agenda.example.com](https://agenda.example.com)  
**Demo** (solo front, se borra al recargar): [poxiitv.github.io/Dayly](https://poxiitv.github.io/Dayly/)

Proyecto de **Alexis ([PoxiiTV](https://github.com/PoxiiTV))**

</div>

---

## Qué es esto

**Dayly** es una agenda web para uso personal o de un equipo pequeño. No es un mock: hay API, base de datos y sesión. Lo que creas sigue ahí al recargar, en el móvil y en el escritorio.

Lo último que se ha añadido:

- Adjuntos en disco, 2FA más estricto, papelera que limpia ficheros.
- Paletas, foto de perfil, ancho de panel.
- **Calen**, mascota con herramientas reales de agenda, clima (Open-Meteo), fútbol, recetas y ejercicio básico.

En la instancia desplegada **el registro público puede estar cerrado** (`ALLOW_PUBLIC_REGISTRATION`). Un administrador crea la cuenta y, si hay SMTP, te llega el acceso por correo.

---

## Cómo entrar

1. Abre [agenda.example.com](https://agenda.example.com).
2. Inicia sesión con el email y la contraseña que te hayan dado.
3. Si es el primer acceso de una cuenta creada por admin, **te pedirá otra contraseña** antes de usar la app.
4. Verifica el email si te llega el enlace (reset y bienvenida también van por correo HTML).

En el móvil se puede **instalar como PWA** (añadir a la pantalla de inicio) cuando el navegador lo ofrezca.

La contraseña de la cuenta exige **al menos 10 caracteres**, con mayúscula, minúscula y número.

---

## Qué puedes hacer

### Hoy y el calendario

| Sitio | Para qué sirve |
|--------|----------------|
| **Dashboard** | Saludo, pendientes, hechas hoy, atrasadas, tiempo enfocado, proyectos y objetivos activos, agenda del día. Completar una tarea lanza confeti. |
| **Mi día** | Qué toca ahora, qué viene después, qué está atrasado. Línea de horas **8:00–20:00**. Posponer una tarea a mañana. |
| **Calendario** | Vistas mes, semana, día y agenda. Rejilla **00:00–24:00** (el día suele empezar a las 8:00). Clic en un hueco abre el alta **con esa fecha y hora**. Arrastra tareas y eventos a otro momento. En el móvil, la semana es tira Lun–Dom + un día (sin scroll horizontal). |

### Tareas

- Crear, editar, completar, cancelar, posponer y enviar a la papelera.
- Prioridad (urgente / alta / normal / baja), fecha opcional con o sin hora, proyecto, etiquetas, color, descripción.
- **Subtareas** con recuento hecho/total.
- Recurrencia diaria, semanal o mensual (cambiar la recurrencia afecta a **la serie**).
- Filtros: todas, hoy, próximas, atrasadas, prioridad alta, sin fecha.
- Las abiertas se ordenan por día de vencimiento y luego por prioridad.
- **Adjuntos** en disco (no en la base de datos): JPEG, PNG, WebP, GIF, PDF, texto, CSV, zip, DOCX y XLSX. Se comprueba el tipo real del archivo. **2 MB por fichero**, **5 por tarea**, cuota **200 MB** por cuenta. Al borrar de verdad se eliminan del disco.

### Bandeja, proyectos, notas

- **Bandeja de entrada:** captura rápida de ideas; luego conviertes cada ítem en tarea, evento o nota.
- **Proyectos:** color, estado editable, barra de progreso real en la tarjeta, ficha con las tareas del proyecto.
- **Notas:** título y contenido, fijar, archivar, buscar. Adjuntos: **solo imágenes** (JPEG, PNG, WebP, GIF), hasta **8 por nota**, misma cuota de 200 MB.

### Hábitos, objetivos, foco

- **Hábitos:** días de la semana, recordatorio opcional a una hora, marca del día y calendario mensual.
- **Objetivos:** meta con fecha, progreso visual y tareas asociadas.
- **Estadísticas:** hoy / semana / mes (completadas, tasa, tiempo enfocado, hábitos, atrasadas).
- **Modo concentración** (`/pomodoro`): 25/5, 50/10 o bloque 90/20. El tiempo de trabajo se **suma a la tarea** que elijas. No está en el menú lateral; Ayuda lo menciona.
- **Recordatorios:** aviso puntual o diario; campana en la app.

El botón **+** (desde cualquier pantalla) crea tarea, evento, nota, proyecto o recordatorio.

### Avisos y búsqueda

- Con la app abierta: toast, notificación del navegador y campana.
- **Web Push** opcional (claves `VAPID_*`) si quieres avisos con la pestaña cerrada. En Safari/iOS a menudo no llega.
- **Ctrl+K** (o Cmd+K): busca tareas, eventos, notas, proyectos, objetivos y hábitos.
- Atajos reales: **Alt+M** Mi día; **Alt+C** o **Alt+E** calendario; **Alt+T** o **Alt+N** tareas; **+** alta rápida; **Esc** cierra diálogos.

### Apariencia y cuenta

- Tema claro, oscuro o sistema. El icono luna/sol **alterna** claro ↔ oscuro con una ola desde el clic.
- **12 paletas:** Tinta, Grafito, Pizarra, Bosque, Arcilla, Vino, Cobre, Mar, Dorado, Royal, Amatista, Hielo.
- Ancho de panel: **Estrecho**, **Normal** o **Ancho**.
- Zona horaria, idioma (español / inglés), primer día de la semana, reloj 24 h, preferencias de avisos (tareas / eventos / recordatorios).
- Perfil: nombre y **foto**.
- Contraseña, sesiones (listar y cerrar), **2FA TOTP** con QR: el secreto no se activa hasta confirmar con contraseña y código. Códigos de recuperación de un uso.
- Importar / exportar **tareas, eventos y notas** en JSON, CSV o ICS. Lo importado se **añade**; no borra lo que ya tienes.
- **Papelera:** tareas, eventos, notas, proyectos y objetivos. Restaurar actualiza las listas. Vaciar o borrar permanente también quita los adjuntos del disco.

### Administración (solo rol admin)

Panel `/admin`: altas (email de bienvenida si hay SMTP), roles, suspender, borrar cuenta (borra sus datos) y métricas. Los datos de cada usuario están **aislados**; nadie ve la agenda de otro.

---

## Calen (la mascota)

Calen es un calendario kawaii flotante. Se arrastra, se redimensiona (clic derecho), abre un chat y desde ese menú entra a **Ajustes de Calen**. **No es un chatbot genérico:** si le pides algo de la agenda, tiene que usar herramientas del servidor. Si dice que creó una tarea y la tool no devolvió una línea `OK id=…`, **no se ha creado**.

### Cómo activarla

1. **Ajustes → Mascota** (también con clic derecho sobre Calen).
2. Actívala («Mostrar mascota»), elige proveedor y modelo, pega **tu** API key y pulsa probar.
3. Proveedores: **OpenCode** (catálogo Go/Zen; `auto-free` elige un modelo gratis del catálogo), **OpenRouter**, o **Personalizado** (URL base de chat, p. ej. `https://api.groq.com/openai/v1`, y **URL de modelos** OpenAI-compatible, p. ej. `https://api.groq.com/openai/v1/models`).
4. Sin key no habla. Cada proveedor guarda **su** key, cifrada en el servidor. Tras «Probar conexión» el campo muestra `API_KEY VALIDA`. La key no vuelve al navegador.

El chat responde en **streaming** (ves el texto según llega). El icono de reinicio limpia la conversación.

### Qué sí hace (en tu zona de Ajustes, p. ej. Europe/Madrid)

| Pedido típico | Qué ocurre de verdad |
|---------------|----------------------|
| «Crea una tarea para mañana» | Alta en la base de datos, con fecha local. Sale en Hoy / Mañana / calendario. |
| «Tacha / cancela / tira a la papelera X» | Cambia estado o la manda a papelera, igual que la UI. Si hay varios títulos iguales, lista ids y pide cuál. |
| «Muévela al viernes» / cambia prioridad o proyecto | Actualiza la tarea. |
| «Crea el proyecto Web» y luego una tarea en ese proyecto | Proyecto + `projectId` / nombre. |
| Notas: crear, listar, papelera | Misma API que Notas. |
| Eventos y recordatorios (hoy, semana, «avísame a las 21») | CRUD real; horas en tu zona, no en UTC del servidor. |
| «Qué tiempo hace» / «clima mañana en Valencia» | **Open-Meteo** (gratis, sin key tuya). Si no dices ciudad, usa la de tu zona (Madrid si es `Europe/Madrid`). Temperatura, sensación, humedad, viento, lluvia y previsión. |
| «Próximo partido del Barça» | football-data.org. La clave se pone en **Ajustes → Mascota** (o `FOOTBALL_DATA_API_KEY` en el servidor). Puede crear el recordatorio con la hora ISO del partido. |
| Receta, menú o cena | Responde con ideas de comida; puede buscar si hace falta un dato concreto. |
| Ejercicio básico para mantener la forma | Rutinas cortas, estiramientos, sentadillas, plancha… |
| «A qué hora abre la farmacia» | Búsqueda web acotada a comida, ejercicio o datos prácticos de una tarea (horarios de comercios). |

Tras una acción, la app **refresca** tareas, proyectos, notas, calendario y recordatorios.

### Qué no hace

- No programa, no escribe código, no es un asistente general ni responde noticias u otros temas ajenos.
- **No** toca bandeja, hábitos, objetivos, subtareas ni vaciar la papelera.
- No inventa el clima ni el marcador: si la tool falla, debe decirlo.
- En la **demo estática** no hay modelo real: solo un stub.

La zona horaria de Calen es la de **Ajustes**, no la del servidor. El clima no gasta tu crédito de IA; el fútbol depende de la key del servidor.

---

## Privacidad y límites (lo que importa al usar la instancia)

- Cada cuenta ve **solo** sus datos. Sesión en cookie **HttpOnly**.
- Contraseñas con **Argon2id**. 2FA opcional.
- Ficheros: sniff MIME, 2 MB por archivo, cuota 200 MB; no se cuelan ejecutables disfrazados de imagen.
- El registro público se puede cerrar (`ALLOW_PUBLIC_REGISTRATION`). En esta instancia las altas las hace un admin.
- **Push / iOS:** hace falta configurar VAPID y dar permiso; Safari a menudo no entrega.
- **Correo:** sin SMTP en el servidor no salen reset ni bienvenida.
- **Calen:** usa *tu* crédito del proveedor de IA. El clima no gasta key. El fútbol usa la key de football-data.org que pongas en Ajustes (o `FOOTBALL_DATA_API_KEY` del servidor).
- La demo de GitHub Pages es un mock: no es esta instancia ni MariaDB.

---

## English

**Dayly** is a real Express + Prisma + MariaDB agenda (not the in-memory GitHub Pages demo). Live instance: [agenda.example.com](https://agenda.example.com). Public signup can be disabled; an admin creates accounts. First login may require a new password (10+ chars, upper, lower, number).

You get a dashboard and My Day, a full calendar (00–24h, click-to-create, drag), tasks with subtasks/recurrence/disk attachments (2 MB/file, 5/task, 200 MB quota), inbox capture, projects with real progress, notes (images only, 8/note), habits with a month calendar, goals, stats, a Pomodoro page at `/pomodoro` that logs time to a task (not in the sidebar), reminders, Ctrl+K search, 12 color skins, PWA, 2FA (TOTP pending until confirm), and trash that purges files. Import/export covers **tasks, events and notes** (JSON / CSV / ICS).

**Calen** is a draggable mascot. With your own LLM API key (OpenCode / OpenRouter / custom) she can create, complete, cancel, trash and edit tasks, projects, notes, events and reminders in **your timezone**, stream replies, fetch **Open-Meteo** weather, look up football fixtures, suggest simple meals/recipes and basic fitness, and search only for those practical topics (shop hours, etc.). She does not code or answer general questions, and she does not manage inbox, habits, goals or subtasks. If a tool does not return `OK id=…`, nothing was saved.

---

## Stack

**Front:** React 18 · TypeScript · Vite 6 · React Router · TanStack Query · Tailwind · PWA.

**Back:** Node.js ≥ 20 · Express · Prisma · MariaDB · Argon2id · cookies HttpOnly · Zod · Helmet · rate limit · RBAC · Multer.

**Calen:** tools en el servidor · SSE · Open-Meteo · football-data.org (opcional).

---

## Estructura

```
agenda_dayly/
├── server/                       # API (Express + Prisma)
│   ├── prisma/
│   ├── src/                      # Rutas, mascota, correo, avisos, push, uploads
│   └── tests/
├── client/                       # React + Vite
├── docker-compose.portainer.yml  # Stack Docker / Portainer + túnel
├── Dockerfile
├── app.mjs
├── scripts/gen-vapid.mjs
├── start.bat
└── deploy.bat
```

---

## Puesta en marcha (desarrollo)

**Requisitos:** Node.js ≥ 20 · MariaDB 11 (o MySQL 8) en el `DATABASE_URL` del `.env`.

```bash
git clone https://github.com/PoxiiTV/Dayly.git && cd Dayly
npm install
# Copia .env.example → .env (DATABASE_URL y APP_SECRET). No se versiona.
npm run db:migrate
npm run db:seed
```

Windows: `setup-mariadb.bat` si no tienes MariaDB, luego `start.bat` (`npm run dev`).

- Web: http://localhost:5173
- API: http://localhost:4000

```bash
npm run dev
npm run build
npm run start
npm run test
npm run typecheck
npm run db:migrate
npm run db:seed
npm run db:studio
```

`node scripts/gen-vapid.mjs` genera `VAPID_*`. `deploy.bat` deja el build de despliegue (incluye `.env` real; no lo subas a git).

Tras cambiar el schema: regenera el cliente Prisma y reinicia. No sustituye a las migraciones.

Producción (este stack): `docker compose -f docker-compose.portainer.yml --profile tunnel up -d --build`  
El contenedor web escucha en `127.0.0.1:18087`.

### Cuentas seed (solo `npm run db:seed` en local)

| Rol | Email | Contraseña |
|-----|--------|------------|
| Admin | `admin@dayly.dev` | `Admin123456` |
| Demo | `alexis@dayly.dev` | `Demo123456` |

Cámbialas si sales de tu PC. **No** son las de producción.

---

## Seguridad (técnica)

- Argon2id; nada de contraseñas en logs.
- Cookie HttpOnly + SameSite; listado y revocación de sesiones.
- RBAC y `userId` en servidor.
- Rate limit, Helmet, CORS acotado, Prisma parametrizado.
- JSON de API acotado; ficheros por multipart + sniff + cuota.
- 2FA TOTP pendiente hasta confirmar + códigos de un uso.
- Primer login de cuentas de admin: cambio de clave obligatorio.
- `ALLOW_PUBLIC_REGISTRATION` para cerrar el alta pública.

---

## Licencia

**PolyForm Noncommercial License 1.0.0** — uso personal y no comercial.  
Copyright: **Alexis (PoxiiTV), 2026**. Ver [LICENSE](LICENSE).

---

<div align="center">

**Dayly** · Alexis · [agenda.example.com](https://agenda.example.com)

[Repositorio](https://github.com/PoxiiTV/Dayly) · [Demo Pages](https://poxiitv.github.io/Dayly/) · [Issues](https://github.com/PoxiiTV/Dayly/issues)

</div>
