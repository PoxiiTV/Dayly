import { useCallback, useEffect, useState } from "react";
import { Download, Globe, Share, Smartphone } from "lucide-react";
import { APP_NAME } from "@brand";
import { Button, Modal } from "@/components/ui";
import { http } from "@/lib/api";
import {
  detectInstallPlatform,
  type InstallersResponse,
  type InstallerMeta,
} from "@/lib/nativeShell";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1).replace(".", ",")} KB`;
  return `${(n / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

function DownloadRow({
  label,
  hint,
  meta,
  loading,
  availableLabel,
  missingLabel,
}: {
  label: string;
  hint: string;
  meta: InstallerMeta | null;
  loading: boolean;
  availableLabel: string;
  missingLabel: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-bg/60 px-4 py-3">
      <p className="text-sm font-semibold text-text">{label}</p>
      <p className="text-xs text-muted mt-0.5 leading-relaxed">{hint}</p>
      {loading ? (
        <Button type="button" variant="secondary" className="mt-3 w-full" disabled>Comprobando…</Button>
      ) : meta ? (
        <a href={meta.url} className="btn-primary mt-3 inline-flex w-full justify-center">
          <Download className="w-4 h-4" />
          {availableLabel}
          <span className="text-white/80 font-normal">({formatBytes(meta.size)})</span>
        </a>
      ) : (
        <Button type="button" variant="secondary" className="mt-3 w-full" disabled>
          {missingLabel}
        </Button>
      )}
    </div>
  );
}

export function InstallAppModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const platform = detectInstallPlatform();
  const [info, setInfo] = useState<InstallersResponse | null>(null);

  useEffect(() => {
    if (!open) {
      setInfo(null);
      return;
    }
    let on = true;
    void http.get<InstallersResponse>("/api/app/installers")
      .then((data) => { if (on) setInfo(data); })
      .catch(() => { if (on) setInfo({ shellVersion: "", windows: null, android: null }); });
    return () => { on = false; };
  }, [open]);

  const stay = useCallback(() => onClose(), [onClose]);
  const loading = info === null && open;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`¿Quieres instalar la APP para disfrutar de todas las características?`}
      description={`${APP_NAME} en el navegador funciona, pero el envoltorio de Windows abre un navegador real (YouTube, Gmail y el resto de HTTPS). En el iPhone se instala como PWA.`}
      size="md"
      footer={<Button variant="secondary" onClick={stay}>Seguir en el navegador</Button>}
    >
      <div className="space-y-3">
        {(platform === "windows" || platform === "other") && (
          <DownloadRow
            label="Windows"
            hint="Instalador sin firmar: SmartScreen puede avisar la primera vez. El .exe solo abre tu-dominio.example; la agenda se actualiza en el servidor."
            meta={info?.windows ?? null}
            loading={loading}
            availableLabel="Descargar para Windows"
            missingLabel="Instalador de Windows aún no publicado"
          />
        )}
        {platform === "android" && (
          <DownloadRow
            label="Android"
            hint="Cuando haya APK se descargará desde aquí. Mientras tanto puedes añadir la PWA a la pantalla de inicio."
            meta={info?.android ?? null}
            loading={loading}
            availableLabel="Descargar APK"
            missingLabel="APK próximamente"
          />
        )}
        {platform === "ios" && (
          <div className="rounded-2xl border border-border bg-bg/60 px-4 py-3">
            <p className="text-sm font-semibold text-text flex items-center gap-2">
              <Smartphone className="w-4 h-4" />iPhone y iPad
            </p>
            <p className="text-xs text-muted mt-1.5 leading-relaxed flex items-start gap-1.5">
              <Share className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              En Safari pulsa Compartir y elige «Añadir a pantalla de inicio». Apple no permite un APK ni un .exe.
            </p>
          </div>
        )}
        {platform !== "windows" && platform !== "other" && (
          <DownloadRow
            label="Windows"
            hint="También puedes instalar el envoltorio en un PC."
            meta={info?.windows ?? null}
            loading={loading}
            availableLabel="Descargar para Windows"
            missingLabel="Instalador de Windows aún no publicado"
          />
        )}
        {platform !== "android" && (
          <DownloadRow
            label="Android"
            hint="El APK llegará más adelante. En el teléfono usa la PWA."
            meta={info?.android ?? null}
            loading={loading}
            availableLabel="Descargar APK"
            missingLabel="APK próximamente"
          />
        )}
        <p className="text-[11px] text-faint flex items-center gap-1.5">
          <Globe className="w-3.5 h-3.5" />
          El navegador integrado solo existe en la app de escritorio, no en un iframe.
        </p>
      </div>
    </Modal>
  );
}
