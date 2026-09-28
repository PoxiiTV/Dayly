import { APP_VERSION } from "@brand";
import { History } from "lucide-react";
import clsx from "clsx";
import { PageHeader } from "@/components/ui";
import { RELEASE_CHANGELOG, sortReleaseChangelogDesc } from "@/lib/releaseChangelog";

/**
 * The whole published history, newest first. It reads the same list that feeds
 * the "novedades" modal, so there is nothing extra to keep in sync: publishing
 * a release adds its entry here automatically.
 */
export function Changelog() {
  const releases = sortReleaseChangelogDesc(RELEASE_CHANGELOG);

  return (
    <div className="page-shell">
      <PageHeader
        title="Historial de versiones"
        lead="Cómo ha ido evolucionando Kalendiario, versión a versión."
      />

      <ol className="relative space-y-4 border-l border-border pl-6 ml-2">
        {releases.map((release) => {
          const current = release.version === APP_VERSION;
          return (
            <li key={release.version} className="relative">
              <span
                aria-hidden
                className={clsx(
                  "absolute -left-[1.9rem] top-4 h-2.5 w-2.5 rounded-full ring-4 ring-bg",
                  current ? "bg-accent" : "bg-border",
                )}
              />
              <section className={clsx("card p-4", current && "border-accent")}>
                <h2 className="flex items-center gap-2 text-sm font-semibold text-text">
                  v{release.version}
                  {current && (
                    <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent-strong">
                      en uso
                    </span>
                  )}
                </h2>
                <ul className="mt-2 space-y-2">
                  {release.notes.map((note) => (
                    <li key={note.title}>
                      <p className="text-sm font-medium text-text">{note.title}</p>
                      <p className="text-sm text-muted">{note.body}</p>
                    </li>
                  ))}
                </ul>
              </section>
            </li>
          );
        })}
      </ol>

      <p className="mt-6 text-xs text-faint">
        El registro arranca en la v{RELEASE_CHANGELOG[0]?.version}, cuando se empezó a anotar cada
        publicación.
      </p>

      <p className="mt-2 flex items-center gap-1.5 text-xs text-faint">
        <History className="h-3.5 w-3.5" aria-hidden="true" />
        {releases.length} versiones publicadas.
      </p>
    </div>
  );
}
