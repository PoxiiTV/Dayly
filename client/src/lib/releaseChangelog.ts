export interface ReleaseNote {
  title: string;
  body: string;
}

export interface ReleaseChangelog {
  version: string;
  notes: readonly ReleaseNote[];
}

export function sortReleaseChangelogDesc(changelog: readonly ReleaseChangelog[]): ReleaseChangelog[] {
  return [...changelog].sort((left, right) => compareReleaseVersions(right.version, left.version));
}

/** One entry per web version, kept separate for incremental display. */
export const RELEASE_CHANGELOG: readonly ReleaseChangelog[] = [
  {
    version: "1.0.142",
    notes: [
      { title: "Integraciones más sólidas", body: "WhatsApp, Telegram y Gmail con Google son más robustos: WhatsApp importa historial y contactos, avisa de envíos fallidos y usa plantillas fuera de las 24 horas; el asistente de Telegram solo responde a tu chat privado; y el acceso de Google es más seguro." },
      { title: "Integraciones en preparación", body: "El administrador puede mostrar una integración que aún no está lista como «Próximamente» u ocultarla del todo." },
    ],
  },
  {
    version: "1.0.141",
    notes: [
      { title: "Arrastre con animación", body: "Al arrastrar una tarjeta, se levanta y flota bajo el cursor con sombra, un hueco punteado marca dónde caerá, las demás se apartan con suavidad y al soltarla se encaja en su sitio. Escape cancela y cerca del borde la página se desplaza sola." },
    ],
  },
  {
    version: "1.0.140",
    notes: [
      { title: "Ordena las tarjetas a tu manera", body: "En el tablero puedes arrastrar las tarjetas (en el móvil, mantén pulsado y arrastra). Tu orden prevalece; las tareas nuevas entran arriba con el orden automático y «Orden automático» vuelve a ordenar por prioridad y fecha." },
      { title: "Aviso de urgentes a punto de vencer", body: "En Ajustes → Apariencia puedes activar un marco rojo pulsante para las tareas urgentes que vencen en menos de 2 horas, en el tablero y en la lista." },
    ],
  },
  {
    version: "1.0.139",
    notes: [
      { title: "Intro y a escribir", body: "Al abrir la tarea rápida con Intro se abre siempre en Tarea y el cursor queda en la descripción, listo para escribir." },
    ],
  },
  {
    version: "1.0.138",
    notes: [
      { title: "Menos ruido al crear proyecto o etiqueta", body: "Los botones «+ Nuevo» y «+ Nueva» pasan a ser un pequeño + junto al título Proyecto o Etiquetas." },
    ],
  },
  {
    version: "1.0.137",
    notes: [
      { title: "Modelo de tareas que no encaja con tu clave", body: "Si el modelo elegido para las tareas no funciona con tu API key (por ejemplo, un modelo gratis de Zen con una clave de OpenCode Go), la IA usa el modelo de la mascota en vez de fallar, y el mensaje explica el motivo." },
    ],
  },
  {
    version: "1.0.136",
    notes: [
      { title: "Modelo de IA propio para las tareas", body: "En Ajustes → Mascota puedes elegir un modelo solo para las tareas (título, descripción, subtareas, reprogramar y plan del día). Lo ideal es uno rápido; la mascota sigue con el suyo." },
      { title: "Color de la tarjeta en la cabecera", body: "En la ficha de la tarea, el color de la tarjeta está ahora junto a la X, y el título y la X de las ventanas quedan centrados en su barra." },
    ],
  },
  {
    version: "1.0.135",
    notes: [
      { title: "Tarea rápida desde la descripción", body: "Al abrir la tarea rápida el cursor va directo a la descripción: escribes, pulsas Intro y se guarda. El título es opcional; con IA se genera solo (con Deshacer) y sin IA se usan las primeras palabras." },
      { title: "Optimizar con IA", body: "Con clic derecho en una tarjeta, «Optimizar con IA» propone título, descripción resumida, subtareas, prioridad y, si no los habías puesto tú, proyecto y etiquetas. Marcas lo que quieras y se puede deshacer." },
      { title: "La IA entiende textos largos", body: "Descripciones largas o desordenadas ya no fallan: se resumen y ordenan conservando nombres, correos, cifras y fechas." },
      { title: "Reprogramar sin horas repetidas", body: "Las atrasadas se colocan en huecos libres de 9:00 a 19:00 según su duración, sin pisarse entre ellas ni con lo que ya tienes en la agenda." },
      { title: "El plan del día se queda", body: "El plan de Mi día se guarda hasta que acaba el día o generas otro, aunque cambies de pantalla." },
      { title: "Ficha de tarea", body: "Botón de IA en el título, color de la tarjeta elegible desde la propia tarea, notas internas más amplias y, con muchos proyectos, un desplegable en lugar de tantos botones." },
    ],
  },
  {
    version: "1.0.134",
    notes: [
      { title: "Reprogramar con IA siempre propone", body: "Las propuestas ya no se pierden si el modelo piensa demasiado o corta la respuesta: se aprovecha lo que envía y el resto se reparte automáticamente por prioridad, tres por día laborable." },
      { title: "IA más fiable con modelos que razonan", body: "Título, descripción, sugerencias y plan del día dejan más margen al modelo, ignoran su razonamiento interno y el plan del día tiene un orden de respaldo." },
    ],
  },
  {
    version: "1.0.133",
    notes: [
      { title: "Tarea rápida con IA", body: "En la tarea rápida, Intro pasa del título a la descripción e Intro de nuevo la crea. Si escribes una descripción, la IA le pone después un título claro y puedes deshacerlo." },
      { title: "Mejorar descripción", body: "El botón de estrellitas del campo Descripción la reescribe más clara y ordenada, sin añadir datos, con opción de deshacer." },
      { title: "Sugerencias mientras escribes", body: "La IA propone proyecto, etiquetas, prioridad y fecha como chips; solo se aplican al pulsarlos. También sugiere subtareas para añadir las que elijas." },
      { title: "Reprogramar atrasadas y plan del día", body: "Desde el aviso de atrasadas la IA propone nuevas fechas que revisas antes de aplicar, y en Mi día prepara un orden sugerido para el día." },
    ],
  },
  {
    version: "1.0.132",
    notes: [
      { title: "Fondo e intensidad en una fila", body: "En Apariencia, el selector de fondo y la intensidad comparten fila a partes iguales, con un deslizador más fino." },
    ],
  },
  {
    version: "1.0.131",
    notes: [
      { title: "Intensidad del fondo", body: "En Apariencia, un deslizador ajusta cuánto se ve el fondo: por debajo del 70 % se apaga (foto, imagen propia o color sólido) y por encima la foto gana presencia." },
    ],
  },
  {
    version: "1.0.130",
    notes: [
      { title: "Buscador más visible", body: "El buscador de tareas va primero, con el mismo ancho que las pestañas Todas, Hoy, Próximas… y un borde e icono destacados." },
      { title: "Aviso de atrasadas que se ve", body: "El aviso de tareas atrasadas es opaco, con borde rojo e icono sólido, y se lee bien sobre cualquier fondo de pantalla." },
    ],
  },
  {
    version: "1.0.129",
    notes: [
      { title: "Proyecto con su color", body: "La etiqueta del proyecto en tarjetas y lista usa el color sólido del proyecto, con texto claro u oscuro según convenga, y la fecha queda alineada con ella." },
      { title: "Filtros más ordenados", body: "El botón Filtros va a la derecha junto al cambio de vista y el selector de proyectos es más ancho para leerse entero." },
    ],
  },
  {
    version: "1.0.128",
    notes: [
      { title: "Tablero de tareas más despejado", body: "Las tarjetas son algo más anchas y tienen más separación entre sí y por dentro, para que el tablero respire y no agobie." },
    ],
  },
  {
    version: "1.0.127",
    notes: [
      { title: "Franja de prioridad en las tarjetas", body: "Cada tarjeta lleva arriba una franja del color de su prioridad con el nombre bien legible; la fecha queda sobre el separador y proyecto y etiquetas van en el pie." },
      { title: "Iconos que se colorean", body: "Al pasar el ratón, aplazar, pomodoro y editar se pintan con su color para distinguirlos mejor." },
      { title: "Títulos largos sin cortar el flujo", body: "Si escribes una tarea muy larga y pulsas Intro, el título se queda en unas cinco líneas y el resto pasa automáticamente a la descripción." },
    ],
  },
  {
    version: "1.0.126",
    notes: [
      { title: "Tarjetas de tareas mejor alineadas", body: "La prioridad y la fecha van arriba, después el título con su descripción y etiquetas, y el proyecto con las acciones queda siempre al pie, a la misma altura en toda la fila." },
    ],
  },
  {
    version: "1.0.125",
    notes: [
      { title: "Tarjetas pintadas con el color del proyecto", body: "En Apariencia puedes pintar el fondo completo de las tarjetas de tareas con el color de su proyecto; el texto cambia a claro u oscuro para leerse siempre bien." },
      { title: "Clic derecho en una tarjeta", body: "Cada tarjeta puede seguir el ajuste general, quedarse sin color, usar el color del proyecto u otro color, y desde el mismo menú se puede eliminar con confirmación y deshacer." },
    ],
  },
  {
    version: "1.0.124",
    notes: [
      { title: "Burbuja que sigue al ratón", body: "La burbuja nativa se arrastra con el movimiento del propio Windows, pegada al puntero y sin volver a su posición anterior." },
      { title: "El chat se abre junto a la burbuja", body: "El panel se despliega al lado de la burbuja, hacia el centro de la pantalla, y al minimizarlo la burbuja vuelve a su sitio en lugar de irse abajo a la derecha." },
      { title: "Nuevo aspecto de la burbuja", body: "La burbuja muestra el avatar a pantalla completa con aro blanco, sombra suave y el contador de no leídos en rojo." },
    ],
  },
  {
    version: "1.0.123",
    notes: [
      { title: "Burbuja estable al moverla", body: "La burbuja nativa conserva su posición visual durante arrastres consecutivos y al abrir el panel, sin saltar a coordenadas antiguas." },
      { title: "Superficie más limpia", body: "La burbuja usa un fondo blanco sin sombra para integrarse mejor con la ventana flotante." },
    ],
  },
  {
    version: "1.0.122",
    notes: [
      { title: "GIF solo al pulsar", body: "El selector de GIF solo envía el GIF al hacer clic o tocarlo; el foco de teclado no puede mandarlo por accidente y vuelve al campo de búsqueda." },
      { title: "Imágenes y adjuntos a tamaño grande", body: "Las imágenes y GIF de las conversaciones, además de los adjuntos de tareas y notas, se abren en un visor ampliado con cierre accesible." },
      { title: "Tarea rápida con errores claros", body: "La creación rápida valida títulos, fechas y horas, límites, subtareas y rangos; los errores del servidor aparecen junto al campo que hay que corregir." },
    ],
  },
  {
    version: "1.0.121",
    notes: [
      { title: "Burbuja nativa libremente arrastrable", body: "La burbuja nativa de Windows se puede arrastrar libremente por la pantalla y conserva su posición entre usos." },
      { title: "Cerrar desde el menú nativo", body: "Con clic derecho, la burbuja abre el menú nativo de Windows con la acción «Cerrar». Estas dos acciones requieren el shell 1.0.20; el shell 1.0.19 conserva la ventana nativa anterior sin ellas y navegador o shells anteriores a 1.0.19 mantienen el portal flotante web." },
    ],
  },
  {
    version: "1.0.120",
    notes: [
      { title: "Una burbuja para el chat", body: "La misma conversación se abre en el portal flotante web y, con el soporte nativo de shell 1.0.19, también en una ventana siempre visible de Windows. El portal web conserva el fallback en navegador y shells anteriores a 1.0.19; esos shells no ofrecen la ventana nativa. Se recuerdan la conversación y la posición, pero la superficie arranca cerrada tras recargar o reiniciar." },
      { title: "Sin chats duplicados", body: "El chat fijado al sidebar se suprime temporalmente para evitar dos superficies. El selector de GIF se comparte entre el chat completo y la burbuja." },
      { title: "Cierre seguro", body: "El PIN oculta temporalmente la superficie durante el bloqueo y solo la restaura después de desbloquearla; la bandeja la oculta temporalmente hasta volver. Cerrar explícitamente la burbuja la desactiva y devuelve el chat fijado al sidebar." },
    ],
  },
  {
    version: "1.0.119",
    notes: [
      { title: "Chat fijado más compacto", body: "El chat anclado conserva el selector con avatar y nick, elimina la cabecera duplicada y deja más espacio para la conversación." },
      { title: "Enviar y zumbido siempre a mano", body: "El compositor empieza en una sola línea, crece al escribir varias líneas y coloca el zumbido encima de Enviar. GIF y ayuda se mantienen fuera del modo compacto." },
    ],
  },
  {
    version: "1.0.118",
    notes: [
      { title: "Chat fijado más cómodo", body: "El compositor aprovecha mejor el ancho: Enviar queda integrado en el campo, desaparecen el acceso a GIF y la ayuda de teclado que no aportaban en el sidebar, y se conserva el acceso a adjuntos y zumbidos." },
      { title: "Conversaciones reconocibles de un vistazo", body: "El selector del chat fijado muestra la foto de perfil y el nick con sus colores tanto en la conversación activa como en la lista." },
      { title: "Más altura útil", body: "Ayuda deja de ocupar una fila del sidebar mientras el chat está fijado y sigue disponible desde la cabecera de Ajustes." },
    ],
  },
  {
    version: "1.0.117",
    notes: [
      { title: "Nubo es una nube y vuelve Posti", body: "Nubo adopta su aspecto de nube kawaii con un tamaño consistente, y el antiguo post-it regresa como una sexta mascota llamada Posti. Los perfiles antiguos de Habi pasan a Nubo sin perder la configuración." },
      { title: "Chat fijado al sidebar", body: "Ajustes → Chat permite dejar una conversación disponible en la barra izquierda, cambiar de conversación desde un selector y abrir el chat completo cuando haga falta. El chat y la mascota fijados se excluyen entre sí para conservar espacio." },
      { title: "Apps plegables sin añadir scroll", body: "El bloque Apps vuelve a quedar justo después de Secciones y puede plegarse para dar más espacio al chat, mientras el chat permanece junto a la parte inferior con separación visual de Ayuda." },
      { title: "Calendario con colores de etiquetas", body: "Eventos y tareas usan el color de sus etiquetas; cuando hay varias, muestran un degradado y ajustan automáticamente el contraste para mantener el texto legible." },
      { title: "Mascotas siempre visibles", body: "Las mascotas flotantes y ancladas se renderizan por encima de los paneles para que no puedan quedar ocultas detrás del contenido." },
    ],
  },
  {
    version: "1.0.116",
    notes: [
      { title: "Cabecera del calendario más fina", body: "La fila de días del calendario deja de ocupar espacio de más y adopta el color de acento del tema para mantener el contraste en claro y oscuro." },
      { title: "Historial siempre en orden", body: "El changelog muestra las versiones de más nueva a más antigua aunque las entradas se hayan añadido en otro orden." },
    ],
  },
  {
    version: "1.0.115",
    notes: [
      { title: "Avisos de tareas en el momento justo", body: "Las tareas con hora avisan al comenzar, sin avisos automáticos para tareas sin hora. Los avisos se deduplican, enlazan con la tarea y permiten posponerla 10 minutos." },
      { title: "Avisos adaptados a cada ventana", body: "La app visible usa un aviso interno; el navegador puede usar Web Push desde Ajustes y el shell Windows muestra avisos nativos cuando queda oculto en la bandeja." },
    ],
  },
  {
    version: "1.0.20",
    notes: [
      { title: "Calendario más práctico", body: "Ahora puedes crear elementos desde un día o con «Añadir aquí» en un evento, y eliminar tareas con confirmación." },
      { title: "Días más claros", body: "Los días anteriores aparecen atenuados y el día actual queda destacado con un fondo verde visible en claro y oscuro." },
      { title: "Timeline de Mi día reparado", body: "Las tareas con hora vuelven a aparecer en su posición temporal junto a los eventos." },
      { title: "Actualizaciones automáticas", body: "La aplicación detecta una versión nueva y recarga el shell para evitar que se quede una interfaz antigua en caché." },
    ],
  },
  {
    version: "1.0.21",
    notes: [
      { title: "Indicador de actualización", body: "Cuando hay una nueva versión disponible, aparece un botón junto al cambio de tema para aplicarla cuando quieras." },
    ],
  },
  {
    version: "1.0.22",
    notes: [
      { title: "Arrastra para cambiar de día", body: "Puedes mover eventos, tareas y recordatorios entre días desde Mes, Semana o Día. Se conserva la hora y la duración; las repeticiones quedan protegidas." },
    ],
  },
  {
    version: "1.0.23",
    notes: [
      { title: "Actualización realmente limpia", body: "Al pulsar Actualizar, Kalendiario retira la versión antigua y vacía su caché antes de cargar la nueva, como un refresco fuerte del navegador." },
    ],
  },
  {
    version: "1.0.24",
    notes: [
      { title: "Avisos de Telegram en tareas", body: "Las tareas pueden activar o desactivar el aviso de Telegram y las tareas atrasadas se pueden aplazar un día." },
      { title: "Panel de tareas más compacto", body: "La lista de tareas aprovecha mejor el espacio y mantiene las acciones importantes a mano." },
    ],
  },
  {
    version: "1.0.25",
    notes: [
      { title: "Navegador integrado", body: "La aplicación de Windows puede abrir páginas HTTPS dentro de la ventana principal desde el menú Navegador, con controles de navegación y sin ventanas extra." },
      { title: "Instalador de Windows", body: "Desde el modal de instalación puedes descargar el instalador de Kalendiario cuando hayas iniciado sesión." },
    ],
  },
  {
    version: "1.0.26",
    notes: [
      { title: "Navegador dentro de Kalendiario", body: "El navegador integrado ocupa el área central de la ventana principal del shell, conserva la navegación lateral y ya no abre una ventana nativa aparte." },
    ],
  },
  {
    version: "1.0.27",
    notes: [
      { title: "Navegador persistente", body: "Al cambiar de sección, el navegador se oculta sin detener el audio ni perder la página; al volver, continúa donde estaba." },
      { title: "Actualizaciones de Windows", body: "La aplicación de escritorio avisa cuando existe un instalador más reciente y ofrece descargarlo." },
      { title: "Barra más legible", body: "La barra y el campo de dirección usan fondos opacos para que el fondo de Kalendiario no interfiera con su lectura." },
    ],
  },
  {
    version: "1.0.28",
    notes: [
      { title: "YouTube sin distracciones", body: "La app de Windows añade controles para ocultar Shorts, recomendaciones, comentarios y reproducción automática dentro de YouTube." },
      { title: "Vídeo flotante", body: "Desde K Focus o con Alt+P puedes mantener el vídeo encima de otras ventanas, moverlo y cambiar su tamaño." },
      { title: "Descarga de actualizaciones reparada", body: "El aviso de Windows guarda y verifica el nuevo instalador mostrando claramente el progreso o cualquier error." },
    ],
  },
  {
    version: "1.0.29",
    notes: [
      { title: "PiP vuelve a tu agenda", body: "Al activar el vídeo flotante, el navegador se oculta y reaparece el panel de Kalendiario que estabas usando, sin perder su estado." },
      { title: "Navegación más clara", body: "Mientras el navegador está abierto, es el único elemento seleccionado y cualquier sección de la barra lateral permite volver incluso si ya estaba abierta." },
      { title: "Actualización integrada", body: "La app de Windows descarga, verifica y abre automáticamente el instalador de las nuevas versiones." },
    ],
  },
  {
    version: "1.0.30",
    notes: [
      { title: "Calendario más completo", body: "Las vistas de mes, semana, día y agenda muestran eventos, tareas y recordatorios, incluidos los que no tienen hora final." },
      { title: "Revisar y editar al pulsar", body: "Pulsa cualquier elemento del calendario para abrir sus datos, editarlos y ver el cambio reflejado al instante." },
      { title: "Solapamientos visibles", body: "Los elementos que coinciden en la misma franja horaria se distribuyen en columnas para que todos sigan siendo accesibles." },
    ],
  },
  {
    version: "1.0.31",
    notes: [
      { title: "Aviso de actualización de Windows", body: "La app de escritorio detecta el envoltorio 1.0.4 y ofrece descargarlo e instalarlo con su firma verificada." },
    ],
  },
  {
    version: "1.0.32",
    notes: [
      { title: "Versión del escritorio a la vista", body: "Junto a la versión de la app aparece la del programa de Windows instalado, para comprobar de un vistazo si una actualización se aplicó." },
      { title: "Avisos de actualización fiables", body: "El aviso de nueva versión pregunta al propio programa qué tiene instalado, así que ya no reaparece ni falla cuando la actualización ya estaba puesta." },
    ],
  },
  {
    version: "1.0.33",
    notes: [
      { title: "Resultados de Spotify más anchos", body: "La lista de canciones y playlists se despliega al doble de ancho hacia la derecha, sin recortar los títulos largos." },
    ],
  },
  {
    version: "1.0.34",
    notes: [
      { title: "Visualizador de música", body: "En la app de Windows, el fondo puede animarse al ritmo de lo que suene en el equipo, ya sea la radio o Spotify." },
      { title: "Pantalla completa con Alt+V", body: "Abre el visualizador en su propia ventana para llevarlo a otro monitor; la barra espaciadora cambia de efecto." },
    ],
  },
  {
    version: "1.0.35",
    notes: [
      { title: "Visualizador arreglado", body: "La ventana del visualizador ya no se queda en blanco ni se bloquea: pinta desde el primer momento y siempre se puede cerrar con Esc o con su botón." },
    ],
  },
  {
    version: "1.0.36",
    notes: [
      { title: "El visualizador ya abre", body: "Se corrigió el bloqueo que dejaba la ventana en blanco y congelada al pulsar Alt+V." },
      { title: "También en el navegador", body: "La pantalla del visualizador se ve desde cualquier navegador, aunque solo la app de Windows puede analizar el sonido del equipo." },
    ],
  },
  {
    version: "1.0.37",
    notes: [
      { title: "Chat con tus amigos", body: "Nueva sección Chat: comparte tu código de amigo o invita por correo y habla con quien use esta misma instancia." },
      { title: "Zumbidos como en MSN", body: "Manda un zumbido y la ventana de la otra persona temblará, con su aviso y su sonido." },
      { title: "Avisos y no leídos", body: "El menú lateral muestra los mensajes pendientes y recibes aviso aunque tengas la app cerrada." },
    ],
  },
  {
    version: "1.0.38",
    notes: [
      { title: "El visualizador ya pinta", body: "Los efectos de MilkDrop se ejecutan en un marco aislado, así que ya se ven sin rebajar la seguridad del resto de la aplicación." },
    ],
  },
  {
    version: "1.0.39",
    notes: [
      { title: "Visualizador operativo", body: "Los efectos ya se cargan y responden; si algo falla, el propio visualizador lo dice en pantalla en vez de quedarse preparándose." },
    ],
  },
  {
    version: "1.0.40",
    notes: [
      { title: "El visualizador ya sigue la música", body: "El audio del equipo llega por fin a los efectos, y la barra espaciadora cambia de efecto aunque el ratón esté sobre el visualizador." },
      { title: "Ajustes de chat aparte", body: "El código de amigo y sus opciones tienen su propio apartado, fuera de Apariencia." },
    ],
  },
  {
    version: "1.0.41",
    notes: [
      { title: "Se acabó el «demasiadas peticiones»", body: "Cada sesión tiene ahora su propio margen, mucho más amplio, y si alguna vez se alcanza se recupera en un minuto en vez de en quince." },
      { title: "Chat instantáneo", body: "Los mensajes y los zumbidos llegan en el momento, sin esperar a la siguiente comprobación." },
      { title: "Aviso de chat junto al logo", body: "Un icono al lado del nombre muestra las solicitudes de amistad y las conversaciones por leer." },
      { title: "Zumbido con sonido propio", body: "El zumbido suena como debe, y el cuadro de escribir ocupa todo el ancho y crece con el texto." },
    ],
  },
  {
    version: "1.0.42",
    notes: [
      { title: "Etiqueta de versión", body: "Junto a la versión de la app ahora pone «shell» en lugar de «escritorio»." },
    ],
  },
  {
    version: "1.0.43",
    notes: [
      { title: "Zumbido de toda la vida", body: "Los zumbidos suenan con el clip original en lugar del sonido provisional." },
    ],
  },
  {
    version: "1.0.44",
    notes: [
      { title: "Historial de versiones", body: "Pulsa el número de versión bajo el nombre de la app para ver todo lo que ha ido cambiando, publicación a publicación." },
    ],
  },
  {
    version: "1.0.45",
    notes: [
      { title: "Móvil más despejado", body: "La radio y la calculadora ya no flotan sobre el contenido en el móvil." },
      { title: "Chat en el móvil", body: "El panel se ajusta a la pantalla: la conversación se desplaza con el dedo y el cuadro de escribir se queda siempre anclado abajo." },
    ],
  },
  {
    version: "1.0.46",
    notes: [
      { title: "Botón de crear en el centro", body: "En el móvil, el + vive ahora en mitad de la barra inferior, que se queda siempre fija y a mano mientras te mueves por la app." },
      { title: "Novedades a la medida de la pantalla", body: "Esta misma ventana ya no se sale del móvil: una sola columna, centrada y con el botón de cerrar siempre a la vista." },
    ],
  },
  {
    version: "1.0.47",
    notes: [
      { title: "El chat se oye estés donde estés", body: "En la app de escritorio, los mensajes y los zumbidos suenan aunque la ventana esté detrás, y el icono de la barra de tareas parpadea hasta que vuelves." },
      { title: "Elige el sonido del chat", body: "En Ajustes › Chat puedes escoger el tono de los mensajes nuevos, o dejarlo en silencio. Iremos añadiendo más." },
    ],
  },
  {
    version: "1.0.48",
    notes: [
      { title: "Nada se sale de la pantalla", body: "Calendario, Tareas y el resto de paneles se ajustan al ancho del móvil: las tiras de pestañas se deslizan solas y los botones bajan a su propia línea en vez de estirar la página." },
      { title: "Barra inferior a tu gusto", body: "Ahora es Dashboard, Calendario, crear, Tareas y Más, con acceso directo al resto de secciones. Al escribir se aparta para que el teclado no te coma la pantalla." },
    ],
  },
  {
    version: "1.0.49",
    notes: [
      { title: "El chat se pega al teclado", body: "Se acabó el hueco entre el cuadro de escribir y el teclado: la conversación crece justo lo que ocupaba la barra inferior y el mensaje queda pegado al teclado." },
    ],
  },
  {
    version: "1.0.50",
    notes: [
      { title: "Zumbido junto a enviar", body: "El botón de zumbido baja al cuadro de escribir, justo encima del de enviar, y deja de ocupar una fila entera de la conversación." },
      { title: "Chat más limpio", body: "Añadir amigo solo aparece en la lista de conversaciones, no dentro de un chat abierto." },
    ],
  },
  {
    version: "1.0.51",
    notes: [
      { title: "Emoticonos en el chat", body: "Botón nuevo sobre el de zumbido: los clásicos ordenados por caras, gestos, corazones y cosas, y se colocan donde tengas el cursor." },
      { title: "Hueco para los GIF", body: "El selector ya trae su pestaña de GIF, lista para cuando se conecte el proveedor de búsqueda." },
    ],
  },
  {
    version: "1.0.52",
    notes: [
      { title: "Tamaño del texto del chat", body: "Dos botones de zoom en la barra inferior de la conversación, junto a bloquear y eliminar, para agrandar o encoger los mensajes. Tu elección se recuerda." },
      { title: "Conversación a pantalla completa", body: "En el móvil, al abrir un chat la cabecera de la página desaparece y la conversación aprovecha ese espacio." },
    ],
  },
  {
    version: "1.0.53",
    notes: [
      { title: "Un fondo para cada chat", body: "Como en WhatsApp o Telegram: nueve fondos para distinguir de un vistazo con quién hablas. Se eligen desde el icono de imagen, junto al zoom, y solo los ves tú." },
    ],
  },
  {
    version: "1.0.54",
    notes: [
      { title: "El fondo viste todo el chat", body: "Ya no se queda en la zona de mensajes: cubre la conversación entera, cabecera y cuadro de escribir incluidos. La lista de la izquierda se mantiene neutra." },
      { title: "Fondos que no cansan", body: "Fuera los puntitos y la cuadrícula: ahora hay trama, curvas, panal, pétalo y pizarra, dibujados a muy bajo contraste." },
      { title: "Lista de conversaciones al día", body: "Tu foto y un buscador arriba, y cada chat muestra el último mensaje con su hora, o el día si es más antiguo." },
    ],
  },
  {
    version: "1.0.55",
    notes: [
      { title: "Panal en condiciones", body: "Los hexágonos del fondo Panal eran diminutos y parecían ruido. Ahora son tres veces más grandes y encajan sin costuras." },
    ],
  },
  {
    version: "1.0.56",
    notes: [
      { title: "Ocho fondos más, del estilo de Pizarra", body: "Tinta, Turquesa, Musgo, Rosa, Ámbar, Ciruela, Acero y Lino: un halo de luz suave sobre un fondo liso, sin patrones que distraigan. Veinte fondos en total." },
    ],
  },
  {
    version: "1.0.57",
    notes: [
      { title: "Confirmación de lectura", body: "Tus mensajes llevan un tick cuando salen y dos cuando la otra persona abre la conversación." },
      { title: "Silenciar y limpiar", body: "Los tres puntos de la conversación permiten silenciarla —ni sonido ni zumbidos— y limpiar el historial solo para ti." },
      { title: "Porcentajes correctos", body: "La calculadora ya hace lo que hace cualquiera: 100 + 21 % son 121. Con × y ÷ usa la fracción, como debe ser." },
      { title: "Secciones a tu gusto", body: "Un botón nuevo en el menú lateral permite ocultar las secciones que no uses, sin perderlas." },
      { title: "Zumbidos y arrastre en el escritorio", body: "El zumbido vuelve a temblar aunque el anterior llegara con la ventana detrás, y ya se pueden reordenar las secciones arrastrando dentro de la app." },
    ],
  },
  {
    version: "1.0.58",
    notes: [
      { title: "Zumbidos sin sobresaltos al volver", body: "Si la ventana no está delante, un zumbido solo suena y parpadea en la barra de tareas. El temblor queda para cuando estás en la app, y los zumbidos de hace rato ya no se reproducen al volver." },
    ],
  },
  {
    version: "1.0.59",
    notes: [
      { title: "Chat con las apps", body: "El chat pasa al bloque de APP'S del menú lateral, junto a la calculadora y Kontraseñas, y se lleva su contador de mensajes sin leer." },
    ],
  },
  {
    version: "1.0.60",
    notes: [
      { title: "Ctrl + Espacio esconde la app", body: "En la app de escritorio, Kalendiario se va junto al reloj: desaparece de la barra de tareas y se queda en silencio. El mismo atajo la trae de vuelta, y también un clic en su icono." },
      { title: "Reordenar arrastrando, por fin", body: "Las secciones y ahora también las APP'S del menú lateral se colocan arrastrando, y funciona igual en la web y en la app de escritorio." },
    ],
  },
  {
    version: "1.0.61",
    notes: [
      { title: "Tu menú lateral, en todas partes", body: "El orden de las secciones y de las APP'S, y lo que decidas ocultar, se guarda en tu cuenta: entra desde la web o desde otro equipo y lo encontrarás igual." },
      { title: "Panel de emojis y GIF", body: "El selector deja de ser un globo y se abre como un panel a la derecha de la conversación, al estilo Telegram, con sus pestañas. El zumbido sigue junto a enviar." },
    ],
  },
  {
    version: "1.0.62",
    notes: [
      { title: "GIF en el chat", body: "La pestaña GIF ya busca de verdad: escribe, elige y se envía a la conversación. También hay una selección al abrirla, sin buscar nada." },
      { title: "La clave, desde el panel admin", body: "La clave del proveedor se guarda cifrada desde Administración y se puede rotar sin tocar el servidor. Las búsquedas las hace el servidor: la clave nunca llega al navegador." },
    ],
  },
  {
    version: "1.0.63",
    notes: [
      { title: "Giphy y Klipy, en vez de Tenor", body: "Tenor dejó de dar claves nuevas. Ahora cada búsqueda pregunta a Giphy y a Klipy y mezcla lo que traen, así que si una agota su cuota la otra sigue respondiendo. Las dos claves se ponen y se rotan desde el panel de administración." },
      { title: "GIF favoritos", body: "La estrella de cada GIF lo guarda en tu cuenta, hasta 50. Al abrir la pestaña aparecen los tuyos primero, están en cualquier dispositivo y no gastan ni una búsqueda." },
    ],
  },
  {
    version: "1.0.64",
    notes: [
      { title: "Encender y apagar cada proveedor", body: "Giphy y Klipy tienen ahora su propio interruptor en Administración: puedes apagar uno sin perder su clave, por ejemplo si agota su cuota del mes." },
      { title: "El panel se queda abierto", body: "Enviar un emoji o un GIF ya no cierra el panel lateral. Se abre y se cierra solo cuando tú quieres." },
      { title: "Guardar los GIF del chat", body: "Los GIF que envías o recibes llevan su estrella: puedes guardarlos en favoritos sin volver a buscarlos." },
    ],
  },
  {
    version: "1.0.65",
    notes: [
      { title: "Enviar archivos por el chat", body: "Adjunta con el clip o pega con Ctrl+V: hasta 5 MB. Las imágenes se ven directamente en la conversación y el resto llega como archivo para guardar." },
      { title: "El servidor solo hace de puente", body: "Lo que envías viaja cifrado, se guarda una semana y se borra solo. Ni se acumula ni queda legible en el disco." },
      { title: "Panel de GIF más ancho", body: "Tres columnas de GIF, el bloque del chat algo más ancho, el botón abre directamente los GIF y el panel se queda como lo dejaste, también al cambiar de sección." },
    ],
  },
  {
    version: "1.0.66",
    notes: [
      { title: "El panel ya no aprieta la conversación", body: "Al abrir los GIF, el bloque del chat se ensancha por la derecha: la conversación se queda exactamente igual de ancha que estaba." },
      { title: "Compositor recogido", body: "Adjuntar, GIF, zumbido y enviar viven ahora dentro del propio cuadro de escribir, a la derecha, en vez de en una columna al lado." },
      { title: "Imágenes con marco fino", body: "Las imágenes y los GIF del chat llevan un borde de un pelo, igual por los cuatro lados, con la hora justo debajo." },
    ],
  },
  {
    version: "1.0.67",
    notes: [
      { title: "El cuadro de escribir crece contigo", body: "Escribe varias líneas y la caja se hace grande hasta cierto punto, con el texto dentro y los botones en su sitio. Al enviar vuelve a una línea." },
      { title: "La conversación no se mueve", body: "El bloque del chat queda anclado por la izquierda: abrir los GIF añade su columna a la derecha y deja la conversación donde estaba." },
      { title: "En el móvil, el panel se aparta", body: "Al enviar un GIF o un emoji desde el móvil, el panel se cierra y deja ver la conversación otra vez." },
    ],
  },
  {
    version: "1.0.68",
    notes: [
      { title: "Chat centrado otra vez", body: "El bloque del chat vuelve a ir centrado como el resto de la app; al abrir los GIF el conjunto se ensancha y la columna queda a la derecha." },
    ],
  },
  {
    version: "1.0.69",
    notes: [
      { title: "El chat se queda quieto", body: "El panel de GIF y emojis se abre sobre el lado derecho del bloque, sin mover ni estrechar nada: la conversación se queda exactamente donde estaba." },
    ],
  },
  {
    version: "1.0.70",
    notes: [
      { title: "El panel de GIF, a la derecha y sin tapar", body: "El bloque del chat queda clavado donde está y crece hacia la derecha para hacerle sitio al panel, que vuelve a ser una columna más: ni se mueve la conversación ni se tapa nada." },
    ],
  },
  {
    version: "1.0.71",
    notes: [
      { title: "Tareas en tarjetas", body: "Un interruptor junto a los filtros cambia entre la lista de siempre y un tablero de tarjetas tipo post-it, con su prioridad, fecha, etiquetas y acciones a mano. La app recuerda cuál prefieres." },
      { title: "Cambio de tema más ágil", body: "Con muchas tareas en pantalla, el cambio claro-oscuro se atascaba porque cada tarjeta animaba su color a la vez. Ahora el color cambia de golpe bajo la onda, que es la que da el efecto." },
      { title: "Colores del chat", body: "Tus mensajes van en el color de Kalen y los que recibes en el azul celeste de la prioridad normal." },
    ],
  },
  {
    version: "1.0.72",
    notes: [
      { title: "Fondos de chat con más color", body: "En tema claro apenas se distinguían del blanco; ahora tienen color de verdad, y el selector ya no se abre por detrás del panel de GIF." },
      { title: "Móvil más aprovechado", body: "Fuera la cabecera vacía del chat y de tareas: en tareas, Etiquetas se va junto a Filtros y las tareas nuevas se crean con el + de la barra inferior, que abre el mismo formulario completo." },
    ],
  },
  {
    version: "1.0.73",
    notes: [
      { title: "Chat a pantalla completa en el móvil", body: "La conversación ocupa todo el ancho y todo el alto disponible, de la barra de arriba a la de abajo, sin fondo asomando por los lados." },
      { title: "Chat en la barra inferior", body: "La barra pasa a ser Dashboard, Tareas, crear, Chat y Más, con el contador de mensajes sin leer sobre el icono del chat." },
    ],
  },
  {
    version: "1.0.74",
    notes: [
      { title: "Una fila más de conversación en el móvil", body: "El tamaño del texto, el fondo, bloquear y eliminar pasan al menú de los tres puntos, y la flecha para volver se suma a la cabecera del chat." },
    ],
  },
  {
    version: "1.0.75",
    notes: [
      { title: "El menú del chat, por delante", body: "El desplegable de los tres puntos ya no queda por detrás de los GIF de la conversación." },
    ],
  },
  {
    version: "1.0.76",
    notes: [
      { title: "Chat sin barra de herramientas", body: "También en escritorio, el tamaño del texto, el fondo, bloquear y eliminar están en el menú de los tres puntos: el cuadro de escritura baja del todo y la conversación gana altura." },
      { title: "Lista de chats más estrecha", body: "La columna de conversaciones ocupa menos y deja más sitio a los mensajes." },
    ],
  },
  {
    version: "1.0.77",
    notes: [
      { title: "Chat a pantalla completa también en el ordenador", body: "La conversación ocupa toda la ventana, sin fondo alrededor y sin la cabecera con el botón grande de añadir amigo: se añade desde el botón que hay encima de la lista." },
      { title: "Botón de crear siempre visible", body: "El «+» flotante queda por encima de cualquier pantalla y el cuadro de escritura le deja sitio. La calculadora sale del dock: sigue en APP'S del menú lateral y en Alt+C." },
      { title: "Completa o compacta, tú eliges", body: "En Ajustes › Chat puedes dejar el panel a pantalla completa o volver a la tarjeta dentro de la página. Se guarda en cada dispositivo." },
    ],
  },
  {
    version: "1.0.78",
    notes: [
      { title: "Lista de chats plegable", body: "Un botón pliega la columna de conversaciones y deja solo las fotos, con el contador encima de cada una. Se recuerda cómo la dejaste." },
      { title: "Cabeceras a la misma altura", body: "Tu foto y tu nombre quedan alineados con los de la persona con la que hablas, y el buscador baja a su propio bloque." },
    ],
  },
  {
    version: "1.0.79",
    notes: [
      { title: "La columna dice lo que es", body: "Encima de las conversaciones hay un rótulo CHATS con su número, siempre visible aunque bajes por la lista, y el botón de añadir amigo a su derecha." },
      { title: "Un solo lenguaje para plegar", body: "El control de plegar la lista pasa al borde de su propia columna, igual y a la misma altura que el del menú lateral: dos límites de panel, un mismo gesto." },
    ],
  },
  {
    version: "1.0.80",
    notes: [
      { title: "Estados en el chat", body: "En línea, ausente o no disponible: se elige desde tu foto en la lista o en Ajustes, se ve junto al nombre de cada persona y «no disponible» silencia mensajes y zumbidos." },
      { title: "Modo claro menos blanco", body: "El fondo de todas las pieles claras baja un punto, así las tarjetas blancas se despegan del papel." },
      { title: "El chat vuelve al último mensaje", body: "Al entrar en una conversación la vista se pega abajo aunque haya imágenes cargando o cambie el tamaño de la ventana." },
    ],
  },
  {
    version: "1.0.81",
    notes: [
      { title: "Tu foto también con la lista plegada", body: "La columna plegada conserva arriba tu foto y tu estado, así la cabecera mide lo mismo que la de la conversación y las dos caras quedan en la misma línea." },
    ],
  },
  {
    version: "1.0.82",
    notes: [
      { title: "La flecha de plegar, a media altura", body: "Deja de estorbar arriba: ahora vive en el borde de la columna, a media altura, como el tirador de un panel." },
    ],
  },
  {
    version: "1.0.83",
    notes: [
      { title: "Raíl plegado centrado", body: "Con la lista plegada, tu foto y las de las conversaciones quedan centradas en la columna." },
    ],
  },
  {
    version: "1.0.84",
    notes: [
      { title: "Chats de grupo", body: "Crea un grupo desde la lista de chats, ponle nombre y elige a quién metes. Aparece junto al resto de conversaciones, con el nombre de quien escribe sobre cada mensaje." },
      { title: "Más participantes cuando quieras", body: "Desde los tres puntos del grupo puedes añadir gente, cambiar el nombre (quien lo creó) o salirte. Cada uno silencia, limpia y pone el fondo que quiera, sin tocar a los demás." },
      { title: "Todo lo del chat, también en grupo", body: "Emojis, GIF, imágenes y archivos de hasta 5 MB funcionan igual. El zumbido no: es cosa de dos." },
    ],
  },
  {
    version: "1.0.85",
    notes: [
      { title: "Menú lateral más limpio", body: "Ajustes pasa a ser una rueda junto al cambio de tema, y Perfil desaparece de la lista: se abre pulsando tu foto o tu nombre, que ahora es todo un mismo botón." },
      { title: "Cerrar sesión, en tu perfil", body: "Sale del menú y vive con el resto de opciones de la cuenta, al final de Perfil." },
      { title: "Bloque de administración sin título", body: "El rótulo ADMINISTRACIÓN desaparece; queda solo el acceso al panel." },
    ],
  },
  {
    version: "1.0.86",
    notes: [
      { title: "Favoritos en el navegador", body: "La estrella de la barra guarda la página, y el botón de al lado abre la lista para volver a ella, renombrarla o quitarla. Se guardan en tu cuenta, así que están en cualquier equipo." },
      { title: "Historial cifrado", body: "El navegador anota por dónde has pasado, con su hora, buscador y borrado de una entrada o de todo. Se guarda cifrado en el servidor y puedes apagarlo cuando quieras." },
      { title: "Página de inicio a tu gusto", body: "En Ajustes › Navegador eliges con qué página abre, con un botón para usar la que tengas delante; en la barra hay una casita para volver a ella." },
      { title: "La barra también busca", body: "Escribir algo que no es una dirección ya no da error: busca en DuckDuckGo." },
    ],
  },
  {
    version: "1.0.87",
    notes: [
      { title: "Salir por WARP desde el navegador", body: "Con la app de escritorio 1.0.13 aparece un escudo en la barra: si tienes Cloudflare WARP en modo proxy, el navegador integrado sale por él y el resto del equipo sigue igual. Si WARP no está escuchando, te lo dice en vez de dejar la página en blanco." },
      { title: "Borrar cookies y datos del navegador", body: "Desde el historial o desde Ajustes › Navegador. Cierra tus sesiones de las webs abiertas ahí, y no toca la sesión de Kalendiario." },
      { title: "El navegador, con su propio perfil", body: "Sus cookies dejan de compartirse con las de la app. La primera vez tendrás que volver a iniciar sesión en las webs que usaras dentro." },
    ],
  },
  {
    version: "1.0.88",
    notes: [
      { title: "El escudo entiende los dos modos de WARP", body: "Si tienes WARP en su modo normal, todo el equipo ya sale por Cloudflare y el escudo lo dice en verde en vez de quejarse de un proxy que no existe. Solo pide el modo proxy cuando quieres que sea únicamente el navegador, y te dice el comando." },
      { title: "Icono propio para la lista de favoritos", body: "Ya no son dos estrellas iguales: la estrella guarda la página y el marcador abre la lista." },
    ],
  },
  {
    version: "1.0.89",
    notes: [
      { title: "Favoritos e historial en un desplegable", body: "Dejan de ocupar la pantalla entera: se abren bajo su botón." },
    ],
  },
  {
    version: "1.0.90",
    notes: [
      { title: "Ctrl+Espacio vuelve a ocultar siempre", body: "Tras abrir el navegador integrado dejaban de responder el atajo, el icono de la bandeja y el botón de ocultar, hasta cerrar la app. Ya no." },
      { title: "El desplegable ya no descoloca la página", body: "Favoritos e historial se abren sobre el navegador sin mover ni un píxel de lo que hay debajo, y al cerrarlos la web sigue justo donde estaba." },
    ],
  },
  {
    version: "1.0.91",
    notes: [
      { title: "Favoritos e historial, en columna a la derecha", body: "Se abren y se cierran con su botón, como una barra lateral: la web se queda donde está y solo cede el ancho de la columna. Ni pantalla completa ni nada que baje." },
    ],
  },
  {
    version: "1.0.92",
    notes: [
      { title: "La radio del menú lleva al panel", body: "Pulsar el nombre de la emisora o de la canción abre el Dashboard, donde está la radio entera. El play y la estrella siguen haciendo lo suyo." },
      { title: "YouTube sin anuncios", body: "El navegador integrado salta el anuncio del reproductor en cuanto puede, lo silencia mientras dura y esconde los banners y las tarjetas patrocinadas. Siempre activado, sin nada que configurar. Necesita la app de escritorio 1.0.15." },
    ],
  },
  {
    version: "1.0.93",
    notes: [
      { title: "El anuncio de YouTube ya ni se carga", body: "En vez de saltarlo, se le quitan al reproductor los anuncios del propio dato que le llega con el vídeo: arranca directo, sin cuenta atrás ni botón de saltar. Lo de saltar queda solo por si algo se cuela. Necesita la app de escritorio 1.0.16." },
    ],
  },
  {
    version: "1.0.94",
    notes: [
      { title: "Títulos completos en el calendario", body: "Mantén el puntero un instante sobre un evento, tarea o recordatorio para ver su título completo y, cuando ayuda, su hora o ubicación." },
    ],
  },
  {
    version: "1.0.95",
    notes: [
      { title: "Suscripciones", body: "Una sección nueva para lo que se te cobra solo: importe, cada cuánto, con qué método y etiquetas. Te avisa antes de cada cargo y puedes confirmar lo pagado o lo omitido, así que el gasto real y la previsión nunca se mezclan." },
      { title: "Cuánto te cuesta al mes", body: "Kalendiario reparte cada suscripción entre los meses de su ciclo, de modo que una anual y una mensual se pueden comparar. Verás el coste mensual, lo pagado este año, la previsión a tres meses y la proyección anual, con desglose por etiqueta y por método de pago." },
      { title: "Métodos de pago sin riesgo", body: "Guarda solo un nombre, el tipo y, si quieres, los cuatro últimos dígitos. Nunca el número completo, el CVV ni una conexión con el banco." },
      { title: "El día 31 se respeta", body: "Una suscripción que se cobra el último día del mes cae en el 28 o el 29 en febrero y vuelve al 31 en marzo, sin irse arrastrando mes a mes." },
    ],
  },
  {
    version: "1.0.96",
    notes: [
      { title: "Las suscripciones tienen sus propias etiquetas", body: "«Ocio» o «Seguros» ya no se mezclan con las etiquetas de tareas: son dos listas independientes y cada una solo aparece donde toca. Si ya habías etiquetado alguna suscripción, sus etiquetas se conservan." },
      { title: "Botón de Etiquetas en Suscripciones", body: "Junto al desplegable de filtrado hay un botón para crear, renombrar, recolorear o eliminar las etiquetas de suscripciones. Borrar una quita la etiqueta, nunca la suscripción." },
    ],
  },
  {
    version: "1.0.97",
    notes: [
      { title: "Generador de nicks", body: "En Perfil tienes el generador de toda la vida: escribes tu nombre y eliges entre veinte adornos como ·°¤*(¯`★´¯)*¤°·, ocho tipos de letra (gótica, burbuja, doble, versalitas…) y un panel de símbolos para montártelo a mano. Puedes combinar adorno y letras, y elegir color y negrita." },
      { title: "Frase debajo del nick", body: "Vuelve el subnick del MSN: una frase corta bajo tu nombre que ven tus amigos del chat, en su lista y en la cabecera de la conversación." },
      { title: "Tu nombre de cuenta no se toca", body: "El nick es un campo aparte. Los correos de la cuenta, la recuperación de contraseña y el panel de administración siguen usando tu nombre real, así que puedes ponerte lo que quieras sin romper nada. Se quita con un botón y vuelve tu nombre." },
      { title: "Seguridad: un usuario ya no puede hacerse administrador", body: "Al revisar el perfil apareció que una petición de guardado admitía campos que no le correspondían, y con ello alguien podía cambiarse el rol o el estado de su propia cuenta. Ya solo se aceptan los campos del formulario, con pruebas que lo vigilan." },
    ],
  },
  {
    version: "1.0.98",
    notes: [
      { title: "Foto de grupo, y la cambia cualquiera", body: "Los grupos del chat ya tienen foto. La puede poner, cambiar o quitar cualquier participante, no solo quien creó el grupo: está en el menú de la conversación, en «Cambiar foto del grupo». Cambiar el nombre y sacar a alguien siguen siendo cosa del dueño." },
    ],
  },
  {
    version: "1.0.99",
    notes: [
      { title: "La pantalla de entrada, al día", body: "Se había quedado con una lista de hace muchas versiones: faltaban el chat entre usuarios y los grupos, las suscripciones, el navegador integrado, el visualizador, el nick y varias cosas más. Ahora están todas, repartidas en seis bloques en vez de una lista larga, y el panel se queda dentro de la pantalla en lugar de estirar la página." },
    ],
  },
  {
    version: "1.0.100",
    notes: [
      { title: "Abres un chat y ya puedes escribir", body: "Al pulsar una conversación el cursor se pone solo en el cuadro de escribir, sin tener que ir a buscarlo. En el móvil no, para que el teclado no te tape la conversación nada más entrar." },
      { title: "«Está escribiendo…»", body: "Cuando la otra persona está escribiendo lo ves bajo su nombre en la conversación y en la lista de chats, también en los grupos. No se guarda en ninguna parte: si cierra la pestaña a media frase, el aviso desaparece solo." },
    ],
  },
  {
    version: "1.0.101",
    notes: [
      { title: "Deshacer y editar, sin ir a buscarlo", body: "Al crear algo con Ctrl+K o el botón +, el aviso se queda unos segundos con «Editar» y «Deshacer». Editar te abre justo ese elemento, sin tener que dar con él en la lista; deshacer lo quita del todo, sin dejarlo en la papelera." },
      { title: "Deshacer al eliminar", body: "Al borrar una tarea, un evento, una nota o un proyecto, el aviso ofrece «Deshacer» y lo devuelve a su sitio. Los recordatorios no lo tienen: se borran del todo y no hay nada que restaurar." },
      { title: "Los avisos ya abren el elemento", body: "Pulsar una notificación de tarea o evento te lleva a su ficha abierta, no solo a la página, que es lo que hacía hasta ahora." },
    ],
  },
  {
    version: "1.0.102",
    notes: [
      { title: "El botón + también lo ofrece", body: "En la versión anterior «Editar» y «Deshacer» solo salían al crear con Ctrl+K. Ahora aparecen igual al crear desde el botón +, sea tarea, evento, nota, proyecto o recordatorio." },
      { title: "Deshacer al completar una tarea", body: "Si marcas una tarea por error, el aviso de «¡Tarea completada!» trae «Deshacer» y la devuelve al estado que tenía, no a pendiente a secas: una que estaba en curso vuelve a estar en curso." },
    ],
  },
  {
    version: "1.0.103",
    notes: [
      { title: "Zumbido en los grupos", body: "El rayo también está en las conversaciones de grupo: zumba a todos a la vez, con Ctrl+Shift+Z como siempre. Cada participante puede mandar uno cada dos minutos, así que nadie puede convertirlo en un martilleo, y el límite es de cada cual: que uno acabe de zumbar no te deja a ti sin poder avisar." },
    ],
  },
  {
    version: "1.0.104",
    notes: [
      { title: "Adornos también en el nombre del grupo", body: "Al cambiar el nombre de un grupo tienes «Ponerle adornos»: las mismas plantillas, tipos de letra y símbolos del generador de nicks, con un contador para no pasarte de los 60 caracteres." },
    ],
  },
  {
    version: "1.0.105",
    notes: [
      { title: "Nicks multicolor", body: "Selecciona un trozo del nick y dale a un color: solo se pinta ese trozo. Repítelo y tienes el nick de varios colores de toda la vida. Sin seleccionar nada, el color se aplica a todo." },
      { title: "Colores también en el nombre del grupo", body: "El diálogo de renombrar un grupo trae ya la fila de colores, con la misma vista previa y el mismo truco de pintar solo lo que selecciones." },
    ],
  },
  {
    version: "1.0.106",
    notes: [
      { title: "La ficha del grupo", body: "Pulsa la foto del grupo en la cabecera y se abre su ficha: la foto en grande, quién está dentro y quién lo creó. Desde ahí añades a alguien, y si el grupo es tuyo, sacas a quien haga falta." },
      { title: "La foto, a tamaño de verdad", body: "Dentro de la ficha, pulsar la foto la muestra en grande sobre fondo oscuro. Se cierra con Escape o pulsando fuera, sin cerrar la ficha." },
    ],
  },
  {
    version: "1.0.107",
    notes: [
      { title: "También la ficha de una persona", body: "Pulsa la foto de un amigo en la cabecera del chat y se abre su perfil: la foto en grande, su nick con sus colores, su frase y si está en línea. Desde ahí puedes bloquearle o eliminar la amistad." },
      { title: "Igual para grupos y para personas", body: "Las dos fichas se abren del mismo modo, desde la foto de la cabecera o desde el menú de la conversación." },
    ],
  },
  {
    version: "1.0.108",
    notes: [
      { title: "Bloqueo rápido con PIN", body: "Puedes proteger la aplicación con un PIN de cuatro cifras desde Ajustes. Si lo activas, se pide al abrir Kalendiario y al volver desde la ventana rápida de Ctrl+Espacio." },
      { title: "Cambia o elimina tu PIN", body: "Ajustes permite cambiar el PIN, desactivarlo temporalmente o eliminarlo por completo. El PIN se guarda protegido y no sustituye a la contraseña de tu cuenta." },
    ],
  },
  {
    version: "1.0.109",
    notes: [
      { title: "El PIN recibe el foco al volver", body: "Al regresar desde la ventana rápida de Ctrl+Espacio, el campo del PIN recupera el foco automáticamente aunque el WebView tarde un instante en volver a estar activo." },
    ],
  },
  {
    version: "1.0.110",
    notes: [
      { title: "El foco vuelve de verdad", body: "Al volver desde Ctrl+Espacio, el shell devuelve el foco al WebView principal después de ocultar el navegador embebido. Así puedes escribir el PIN directamente al recuperar la aplicación." },
    ],
  },
  {
    version: "1.0.111",
    notes: [
      { title: "Ajustes mucho mejor ordenados", body: "General, apariencia, sonido, chat, mascota, navegador e integraciones se agrupan ahora en acordeones claros, con enlaces directos y sin perder cambios al pasar de una sección a otra." },
      { title: "Orbi llega desde otra galaxia", body: "La familia de mascotas suma un extraterrestre kawaii con expresiones propias para acompañarte mientras exploras ideas y planes." },
    ],
  },
  {
    version: "1.0.112",
    notes: [
      { title: "Ajustes también puede descansar", body: "Ahora puedes plegar el último bloque abierto y dejar todos los ajustes cerrados. Un clic vuelve a abrir solo lo que necesitas." },
      { title: "Amistades desde el grupo", body: "Desde la ficha de un grupo puedes pedir amistad directamente a cualquiera de sus participantes, sin copiar códigos ni introducir correos." },
    ],
  },
  {
    version: "1.0.114",
    notes: [
      { title: "Orbi se queda en su cara", body: "El extraterrestre ahora comparte el formato del resto de mascotas: una cara gris kawaii, con sus expresiones propias y sin cuerpo." },
    ],
  },
  {
    version: "1.0.113",
    notes: [
      { title: "La mascota vive en tus Apps", body: "Desde Ajustes → Mascota puedes dejar un chat compacto siempre abierto entre tus aplicaciones y Ayuda para escribirle en cualquier momento." },
    ],
  },
];

