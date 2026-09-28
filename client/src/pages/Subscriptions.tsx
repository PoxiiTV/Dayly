import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import {
  CreditCard, Plus, Pencil, Trash2, Wallet, Check, SkipForward, Play, Pause, Ban, Search, RotateCcw, Tags,
} from "lucide-react";
import { http } from "@/lib/api";
import type {
  PaymentMethod, Subscription, SubscriptionCharge, SubscriptionForecast, SubscriptionStatus, SubscriptionSummary, SubscriptionTag,
} from "@/lib/types";
import {
  Button, ConfirmDialog, EmptyState, Input, Modal, PageHeader, Segmented, Select, Spinner, useToast,
} from "@/components/ui";
import { SubscriptionEditor } from "@/components/SubscriptionEditor";
import { TagManager } from "@/components/TagManager";
import { formatMoney, formatMoneyRounded } from "@/lib/money";
import { localKey } from "@/lib/dates";

type StatusFilter = "ALL" | SubscriptionStatus;

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "ACTIVE", label: "Activas" },
  { value: "PAUSED", label: "Pausadas" },
  { value: "CANCELLED", label: "Canceladas" },
  { value: "ALL", label: "Todas" },
];

// Status is never communicated by colour alone: every badge carries its word.
const STATUS_BADGE: Record<SubscriptionStatus, { label: string; className: string }> = {
  ACTIVE: { label: "Activa", className: "border-ok/40 text-ok bg-ok/10" },
  PAUSED: { label: "Pausada", className: "border-warn/40 text-warn bg-warn/10" },
  CANCELLED: { label: "Cancelada", className: "border-border text-muted" },
};

const CYCLE_LABEL: Record<number, string> = { 1: "al mes", 3: "al trimestre", 6: "al semestre", 12: "al año", 24: "cada 2 años" };

function cycleLabel(months: number): string {
  return CYCLE_LABEL[months] ?? `cada ${months} meses`;
}

function fmtDay(ymd: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd;
  const [y, m, d] = ymd.split("-").map(Number);
  return new Intl.DateTimeFormat("es-ES", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" })
    .format(new Date(Date.UTC(y, m - 1, d, 12)));
}

/** Days from today to `ymd`, negative when it is already past. */
function daysUntil(ymd: string): number {
  const today = localKey(new Date());
  const a = Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, Number(today.slice(8, 10)));
  const b = Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)) - 1, Number(ymd.slice(8, 10)));
  return Math.round((b - a) / 86_400_000);
}

function dueLabel(ymd: string): string {
  const n = daysUntil(ymd);
  if (n < 0) return `Pendiente desde el ${fmtDay(ymd)}`;
  if (n === 0) return "Se cobra hoy";
  if (n === 1) return "Se cobra mañana";
  return `En ${n} días · ${fmtDay(ymd)}`;
}

function Metric({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "real" | "forecast" }) {
  return (
    <div className="card p-4">
      <p className="text-xs text-faint uppercase tracking-wide">{label}</p>
      <p className="text-xl font-semibold text-text mt-1 tabular-nums">{value}</p>
      {hint && (
        <p className={clsx("text-xs mt-0.5", tone === "forecast" ? "text-muted italic" : "text-muted")}>{hint}</p>
      )}
    </div>
  );
}

/** Horizontal bars plus the same numbers as a real table, so nothing depends
 * on being able to compare bar lengths — or to see colour. */
