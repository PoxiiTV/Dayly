import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import clsx from "clsx";
import { http } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { PaymentMethod, Subscription, SubscriptionTag } from "@/lib/types";
import { Button, ComingSoonBadge, Input, Modal, Select, Spinner, useToast } from "@/components/ui";
import { integrationShown, useIntegration } from "@/lib/integrations";
import { centsToInput, parseMoneyInput } from "@/lib/money";
import { localKey } from "@/lib/dates";

const CYCLES: { value: number; label: string }[] = [
  { value: 1, label: "Mensual" },
  { value: 3, label: "Trimestral" },
  { value: 6, label: "Semestral" },
  { value: 12, label: "Anual" },
  { value: 24, label: "Cada 2 años" },
];

/** Offered reminders, in days before the charge. At most three at a time. */
const ALERT_CHOICES = [30, 14, 7, 3, 1, 0];
const MAX_ALERTS = 3;

function alertLabel(days: number): string {
  if (days === 0) return "El mismo día";
  if (days === 1) return "1 día antes";
  return `${days} días antes`;
}

interface FormState {
  name: string;
  vendor: string;
  amount: string;
  cycleMonths: number;
  customCycle: string;
  firstChargeDate: string;
  lastDayOfMonth: boolean;
  paymentMethodId: string;
  tagIds: string[];
  alertHour: number;
  alertDaysBefore: number[];
  notifyInApp: boolean;
  notifyTelegram: boolean;
  notifyEmail: boolean;
  notes: string;
}

function formFrom(sub?: Subscription | null): FormState {
  if (!sub) {
    return {
      name: "", vendor: "", amount: "", cycleMonths: 1, customCycle: "",
      firstChargeDate: localKey(new Date()), lastDayOfMonth: false,
      paymentMethodId: "", tagIds: [], alertHour: 9, alertDaysBefore: [7, 1, 0],
      notifyInApp: true, notifyTelegram: false, notifyEmail: false, notes: "",
    };
  }
  const known = CYCLES.some((c) => c.value === sub.cycleMonths);
  return {
    name: sub.name,
    vendor: sub.vendor ?? "",
    amount: centsToInput(sub.amountCents),
    cycleMonths: known ? sub.cycleMonths : -1,
    customCycle: known ? "" : String(sub.cycleMonths),
    firstChargeDate: sub.nextChargeDate,
    lastDayOfMonth: sub.anchorDay === 31,
    paymentMethodId: sub.paymentMethodId ?? "",
    tagIds: (sub.tags ?? []).map((t) => t.id),
    alertHour: sub.alertHour,
    alertDaysBefore: sub.alertDaysBefore ?? [],
    notifyInApp: sub.notifyInApp,
    notifyTelegram: sub.notifyTelegram,
    notifyEmail: sub.notifyEmail,
    notes: sub.notes ?? "",
  };
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-faint">{title}</h3>
      {children}
    </section>
  );
}

