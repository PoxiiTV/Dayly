import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Users, Plus, Search, ShieldCheck, Ban, CheckCircle2, Activity } from "lucide-react";
import clsx from "clsx";
import { http } from "@/lib/api";
import { Spinner, Button, Input, Select, useToast, ConfirmDialog, EmptyState, Avatar } from "@/components/ui";
import { relativeDay } from "@/lib/dates";

interface AdminStats { stats: { totalUsers: number; activeUsers: number; newUsers: number; newUsersWeek: number; tasks: number; events: number; activeSessions: number; recentErrors: number }; recentActivity: { id: string; action: string; createdAt: string; user?: { name: string; email: string } }[]; }
interface AdminUser { id: string; email: string; name: string; status: "ACTIVE" | "SUSPENDED"; role: { name: string }; createdAt: string; lastLoginAt?: string | null; twoFactorEnabled: boolean; }

export function Admin() {
  const qc = useQueryClient();
  const { push } = useToast();
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [confirm, setConfirm] = useState<AdminUser | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [cName, setCName] = useState("");
  const [cEmail, setCEmail] = useState("");
  const [cPass, setCPass] = useState("");
  const [cRole, setCRole] = useState("USER");

  const { data: stats } = useQuery({ queryKey: ["admin", "stats"], queryFn: () => http.get<AdminStats>("/api/admin/stats") });
  const { data: users, isLoading } = useQuery({ queryKey: ["admin", "users", q, page], queryFn: () => http.get<{ users: AdminUser[]; total: number; hasMore: boolean }>("/api/admin/users", { q: q || undefined, page }) });

  const setStatus = async (u: AdminUser, status: "ACTIVE" | "SUSPENDED") => {
    try { await http.patch(`/api/admin/users/${u.id}`, { status }); qc.invalidateQueries({ queryKey: ["admin"] }); push("success", status === "SUSPENDED" ? "Usuario suspendido" : "Usuario reactivado"); } catch (e: any) { push("error", e.message); }
  };
  const setRole = async (u: AdminUser, role: "USER" | "ADMIN") => {
    try { await http.patch(`/api/admin/users/${u.id}`, { role }); qc.invalidateQueries({ queryKey: ["admin"] }); push("success", "Rol actualizado"); } catch (e: any) { push("error", e.message); }
  };
  const create = async () => {
    if (!cName.trim() || !cEmail.trim() || !cPass) return;
    try {
      const created = await http.post<{ user: { email: string }; emailSent?: boolean }>("/api/admin/users", { name: cName.trim(), email: cEmail.trim(), password: cPass, role: cRole });
      setCreateOpen(false); setCName(""); setCEmail(""); setCPass("");
      qc.invalidateQueries({ queryKey: ["admin"] });
      push("success", created.emailSent ? "Usuario creado. Le hemos enviado el acceso por correo." : "Usuario creado. El correo de acceso no se pudo enviar.");
    } catch (e: any) { push("error", e.message); }
  };

  const s = stats?.stats;

  return (
    <div className="max-w-5xl mx-auto animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-text tracking-tight flex items-center gap-2"><ShieldCheck className="w-6 h-6 text-accent" />Panel de administración</h1>
        <Button onClick={() => setCreateOpen(true)}><Plus className="w-4 h-4" />Crear usuario</Button>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Kpi label="Usuarios" value={s?.totalUsers ?? "–"} icon={<Users className="w-4 h-4" />} />
        <Kpi label="Activos" value={s?.activeUsers ?? "–"} icon={<Activity className="w-4 h-4" />} />
        <Kpi label="Nuevos (7d)" value={s?.newUsersWeek ?? "–"} icon={<Plus className="w-4 h-4" />} />
        <Kpi label="Sesiones activas" value={s?.activeSessions ?? "–"} icon={<Activity className="w-4 h-4" />} />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Kpi label="Tareas" value={s?.tasks ?? "–"} />
        <Kpi label="Eventos" value={s?.events ?? "–"} />
        <Kpi label="Con 2FA" value={"–"} />
        <Kpi label="Sesiones" value={"–"} />
      </div>

      {/* Users table */}
      <div className="card overflow-hidden mb-6">
        <div className="p-4 border-b border-border flex items-center gap-3">
          <div className="relative flex-1 max-w-sm"><Search className="absolute left-3 top-2.5 w-4 h-4 text-faint" /><Input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Buscar por nombre o email…" className="!pl-9" /></div>
          <span className="text-sm text-muted">{users?.total ?? 0} usuarios</span>
        </div>
        {isLoading ? <div className="grid place-items-center h-48"><Spinner /></div> : !users || users.users.length === 0 ? <EmptyState title="Sin resultados" /> : (
          <div className="divide-y divide-border/60">
            {users.users.map((u) => (
              <div key={u.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <Avatar name={u.name} size={32} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-text truncate">{u.name}</p>
                  <p className="text-xs text-muted truncate">{u.email} · alta {relativeDay(u.createdAt)}</p>
                </div>
                <span className={clsx("chip text-[10px]", u.status === "ACTIVE" ? "bg-ok/15 text-ok" : "bg-danger/10 text-danger")}>{u.status === "ACTIVE" ? "Activo" : "Suspendido"}</span>
                <select value={u.role.name} onChange={(e) => setRole(u, e.target.value as "USER" | "ADMIN")} className="input !w-28 !h-8 !text-xs">
                  <option value="USER">Usuario</option><option value="ADMIN">Admin</option>
                </select>
                <div className="flex gap-1">
                  {u.status === "ACTIVE"
                    ? <Button size="sm" variant="ghost" onClick={() => setStatus(u, "SUSPENDED")} title="Suspender"><Ban className="w-4 h-4 text-danger" /></Button>
                    : <Button size="sm" variant="ghost" onClick={() => setStatus(u, "ACTIVE")} title="Reactivar"><CheckCircle2 className="w-4 h-4 text-ok" /></Button>}
                  <Button size="sm" variant="ghost" onClick={() => setConfirm(u)} title="Eliminar">🗑</Button>
                </div>
              </div>
            ))}
          </div>
        )}
        {users?.hasMore && <div className="p-3 text-center"><Button variant="secondary" size="sm" onClick={() => setPage(page + 1)}>Cargar más</Button></div>}
      </div>

      {/* Recent activity */}
      {(stats?.recentActivity?.length ?? 0) > 0 && (
        <div className="card p-5">
          <h2 className="font-semibold text-text mb-3 text-sm uppercase tracking-wide text-faint">Actividad reciente</h2>
          <ul className="space-y-1.5">
            {stats!.recentActivity.map((a) => (
              <li key={a.id} className="flex items-center justify-between text-xs">
                <span className="text-muted">{a.user?.name ?? "Sistema"} · <code className="text-faint">{a.action}</code></span>
                <span className="text-faint">{relativeDay(a.createdAt)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <ConfirmDialog open={!!confirm} onClose={() => setConfirm(null)} title="Eliminar usuario" message={`Se borrarán definitivamente todos los datos de «${confirm?.name}». Esta acción no se puede deshacer.`} onConfirm={async () => { if (confirm) { try { await http.del(`/api/admin/users/${confirm.id}`); qc.invalidateQueries({ queryKey: ["admin"] }); push("success", "Usuario eliminado"); } catch (e: any) { push("error", e.message); } } setConfirm(null); }} />

      {/* Create user modal */}
      {createOpen && (
        <div className="fixed inset-0 z-[70] flex items-end md:items-center justify-center p-0 md:p-6">
          <div className="absolute inset-0 bg-black/50" onClick={() => setCreateOpen(false)} />
          <div className="relative bg-surface rounded-t-3xl md:rounded-3xl w-full md:max-w-sm p-5 space-y-4 animate-slide-up">
            <h3 className="font-semibold text-text">Crear usuario</h3>
            <Input label="Nombre" value={cName} onChange={(e) => setCName(e.target.value)} />
            <Input label="Email" type="email" value={cEmail} onChange={(e) => setCEmail(e.target.value)} />
            <Input label="Contraseña" type="password" value={cPass} onChange={(e) => setCPass(e.target.value)} placeholder="Mín. 10 caracteres" />
            <Select label="Rol" value={cRole} onChange={(e) => setCRole(e.target.value)}><option value="USER">Usuario</option><option value="ADMIN">Admin</option></Select>
            <div className="flex justify-end gap-2 pt-2"><Button variant="secondary" onClick={() => setCreateOpen(false)}>Cancelar</Button><Button onClick={create}>Crear</Button></div>
          </div>
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, icon }: { label: string; value: string | number; icon?: React.ReactNode }) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 text-muted mb-1 text-[11px]">{icon}{label}</div>
      <div className="text-2xl font-bold text-text tabular-nums">{value}</div>
    </div>
  );
}