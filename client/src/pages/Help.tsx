import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  Calculator,
  CalendarDays,
  CheckCircle2,
  Clock3,
  HelpCircle,
  Keyboard,
  ListTodo,
  Mail,
  Map as MapIcon,
  MessageCircle,
  Plus,
  Search,
  ShieldCheck,
  Smartphone,
  Sparkles,
  WalletCards,
  Webhook,
  Minimize2,
  MessagesSquare,
  CreditCard,
  Wand2,
  Undo2,
  UserRound,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { APP_NAME } from "@brand";
import { PageHeader } from "@/components/ui";

type HelpItem = { title: string; body: string; icon: LucideIcon };

const SHORTCUTS: { keys: string; desc: string; icon: LucideIcon }[] = [
  { keys: "Ctrl + K", desc: "Buscar o crear en lenguaje natural", icon: Search },
  { keys: "Alt + N", desc: "Nueva tarea", icon: ListTodo },
  { keys: "Alt + E", desc: "Nuevo evento", icon: CalendarDays },
  { keys: "Alt + M", desc: "Ir a Mi día", icon: MapIcon },
  { keys: "Alt + C", desc: "Calculadora", icon: Calculator },
  { keys: "Alt + T", desc: "Ir a Tareas", icon: ListTodo },
  { keys: "Alt + A", desc: "Ir al Chat", icon: MessagesSquare },
  { keys: "Ctrl + Espacio", desc: "Esconder la app junto al reloj y recuperarla; si activas el PIN rápido, lo pedirá al volver (solo en escritorio)", icon: Minimize2 },
  { keys: "Intro", desc: "Abrir crear; en el título del modal, guardar y cerrar", icon: Plus },
  { keys: "Esc", desc: "Cerrar diálogo o buscador", icon: ArrowLeft },
  { keys: "+", desc: "Botón flotante de creación rápida", icon: Plus },
];

