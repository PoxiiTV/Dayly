const SIZE = 256;
const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);

/** Center-crop to a square JPEG small enough to store as avatarUrl. */
export async function fileToAvatarDataUrl(file: File): Promise<string> {
  if (!ALLOWED.has(file.type)) throw new Error("Usa una foto JPG, PNG o WebP.");
  if (file.size > MAX_BYTES) throw new Error("La foto pesa demasiado (máximo 8 MB).");

  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    throw new Error("No se pudo procesar la imagen.");
  }

  const side = Math.min(bitmap.width, bitmap.height);
  const sx = (bitmap.width - side) / 2;
  const sy = (bitmap.height - side) / 2;
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, SIZE, SIZE);
  bitmap.close();

  const url = canvas.toDataURL("image/jpeg", 0.84);
  if (url.length > 180_000) throw new Error("No se pudo comprimir la foto. Prueba otra imagen.");
  return url;
}
