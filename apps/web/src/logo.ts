/**
 * Recorte automático del logo: quita el margen blanco o transparente que rodea al dibujo,
 * para que el logo se vea grande aunque la imagen original venga con mucho espacio alrededor.
 */
function limites(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const d = ctx.getImageData(0, 0, w, h).data;
  // Color de fondo = el de la esquina superior izquierda (blanco, transparente o un color liso)
  const [r0, g0, b0, a0] = [d[0], d[1], d[2], d[3]];
  const esFondo = (i: number) => {
    const a = d[i + 3];
    if (a < 16) return true;                                     // transparente
    if (a0 < 16) return false;                                   // fondo transparente y este píxel no lo es
    return Math.abs(d[i] - r0) + Math.abs(d[i + 1] - g0) + Math.abs(d[i + 2] - b0) < 40;
  };
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!esFondo((y * w + x) * 4)) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) return null;                                       // imagen vacía: no se recorta
  const m = Math.round(Math.max(x1 - x0, y1 - y0) * 0.04);       // respiro del 4 %
  return { x: Math.max(0, x0 - m), y: Math.max(0, y0 - m), w: Math.min(w, x1 + m + 1) - Math.max(0, x0 - m), h: Math.min(h, y1 + m + 1) - Math.max(0, y0 - m) };
}

/** Recorta los bordes y reduce a `maximo` px por el lado más largo. Devuelve un data URL PNG. */
export async function recortarLogo(fuente: Blob | string, maximo = 640): Promise<string> {
  const img = typeof fuente === 'string'
    ? await new Promise<HTMLImageElement>((ok, mal) => { const i = new Image(); i.onload = () => ok(i); i.onerror = mal; i.src = fuente; })
    : await createImageBitmap(fuente);
  const w = img.width, h = img.height;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  const r = limites(ctx, w, h) ?? { x: 0, y: 0, w, h };
  const k = Math.min(1, maximo / Math.max(r.w, r.h));
  const out = document.createElement('canvas');
  out.width = Math.round(r.w * k); out.height = Math.round(r.h * k);
  const o = out.getContext('2d')!;
  o.imageSmoothingQuality = 'high';
  o.drawImage(c, r.x, r.y, r.w, r.h, 0, 0, out.width, out.height);
  return out.toDataURL('image/png');
}

// Logos ya guardados antes de esta versión: se recortan al mostrarlos (una vez por sesión)
const cache = new Map<string, Promise<string>>();
export function logoRecortado(src: string) {
  if (!cache.has(src)) cache.set(src, recortarLogo(src).catch(() => src));
  return cache.get(src)!;
}