const BASICS: HelpItem[] = [
  { title: "Alta rápida", body: "El botón + y Ctrl+K entienden frases como «reunión mañana a las 10» o «tarea urgente el viernes». Revisa el resultado antes de guardar.", icon: Sparkles },
  { title: "Deshacer y editar", body: "Al crear algo con el + o con Ctrl+K, el aviso trae unos segundos los botones «Editar» y «Deshacer»: abres lo recién creado para corregirlo sin ir a buscarlo, o lo retiras si te equivocaste. Marcar una tarea como hecha ofrece «Deshacer», que la devuelve al estado que tenía, no a pendiente a secas.", icon: Undo2 },
  { title: "Calendario", body: "Arrastra tareas y eventos a otra fecha u hora. En una repetición, «esta vez no» salta solo esa ocurrencia; editar la serie cambia las siguientes.", icon: CalendarDays },
  { title: "Mi día y foco", body: "Mi día separa lo pendiente, lo siguiente y lo atrasado. Pomodoro registra el tiempo en la tarea elegida y admite bloques 25/5, 50/10 y 90/20.", icon: Clock3 },
  { title: "Tareas y proyectos", body: "Usa subtareas, prioridad, etiquetas, recurrencia, rangos de fechas, adjuntos y proyectos. En las atrasadas puedes aplazar un día con el icono junto a editar y Pomodoro, sin abrir la tarea. En Tareas → Etiquetas puedes crear cada etiqueta con nombre y color, renombrarla, recolorearla o eliminarla sin borrar las tareas.", icon: ListTodo },
  { title: "Correo", body: "Mensajes mantiene el correo en vivo. Conecta Gmail mediante Google OAuth o un buzón IMAP; puedes leer, responder y convertir un email en tarea o evento. El correo no se copia al histórico empresarial cifrado.", icon: Mail },
  { title: "Suscripciones", body: "Apunta lo que se te cobra solo: importe, cada cuánto, método de pago y etiquetas. Sus etiquetas son propias y no se mezclan con las de tareas: se gestionan con el botón «Etiquetas», junto al filtro. Kalendiario avisa antes de cada cargo (hasta tres avisos, a la hora que elijas) y tú confirmas si se pagó, si se omitió o por cuánto se cobró al final. El gasto real solo cuenta lo confirmado; la previsión va siempre aparte. Del método de pago se guarda un nombre y como mucho los cuatro últimos dígitos: nunca el número completo, el CVV ni una conexión con el banco.", icon: CreditCard },
  { title: "Nick y frase", body: "En Perfil, el generador de nicks decora tu nombre al estilo MSN: adornos, tipos de letra Unicode y símbolos, más color y negrita. Si seleccionas parte del texto y pulsas un color, se pinta solo ese trozo: así se hace un nick de varios colores. Sin nada seleccionado, el color va a todo el nick. Debajo puedes poner una frase corta (el subnick), que ven tus amigos del chat en su lista y en la cabecera de la conversación. Es un campo aparte: tu nombre de cuenta sigue igual para los correos y la recuperación de contraseña, y puedes quitar el nick cuando quieras.", icon: Wand2 },
  { title: "La ficha de un amigo", body: "Pulsa la foto de una persona en la cabecera del chat y verás su perfil: la foto en grande, su nick, su frase y si está conectada. Ahí mismo puedes bloquearle o eliminar la amistad, con su confirmación. La foto y el nombre son suyos, así que solo se miran.", icon: UserRound },
  { title: "Grupos del chat", body: "Pulsa la foto del grupo en la cabecera y se abre su ficha: la foto en grande, quiénes están dentro, añadir a alguien y, si lo creaste tú, sacar a quien haga falta. La foto la puede cambiar cualquier participante; el nombre y quitar a alguien, solo el que lo creó. Al renombrar tienes los mismos adornos y colores que en tu nick. El zumbido también llega a los grupos, con un margen de 2 minutos por persona para que no sea un caos. Cada quien tiene su propio silencio y su propio fondo dentro del mismo grupo.", icon: MessagesSquare },
  { title: "Escribiendo y foco", body: "Al abrir una conversación el cursor se pone solo en el campo de escribir (en ordenador; en el móvil no, para que el teclado no tape el chat). Mientras la otra persona escribe verás «escribiendo…» en la conversación y en la lista; no se guarda en ninguna parte y se apaga solo a los pocos segundos.", icon: MessageCircle },
  { title: "Notas, objetivos y Cofre", body: "Las notas admiten Markdown, vista previa y fotos. Hábitos viven dentro de Objetivos. Cofre cifra sus entradas en el navegador y nunca las expone a búsqueda, exportación ni Kalen.", icon: WalletCards },
  { title: "Navegador de escritorio", body: "En APP's, Navegador pide instalar el envoltorio de Windows si estás en el navegador o en la PWA. Dentro del .exe se integra un navegador HTTPS real (no un iframe), con controles de navegación y sin abrir otra ventana. En YouTube, K Focus permite reducir distracciones y abrir el vídeo flotante con Alt+P. En el iPhone se añade a la pantalla de inicio; el APK de Android llegará más adelante.", icon: Smartphone },
];

const MESSAGE_RULES: HelpItem[] = [
  { title: "Una conversación por cuenta", body: "Cada conexión de WhatsApp Business o Telegram Business pertenece a tu usuario. Los textos, identificadores y recibos se cifran en reposo; el histórico se conserva como máximo 90 días.", icon: ShieldCheck },
  { title: "Responder ahora", body: "Escribe un texto y Mensajes lo encola. El worker comprueba de nuevo la propiedad, la conexión, la ventana del proveedor y la idempotencia antes de enviarlo.", icon: MessageCircle },
  { title: "Programar con revisión", body: "Selecciona el mensaje citado, redacta el texto y revisa destinatario, cuenta, contenido, fecha y zona horaria. La confirmación exige la versión exacta que ves en pantalla.", icon: CheckCircle2 },
  { title: "Pausas y resultados dudosos", body: "Actividad nueva, edición o borrado del mensaje citado, o una respuesta enviada desde el móvil, pausa la programación. Si el proveedor devuelve un resultado ambiguo, pasa a atención y no se reintenta automáticamente.", icon: AlertTriangle },
  { title: "Ventana de 24 horas", body: "Si la ventana de respuesta se cierra, se conserva el borrador o se crea atención, pero no se envía tarde. Un trabajo que llega con más de cinco minutos de retraso tampoco se manda automáticamente.", icon: Clock3 },
  { title: "Adjuntos", body: "Se abren mediante un proxy autenticado, sin guardarlos localmente. Solo se aceptan tipos permitidos y hasta 10 MB; si el proveedor ya no los entrega, el archivo deja de estar disponible.", icon: ShieldCheck },
];

