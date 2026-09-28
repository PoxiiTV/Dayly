# Integraciones: lo que tienes que hacer tú

Guía paso a paso para dejar operativas WhatsApp Business, Telegram Business y
Gmail en Kalendiario. El código ya está preparado (commit `a9c9690`, rama
`mejoras`); lo que queda son cuentas, permisos y configuración en los
proveedores, más el despliegue.

> Los nombres de menús de Google y Meta cambian a menudo. Si un menú no
> coincide exactamente, busca el término entre comillas en su consola.

Orden recomendado:

1. [Preparar el servidor](#1-preparar-el-servidor) (obligatorio para todo).
2. [Desplegar y migrar](#2-desplegar-y-migrar).
3. [Telegram](#3-telegram) (lo más rápido de dejar funcionando).
4. [Gmail con Google](#4-gmail-con-google).
5. [WhatsApp Business](#5-whatsapp-business) (lo más largo: requiere
   verificaciones de Meta que tardan días).
6. [Comprobación final](#6-comprobación-final).

### Mientras tanto: ocultar o anunciar lo que no está listo

En `/admin` → **Integraciones de la plataforma**, cada bloque (Telegram,
Google Gmail, WhatsApp Business) tiene el selector **«Mientras no esté activa,
los usuarios la ven»**:

- **Con la etiqueta «Próximamente»** (por defecto): los usuarios ven la
  pestaña, tarjeta u opción con la etiqueta y sin poder usarla.
- **Oculta**: desaparece por completo (pestañas de Mensajes, tarjetas de
  canal, Ajustes → Integraciones, opciones "Avisar por Telegram", botón
  "Conectar con Google").

Se aplica al instante. En cuanto actives la integración y completes su
configuración, aparece para todos sin tocar nada más.

---

## 1. Preparar el servidor

### 1.1 Dominio público con HTTPS

Telegram, Google y Meta llaman a tu servidor desde internet. Sin HTTPS
público nada de esto funciona.

- [ ] Ten un dominio propio apuntando al servidor (ej. `agenda.tudominio.com`).
- [ ] Certificado TLS válido (Let's Encrypt vale). Nada de certificados
      autofirmados: Telegram y Meta los rechazan.
- [ ] Puerto público 443 (Telegram solo admite webhooks en 443, 80, 88 u 8443;
      usa 443).
- [ ] Comprueba desde fuera: `https://agenda.tudominio.com/api/health` debe
      responder `{"ok":true,...}`.

### 1.2 Variables del `.env` de producción

Edita el `.env` del servidor (nunca lo subas al repositorio):

| Variable | Valor | Por qué |
|---|---|---|
| `PUBLIC_URL` | `https://agenda.tudominio.com` (sin `/` final) | Con ella se construye la URL del webhook de Telegram y el callback de Google. |
| `CLIENT_ORIGIN` | `https://agenda.tudominio.com` | Lista de orígenes permitidos para el retorno de Google. Si sirves la app en varios dominios, sepáralos por comas. |
| `TRUST_PROXY` | `1` si hay un proxy inverso (Nginx, Plesk, Cloudflare) delante | Para que la app vea la IP y el protocolo reales. |
| `NODE_ENV` | `production` | Cookies seguras. |

Las credenciales de Google y Meta **no** van en el `.env`: se guardan cifradas
desde el panel de administración (paso 4 y 5). Las variables
`WHATSAPP_*`, `MESSAGING_*`, `GOOGLE_CLIENT_ID`… del `.env` solo sirven como
importación inicial la primera vez que arranca; después manda el panel.

---

## 2. Desplegar y migrar

Lo que debe hacerse, en este orden:

- [ ] Llevar la rama `mejoras` a producción.
- [ ] Aplicar migraciones **antes** de arrancar la versión nueva:
      `npm run db:migrate:deploy -w server`
      (añade la migración `20260924090000_messaging_hardening`: dos columnas y
      la tabla `TelegramAssistantSession`).
- [ ] Comprobar que no quedan migraciones pendientes:
      desde `server/`: `node --env-file=../.env ../node_modules/prisma/build/index.js migrate status`.
- [ ] Reiniciar y comprobar `/api/health` con la versión nueva.

### 2.1 Solo si todavía usas el bot de Telegram antiguo

Si en el `.env` tienes `TELEGRAM_BOT_TOKEN` del bot único de antes:

- [ ] Desde la raíz:
      `npm run migrate:legacy-integrations -w server -- --telegram-owner-email TU_CORREO_ADMIN`
- [ ] Entra con ese administrador en **Ajustes → Telegram** y pulsa activar
      webhook.
- [ ] Comprueba que recibes mensajes y, solo entonces, borra
      `TELEGRAM_BOT_TOKEN` y `TELEGRAM_WEBHOOK_SECRET` del `.env`.

---

## 3. Telegram

Hay dos usos distintos, y cada usuario configura el suyo:

- **Asistente Kalen por Telegram**: el usuario escribe al bot y Kalen apunta
  tareas, recordatorios, etc. Funciona con cualquier cuenta de Telegram.
- **Telegram Business**: el bot lee y responde los chats de clientes del
  usuario desde la bandeja de Mensajes. Requiere **Telegram Premium**.

### 3.1 Como administrador (una vez)

- [ ] Entra en `/admin` → **Integraciones de la plataforma** → **Telegram**.
- [ ] Activa **Habilitar Telegram para usuarios** y guarda.

No hay más: cada usuario trae su propio bot.

### 3.2 Lo que hace cada usuario (hazlo tú primero con tu cuenta para probar)

**Crear el bot:**

- [ ] En Telegram, abre `@BotFather` y envía `/newbot`.
- [ ] Ponle nombre y un usuario que termine en `bot` (ej. `kalen_tuyo_bot`).
- [ ] Copia el **token** que te da (formato `123456789:AA...`). Es secreto:
      no lo pegues en chats ni correos.
- [ ] Para Telegram Business: en `@BotFather` → `/mybots` → tu bot →
      **Bot Settings** → **Business Mode** → activar.

**Conectarlo en Kalendiario:**

- [ ] **Ajustes → Telegram** → pega el token → guardar.
- [ ] Pulsa activar webhook. Si el bot ya tenía otro webhook, la app te
      enseña a qué dominio apunta y te pide confirmar la sustitución.
- [ ] Pulsa **Vincular**: se abre `t.me/tu_bot?start=...`. Pulsa **Iniciar**
      en un **chat privado** con el bot. El enlace caduca a los 10 minutos.
      Por seguridad el bot no se vincula desde grupos.
- [ ] Escríbele "qué tengo hoy" para probar el asistente.

**Telegram Business (opcional, con Premium):**

- [ ] En la app de Telegram: **Ajustes → Telegram Business → Chatbots** →
      añade tu bot y dale permiso para **responder** mensajes.
- [ ] En Kalendiario, **Mensajes → Canales conectados** debe mostrar Telegram
      Business como activo.
- [ ] Pide a otra persona que te escriba; el mensaje debe aparecer en
      **Mensajes**.

**Importante:**

- Si desconectas Telegram Business desde Kalendiario, **no** se reactiva
  solo. Para volver a conectarlo: Telegram → Ajustes → Telegram Business →
  Chatbots → quita el bot y añádelo de nuevo.
- El bot solo puede responder en chats con actividad en las últimas 24 h
  (norma de Telegram).

---

## 4. Gmail con Google

Permite "Conectar con Google" sin contraseña de aplicación. Sin esto, los
usuarios pueden seguir conectando Gmail con una **contraseña de aplicación**
(funciona ya, no requiere nada de lo siguiente).

### 4.1 Aviso importante antes de empezar

La app pide el permiso `https://mail.google.com/` (leer y enviar correo por
IMAP/SMTP). Google lo clasifica como **restringido**:

- En modo **Testing**: solo pueden entrar hasta 100 usuarios de prueba que
  añadas a mano, y **el permiso caduca cada 7 días** (el usuario verá "La
  sesión de Google caducó" y tendrá que reconectar).
- Para usuarios reales (modo **In production**) necesitas la **verificación
  de Google** y una **evaluación de seguridad CASA** hecha por un laboratorio
  autorizado, que se renueva cada año y tiene coste. Tarda semanas.

Recomendación: usa modo Testing para ti y tu equipo; decide si merece la pena
la verificación antes de abrirlo a todos.

### 4.2 Proyecto en Google Cloud

- [ ] Entra en <https://console.cloud.google.com/> y crea un proyecto
      (ej. "Kalendiario").
- [ ] **APIs y servicios → Biblioteca** → busca **Gmail API** → **Habilitar**.

### 4.3 Pantalla de consentimiento ("Google Auth Platform" / "OAuth consent screen")

- [ ] Tipo de usuario: **Externo** (o **Interno** si todos los usuarios están
      en tu Google Workspace: así no hace falta verificación).
- [ ] Nombre de la app, correo de soporte, logo (opcional), correo del
      desarrollador.
- [ ] Dominios autorizados: `tudominio.com`.
- [ ] Enlaces a **política de privacidad** y **condiciones** en tu dominio
      (obligatorios para verificar).
- [ ] **Permisos (scopes)**: añade `openid`, `.../auth/userinfo.email` y
      `https://mail.google.com/`.
- [ ] **Usuarios de prueba**: añade tu Gmail y los de quienes vayan a probar.

### 4.4 Credenciales OAuth

- [ ] **Credenciales → Crear credenciales → ID de cliente de OAuth**.
- [ ] Tipo: **Aplicación web**.
- [ ] **URI de redireccionamiento autorizados**: añade exactamente, uno por
      cada dominio de `CLIENT_ORIGIN`/`PUBLIC_URL`:
      - `https://agenda.tudominio.com/api/inbox/mailboxes/google/callback`
      - (desarrollo, opcional) `http://localhost:5173/api/inbox/mailboxes/google/callback`
- [ ] Guarda y copia **Client ID** y **Client Secret**.

### 4.5 En Kalendiario

- [ ] `/admin` → **Integraciones de la plataforma** → **Google Gmail**.
- [ ] Pega **Client ID** y **Client Secret**, activa **Habilitar conexión con
      Gmail** y guarda.
- [ ] Comprueba que la **Redirect URI** que muestra el panel coincide con la
      que registraste.
- [ ] Como usuario: **Mensajes → Correo → Añadir buzón → Conectar con Google**.
      Acepta el acceso al correo.
- [ ] El panel de admin marcará Google como **operativo** tras la primera
      conexión correcta.

**Importante:**

- Si cambias el Client ID o el Secret en el panel, todas las conexiones Gmail
  con Google se invalidan y cada usuario tendrá que reconectar (la app te
  avisa del número afectado antes de guardar).
- Un buzón conectado con Google solo permite cambiar su nombre. Para cambiar
  servidor o cuenta hay que escribir una contraseña de aplicación; en ese
  momento se revoca el permiso de Google.

---

## 5. WhatsApp Business

Usa la conexión oficial de Meta ("Embedded Signup") en modo **coexistencia**:
el usuario sigue usando la app **WhatsApp Business** en su móvil y además ve y
responde los chats desde Kalendiario.

### 5.1 Requisitos de Meta (los que más tardan)

- [ ] Una cuenta de **Meta Business** (Business Manager) a tu nombre o de tu
      empresa: <https://business.facebook.com/>.
- [ ] **Verificación del negocio** en *Configuración del negocio → Centro de
      seguridad*. Pide documentación de la empresa (CIF, recibo, web con los
      mismos datos). Tarda de días a semanas.
- [ ] Web pública con **política de privacidad** y **condiciones** que
      mencionen el uso de WhatsApp.

### 5.2 Crear la app en Meta for Developers

- [ ] <https://developers.facebook.com/apps> → **Crear app** → tipo
      **Business** → asóciala a tu Business Manager.
- [ ] Añade los productos **WhatsApp** y **Facebook Login for Business**.
- [ ] **Configuración → Básica**: copia **App ID** y **App Secret** (secreto:
      no lo compartas). Rellena dominio de la app (`tudominio.com`), URL de
      privacidad y de condiciones.
- [ ] **Facebook Login for Business → Configuración**:
      - **Dominios permitidos para el SDK de JavaScript**: `https://agenda.tudominio.com`.
      - **URI de redireccionamiento OAuth válidos**: `https://agenda.tudominio.com/`.
      - Login con el SDK de JavaScript: **Sí**.

### 5.3 Configuración de Embedded Signup (el "Configuration ID")

- [ ] **Facebook Login for Business → Configuraciones → Crear configuración**.
- [ ] Tipo de login: **Embedded Signup de WhatsApp** / variante que admita
      **WhatsApp Business app (coexistencia)**.
- [ ] Tipo de token: **System-user access token** (no caduca).
- [ ] Permisos: `whatsapp_business_management`,
      `whatsapp_business_messaging` y `business_management`.
- [ ] Guarda y copia el **Configuration ID**.

### 5.4 Webhook

- [ ] Inventa un **Verify Token** largo y aleatorio (ej. genera 40 caracteres
      con un gestor de contraseñas). Lo usarás en dos sitios.
- [ ] **Primero** guárdalo en Kalendiario (paso 5.6), porque Meta lo comprueba
      al instante.
- [ ] **WhatsApp → Configuración → Webhook → Editar**:
      - URL de devolución de llamada:
        `https://agenda.tudominio.com/api/messaging/whatsapp/webhook`
      - Token de verificación: el Verify Token.
- [ ] En **Campos del webhook**, suscríbete a **todos** estos:
      - [ ] `messages`
      - [ ] `smb_message_echoes` (lo que respondes desde el móvil)
      - [ ] `history` (historial al conectar)
      - [ ] `smb_app_state_sync` (nombres de contactos)

  Sin los tres últimos, lo que escribas desde la app del móvil, el historial y
  los nombres no aparecerán en Kalendiario.

### 5.5 Permisos avanzados y App Review

Mientras la app esté en modo desarrollo solo funciona con cuentas que tengan
rol en ella. Para clientes reales:

- [ ] Solicita **Acceso avanzado** para `whatsapp_business_management`,
      `whatsapp_business_messaging` y `business_management` en
      **Revisión de la app → Permisos y funciones**.
- [ ] Graba un vídeo de pantalla mostrando el flujo completo en Kalendiario:
      Mensajes → Conectar WhatsApp → Embedded Signup → recibir un mensaje →
      responder → enviar plantilla.
- [ ] Solicita ser **Tech Provider** (proveedor de tecnología) si lo pide la
      consola: es necesario para que terceros conecten sus números.
- [ ] Pon la app en modo **Live / En producción**.

### 5.6 En Kalendiario

- [ ] `/admin` → **Integraciones de la plataforma** → **WhatsApp Business**:
      - **App ID**, **App Secret**, **Configuration ID**, **Verify Token**.
      - **Versión Graph**: la vigente que indique Meta en su changelog
        (formato `v23.0`). Revísala en cada despliegue; Meta retira versiones
        cada ~2 años.
      - Activa **Habilitar WhatsApp Business** y guarda.
- [ ] Vuelve al paso 5.4 y verifica el webhook en Meta (debe quedar en verde).

### 5.7 Lo que hace cada usuario (pruébalo tú primero)

- [ ] Tener la app **WhatsApp Business** en el móvil con el número, versión
      actualizada.
- [ ] **Mensajes → Canales conectados → WhatsApp Business → Conectar**.
- [ ] En la ventana de Meta: elige o crea la cuenta de negocio, elige
      **conectar tu app de WhatsApp Business existente**, escanea el QR con el
      móvil y **acepta compartir el historial** si quiere ver chats antiguos.
      Esa sincronización solo se puede pedir en las primeras 24 h.
- [ ] Debe aparecer "WhatsApp Business conectado".

### 5.8 Plantillas (para escribir pasadas 24 h)

WhatsApp solo permite texto libre durante las 24 h siguientes al último
mensaje del cliente. Pasado ese plazo solo se pueden enviar **plantillas
aprobadas**:

- [ ] Cada usuario las crea en **WhatsApp Manager**
      (<https://business.facebook.com/wa/manage/message-templates/>) y espera
      a que Meta las apruebe (minutos u horas).
- [ ] Kalendiario solo muestra las compatibles: variables numéricas en el
      cuerpo (`{{1}}`, `{{2}}`…), cabecera de texto sin variables o sin
      cabecera, y botones sin variables. Nada de imágenes ni categoría
      "Autenticación".
- [ ] **Método de pago**: cada cuenta de WhatsApp Business debe tener una
      tarjeta en *WhatsApp Manager → Configuración de pago*, porque Meta cobra
      las conversaciones iniciadas con plantilla. Sin tarjeta, el envío falla.

---

## 6. Comprobación final

Prueba con **dos usuarios distintos** (tú y una cuenta de prueba):

- [ ] **Telegram**: cada uno con su bot; los mensajes de uno no aparecen al
      otro. El asistente no responde en un grupo.
- [ ] **Gmail**: conectar con Google, leer un correo, responder. Borrar el
      buzón y comprobar en <https://myaccount.google.com/permissions> que el
      acceso de Kalendiario ha desaparecido.
- [ ] **WhatsApp**:
      - Un cliente escribe → aparece en Mensajes.
      - Respondes desde Kalendiario → llega al cliente.
      - Respondes desde el móvil → aparece en Kalendiario.
      - En una conversación con más de 24 h, **Enviar plantilla** funciona.
      - Desconectar y conectar el mismo número desde la otra cuenta: la otra
        cuenta no ve las conversaciones antiguas.
- [ ] En `/admin`, Google y WhatsApp aparecen como **operativos**.

## Si algo falla

| Síntoma | Causa probable |
|---|---|
| Telegram no recibe nada | `PUBLIC_URL` no es HTTPS pública, o el webhook apunta a otro dominio (Ajustes → Telegram muestra el host). |
| "Este chat no está vinculado" | Vinculaste desde un grupo, o el enlace caducó: genera otro y usa el chat privado. |
| Google: `redirect_uri_mismatch` | La Redirect URI registrada no es idéntica (protocolo, dominio, sin `/` final). |
| Google: "La sesión de Google caducó" cada semana | La app está en modo Testing (caducidad de 7 días). |
| WhatsApp: la ventana de Meta se cierra sin conectar | Dominio no permitido en Facebook Login for Business, o Configuration ID incorrecto. |
| WhatsApp: no aparecen mis respuestas del móvil | Falta suscribir `smb_message_echoes` en el webhook. |
| WhatsApp: "Meta limitó el envío" | Calidad o límites de la cuenta; revisa WhatsApp Manager. |
| WhatsApp: plantilla falla al enviar | Falta método de pago o la plantilla no está aprobada en ese idioma. |
