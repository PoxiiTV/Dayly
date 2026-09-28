import { useEffect, useRef, useState, type ReactNode } from "react";
import { ImageIcon, Images, Shuffle, Upload } from "lucide-react";
import clsx from "clsx";
import { Button, Modal, useToast } from "@/components/ui";
import { http } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { PublicUser } from "@/lib/types";
import {
  FEATURED_COUNT,
  MORE_PAGE,
  WALLPAPERS,
  customWallpaperPreview,
  extrasToReveal,
  fileToWallpaperBlob,
  paintWallpaper,
  parseWallpaper,
  randomWallpaperId,
  type WallpaperId,
  wallpaperById,
  wallpaperThumb,
} from "@/lib/wallpapers";

/** `aside` shares the row with the picker (half each from `sm` up). */
export function WallpaperPicker({ aside }: { aside?: ReactNode } = {}) {
  const { user, applyWallpaper, refresh } = useAuth();
  const { push } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [moreCount, setMoreCount] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const selected = parseWallpaper(user?.wallpaper);
  const customSrc = customWallpaperPreview(selected === "custom");
  const current = selected === "none" || selected === "custom" ? null : wallpaperById(selected);
  const currentUrl = selected === "none" ? null : selected === "custom" ? customSrc : current?.url;
  const shown = WALLPAPERS.slice(0, FEATURED_COUNT + moreCount);
  const remaining = WALLPAPERS.length - shown.length;

  useEffect(() => {
    if (!open) {
      setMoreCount(0);
      return;
    }
    setMoreCount(extrasToReveal(selected));
  }, [open, selected]);

  const pick = async (id: WallpaperId) => {
    if (id === selected) {
      setOpen(false);
      return;
    }
    await applyWallpaper(id);
    setOpen(false);
  };

  const surprise = async () => {
    await pick(randomWallpaperId(selected));
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    try {
      const blob = await fileToWallpaperBlob(file);
      const body = new FormData();
      body.append("file", blob, "wallpaper.jpg");
      const data = await http.postForm<{ user: PublicUser }>("/api/users/me/wallpaper", body);
      paintWallpaper("custom", Date.now());
      if (data.user) await refresh();
      else await applyWallpaper("custom");
      push("success", "Fondo actualizado");
      setOpen(false);
    } catch (err: unknown) {
      push("error", err instanceof Error ? err.message : "No se pudo subir la foto.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <p className="text-xs font-medium text-muted mt-5 mb-2">Fondo</p>
      <div className={clsx("grid gap-2", aside && "sm:grid-cols-2")}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full flex items-center gap-3 rounded-xl border border-border p-2 pr-3 text-left hover:border-accent/40 hover:bg-surface transition-colors"
      >
        <span
          className="w-16 h-12 rounded-lg border border-border bg-bg bg-cover bg-center shrink-0"
          style={currentUrl ? { backgroundImage: `url("${currentUrl}")` } : undefined}
          aria-hidden
        />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-text">
            {selected === "none" ? "Color sólido" : selected === "custom" ? "Tu foto" : current?.name}
          </span>
          <span className="block text-[11px] text-faint">Galería Unsplash o una foto tuya. El velo mantiene el texto legible.</span>
        </span>
        <ImageIcon className="w-4 h-4 text-faint shrink-0" />
      </button>
      {aside}
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Fondo de la app"
        description="Elige una escena o sube la tuya. Un velo oscurece la imagen para que las tarjetas y el texto no pierdan contraste."
        size="lg"
      >
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => void onFile(e)} />
        <div className="flex items-center justify-end -mt-2 mb-1">
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void surprise()}>
            <Shuffle className="w-4 h-4" />Al azar
          </Button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
          <button
            type="button"
            aria-pressed={selected === "none"}
            onClick={() => void pick("none")}
            className={clsx(
              "relative overflow-hidden rounded-xl border text-left h-24 px-3 py-2.5",
              selected === "none" ? "border-accent ring-2 ring-accent/30" : "border-border hover:border-accent/40",
            )}
          >
            <span className="absolute inset-0 bg-bg" aria-hidden />
            <span className="relative text-xs font-medium text-text">Color sólido</span>
            <span className="relative block text-[11px] text-faint mt-0.5">Sin imagen</span>
          </button>

          <button
            type="button"
            disabled={busy}
            aria-pressed={selected === "custom"}
            onClick={() => (customSrc ? void pick("custom") : fileRef.current?.click())}
            className={clsx(
              "relative overflow-hidden rounded-xl border text-left h-24 px-3 py-2.5",
              selected === "custom" ? "border-accent ring-2 ring-accent/30" : "border-dashed border-border hover:border-accent/40",
            )}
            style={customSrc ? { backgroundImage: `url("${customSrc}")`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}
          >
            {!customSrc && <span className="absolute inset-0 bg-elevated" aria-hidden />}
            {customSrc && <span className="absolute inset-0 bg-bg/45" aria-hidden />}
            <span className="relative inline-flex items-center gap-1.5 text-xs font-medium text-text">
              <Upload className="w-3.5 h-3.5" />
              {customSrc ? "Tu foto" : "Subir foto"}
            </span>
            <span className="relative block text-[11px] text-faint mt-0.5">{customSrc ? "Pulsa para usar o elige otra" : "JPG, PNG o WebP"}</span>
          </button>

          {shown.map((item) => {
            const on = selected === item.id;
            return (
              <button
                key={item.id}
                type="button"
                aria-pressed={on}
                onClick={() => void pick(item.id)}
                className={clsx(
                  "relative overflow-hidden rounded-xl border text-left h-24 px-3 py-2.5 bg-cover bg-center",
                  on ? "border-accent ring-2 ring-accent/30" : "border-border hover:border-accent/40",
                )}
                style={{ backgroundImage: `url("${wallpaperThumb(item.url)}")` }}
              >
                <span className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" aria-hidden />
                <span className="relative text-xs font-semibold text-white drop-shadow">{item.name}</span>
                <span className="relative block text-[10px] text-white/75">{item.credit}</span>
              </button>
            );
          })}

          {remaining > 0 && (
            <button
              type="button"
              onClick={() => setMoreCount((n) => n + MORE_PAGE)}
              className="relative overflow-hidden rounded-xl border border-dashed border-border text-left h-24 px-3 py-2.5 hover:border-accent/40 hover:bg-elevated"
            >
              <span className="relative inline-flex items-center gap-1.5 text-xs font-medium text-text">
                <Images className="w-3.5 h-3.5" />
                Más fondos
              </span>
              <span className="relative block text-[11px] text-faint mt-0.5">{remaining} escenas más</span>
            </button>
          )}
        </div>
        {customSrc && (
          <div className="mt-3">
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => fileRef.current?.click()}>
              <Upload className="w-4 h-4" />Cambiar foto propia
            </Button>
          </div>
        )}
      </Modal>
    </>
  );
}