function HelpCards({ items }: { items: HelpItem[] }) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {items.map(({ title, body, icon: Icon }) => (
        <article key={title} className="rounded-2xl border border-border bg-surface/60 p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-text">
            <Icon aria-hidden="true" className="h-4 w-4 shrink-0 text-accent" />
            {title}
          </h3>
          <p className="mt-2 text-sm leading-6 text-muted">{body}</p>
        </article>
      ))}
    </div>
  );
}

function Steps({ items }: { items: string[] }) {
  return (
    <ol className="space-y-3 text-sm leading-6 text-muted">
      {items.map((item, index) => (
        <li key={item} className="flex gap-3">
          <span aria-hidden="true" className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent/15 text-xs font-semibold text-accent">{index + 1}</span>
          <span>{item}</span>
        </li>
      ))}
    </ol>
  );
}

export function Help() {
  return (
    <div className="page-shell">
      <PageHeader title="Ayuda" />
      <div className="space-y-6">
        <section className="card p-5" aria-labelledby="shortcuts-title">
          <h2 id="shortcuts-title" className="section-title mb-4"><Keyboard aria-hidden="true" className="h-4 w-4" />Atajos de teclado</h2>
          <ul className="space-y-2.5">
            {SHORTCUTS.map(({ keys, desc, icon: Icon }) => (
              <li key={keys} className="flex items-center justify-between gap-4">
                <span className="flex items-center gap-2 text-sm text-muted"><Icon aria-hidden="true" className="h-4 w-4 text-faint" />{desc}</span>
                <kbd className="rounded-lg border border-border bg-surface px-2 py-1 text-xs font-mono text-text">{keys}</kbd>
              </li>
            ))}
          </ul>
        </section>

        <section className="card p-5" aria-labelledby="basics-title">
          <h2 id="basics-title" className="card-title mb-4">Lo esencial de {APP_NAME}</h2>
          <HelpCards items={BASICS} />
        </section>

        <section className="card p-5" aria-labelledby="messages-title">
          <h2 id="messages-title" className="card-title flex items-center gap-2"><MessageCircle aria-hidden="true" className="h-5 w-5 text-accent" />Mensajes</h2>
          <p className="mt-2 text-sm leading-6 text-muted">Mensajes combina correo en vivo con canales empresariales por cuenta. Telegram para avisos y Telegram Business son flujos distintos: el primero habla con Kalen y envía avisos; el segundo muestra conversaciones del negocio.</p>
          <div className="mt-4"><HelpCards items={MESSAGE_RULES} /></div>

          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            <div className="rounded-2xl border border-border p-4">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-text"><Smartphone aria-hidden="true" className="h-4 w-4 text-accent" />Telegram Business</h3>
              <p className="mt-2 text-sm leading-6 text-muted">Cada cuenta usa su propio bot. Guarda su token en Ajustes → Telegram, activa el webhook y vincula tu chat antes de añadir ese bot desde los ajustes de Telegram Business.</p>
              <div className="mt-4"><Steps items={[
                "Crea un bot con BotFather, guarda el token y activa su webhook desde Ajustes → Telegram.",
                "Genera el enlace de vinculación y ábrelo con la cuenta correcta.",
                "Pulsa /start en Telegram y comprueba que el bot confirma la vinculación.",
                "En Telegram Business añade el bot como bot de negocio y concede las conversaciones necesarias.",
                "Vuelve a Mensajes: las conversaciones, ediciones y borrados aparecerán con su origen (cliente, móvil o bot).",
              ]} /></div>
            </div>
            <div className="rounded-2xl border border-border p-4">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-text"><Webhook aria-hidden="true" className="h-4 w-4 text-accent" />WhatsApp Business</h3>
              <p className="mt-2 text-sm leading-6 text-muted">Usa el Embedded Signup oficial de Meta en coexistencia con WhatsApp. El administrador prepara la app, la configuración de signup, el webhook y la versión Graph; cada usuario completa su propia conexión desde Mensajes.</p>
              <div className="mt-4"><Steps items={[
                "El administrador habilita el canal y configura la app Meta, el verify token y la versión Graph revisada.",
                "En Mensajes → Canales pulsa Conectar WhatsApp y completa Embedded Signup, seleccionando teléfono y WABA.",
                "Acepta los permisos en Meta y vuelve a Kalendiario; la conexión queda ligada a tu cuenta.",
                "Si quieres conservar la copia local, desconecta primero y luego usa Borrar datos locales; son acciones distintas.",
              ]} /></div>
            </div>
          </div>
        </section>

        <section className="card p-5" aria-labelledby="kalen-title">
          <h2 id="kalen-title" className="card-title flex items-center gap-2"><Bot aria-hidden="true" className="h-5 w-5 text-accent" />Kalen y proveedores de IA</h2>
          <p className="mt-2 text-sm leading-6 text-muted">Kalen no es un chatbot general: usa herramientas del servidor para tareas, eventos, recordatorios, proyectos, notas, hábitos, objetivos, radio, clima y fútbol. Si una acción no devuelve <code className="rounded bg-surface px-1.5 py-0.5 text-xs text-text">OK id=…</code>, no la des por guardada.</p>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div className="rounded-2xl border border-border p-4"><h3 className="text-sm font-semibold text-text">Configurar</h3><p className="mt-2 text-sm leading-6 text-muted">En Ajustes → Mascota activa Kalen, elige OpenCode, OpenRouter o Personalizado, selecciona modelo, pega tu clave y prueba. Las claves se cifran en el servidor y no vuelven al navegador; cada proveedor conserva su propia clave.</p></div>
            <div className="rounded-2xl border border-border p-4"><h3 className="text-sm font-semibold text-text">Mensajes con Kalen</h3><p className="mt-2 text-sm leading-6 text-muted">Solo prepara un borrador con los mensajes seleccionados y, opcionalmente, hasta 10 recientes. Antes de cada acción debes aceptar explícitamente el tratamiento empresarial con el proveedor. Kalen nunca confirma ni envía mensajes por su cuenta.</p></div>
            <div className="rounded-2xl border border-border p-4"><h3 className="text-sm font-semibold text-text">Proveedores personalizados</h3><p className="mt-2 text-sm leading-6 text-muted">Las URL de chat, modelos y uso deben ser HTTPS públicas y compatibles con OpenAI cuando el proveedor lo requiera. No pegues claves en notas, chats ni tickets.</p></div>
            <div className="rounded-2xl border border-border p-4"><h3 className="text-sm font-semibold text-text">Límites</h3><p className="mt-2 text-sm leading-6 text-muted">No abre Cofre, no programa código ni controla Telegram desde el chat. Clima usa Open-Meteo; fútbol necesita la clave opcional de football-data.org.</p></div>
          </div>
        </section>

        <section className="card p-5" aria-labelledby="integrations-title">
          <h2 id="integrations-title" className="card-title flex items-center gap-2"><HelpCircle aria-hidden="true" className="h-5 w-5 text-accent" />Integraciones y cuenta</h2>
          <ul className="mt-4 space-y-3 text-sm leading-6 text-muted">
            <li><strong className="text-text">Google/Gmail:</strong> el administrador registra una app OAuth; cada usuario puede conectar varios buzones y elegir cuál envía sus avisos. Para otros proveedores usa IMAP/SMTP con TLS.</li>
            <li><strong className="text-text">Spotify:</strong> Ajustes → Spotify usa PKCE; el permiso duradero queda cifrado en el servidor y el navegador solo conserva acceso breve en memoria. El reproductor interno requiere Premium.</li>
            <li><strong className="text-text">Avisos:</strong> además de interfaz, sonido y Web Push, puedes habilitar correo mediante tu buzón predeterminado. En Ajustes, «Activar avisos push» pide permiso, lanza un aviso de prueba y registra el navegador para cuando la pestaña esté cerrada.</li>
            <li><strong className="text-text">Perfil:</strong> cambia contraseña, 2FA, passkeys, sesiones, preferencias, zona horaria, ICS e importación/exportación. La Papelera permite restaurar o borrar permanentemente.</li>
            <li><strong className="text-text">Datos:</strong> la sesión usa cookie HttpOnly, las cuentas están aisladas y los adjuntos empresariales no se almacenan localmente. Desconectar un canal revoca credenciales y pausa sus respuestas pendientes.</li>
          </ul>
        </section>

        <section className="card p-5" aria-labelledby="admin-title">
          <h2 id="admin-title" className="card-title flex items-center gap-2"><ShieldCheck aria-hidden="true" className="h-5 w-5 text-accent" />Configuración de administrador</h2>
          <p className="mt-2 text-sm leading-6 text-muted">La configuración global vive en la base de datos y se administra aquí. Las variables del servidor solo sirven para la importación inicial; nunca pongas secretos en el cliente, README, logs o Git.</p>
          <div className="mt-4 overflow-x-auto rounded-xl border border-border">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-surface text-xs uppercase tracking-wide text-muted"><tr><th className="px-3 py-2">Canal</th><th className="px-3 py-2">Configuración</th><th className="px-3 py-2">Uso</th></tr></thead>
              <tbody className="divide-y divide-border text-muted">
                <tr><td className="px-3 py-3 font-medium text-text">Telegram Business</td><td className="px-3 py-3">Interruptor global</td><td className="px-3 py-3">Cada usuario registra y activa su propio bot.</td></tr>
                <tr><td className="px-3 py-3 font-medium text-text">WhatsApp Business</td><td className="px-3 py-3">App ID, App Secret, Configuration ID, Verify Token y versión Graph</td><td className="px-3 py-3">Embedded Signup, firma del webhook y Graph API.</td></tr>
                <tr><td className="px-3 py-3 font-medium text-text">Google, Spotify y SMTP</td><td className="px-3 py-3">Credenciales globales</td><td className="px-3 py-3">Los usuarios conectan después sus cuentas o buzones propios.</td></tr>
                <tr><td className="px-3 py-3 font-medium text-text">Kalen</td><td className="px-3 py-3">Ajustes → Mascota</td><td className="px-3 py-3">Proveedor, modelo, URLs HTTPS y claves cifradas por cuenta.</td></tr>
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs leading-5 text-muted">La versión Graph de Meta debe revisarse en cada release. Deshabilitar un proveedor es un corte global y no borra las conexiones de sus usuarios.</p>
        </section>

        <section className="card p-5" aria-labelledby="troubleshooting-title">
          <h2 id="troubleshooting-title" className="card-title flex items-center gap-2"><AlertTriangle aria-hidden="true" className="h-5 w-5 text-accent" />Si algo no funciona</h2>
          <ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-6 text-muted">
            <li><strong className="text-text">No llega Telegram:</strong> comprueba que el enlace no haya caducado, que el bot esté configurado y que /start haya confirmado la vinculación.</li>
            <li><strong className="text-text">WhatsApp no conecta:</strong> revisa Embedded Signup, teléfono/WABA, permisos y que la versión Graph y el webhook coincidan con la configuración de Meta.</li>
            <li><strong className="text-text">Una respuesta está pausada:</strong> abre el detalle y revisa si llegó actividad nueva, cambió el mensaje citado, hubo respuesta móvil, se cerró la ventana de 24 horas o el trabajo quedó obsoleto.</li>
            <li><strong className="text-text">Kalen no actúa:</strong> prueba la conexión, confirma proveedor/modelo y revisa la zona horaria. Para agenda, exige el identificador <code>OK id=…</code>.</li>
            <li><strong className="text-text">No llega correo:</strong> sin SMTP no funcionan bienvenida ni recuperación; en Gmail, el administrador debe tener OAuth y la cuenta debe estar autorizada.</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