type ParsedVersion = readonly [number, number, number];

export function parseReleaseVersion(value: string): ParsedVersion | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(value.trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

export function compareReleaseVersions(left: string, right: string): number {
  const a = parseReleaseVersion(left);
  const b = parseReleaseVersion(right);
  if (!a || !b) return 0;
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index]! > b[index]! ? 1 : -1;
  }
  return 0;
}

/** Return only releases after lastSeenVersion and up to currentVersion. */
export function getPendingReleaseChangelog(
  currentVersion: string,
  lastSeenVersion: string | null,
  changelog: readonly ReleaseChangelog[] = RELEASE_CHANGELOG,
): readonly ReleaseChangelog[] {
  if (!parseReleaseVersion(currentVersion)) return [];
  const lastSeen = lastSeenVersion && parseReleaseVersion(lastSeenVersion) ? lastSeenVersion : null;
  if (!lastSeen) {
    return changelog.filter((release) => release.version === currentVersion && release.notes.length > 0);
  }
  return changelog
    .filter((release) => (
      release.notes.length > 0
      && compareReleaseVersions(release.version, currentVersion) <= 0
      && (!lastSeen || compareReleaseVersions(release.version, lastSeen) > 0)
    ))
    .sort((left, right) => compareReleaseVersions(left.version, right.version));
}