function Breakdown({ title, rows }: { title: string; rows: { key: string; name: string; color?: string | null; monthlyCents: number }[] }) {
  const [asTable, setAsTable] = useState(false);
  const total = rows.reduce((s, r) => s + r.monthlyCents, 0);
  if (!rows.length) return null;
  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-text">{title}</h3>
        <button type="button" onClick={() => setAsTable((v) => !v)} className="text-xs text-accent hover:underline">
          {asTable ? "Ver gráfico" : "Ver tabla"}
        </button>
      </div>
      {asTable ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-faint">
                <th className="py-1 pr-3 font-normal">Concepto</th>
                <th className="py-1 pr-3 font-normal text-right">Al mes</th>
                <th className="py-1 font-normal text-right">%</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-t border-border">
                  <td className="py-1.5 pr-3 text-text">{r.name}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums text-text">{formatMoney(r.monthlyCents)}</td>
                  <td className="py-1.5 text-right tabular-nums text-muted">{total ? Math.round((r.monthlyCents / total) * 100) : 0}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => {
            const pct = total ? Math.round((r.monthlyCents / total) * 100) : 0;
            return (
              <li key={r.key}>
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="text-text truncate">{r.name}</span>
                  <span className="text-muted tabular-nums shrink-0">{formatMoney(r.monthlyCents)} · {pct}%</span>
                </div>
                <div className="h-2 rounded-full bg-bg border border-border mt-1 overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${Math.max(pct, 2)}%`, background: r.color ?? "var(--accent, #3b82f6)" }} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function Subscriptions() {
  const qc = useQueryClient();
  const { push } = useToast();
  const [params, setParams] = useSearchParams();

  const [status, setStatus] = useState<StatusFilter>("ACTIVE");
  const [term, setTerm] = useState("");
  const [tagId, setTagId] = useState("");
  const [methodId, setMethodId] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Subscription | null>(null);
  const [walletOpen, setWalletOpen] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Subscription | null>(null);

  const openId = params.get("s");
  const highlightDay = params.get("c");

  const listQuery = useQuery({
    queryKey: ["subscriptions", status, tagId, methodId],
    queryFn: () => http.get<{ subscriptions: Subscription[] }>("/api/subscriptions", {
      status: status === "ALL" ? undefined : status,
      tagId: tagId || undefined,
      methodId: methodId || undefined,
    }),
  });
  const summaryQuery = useQuery({
    queryKey: ["subscriptions-summary"],
    queryFn: () => http.get<SubscriptionSummary>("/api/subscriptions/summary"),
  });
  const methodsQuery = useQuery({
    queryKey: ["payment-methods"],
    queryFn: () => http.get<{ methods: PaymentMethod[] }>("/api/subscriptions/methods"),
  });
  // Subscription tags are their own vocabulary: never /api/tags.
  const tagsQuery = useQuery({
    queryKey: ["subscription-tags"],
    queryFn: () => http.get<{ tags: SubscriptionTag[] }>("/api/subscriptions/tags"),
  });

  const subscriptions = listQuery.data?.subscriptions ?? [];
  const methods = methodsQuery.data?.methods ?? [];
  const tags = tagsQuery.data?.tags ?? [];
  const summary = summaryQuery.data;

  // Searching client-side keeps typing instant; the server filter exists for
  // deep links and very large lists.
  const visible = useMemo(() => {
    const q = term.trim().toLowerCase();
    if (!q) return subscriptions;
    return subscriptions.filter((s) => s.name.toLowerCase().includes(q) || (s.vendor ?? "").toLowerCase().includes(q));
  }, [subscriptions, term]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["subscriptions"] });
    void qc.invalidateQueries({ queryKey: ["subscriptions-summary"] });
    void qc.invalidateQueries({ queryKey: ["subscription-detail"] });
  };

  const openDetail = (id: string) => {
    const next = new URLSearchParams(params);
    next.set("s", id);
    next.delete("c");
    setParams(next, { replace: true });
  };

  const closeDetail = () => {
    const next = new URLSearchParams(params);
    next.delete("s");
    next.delete("c");
    setParams(next, { replace: true });
  };

  const setStatusOf = async (sub: Subscription, next: SubscriptionStatus) => {
    try {
      await http.patch(`/api/subscriptions/${sub.id}`, { status: next });
      refresh();
      push("success", next === "ACTIVE" ? "Suscripción reanudada" : next === "PAUSED" ? "Suscripción pausada" : "Suscripción cancelada");
    } catch (e) {
      push("error", e instanceof Error ? e.message : "No se pudo cambiar el estado.");
    }
  };

  const remove = async () => {
    if (!confirmDelete) return;
    try {
      await http.del(`/api/subscriptions/${confirmDelete.id}`);
      if (openId === confirmDelete.id) closeDetail();
      refresh();
      push("success", "Suscripción eliminada");
    } catch (e) {
      push("error", e instanceof Error ? e.message : "No se pudo eliminar.");
    } finally {
      setConfirmDelete(null);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Suscripciones"
        lead="Lo que se te cobra solo, cuándo y con qué."
        actions={<>
          <Button variant="secondary" onClick={() => setWalletOpen(true)}><Wallet className="w-4 h-4" />Métodos</Button>
          <Button onClick={() => { setEditing(null); setEditorOpen(true); }}><Plus className="w-4 h-4" />Nueva</Button>
        </>}
      />

      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Metric label="Coste mensual" value={formatMoney(summary.monthlyCents)}
            hint={`${summary.counts.active} activa${summary.counts.active === 1 ? "" : "s"}`} />
          <Metric label={`Pagado en ${summary.year}`} value={formatMoney(summary.paidThisYearCents)}
            hint="Solo cargos confirmados" tone="real" />
          <Metric label="Próximos 3 meses" value={formatMoney(summary.next3MonthsCents)}
            hint="Previsión, aún sin confirmar" tone="forecast" />
          <Metric label="Proyección anual" value={formatMoneyRounded(summary.yearlyProjectionCents)}
            hint="Previsión al ritmo actual" tone="forecast" />
        </div>
      )}

      <div className="card p-3 space-y-3">
        <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
          <div className="relative flex-1 min-w-0">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
            <Input aria-label="Buscar suscripción" className="pl-9" placeholder="Buscar por nombre o proveedor"
              value={term} onChange={(e) => setTerm(e.target.value)} dense />
          </div>
          <Segmented options={STATUS_FILTERS} value={status} onChange={setStatus} />
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" className="shrink-0" onClick={() => setTagsOpen(true)}>
              <Tags className="w-4 h-4" />Etiquetas
            </Button>
            <Select aria-label="Filtrar por etiqueta" className="flex-1 min-w-0" value={tagId} onChange={(e) => setTagId(e.target.value)} dense>
              <option value="">Todas las etiquetas</option>
              {tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </div>
          <Select aria-label="Filtrar por método de pago" value={methodId} onChange={(e) => setMethodId(e.target.value)} dense>
            <option value="">Todos los métodos</option>
            {methods.map((m) => <option key={m.id} value={m.id}>{m.alias}</option>)}
          </Select>
        </div>
      </div>

      {listQuery.isLoading ? (
        <div className="grid place-items-center h-48 text-accent"><Spinner /></div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={<CreditCard className="w-6 h-6" />}
          title={subscriptions.length === 0 ? "Aún no hay suscripciones" : "Nada con esos filtros"}
          hint={subscriptions.length === 0 ? "Apunta lo que se te cobra cada mes y deja de enterarte por el banco." : undefined}
          action={subscriptions.length === 0 ? <Button onClick={() => { setEditing(null); setEditorOpen(true); }}><Plus className="w-4 h-4" />Nueva</Button> : undefined}
        />
      ) : (
        <ul className="space-y-2">
          {visible.map((sub) => {
            const badge = STATUS_BADGE[sub.status];
            const overdue = sub.status === "ACTIVE" && daysUntil(sub.nextChargeDate) < 0;
            return (
              <li key={sub.id} className="card p-4">
                <div className="flex items-start justify-between gap-3">
                  <button type="button" onClick={() => openDetail(sub.id)} className="min-w-0 text-left flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-text truncate">{sub.name}</span>
                      <span className={clsx("chip chip-sm border", badge.className)}>{badge.label}</span>
                      {(sub.tags ?? []).map((t) => (
                        <span key={t.id} className="chip chip-sm border border-border text-muted">{t.name}</span>
                      ))}
                    </div>
                    <p className="text-sm text-muted mt-1 tabular-nums">
                      {formatMoney(sub.amountCents, sub.currency)} {cycleLabel(sub.cycleMonths)}
                      {sub.paymentMethod ? ` · ${sub.paymentMethod.alias}` : ""}
                    </p>
                    {sub.status !== "CANCELLED" && (
                      <p className={clsx("text-xs mt-0.5", overdue ? "text-warn font-medium" : "text-faint")}>
                        {sub.status === "PAUSED" ? "Pausada, no se avisa" : dueLabel(sub.nextChargeDate)}
                      </p>
                    )}
                  </button>
                  <div className="flex items-center gap-1 shrink-0">
                    {sub.status === "ACTIVE" && (
                      <button type="button" aria-label="Pausar" title="Pausar" onClick={() => void setStatusOf(sub, "PAUSED")} className="btn-ghost btn-icon-sm text-faint">
                        <Pause className="w-4 h-4" />
                      </button>
                    )}
                    {sub.status !== "ACTIVE" && (
                      <button type="button" aria-label="Reanudar" title="Reanudar" onClick={() => void setStatusOf(sub, "ACTIVE")} className="btn-ghost btn-icon-sm text-faint">
                        <Play className="w-4 h-4" />
                      </button>
                    )}
                    {sub.status !== "CANCELLED" && (
                      <button type="button" aria-label="Cancelar" title="Cancelar (conserva el historial)" onClick={() => void setStatusOf(sub, "CANCELLED")} className="btn-ghost btn-icon-sm text-faint">
                        <Ban className="w-4 h-4" />
                      </button>
                    )}
                    <button type="button" aria-label="Editar" title="Editar" onClick={() => { setEditing(sub); setEditorOpen(true); }} className="btn-ghost btn-icon-sm text-faint">
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button type="button" aria-label="Eliminar" title="Eliminar" onClick={() => setConfirmDelete(sub)} className="btn-ghost btn-icon-sm text-faint hover:text-danger">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {summary && (summary.byTag.length > 0 || summary.byMethod.length > 0) && (
        <div className="grid lg:grid-cols-2 gap-3">
          <Breakdown title="Gasto mensual por etiqueta" rows={summary.byTag.map((r) => ({ key: r.tagId ?? "none", name: r.name, color: r.color, monthlyCents: r.monthlyCents }))} />
          <Breakdown title="Gasto mensual por método de pago" rows={summary.byMethod.map((r) => ({ key: r.methodId ?? "none", name: r.name, monthlyCents: r.monthlyCents }))} />
        </div>
      )}

      <SubscriptionEditor
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        editing={editing}
        methods={methods}
        tags={tags}
        onSaved={refresh}
      />

      <SubscriptionDetail
        id={openId}
        highlightDay={highlightDay}
        onClose={closeDetail}
        onEdit={(sub) => { setEditing(sub); setEditorOpen(true); }}
        onChanged={refresh}
      />

      <TagManager
        open={tagsOpen}
        onClose={() => setTagsOpen(false)}
        endpoint="/api/subscriptions/tags"
        queryKey="subscription-tags"
        consumerKeys={["subscriptions", "subscriptions-summary", "subscription-detail"]}
        description="Las etiquetas de Suscripciones son independientes de las de tareas. Renombra, recolorea o elimina las de aquí."
        deleteMessage={(name) => `Se quitará #${name} de tus suscripciones. Las suscripciones no se eliminan.`}
        onDeleted={(id) => { if (tagId === id) setTagId(""); }}
      />

      <WalletModal open={walletOpen} onClose={() => setWalletOpen(false)} methods={methods}
        onChanged={() => { void qc.invalidateQueries({ queryKey: ["payment-methods"] }); refresh(); }} />

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => void remove()}
        title="Eliminar suscripción"
        message={`Se borra «${confirmDelete?.name ?? ""}» y todo su historial de cargos. Si solo quieres dejar de pagarla, cancélala en su lugar.`}
      />
    </div>
  );
}

function SubscriptionDetail({ id, highlightDay, onClose, onEdit, onChanged }: {
  id: string | null;
  highlightDay: string | null;
  onClose: () => void;
  onEdit: (sub: Subscription) => void;
  onChanged: () => void;
}) {
  const { push } = useToast();
  const qc = useQueryClient();
  const [busyDay, setBusyDay] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["subscription-detail", id],
    queryFn: () => http.get<{ subscription: Subscription; charges: SubscriptionCharge[]; forecast: SubscriptionForecast[] }>(`/api/subscriptions/${id}`),
    enabled: Boolean(id),
  });

  const sub = data?.subscription;
  const charges = data?.charges ?? [];
  const forecast = data?.forecast ?? [];

  const settle = async (dueDate: string, status: "PAID" | "SKIPPED") => {
    if (!id) return;
    setBusyDay(dueDate);
    try {
      await http.post(`/api/subscriptions/${id}/charges`, { dueDate, status });
      await qc.invalidateQueries({ queryKey: ["subscription-detail", id] });
      onChanged();
      push("success", status === "PAID" ? "Cargo marcado como pagado" : "Cargo omitido");
    } catch (e) {
      push("error", e instanceof Error ? e.message : "No se pudo guardar el cargo.");
    } finally {
      setBusyDay(null);
    }
  };

  const undo = async (charge: SubscriptionCharge) => {
    if (!id) return;
    setBusyDay(charge.dueDate);
    try {
      await http.del(`/api/subscriptions/${id}/charges/${charge.id}`);
      await qc.invalidateQueries({ queryKey: ["subscription-detail", id] });
      onChanged();
      push("success", "Cargo deshecho");
    } catch (e) {
      push("error", e instanceof Error ? e.message : "No se pudo deshacer.");
    } finally {
      setBusyDay(null);
    }
  };

  return (
    <Modal open={Boolean(id)} onClose={onClose} title={sub?.name ?? "Suscripción"}
      description={sub ? `${formatMoney(sub.amountCents, sub.currency)} ${cycleLabel(sub.cycleMonths)}${sub.vendor ? ` · ${sub.vendor}` : ""}` : undefined}
      size="lg"
      footer={sub ? <>
        <Button variant="secondary" onClick={onClose}>Cerrar</Button>
        <Button onClick={() => { onEdit(sub); onClose(); }}><Pencil className="w-4 h-4" />Editar</Button>
      </> : undefined}
    >
      {isLoading || !sub ? (
        <div className="grid place-items-center h-40 text-accent"><Spinner /></div>
      ) : (
        <div className="space-y-6">
          <div className="grid sm:grid-cols-2 gap-3 text-sm">
            <div className="rounded-xl border border-border p-3">
              <p className="text-xs text-faint uppercase tracking-wide">Método de pago</p>
              <p className="text-text mt-0.5">
                {sub.paymentMethod ? `${sub.paymentMethod.alias}${sub.paymentMethod.last4 ? ` ····${sub.paymentMethod.last4}` : ""}` : "Sin especificar"}
              </p>
            </div>
            <div className="rounded-xl border border-border p-3">
              <p className="text-xs text-faint uppercase tracking-wide">Avisos</p>
              <p className="text-text mt-0.5">
                {sub.alertDaysBefore.length === 0
                  ? "Sin avisos"
                  : `${sub.alertDaysBefore.map((d) => (d === 0 ? "el día" : `${d} d`)).join(", ")} · ${String(sub.alertHour).padStart(2, "0")}:00`}
              </p>
            </div>
          </div>

          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-faint">Próximos cobros (previsión)</h3>
            {forecast.length === 0 ? (
              <p className="text-sm text-muted">No hay cobros previstos.</p>
            ) : (
              <ul className="space-y-1.5">
                {forecast.slice(0, 12).map((f) => (
                  <li key={f.dueDate}
                    className={clsx("flex items-center justify-between gap-3 rounded-xl border p-2.5",
                      highlightDay === f.dueDate ? "border-accent bg-accent/5" : "border-border")}>
                    <div className="min-w-0">
                      <p className="text-sm text-text">{fmtDay(f.dueDate)}</p>
                      <p className="text-xs text-muted tabular-nums">{formatMoney(f.amountCents, sub.currency)} · previsto</p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button size="sm" variant="secondary" disabled={busyDay === f.dueDate} onClick={() => void settle(f.dueDate, "PAID")}>
                        <Check className="w-4 h-4" />Pagado
                      </Button>
                      <button type="button" aria-label="Omitir este cobro" title="Omitir este cobro"
                        disabled={busyDay === f.dueDate} onClick={() => void settle(f.dueDate, "SKIPPED")}
                        className="btn-ghost btn-icon-sm text-faint">
                        <SkipForward className="w-4 h-4" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-faint">Historial</h3>
            {charges.length === 0 ? (
              <p className="text-sm text-muted">Todavía no has confirmado ningún cargo.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-faint">
                      <th className="py-1 pr-3 font-normal">Fecha</th>
                      <th className="py-1 pr-3 font-normal">Estado</th>
                      <th className="py-1 pr-3 font-normal text-right">Importe</th>
                      <th className="py-1 pr-3 font-normal">Método</th>
                      <th className="py-1 font-normal sr-only">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {charges.map((c) => (
                      <tr key={c.id} className={clsx("border-t border-border", highlightDay === c.dueDate && "bg-accent/5")}>
                        <td className="py-1.5 pr-3 text-text whitespace-nowrap">{fmtDay(c.dueDate)}</td>
                        <td className="py-1.5 pr-3">
                          <span className={clsx("chip chip-sm border", c.status === "PAID" ? "border-ok/40 text-ok bg-ok/10" : "border-border text-muted")}>
                            {c.status === "PAID" ? "Pagado" : "Omitido"}
                          </span>
                        </td>
                        <td className="py-1.5 pr-3 text-right tabular-nums text-text">
                          {c.status === "PAID" ? formatMoney(c.amountCents, sub.currency) : "—"}
                        </td>
                        <td className="py-1.5 pr-3 text-muted truncate">{c.methodLabel ?? "—"}</td>
                        <td className="py-1.5 text-right">
                          <button type="button" aria-label={`Deshacer el cargo del ${fmtDay(c.dueDate)}`} title="Deshacer"
                            disabled={busyDay === c.dueDate} onClick={() => void undo(c)}
                            className="btn-ghost btn-icon-sm text-faint hover:text-danger">
                            <RotateCcw className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {sub.notes && (
            <section className="space-y-1">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-faint">Notas</h3>
              <p className="text-sm text-muted whitespace-pre-wrap">{sub.notes}</p>
            </section>
          )}
        </div>
      )}
    </Modal>
  );
}

function WalletModal({ open, onClose, methods, onChanged }: {
  open: boolean;
  onClose: () => void;
  methods: PaymentMethod[];
  onChanged: () => void;
}) {
  const { push } = useToast();
  const [alias, setAlias] = useState("");
  const [kind, setKind] = useState<"ACCOUNT" | "CARD" | "OTHER">("CARD");
  const [last4, setLast4] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDrop, setConfirmDrop] = useState<PaymentMethod | null>(null);

  useEffect(() => {
    if (open) { setAlias(""); setKind("CARD"); setLast4(""); }
  }, [open]);

  const create = async () => {
    if (!alias.trim()) { push("error", "Ponle un nombre."); return; }
    if (last4 && !/^\d{4}$/.test(last4)) { push("error", "Los últimos dígitos son exactamente 4 números."); return; }
    setBusy(true);
    try {
      await http.post("/api/subscriptions/methods", { alias: alias.trim(), kind, last4: last4 || null });
      setAlias(""); setLast4("");
      onChanged();
      push("success", "Método de pago añadido");
    } catch (e) {
      push("error", e instanceof Error ? e.message : "No se pudo guardar.");
    } finally {
      setBusy(false);
    }
  };

  const drop = async () => {
    if (!confirmDrop) return;
    try {
      const r = await http.del<{ archived: boolean }>(`/api/subscriptions/methods/${confirmDrop.id}`);
      onChanged();
      push("success", r.archived ? "Método archivado: lo usan suscripciones existentes" : "Método eliminado");
    } catch (e) {
      push("error", e instanceof Error ? e.message : "No se pudo eliminar.");
    } finally {
      setConfirmDrop(null);
    }
  };

  const restore = async (method: PaymentMethod) => {
    try {
      await http.patch(`/api/subscriptions/methods/${method.id}`, { archived: false });
      onChanged();
    } catch (e) {
      push("error", e instanceof Error ? e.message : "No se pudo restaurar.");
    }
  };

  return (
    <>
      <Modal open={open} onClose={onClose} title="Métodos de pago"
        description="Solo un nombre para reconocerlos. Nunca guardes aquí el número completo ni el CVV."
        size="md"
        footer={<Button variant="secondary" onClick={onClose}>Cerrar</Button>}>
        <div className="space-y-5">
          <div className="space-y-3">
            <Input label="Nombre" value={alias} placeholder="Ej. Visa nómina, Cuenta conjunta"
              onChange={(e) => setAlias(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void create()} />
            <div className="grid sm:grid-cols-2 gap-3">
              <Select label="Tipo" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
                <option value="CARD">Tarjeta</option>
                <option value="ACCOUNT">Cuenta</option>
                <option value="OTHER">Otro</option>
              </Select>
              <Input label="Últimos 4 dígitos (opcional)" inputMode="numeric" maxLength={4} value={last4}
                onChange={(e) => setLast4(e.target.value.replace(/\D/g, "").slice(0, 4))} />
            </div>
            <Button onClick={() => void create()} disabled={busy}>{busy ? <Spinner /> : <><Plus className="w-4 h-4" />Añadir</>}</Button>
          </div>

          {methods.length > 0 && (
            <ul className="space-y-1.5">
              {methods.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-3 rounded-xl border border-border p-2.5">
                  <div className="min-w-0">
                    <p className="text-sm text-text truncate">
                      {m.alias}{m.last4 ? <span className="text-muted"> ····{m.last4}</span> : null}
                    </p>
                    <p className="text-xs text-faint">
                      {m.kind === "CARD" ? "Tarjeta" : m.kind === "ACCOUNT" ? "Cuenta" : "Otro"}
                      {m.archivedAt ? " · archivado" : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {m.archivedAt && (
                      <button type="button" aria-label="Restaurar" title="Restaurar" onClick={() => void restore(m)} className="btn-ghost btn-icon-sm text-faint">
                        <RotateCcw className="w-4 h-4" />
                      </button>
                    )}
                    <button type="button" aria-label="Eliminar método" title="Eliminar" onClick={() => setConfirmDrop(m)} className="btn-ghost btn-icon-sm text-faint hover:text-danger">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(confirmDrop)}
        onClose={() => setConfirmDrop(null)}
        onConfirm={() => void drop()}
        title="Eliminar método de pago"
        message="Si alguna suscripción lo usa, se archivará en vez de borrarse para que el historial siga teniendo sentido."
      />
    </>
  );
}
