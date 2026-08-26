/* eslint-disable no-console */
/**
 * Showcase seed for the shared demo account (demo@diario.dev / Demo123456).
 * Fills every section of the app with plausible sample data so anyone can
 * log in and see what the product offers.
 *
 * Run: npm run db:seed:demo        (safe to repeat; skips if data exists)
 *      npm run db:seed:demo -- --reset   (wipes this user's data first)
 *
 * Independent from SEED_DEMO: it only touches the demo@diario.dev user.
 */
import { PrismaClient, RoleName, TaskStatus, Priority, ProjectStatus, ThemePreference } from "@prisma/client";
import { hashPassword } from "../src/lib/crypto.js";

const prisma = new PrismaClient();
const DEMO_EMAIL = "demo@diario.dev";
const reset = process.argv.includes("--reset");

async function main() {
  const userRole = await prisma.role.findUniqueOrThrow({ where: { name: RoleName.USER } });
  const passwordHash = await hashPassword("Demo123456");

  const demoUser = await prisma.user.upsert({
    where: { emailLower: DEMO_EMAIL },
    update: {},
    create: {
      email: DEMO_EMAIL,
      emailLower: DEMO_EMAIL,
      name: "Demo",
      passwordHash,
      roleId: userRole.id,
      emailVerifiedAt: new Date(),
      theme: ThemePreference.SYSTEM,
    },
  });
  const uid = demoUser.id;

  const existingTasks = await prisma.task.count({ where: { userId: uid } });
  if (existingTasks > 0 && !reset) {
    console.log(`El usuario ${DEMO_EMAIL} ya tiene datos (${existingTasks} tareas). Usa --reset para regenerarlos.`);
    return;
  }
  if (existingTasks > 0 && reset) {
    // Children cascade from these parents (see schema onDelete rules).
    await prisma.timeEntry.deleteMany({ where: { userId: uid } });
    await prisma.habitLog.deleteMany({ where: { userId: uid } });
    await prisma.habit.deleteMany({ where: { userId: uid } });
    await prisma.task.deleteMany({ where: { userId: uid } });
    await prisma.reminder.deleteMany({ where: { userId: uid } });
    await prisma.event.deleteMany({ where: { userId: uid } });
    await prisma.note.deleteMany({ where: { userId: uid } });
    await prisma.noteFolder.deleteMany({ where: { userId: uid } });
    await prisma.goal.deleteMany({ where: { userId: uid } });
    await prisma.inboxItem.deleteMany({ where: { userId: uid } });
    await prisma.project.deleteMany({ where: { userId: uid } });
    await prisma.recurrence.deleteMany({ where: { userId: uid } });
    await prisma.tag.deleteMany({ where: { userId: uid } });
    console.log("Datos anteriores del usuario demo eliminados.");
  }

  // ---------- Helpers ----------
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  function at(base: Date, h: number, m: number) {
    return new Date(base.getFullYear(), base.getMonth(), base.getDate(), h, m, 0, 0);
  }
  function addDays(d: Date, days: number) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
  }

  // ---------- Tags ----------
  const tags: Record<string, string> = {};
  for (const t of ["Trabajo", "Personal", "Casa", "Estudio", "Ideas", "Urgente"]) {
    const rec = await prisma.tag.create({ data: { userId: uid, name: t } });
    tags[t] = rec.id;
  }

  // ---------- Projects ----------
  const web = await prisma.project.create({
    data: {
      userId: uid, name: "Rediseño web djhummer.es",
      description: "Nueva imagen, portfolio y contacto para la web del DJ.",
      color: "#6366f1", status: ProjectStatus.ACTIVE,
      startDate: addDays(today, -20), dueDate: addDays(today, 25),
    },
  });
  const flat = await prisma.project.create({
    data: {
      userId: uid, name: "Piso nuevo",
      description: "Mudanza, muebles y puesta en marcha del piso.",
      color: "#f59e0b", status: ProjectStatus.ACTIVE,
      startDate: addDays(today, -10), dueDate: addDays(today, 60),
    },
  });
  await prisma.project.create({
    data: {
      userId: uid, name: "Curso de Ableton",
      description: "Terminar el curso de producción musical.",
      color: "#10b981", status: ProjectStatus.COMPLETED,
      startDate: addDays(today, -90), dueDate: addDays(today, -7),
    },
  });

  // ---------- Weekly recurrence (lunes 9:00) ----------
  const weekly = await prisma.recurrence.create({
    data: { userId: uid, frequency: "WEEKLY", interval: 1, byDay: ["MO"], timezone: "Europe/Madrid" },
  });

  // ---------- Tasks ----------
  const overdue = await prisma.task.create({
    data: {
      userId: uid, title: "Renovar el dominio del hosting",
      description: "Caduca esta semana; renovar antes de que se caiga la web.",
      dueDate: addDays(today, -2), priority: Priority.URGENT, status: TaskStatus.IN_PROGRESS,
      projectId: web.id, estimateMinutes: 30, timeSpentMinutes: 15,
      tags: { connect: [{ id: tags["Urgente"] }, { id: tags["Trabajo"] }] },
    },
  });
  await prisma.task.create({
    data: {
      userId: uid, title: "Preparar presentación del proyecto",
      description: "Diapositivas con estado actual y siguientes pasos.",
      dueDate: today, priority: Priority.HIGH, projectId: web.id, estimateMinutes: 120,
      tags: { connect: [{ id: tags["Trabajo"] }] },
    },
  });
  const emails = await prisma.task.create({
    data: {
      userId: uid, title: "Responder emails pendientes",
      dueDate: today, priority: Priority.URGENT, status: TaskStatus.IN_PROGRESS, estimateMinutes: 30,
    },
  });
  await prisma.task.create({
    data: {
      userId: uid, title: "Sacar entradas para el concierto",
      dueDate: today, priority: Priority.NORMAL,
      tags: { connect: [{ id: tags["Personal"] }] },
    },
  });
  await prisma.task.create({
    data: {
      userId: uid, title: "Regar las plantas",
      dueDate: today, priority: Priority.LOW,
      tags: { connect: [{ id: tags["Casa"] }] },
    },
  });
  await prisma.task.create({
    data: {
      userId: uid, title: "Diseñar la página de contacto",
      description: "Formulario, redes y mapa.",
      dueDate: addDays(today, 2), priority: Priority.NORMAL, projectId: web.id, estimateMinutes: 90,
      tags: { connect: [{ id: tags["Trabajo"] }] },
      subtasks: {
        create: [
          { userId: uid, title: "Crear estructura", done: true, sortOrder: 0 },
          { userId: uid, title: "Diseñar interfaz", done: false, sortOrder: 1 },
          { userId: uid, title: "Programar formulario", done: false, sortOrder: 2 },
          { userId: uid, title: "Probar y publicar", done: false, sortOrder: 3 },
        ],
      },
    },
  });
  const shelf = await prisma.task.create({
    data: {
      userId: uid, title: "Montar la estantería del salón",
      dueDate: addDays(today, 3), priority: Priority.NORMAL, projectId: flat.id, estimateMinutes: 60,
      tags: { connect: [{ id: tags["Casa"] }] },
      subtasks: {
        create: [
          { userId: uid, title: "Comprar tornillos", done: true, sortOrder: 0 },
          { userId: uid, title: "Montar estructura", done: false, sortOrder: 1 },
        ],
      },
    },
  });
  await prisma.task.create({
    data: {
      userId: uid, title: "Terminar el módulo 4 del curso de mezcla",
      dueDate: addDays(today, 5), priority: Priority.HIGH, estimateMinutes: 180,
      tags: { connect: [{ id: tags["Estudio"] }] },
    },
  });
  await prisma.task.create({
    data: {
      userId: uid, title: "Revisar el presupuesto de la mudanza",
      dueDate: addDays(today, 7), priority: Priority.URGENT, projectId: flat.id,
      tags: { connect: [{ id: tags["Urgente"] }] },
    },
  });
  await prisma.task.create({
    data: {
      userId: uid, title: "Quedada con los amigos",
      dueDate: addDays(today, 4), priority: Priority.LOW,
      tags: { connect: [{ id: tags["Personal"] }] },
    },
  });

  // Historial completado (alimenta estadísticas y rachas)
  const doneTitles = [
    "Actualizar el portafolio", "Pagar el alquiler", "Sesión de estudio",
    "Ordenar escritorio", "Llamada con el cliente", "Ir al supermercado",
  ];
  for (let i = 0; i < doneTitles.length; i++) {
    const d = addDays(today, -(i + 1));
    await prisma.task.create({
      data: {
        userId: uid, title: doneTitles[i],
        dueDate: d, status: TaskStatus.COMPLETED, completedAt: d, statusChangedAt: d,
        priority: i % 2 === 0 ? Priority.NORMAL : Priority.LOW,
      },
    });
  }

  // ---------- Events ----------
  await prisma.event.createMany({
    data: [
      {
        userId: uid, title: "Reunión de equipo",
        startAt: at(today, 9, 0), endAt: at(today, 9, 45),
        color: "#ef4444", category: "Reunión", location: "Videollamada",
        recurrenceId: weekly.id,
      },
      {
        userId: uid, title: "Bloque de diseño",
        startAt: at(today, 10, 30), endAt: at(today, 12, 0),
        color: "#6366f1", projectId: web.id,
      },
      {
        userId: uid, title: "Almuerzo",
        startAt: at(today, 12, 0), endAt: at(today, 12, 45),
        color: "#f59e0b",
      },
      {
        userId: uid, title: "Sesión de estudio",
        startAt: at(today, 16, 0), endAt: at(today, 17, 30),
        color: "#10b981",
      },
      {
        userId: uid, title: "Clase de inglés",
        startAt: at(addDays(today, 1), 18, 0), endAt: at(addDays(today, 1), 19, 0),
        color: "#0ea5e9", category: "Clase",
      },
      {
        userId: uid, title: "Visita al piso (medidor)",
        startAt: at(addDays(today, 3), 11, 0), endAt: at(addDays(today, 3), 12, 0),
        color: "#f59e0b", projectId: flat.id, location: "Calle Mayor 42",
      },
      {
        userId: uid, title: "Concierto",
        startAt: at(addDays(today, 10), 21, 0), endAt: at(addDays(today, 10), 23, 30),
        color: "#a855f7", location: "Sala Apolo",
      },
    ],
  });

  // ---------- Note folders ----------
  const fPersonal = await prisma.noteFolder.create({ data: { userId: uid, name: "Personal" } });
  const fWork = await prisma.noteFolder.create({ data: { userId: uid, name: "Trabajo" } });

  // ---------- Notes ----------
  await prisma.note.create({
    data: {
      userId: uid, title: "Bienvenida a Dayly",
      content: "# Bienvenido/a 👋\n\nEsto es un **demo completo** de la app:\n\n- Tareas con subtareas, prioridades y etiquetas\n- Calendario con eventos recurrentes\n- Proyectos con progreso\n- Notas con carpetas\n- Hábitos con rachas\n- Objetivos vinculados a tareas\n- Papelera, import/export, Pomodoro…\n\nTodo lo que veas aquí se puede editar sin miedo.",
      pinned: true, favorite: true, color: "#f59e0b",
    },
  });
  await prisma.note.create({
    data: {
      userId: uid, title: "Lista de la compra",
      content: "- Fruta y verdura\n- Café\n- Pan integral\n- Detergente",
      folderId: fPersonal.id, tags: { connect: [{ id: tags["Casa"] }] },
    },
  });
  await prisma.note.create({
    data: {
      userId: uid, title: "Notas de mezcla — EP",
      content: "## Pendiente\n\n- [x] Subir el kick 2 dB\n- [ ] Sidechain del bajo\n- [ ] Automación del drop\n- [ ] Master final",
      tags: { connect: [{ id: tags["Estudio"] }, { id: tags["Ideas"] }] },
    },
  });
  await prisma.note.create({
    data: {
      userId: uid, title: "Datos del hosting (ejemplo)",
      content: "Panel: panel.ejemplo.com\nUsuario: usuario_demo\nCDN activada: sí\n\n> Nota: datos ficticios del demo.",
      folderId: fWork.id, tags: { connect: [{ id: tags["Trabajo"] }] },
    },
  });
  await prisma.note.create({
    data: {
      userId: uid, title: "Rutina semanal",
      content: "**Lunes a viernes**\n- 08:00 levantarse\n- 09:00 reunión\n- 16:00 estudio\n\n**Fin de semana**\n- Salir a correr\n- Comprar para la semana",
      folderId: fPersonal.id,
    },
  });

  // ---------- Habits ----------
  const habits = [
    { name: "Beber agua", color: "#0ea5e9", scheduleDayBits: 127, reminderMinuteOfDay: 9 * 60 },
    { name: "Leer 20 minutos", color: "#a855f7", scheduleDayBits: 127, reminderMinuteOfDay: 22 * 60 + 30 },
    { name: "Entrenar", color: "#22c55e", scheduleDayBits: 62, reminderMinuteOfDay: null as number | null },
    { name: "Estudiar música", color: "#f59e0b", scheduleDayBits: 31, reminderMinuteOfDay: 19 * 60 },
  ];
  for (const h of habits) {
    const habit = await prisma.habit.create({
      data: { userId: uid, name: h.name, color: h.color, scheduleDayBits: h.scheduleDayBits, reminderMinuteOfDay: h.reminderMinuteOfDay },
    });
    // ~10 weeks of history so the monthly calendar view shows real streaks
    // and missed days; deterministic pseudo-random gaps per weekday.
    const missChance: number[] = [0.15, 0.1, 0.1, 0.25, 0.2, 0.35, 0.4]; // L M X J V S D
    for (let i = 69; i >= 0; i--) {
      const d = addDays(today, -i);
      const jsDay = (d.getDay() + 6) % 7;
      if (((h.scheduleDayBits >> jsDay) & 1) !== 1) continue;
      const seedNum = (i * 31 + h.name.length * 7 + jsDay * 13) % 100;
      // Recent days (last 5) mostly done to keep a believable current streak.
      const missed = i > 5 && seedNum < missChance[jsDay] * 100;
      if (missed) continue;
      // Store at UTC-noon of the local calendar date (same convention as the
      // /log endpoint) so ISO date keys match the client's localKey().
      await prisma.habitLog.create({
        data: { userId: uid, habitId: habit.id, date: new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 12)), done: true },
      });
    }
  }

  // ---------- Goals ----------
  await prisma.goal.create({
    data: {
      userId: uid, title: "Lanzar la nueva web",
      description: "Web en producción con portfolio actualizado.",
      dueDate: addDays(today, 25), projectId: web.id, status: TaskStatus.IN_PROGRESS,
      tasks: { connect: [{ id: overdue.id }] },
    },
  });
  await prisma.goal.create({
    data: {
      userId: uid, title: "Mudanza sin estrés",
      description: "Dejar el piso listo en un mes.",
      dueDate: addDays(today, 60), projectId: flat.id, status: TaskStatus.PENDING,
      tasks: { connect: [{ id: shelf.id }] },
    },
  });

  // ---------- Inbox ----------
  await prisma.inboxItem.createMany({
    data: [
      { userId: uid, content: "Llamar a la sala para confirmar la fecha del concierto" },
      { userId: uid, content: "Comparar precios de monitores de estudio" },
      { userId: uid, content: "Idea: playlist colaborativa para el viaje" },
    ],
  });

  // ---------- Reminders ----------
  await prisma.reminder.create({
    data: { userId: uid, title: "Llamar al médico", remindAt: at(addDays(today, 1), 9, 0) },
  });
  await prisma.reminder.create({
    data: { userId: uid, title: "Enviar la factura", remindAt: at(addDays(today, 2), 10, 0), scheduleDaily: false },
  });

  // ---------- Time tracking (Pomodoro previo) ----------
  await prisma.timeEntry.createMany({
    data: [
      { userId: uid, taskId: overdue.id, projectId: web.id, startedAt: at(addDays(today, -1), 10, 0), endedAt: at(addDays(today, -1), 10, 25), durationSec: 1500, source: "POMODORO" },
      { userId: uid, taskId: emails.id, startedAt: at(today, 8, 30), endedAt: at(today, 8, 50), durationSec: 1200, source: "MANUAL" },
      { userId: uid, startedAt: at(addDays(today, -2), 17, 0), endedAt: at(addDays(today, -2), 18, 0), durationSec: 3600, source: "MANUAL", note: "Búsqueda de inspiración" },
    ],
  });

  console.log(`Demo completo creado para ${DEMO_EMAIL} (contraseña: Demo123456).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
