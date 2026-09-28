import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";
import { Button, Spinner } from "@/components/ui";
import { http } from "@/lib/api";
import {
  fetchNativeShellUpdate,
  installNativeShellUpdate,
  isNativeShell,
  listenNativeEvent,
  resolveNativeShellVersion,
  type InstallerMeta,
  type InstallersResponse,
  type ShellUpdateProgress,
} from "@/lib/nativeShell";
import { compareVersions } from "@/lib/releaseUpdate";

const DISMISSED_PREFIX = "dayly.shell-update.dismissed.";

type ShellUpdate = {
  currentVersion: string;
  latestVersion: string;
  installer: InstallerMeta;
};

type FileWriter = {
  write(data: Blob): Promise<void>;
  close(): Promise<void>;
  abort?(): Promise<void>;
};

type SaveFileHandle = { createWritable(): Promise<FileWriter> };
type SaveFilePicker = (options: {
  suggestedName: string;
  types: { description: string; accept: Record<string, string[]> }[];
}) => Promise<SaveFileHandle>;

function getSaveFilePicker(): SaveFilePicker | null {
  if (typeof window === "undefined") return null;
  const candidate = (window as Window & { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;
  return typeof candidate === "function" ? candidate.bind(window) : null;
}

async function sha256(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function isCancelledFilePicker(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export function ShellUpdateNotice() {
  const [update, setUpdate] = useState<ShellUpdate | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<ShellUpdateProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isNativeShell()) return;
    let alive = true;

    const check = async () => {
      const currentVersion = await resolveNativeShellVersion();
      if (!alive || !currentVersion) return;
      const info = await http.get<InstallersResponse>("/api/app/installers");
      if (!alive || !info.windows) return;
      // The wrapper's own updater is the authority on what it can install: when
      // it confirms nothing is pending, offering the update would only lead to
      // "no hay actualización disponible" after the user clicks.
      const pending = await fetchNativeShellUpdate();
      if (!alive || (pending.known && pending.version === null)) return;
      const latestVersion = pending.version ?? info.shellVersion;
      if (compareVersions(latestVersion, currentVersion) <= 0) return;
      if (sessionStorage.getItem(`${DISMISSED_PREFIX}${latestVersion}`) === "1") return;
      setUpdate({ currentVersion, latestVersion, installer: info.windows });
    };

    void check().catch(() => { /* Update checks never block normal use. */ });

    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!isNativeShell()) return;
    let active = true;
    let unlisten = () => {};
    void listenNativeEvent<ShellUpdateProgress>("kalendiario-shell-update-progress", (next) => {
      if (active) setProgress(next);
    }).then((stop) => {
      if (active) unlisten = stop;
      else stop();
    }).catch(() => { /* The update still works without progress events. */ });
    return () => {
      active = false;
      unlisten();
    };
  }, []);

  if (!update) return null;
  const usesNativeUpdater = compareVersions(update.currentVersion, "1.0.3") >= 0;

  const dismiss = () => {
    sessionStorage.setItem(`${DISMISSED_PREFIX}${update.latestVersion}`, "1");
    setUpdate(null);
  };

  const downloadBootstrapInstaller = async () => {
    const picker = getSaveFilePicker();
    let handle: SaveFileHandle | null = null;
    const filename = `Kalendiario-Setup-${update.latestVersion}.exe`;
    if (picker) {
      handle = await picker({
        suggestedName: filename,
        types: [{
          description: "Instalador de Windows",
          accept: { "application/vnd.microsoft.portable-executable": [".exe"] },
        }],
      });
    }

    const response = await fetch(update.installer.url, { cache: "no-store", credentials: "include" });
    if (!response.ok) throw new Error(`download failed (${response.status})`);
    const blob = await response.blob();
    if (blob.size !== update.installer.size || await sha256(blob) !== update.installer.sha256.toLowerCase()) {
      throw new Error("installer integrity mismatch");
    }
    if (handle) {
      const writer = await handle.createWritable();
      try {
        await writer.write(blob);
        await writer.close();
      } catch (writeError) {
        await writer.abort?.().catch(() => {});
        throw writeError;
      }
    } else {
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = filename;
      anchor.hidden = true;
      document.body.appendChild(anchor);
      anchor.click();
      window.setTimeout(() => {
        anchor.remove();
        URL.revokeObjectURL(objectUrl);
      }, 60_000);
    }
  };

  const installUpdate = async () => {
    setDownloading(true);
    setProgress({ phase: "downloading", downloaded: 0, total: null });
    setError(null);
    try {
      if (!usesNativeUpdater) {
        await downloadBootstrapInstaller();
        dismiss();
      } else {
        await installNativeShellUpdate();
      }
    } catch (installError) {
      if (isCancelledFilePicker(installError)) return;
      setProgress(null);
      // Distinguish a real failure from an update the wrapper already applied:
      // the notice can outlive the install when the page was never reloaded.
      const pending = usesNativeUpdater ? await fetchNativeShellUpdate() : { known: false, version: null };
      setError(pending.known && pending.version === null
        ? `Ya tienes instalada la versión ${update.currentVersion}. Reinicia la app si el aviso reaparece.`
        : `${usesNativeUpdater ? "No se pudo instalar" : "No se pudo descargar"} la actualización. Comprueba la conexión y vuelve a intentarlo.`);
    } finally {
      setDownloading(false);
    }
  };

  const percent = progress?.total && progress.total > 0
    ? Math.min(100, Math.round((progress.downloaded / progress.total) * 100))
    : null;
  const actionLabel = progress?.phase === "installing"
    ? "Abriendo instalador…"
    : downloading
      ? `Descargando${percent === null ? "…" : ` ${percent}%`}`
      : usesNativeUpdater ? "Descargar e instalar" : "Descargar instalador";

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-1 left-1/2 z-[80] flex h-12 w-max max-w-[calc(100vw-1rem)] -translate-x-1/2 items-center gap-2 rounded-xl border border-border bg-surface px-2 shadow-pop"
    >
      <p className="min-w-0 truncate pl-2 text-sm font-medium text-text" role={error ? "alert" : undefined}>
        {error ?? <>
          Nueva versión de la app de Windows: {update.latestVersion}
          <span className="hidden text-muted sm:inline"> · instalada {update.currentVersion}</span>
        </>}
      </p>
      <Button
        onClick={() => void installUpdate()}
        disabled={downloading}
        aria-busy={downloading}
        className="h-10 shrink-0 px-3"
      >
        {downloading ? <Spinner size={16} /> : <Download className="h-4 w-4" aria-hidden="true" />}
        {actionLabel}
      </Button>
      <Button variant="ghost" icon onClick={dismiss} aria-label="Recordármelo más tarde" title="Más tarde" disabled={downloading}>
        <X className="h-5 w-5" aria-hidden="true" />
      </Button>
    </div>
  );
}
