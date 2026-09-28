export type WallpaperId = "none" | "custom" | (typeof WALLPAPERS)[number]["id"];

export const FEATURED_COUNT = 12;
export const MORE_PAGE = 9;

export const WALLPAPERS = [
  { id: "alps", name: "Alpes", credit: "Luca Bravo", url: "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?auto=format&fit=crop&w=1920&q=70" },
  { id: "forest", name: "Bosque", credit: "Sebastian Unrau", url: "https://images.unsplash.com/photo-1441974231531-c6227db76b6e?auto=format&fit=crop&w=1920&q=70" },
  { id: "ocean", name: "Costa", credit: "Sean Oulashin", url: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1920&q=70" },
  { id: "dusk", name: "Atardecer", credit: "Dawid Zawila", url: "https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?auto=format&fit=crop&w=1920&q=70" },
  { id: "night", name: "Noche", credit: "Ryan Hutton", url: "https://images.unsplash.com/photo-1419242902214-272b3f66ee7a?auto=format&fit=crop&w=1920&q=70" },
  { id: "city", name: "Ciudad", credit: "Pedro Lastra", url: "https://images.unsplash.com/photo-1480714378408-67cf0d13bc1b?auto=format&fit=crop&w=1920&q=70" },
  { id: "desert", name: "Desierto", credit: "Wolfgang Lutz", url: "https://images.unsplash.com/photo-1509316785289-025f5b846b35?auto=format&fit=crop&w=1920&q=70" },
  { id: "lake", name: "Lago", credit: "Luca Bravo", url: "https://images.unsplash.com/photo-1439066615861-d1af74d74000?auto=format&fit=crop&w=1920&q=70" },
  { id: "peaks", name: "Cumbres", credit: "Kalen Emsley", url: "https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=1920&q=70" },
  { id: "mist", name: "Niebla", credit: "Jay Mantri", url: "https://images.unsplash.com/photo-1418065460487-3e41a6c84dc5?auto=format&fit=crop&w=1920&q=70" },
  { id: "aurora", name: "Aurora", credit: "Jonatan Pie", url: "https://images.unsplash.com/photo-1531366936337-7c912a4589a7?auto=format&fit=crop&w=1920&q=70" },
  { id: "ink", name: "Tinta", credit: "Pawel Czerwinski", url: "https://images.unsplash.com/photo-1550684848-fac1c5b4e853?auto=format&fit=crop&w=1920&q=70" },
  { id: "sierra", name: "Sierra", credit: "David Marcu", url: "https://images.unsplash.com/photo-1469474968028-56623f02e42e?auto=format&fit=crop&w=1920&q=70" },
  { id: "snow", name: "Nieve", credit: "Kamil Szumotalski", url: "https://images.unsplash.com/photo-1579614088169-042c37287cb8?auto=format&fit=crop&w=1920&q=70" },
  { id: "glen", name: "Valle", credit: "Robert Lukeman", url: "https://images.unsplash.com/photo-1472214103451-9374bd1c798e?auto=format&fit=crop&w=1920&q=70" },
  { id: "stars", name: "Estrellas", credit: "Benjamin Voros", url: "https://images.unsplash.com/photo-1519681393784-d120267933ba?auto=format&fit=crop&w=1920&q=70" },
  { id: "grove", name: "Arboleda", credit: "Qingbao Meng", url: "https://images.unsplash.com/photo-1426604966848-d7adac402bff?auto=format&fit=crop&w=1920&q=70" },
  { id: "cabin", name: "Cabaña", credit: "Luca Bravo", url: "https://images.unsplash.com/photo-1470770841072-f978cf4d019e?auto=format&fit=crop&w=1920&q=70" },
  { id: "path", name: "Senda", credit: "Hanna Lazar", url: "https://images.unsplash.com/photo-1763713433757-efe06bbf58ea?auto=format&fit=crop&w=1920&q=70" },
  { id: "field", name: "Prado", credit: "David Marcu", url: "https://images.unsplash.com/photo-1470252649378-9c29740c9fa8?auto=format&fit=crop&w=1920&q=70" },
  { id: "palms", name: "Palmeras", credit: "Simeon Senecal", url: "https://images.unsplash.com/photo-1518173946687-a4c8892bbd9f?auto=format&fit=crop&w=1920&q=70" },
  { id: "tokyo", name: "Tokio", credit: "Jezael Melgoza", url: "https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?auto=format&fit=crop&w=1920&q=70" },
  { id: "dunes", name: "Dunas", credit: "Wolfgang Lutz", url: "https://images.unsplash.com/photo-1473580044384-7ba9967e16a0?auto=format&fit=crop&w=1920&q=70" },
  { id: "pines", name: "Pinos", credit: "Lukasz Szmigiel", url: "https://images.unsplash.com/photo-1448375240586-882707db888b?auto=format&fit=crop&w=1920&q=70" },
  { id: "space", name: "Espacio", credit: "NASA", url: "https://images.unsplash.com/photo-1462331940025-496dfbfc7564?auto=format&fit=crop&w=1920&q=70" },
  { id: "reef", name: "Arrecife", credit: "Cristian Palmer", url: "https://images.unsplash.com/photo-1559827260-dc66d52bef19?auto=format&fit=crop&w=1920&q=70" },
  { id: "glacier", name: "Glaciar", credit: "Timur Kozmenko", url: "https://images.unsplash.com/photo-1738539721560-5056a7c73263?auto=format&fit=crop&w=1920&q=70" },
  { id: "canopy", name: "Dosel", credit: "Sebastian Unrau", url: "https://images.unsplash.com/photo-1542273917363-3b1817f69a2d?auto=format&fit=crop&w=1920&q=70" },
  { id: "rain", name: "Lluvia", credit: "Noah Silliman", url: "https://images.unsplash.com/photo-1515694346937-94d85e41e6f0?auto=format&fit=crop&w=1920&q=70" },
  { id: "marble", name: "Mármol", credit: "Pawel Czerwinski", url: "https://images.unsplash.com/photo-1541701494587-cb58502866ab?auto=format&fit=crop&w=1920&q=70" },
  { id: "silk", name: "Seda", credit: "Pawel Czerwinski", url: "https://images.unsplash.com/photo-1557672172-298e090bd0f1?auto=format&fit=crop&w=1920&q=70" },
  { id: "wave", name: "Oleaje", credit: "Sean Oulashin", url: "https://images.unsplash.com/photo-1475924156734-496f6cac6ec1?auto=format&fit=crop&w=1920&q=70" },
  { id: "ridge", name: "Cresta", credit: "Kalen Emsley", url: "https://images.unsplash.com/photo-1486870591958-9b9d0d1dda99?auto=format&fit=crop&w=1920&q=70" },
  { id: "bloom", name: "Flor", credit: "RoonZ nl", url: "https://images.unsplash.com/photo-1520763185298-1b434c919102?auto=format&fit=crop&w=1920&q=70" },
  { id: "isla", name: "Isla", credit: "Jack Ward", url: "https://images.unsplash.com/photo-1483728642387-6c3bdd6c93e5?auto=format&fit=crop&w=1920&q=70" },
  { id: "harbor", name: "Puerto", credit: "Pedro Lastra", url: "https://images.unsplash.com/photo-1449824913935-59a10b8d2000?auto=format&fit=crop&w=1920&q=70" },
] as const;

export const WALLPAPER_STORAGE = "dayly.wallpaper";
export const CUSTOM_WALLPAPER_DATA_KEY = "dayly.demo.wallpaper";
const CUSTOM_BUST_KEY = "dayly.wallpaper.bust";

const PRESET_IDS = new Set<string>(WALLPAPERS.map((item) => item.id));

export function parseWallpaper(raw?: string | null): WallpaperId {
  if (!raw || raw === "none") return "none";
  if (raw === "custom") return "custom";
  if (PRESET_IDS.has(raw)) return raw as WallpaperId;
  return "none";
}

export function wallpaperById(id: string) {
  return WALLPAPERS.find((item) => item.id === id);
}

export function randomWallpaperId(except?: WallpaperId): WallpaperId {
  const pool = except ? WALLPAPERS.filter((item) => item.id !== except) : WALLPAPERS;
  const pick = pool[Math.floor(Math.random() * pool.length)] ?? WALLPAPERS[0];
  return pick.id;
}

export function extrasToReveal(id: WallpaperId): number {
  const index = WALLPAPERS.findIndex((item) => item.id === id);
  if (index < FEATURED_COUNT) return 0;
  return Math.ceil((index + 1 - FEATURED_COUNT) / MORE_PAGE) * MORE_PAGE;
}

export function wallpaperThumb(url: string): string {
  return url.replace("w=1920", "w=480").replace("q=70", "q=55");
}

export function wallpaperCssUrl(id: WallpaperId, bust?: number): string | null {
  if (id === "none") return null;
  if (id === "custom") {
    if (import.meta.env.VITE_APP_DEMO === "1") {
      try {
        const stored = localStorage.getItem(CUSTOM_WALLPAPER_DATA_KEY);
        return stored && stored.startsWith("data:image/") ? stored : null;
      } catch {
        return null;
      }
    }
    const token = bust ?? Number(localStorage.getItem(CUSTOM_BUST_KEY) || Date.now());
    return `/api/users/me/wallpaper?t=${token}`;
  }
  return wallpaperById(id)?.url ?? null;
}

export function customWallpaperPreview(active: boolean): string | null {
  if (!active) return null;
  return wallpaperCssUrl("custom");
}

export function paintWallpaper(id: WallpaperId, bust?: number) {
  if (typeof document === "undefined") return;
  const url = wallpaperCssUrl(id, bust);
  const root = document.documentElement;
  if (!url) {
    root.removeAttribute("data-wallpaper");
    root.style.removeProperty("--app-wallpaper");
    localStorage.setItem(WALLPAPER_STORAGE, "none");
    return;
  }
  root.setAttribute("data-wallpaper", id);
  root.style.setProperty("--app-wallpaper", `url("${url}")`);
  localStorage.setItem(WALLPAPER_STORAGE, id);
  if (bust) localStorage.setItem(CUSTOM_BUST_KEY, String(bust));
}

export async function fileToWallpaperBlob(file: File): Promise<Blob> {
  const allowed = new Set(["image/jpeg", "image/png", "image/webp"]);
  if (!allowed.has(file.type)) throw new Error("Usa una foto JPG, PNG o WebP.");
  if (file.size > 8 * 1024 * 1024) throw new Error("La foto pesa demasiado (máximo 8 MB).");
  const bitmap = await createImageBitmap(file);
  const max = 1920;
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    throw new Error("No se pudo procesar la imagen.");
  }
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
  if (!blob) throw new Error("No se pudo comprimir la foto.");
  return blob;
}
