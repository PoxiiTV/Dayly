import { useEffect, useState } from "react";
import { Check, Sparkles } from "lucide-react";
import { APP_VERSION } from "@brand";
import { Button, Modal } from "@/components/ui";
import { getPendingReleaseNotes, markReleaseNotesSeen } from "@/lib/releaseNotes";
import type { ReleaseChangelog } from "@/lib/releaseChangelog";

export function ReleaseNotesModal() {
  const [open, setOpen] = useState(false);
  const [pendingReleases, setPendingReleases] = useState<readonly ReleaseChangelog[]>([]);

  useEffect(() => {
    const releases = getPendingReleaseNotes();
    setPendingReleases(releases);
    if (releases.length > 0) setOpen(true);
  }, []);

  const close = () => {
    markReleaseNotesSeen();
    setOpen(false);
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title={<span className="inline-flex items-center gap-2"><Sparkles className="w-5 h-5 text-accent" aria-hidden />Novedades de Kalendiario</span>}
      description={pendingReleases.length === 1 ? `Versión ${APP_VERSION}` : `Cambios desde tu última visita · hasta v${APP_VERSION}`}
      size="sm"
      footer={<Button onClick={close}><Check className="w-4 h-4" />Entendido</Button>}
    >
      <div className="space-y-5">
        {pendingReleases.map((release) => (
          <section key={release.version} aria-labelledby={`release-${release.version}`}>
            <h3 id={`release-${release.version}`} className="text-xs font-semibold uppercase tracking-wide text-accent-strong mb-2">Versión {release.version}</h3>
            <ul className="space-y-4">
              {release.notes.map((note) => (
                <li key={note.title} className="flex gap-3">
                  <span className="mt-0.5 w-6 h-6 shrink-0 rounded-full bg-accent-soft text-accent-strong grid place-items-center" aria-hidden>
                    <Check className="w-3.5 h-3.5" strokeWidth={2.5} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-text">{note.title}</p>
                    <p className="text-sm text-muted leading-relaxed mt-0.5">{note.body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Modal>
  );
}
