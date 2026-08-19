/* eslint-disable no-console */
/**
 * Dayly DB seed. Creates the base roles, a demo user and some sample data so
 * you can explore the app immediately. Seed data is clearly scoped under the
 * demo user and tagged `[Demo]` so it can be told apart from real records.
 *
 * Run: npm run db:seed   (uses DATABASE_URL + SEED_DEMO from .env)
 * Idempotent: safe to run repeatedly.
 */
import { PrismaClient, RoleName, TaskStatus, Priority, ProjectStatus, ThemePreference } from "@prisma/client";
import { hashPassword } from "../src/lib/crypto.js";

const prisma = new PrismaClient();
const demo = process.env.SEED_DEMO !== "false";

async function main() {
  // --- Roles (RBAC) ---
  const roleSpecs = [
    { name: RoleName.USER, description: "Usuario estándar", permissions: [] },
    {
      name: RoleName.ADMIN,
      description: "Administrador",
      permissions: ["admin.access", "users.manage", "users.view", "stats.view"],
    },
  ];
  for (const r of roleSpecs) {
    await prisma.role.upsert({ where: { name: r.name }, update: r, create: r });
  }
  const userRole = await prisma.role.findUniqueOrThrow({ where: { name: RoleName.USER } });
  const adminRole = await prisma.role.findUniqueOrThrow({ where: { name: RoleName.ADMIN } });
  console.log(`Roles listos: ${userRole.name}, ${adminRole.name}`);

  if (!demo) {
    console.log("SEED_DEMO=false — no se crean datos demo. Terminado.");
    return;
  }

  // --- Demo users ---
  const demoPass = await hashPassword("Demo123456");
  const demoUser = await prisma.user.upsert({
    where: { emailLower: "alexis@dayly.dev" },
    update: {},
    create: {
      email: "alexis@dayly.dev",
      emailLower: "alexis@dayly.dev",
      name: "Alexis Demo",
      passwordHash: demoPass,
      roleId: userRole.id,
      emailVerifiedAt: new Date(),
      theme: ThemePreference.SYSTEM,
    },
  });

  const adminPass = await hashPassword("Admin123456");
  const adminUser = await prisma.user.upsert({
    where: { emailLower: "admin@dayly.dev" },
    update: {},
    create: {
      email: "admin@dayly.dev",
      emailLower: "admin@dayly.dev",
      name: "Admin Dayly",
      passwordHash: adminPass,
      roleId: adminRole.id,
      emailVerifiedAt: new Date(),
      theme: ThemePreference.DARK,
    },
  });
  console.log("Usuarios demo: alexis@dayly.dev / Demo123456  ·  admin@dayly.dev / Admin123456");

  // --- Tags ---
  const tagNames = ["Trabajo", "Personal", "Casa", "Estudio", "DJ", "Urgente"];
  const tags: Record<string, string> = {};
  for (const t of tagNames) {
    const rec = await prisma.tag.upsert({
      where: { userId_name: { userId: demoUser.id, name: t } },
      update: {},
      create: { userId: demoUser.id, name: t },
    });
    tags[t] = rec.id;
  }

  // --- Project ---
  const work = await prisma.project.create({
    data: {
      userId: demoUser.id,
      name: "Web djhummer.es",
      description: "Renovar la web profesional del DJ",
      color: "#6366f1",
      status: ProjectStatus.ACTIVE,
      startDate: new Date(),
      dueDate: addDays(new Date(), 30),
    },
  });

  // --- Recurrence (weekly, Mondays 09:00) ---
  const weekly = await prisma.recurrence.create({
    data: { userId: demoUser.id, frequency: "WEEKLY", interval: 1, byDay: ["MO"], timezone: "Europe/Madrid" },
  });

  // --- Tasks ---
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  await prisma.task.createMany({
    data: [
      {
        userId: demoUser.id,
        title: "Preparar set para el fin de semana",
        description: "Seleccionar tracklist de latin tech house",
        dueDate: today,
        priority: Priority.HIGH,
        projectId: work.id,
        estimateMinutes: 120,
      },
      {
        userId: demoUser.id,
        title: "Responder emails de booking",
        dueDate: today,
        priority: Priority.URGENT,
        status: TaskStatus.IN_PROGRESS,
        estimateMinutes: 30,
      },
    ],
  });

  // Tasks with tags (relations can't go through createMany)
  await prisma.task.create({
    data: {
      userId: demoUser.id,
      title: "Comprar cables de audio",
      priority: Priority.LOW,
      dueDate: addDays(today, 1),
      tags: { connect: [{ id: tags["Personal"] }, { id: tags["Casa"] }] },
    },
  });
  await prisma.task.create({
    data: {
      userId: demoUser.id,
      title: "Estudiar nuevas técnicas de mezcla",
      dueDate: today,
      priority: Priority.NORMAL,
      tags: { connect: [{ id: tags["Estudio"] }] },
    },
  });

  await prisma.task.create({
    data: {
      userId: demoUser.id,
      title: "Diseñar página de contacto",
      description: "Sección con formulario y redes",
      dueDate: addDays(today, 2),
      priority: Priority.NORMAL,
      projectId: work.id,
      estimateMinutes: 90,
      subtasks: {
        create: [
          { userId: demoUser.id, title: "Crear estructura", done: true },
          { userId: demoUser.id, title: "Diseñar interfaz", done: false },
          { userId: demoUser.id, title: "Programar backend", done: false },
          { userId: demoUser.id, title: "Probar y publicar", done: false },
        ],
      },
    },
  });

  // --- Events (agenda de hoy) ---
  await prisma.event.createMany({
    data: [
      {
        userId: demoUser.id,
        title: "Reunión de booking",
        startAt: at(today, 9, 0),
        endAt: at(today, 9, 45),
        color: "#ef4444",
        category: "Reunión",
        location: "Videollamada",
        recurrenceId: weekly.id,
      },
      {
        userId: demoUser.id,
        title: "Diseñar página de contacto",
        startAt: at(today, 10, 30),
        endAt: at(today, 12, 0),
        color: "#6366f1",
        projectId: work.id,
      },
      {
        userId: demoUser.id,
        title: "Almuerzo",
        startAt: at(today, 12, 0),
        endAt: at(today, 12, 45),
        color: "#f59e0b",
      },
      {
        userId: demoUser.id,
        title: "Ensayo técnica de mezcla",
        startAt: at(today, 15, 0),
        endAt: at(today, 16, 30),
        color: "#10b981",
      },
    ],
  });

  // --- Notes ---
  await prisma.note.create({
    data: {
      userId: demoUser.id,
      title: "Ideas para el nuevo EP",
      content: "# Ideas\n\n- Track A: *Sabor a Playa* remix\n- Feature con vocalista\n- Publicar en verano",
      pinned: true,
      favorite: true,
      tags: { connect: [{ id: tags["DJ"] }] },
    },
  });
  await prisma.note.create({
    data: {
      userId: demoUser.id,
      title: "Lista de la compra",
      content: "- Cables RCA\n- Monitores\n- Auriculares nuevos",
      tags: { connect: [{ id: tags["Casa"] }] },
    },
  });

  // --- Habits ---
  for (const h of ["Beber agua", "Leer 20 min", "Entrenar", "Estudiar música"]) {
    const habit = await prisma.habit.create({
      data: { userId: demoUser.id, name: h, scheduleDayBits: 127 },
    });
    // Log done for each of the last 5 days to show streaks
    for (let i = 0; i < 5; i++) {
      const d = addDays(today, -1 * i);
      await prisma.habitLog.create({
        data: { userId: demoUser.id, habitId: habit.id, date: new Date(d.getFullYear(), d.getMonth(), d.getDate()), done: true },
      });
    }
  }

  // --- Goals ---
  await prisma.goal.create({
    data: {
      userId: demoUser.id,
      title: "Lanzar mi nueva web",
      dueDate: addDays(today, 30),
      projectId: work.id,
      description: "Web profesional preparada para producción",
      tasks: { connect: [{ id: (await prisma.task.findFirst({ where: { title: "Diseñar página de contacto" } }))!.id }] },
    },
  });

  // --- Inbox ---
  await prisma.inboxItem.createMany({
    data: [
      { userId: demoUser.id, content: "Llamar a la sala para confirmar fecha" },
      { userId: demoUser.id, content: "Revisar factura del hosting" },
    ],
  });

  // --- Week stats seed: some completed tasks over past days ---
  for (let i = 1; i <= 6; i++) {
    await prisma.task.create({
      data: {
        userId: demoUser.id,
        title: `Tarea completada hace ${i} día/s [Demo]`,
        dueDate: addDays(today, -1 * i),
        status: TaskStatus.COMPLETED,
        completedAt: addDays(today, -1 * i),
        priority: Priority.NORMAL,
      },
    });
  }

  console.log("Seed demo completado con datos de ejemplo.");
}

function at(base: Date, h: number, m: number) {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate(), h, m, 0, 0);
}
function addDays(d: Date, days: number) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());