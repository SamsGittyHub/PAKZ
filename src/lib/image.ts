"use client";
/** Resize to ≤ maxSide px and re-encode as WebP in the browser before upload. */
export async function compressImage(file: File, maxSide = 1600, quality = 0.82): Promise<{ blob: Blob; width: number; height: number }> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/webp", quality));
  if (!blob) throw new Error("Could not encode image");
  // Some browsers silently fall back to PNG if WebP encoding is unsupported.
  return { blob, width, height };
}

export async function toUploadForm(file: File): Promise<FormData> {
  const { blob, width, height } = await compressImage(file);
  const ext = blob.type === "image/webp" ? "webp" : blob.type.split("/")[1] ?? "png";
  const form = new FormData();
  form.set("file", new File([blob], `${crypto.randomUUID()}.${ext}`, { type: blob.type }));
  form.set("width", String(width));
  form.set("height", String(height));
  return form;
}