export function SubscriptionEditor({ open, onClose, editing, methods, tags, onSaved }: {
  open: boolean;
  onClose: () => void;
  editing?: Subscription | null;
  methods: PaymentMethod[];
  tags: SubscriptionTag[];
  onSaved: () => void;
}) {
  const { push } = useToast();
  const { user } = useAuth();
  const [form, setForm] = useState<FormState>(() => formFrom(editing));
  const [busy, setBusy] = useState(false);
  const [showAlerts, setShowAlerts] = useState(false);

  const { data: telegramStatus } = useQuery({
    queryKey: ["telegram-status"],
    queryFn: () => http.get<{ linked: boolean }>("/api/telegram/status"),
    enabled: open,
  });

  useEffect(() => {
    if (open) {
      setForm(formFrom(editing));
      setShowAlerts(false);
    }
  }, [open, editing?.id]);

  const cycleMonths = form.cycleMonths === -1 ? Number(form.customCycle) || 0 : form.cycleMonths;
  const telegramState = useIntegration("telegram");
  const telegramLinked = telegramState === "AVAILABLE" && (telegramStatus?.linked ?? false);
  const emailReady = Boolean(user?.notifyEmail);

  const monthlyHint = useMemo(() => {
    const cents = parseMoneyInput(form.amount);
    if (!cents || cycleMonths < 1) return null;
    if (cycleMonths === 1) return null;
    return Math.round(cents / cycleMonths);
  }, [form.amount, cycleMonths]);

  const toggleAlert = (days: number) => {
    setForm((f) => {
      if (f.alertDaysBefore.includes(days)) {
        return { ...f, alertDaysBefore: f.alertDaysBefore.filter((d) => d !== days) };
      }
      if (f.alertDaysBefore.length >= MAX_ALERTS) return f;
      return { ...f, alertDaysBefore: [...f.alertDaysBefore, days].sort((a, b) => b - a) };
    });
  };

  const toggleTag = (id: string) => {
    setForm((f) => ({ ...f, tagIds: f.tagIds.includes(id) ? f.tagIds.filter((t) => t !== id) : [...f.tagIds, id] }));
  };

  const save = async () => {
    const name = form.name.trim();
    if (!name) { push("error", "Escribe un nombre."); return; }
    const amountCents = parseMoneyInput(form.amount);
    if (!amountCents) { push("error", "El importe no es válido. Por ejemplo: 12,99"); return; }
    if (cycleMonths < 1 || cycleMonths > 36) { push("error", "El ciclo va de 1 a 36 meses."); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.firstChargeDate)) { push("error", "Elige la fecha del próximo cobro."); return; }

    const payload = {
      name,
      vendor: form.vendor.trim() || null,
      notes: form.notes.trim() || null,
      amountCents,
      cycleMonths,
      anchorDay: form.lastDayOfMonth ? 31 : Number(form.firstChargeDate.slice(8, 10)),
      firstChargeDate: form.firstChargeDate,
      paymentMethodId: form.paymentMethodId || null,
      tagIds: form.tagIds,
      alertHour: form.alertHour,
      alertDaysBefore: form.alertDaysBefore,
      notifyInApp: form.notifyInApp,
      notifyTelegram: form.notifyTelegram,
      notifyEmail: form.notifyEmail,
    };
    setBusy(true);
    try {
      if (editing) await http.patch(`/api/subscriptions/${editing.id}`, payload);
      else await http.post("/api/subscriptions", payload);
      push("success", editing ? "Suscripción actualizada" : "Suscripción creada");
      onSaved();
      onClose();
    } catch (e) {
      push("error", e instanceof Error ? e.message : "No se pudo guardar.");
    } finally {
      setBusy(false);
    }
  };

  const activeMethods = methods.filter((m) => !m.archivedAt || m.id === form.paymentMethodId);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? "Editar suscripción" : "Nueva suscripción"}
      size="lg"
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button onClick={() => void save()} disabled={busy}>{busy ? <Spinner /> : "Guardar"}</Button>
      </>}
    >
      <div className="space-y-6">
        <Block title="Qué y cuánto">
          <Input label="Nombre" value={form.name} autoFocus placeholder="Ej. Netflix, Seguro del coche, ChatGPT"
            onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <div className="grid sm:grid-cols-2 gap-3">
            <Input label="Importe" inputMode="decimal" value={form.amount} placeholder="12,99"
              onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            <Select label="Cada cuánto" value={String(form.cycleMonths)}
              onChange={(e) => setForm({ ...form, cycleMonths: Number(e.target.value) })}>
              {CYCLES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              <option value={-1}>Otro…</option>
            </Select>
          </div>
          {form.cycleMonths === -1 && (
            <Input label="Cada cuántos meses" type="number" min={1} max={36} value={form.customCycle}
              onChange={(e) => setForm({ ...form, customCycle: e.target.value })} />
          )}
          {monthlyHint !== null && (
            <p className="text-xs text-muted">Equivale a <strong className="text-text">{(monthlyHint / 100).toFixed(2).replace(".", ",")} €</strong> al mes.</p>
          )}
        </Block>

        <Block title="Cuándo se cobra">
          <Input label="Próximo cobro" type="date" value={form.firstChargeDate}
            onChange={(e) => setForm({ ...form, firstChargeDate: e.target.value })} />
          <label className="flex items-start gap-2.5 text-sm text-text cursor-pointer select-none">
            <input type="checkbox" className="mt-0.5 accent-accent w-4 h-4" checked={form.lastDayOfMonth}
              onChange={(e) => setForm({ ...form, lastDayOfMonth: e.target.checked })} />
            <span>
              Siempre el último día del mes
              <span className="block text-xs text-muted">En febrero cae el 28 o el 29, y en marzo vuelve al 31.</span>
            </span>
          </label>
        </Block>

        <Block title="Cómo se paga">
          <Select label="Método de pago" value={form.paymentMethodId}
            onChange={(e) => setForm({ ...form, paymentMethodId: e.target.value })}>
            <option value="">Sin especificar</option>
            {activeMethods.map((m) => (
              <option key={m.id} value={m.id}>{m.alias}{m.last4 ? ` ····${m.last4}` : ""}{m.archivedAt ? " (archivado)" : ""}</option>
            ))}
          </Select>
          <div className="space-y-1.5">
            <span className="label">Etiquetas</span>
            {tags.length === 0 ? (
              <p className="text-xs text-muted">
                Aún no tienes etiquetas de suscripciones. Créalas con el botón «Etiquetas» de la lista.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {tags.map((t) => {
                  const on = form.tagIds.includes(t.id);
                  return (
                    <button key={t.id} type="button" aria-pressed={on} onClick={() => toggleTag(t.id)}
                      className={clsx("chip chip-sm border transition-colors", on ? "border-accent text-accent bg-accent/10" : "border-border text-muted hover:border-accent/40")}>
                      {on ? "✓ " : ""}{t.name}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </Block>

        <section className="space-y-3">
          <button type="button" onClick={() => setShowAlerts((v) => !v)}
            className="flex w-full items-center justify-between text-xs font-semibold uppercase tracking-wide text-faint hover:text-text">
            <span>Avisos</span>
            <span className="normal-case tracking-normal text-muted">
              {form.alertDaysBefore.length === 0 ? "Sin avisos" : `${form.alertDaysBefore.length} · ${String(form.alertHour).padStart(2, "0")}:00`}
              {showAlerts ? " ▲" : " ▼"}
            </span>
          </button>
          {showAlerts && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <span className="label">Avísame (hasta {MAX_ALERTS})</span>
                <div className="flex flex-wrap gap-2">
                  {ALERT_CHOICES.map((d) => {
                    const on = form.alertDaysBefore.includes(d);
                    const full = !on && form.alertDaysBefore.length >= MAX_ALERTS;
                    return (
                      <button key={d} type="button" aria-pressed={on} disabled={full} onClick={() => toggleAlert(d)}
                        className={clsx("chip chip-sm border transition-colors",
                          on ? "border-accent text-accent bg-accent/10" : full ? "border-border text-faint opacity-50 cursor-not-allowed" : "border-border text-muted hover:border-accent/40")}>
                        {on ? "✓ " : ""}{alertLabel(d)}
                      </button>
                    );
                  })}
                </div>
              </div>
              <Select label="A qué hora" value={String(form.alertHour)}
                onChange={(e) => setForm({ ...form, alertHour: Number(e.target.value) })}>
                {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
              </Select>
              <div className="space-y-2">
                <span className="label">Por dónde</span>
                <label className="flex items-center gap-2.5 text-sm text-text cursor-pointer select-none">
                  <input type="checkbox" className="accent-accent w-4 h-4" checked={form.notifyInApp}
                    onChange={(e) => setForm({ ...form, notifyInApp: e.target.checked })} />
                  En la aplicación
                </label>
                {integrationShown(telegramState) && <label className={clsx("flex items-start gap-2.5 text-sm select-none", telegramLinked ? "text-text cursor-pointer" : "text-muted")}>
                  <input type="checkbox" className="mt-0.5 accent-accent w-4 h-4" checked={form.notifyTelegram} disabled={!telegramLinked}
                    onChange={(e) => setForm({ ...form, notifyTelegram: e.target.checked })} />
                  <span>
                    Telegram
                    {telegramState === "COMING_SOON" && <ComingSoonBadge className="ml-2" />}
                    {telegramState === "AVAILABLE" && !telegramLinked && (
                      <span className="block text-xs text-muted">
                        Telegram no está vinculado. <Link to="/settings" className="text-accent underline">Vincúlalo en Ajustes</Link> para poder activarlo.
                      </span>
                    )}
                  </span>
                </label>}
                <label className={clsx("flex items-start gap-2.5 text-sm select-none", emailReady ? "text-text cursor-pointer" : "text-muted")}>
                  <input type="checkbox" className="mt-0.5 accent-accent w-4 h-4" checked={form.notifyEmail} disabled={!emailReady}
                    onChange={(e) => setForm({ ...form, notifyEmail: e.target.checked })} />
                  <span>
                    Correo
                    {!emailReady && (
                      <span className="block text-xs text-muted">
                        Los avisos por correo están desactivados. <Link to="/settings" className="text-accent underline">Actívalos en Ajustes</Link> y elige un buzón.
                      </span>
                    )}
                  </span>
                </label>
              </div>
            </div>
          )}
        </section>
      </div>
    </Modal>
  );
}
