const fmt = new Intl.NumberFormat('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** RD$ 1,234.50 */
export const rd = (v: number | string) => `RD$ ${fmt.format(Number(v) || 0)}`;
/** 1,234.50 */
export const num = (v: number | string) => fmt.format(Number(v) || 0);

const r2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;
const TASA: Record<number, number> = { 1: 0.18, 2: 0.16, 3: 0, 4: 0 };

/**
 * Vista previa instantánea mientras se arma el carrito (misma regla que el servidor:
 * ITBIS sobre la base acumulada por tasa). El total oficial lo da /ventas/cotizar al cobrar.
 */
export function previsualizar(lineas: { precio: number; cantidad: number; indicador: number; descuento?: number }[]) {
  const base: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
  let bruto = 0, descuento = 0;
  for (const l of lineas) {
    const b = r2(l.precio * l.cantidad);
    const d = Math.min(l.descuento ?? 0, b);
    bruto += b; descuento += d;
    base[l.indicador] += r2(b - d);
  }
  const itbis1 = r2(base[1] * TASA[1]);
  const itbis2 = r2(base[2] * TASA[2]);
  const subtotal = r2(base[1] + base[2] + base[3] + base[4]);
  return { bruto: r2(bruto), descuento: r2(descuento), subtotal, exento: r2(base[3] + base[4]), itbis1, itbis2, itbis: r2(itbis1 + itbis2), total: r2(subtotal + itbis1 + itbis2) };
}

export const uuid = () =>
  crypto.randomUUID?.() ??
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });

// ---------------------------------------------------------------- avisos
export type TipoAviso = 'ok' | 'error' | 'info';
export function avisar(texto: string, tipo: TipoAviso = 'info') {
  window.dispatchEvent(new CustomEvent('aviso', { detail: { texto, tipo } }));
}

export const DENOMINACIONES = [2000, 1000, 500, 200, 100, 50, 25, 10, 5, 1];

export const redondear2 = r2;

/** Dígito verificador del RNC (9 dígitos) */
export function rncValido(rnc: string) {
  if (!/^\d{9}$/.test(rnc)) return false;
  const suma = [7, 9, 8, 6, 5, 4, 3, 2].reduce((s, p, i) => s + p * Number(rnc[i]), 0);
  const r = suma % 11;
  return (r === 0 ? 2 : r === 1 ? 1 : 11 - r) === Number(rnc[8]);
}
/** Dígito verificador de la cédula (11 dígitos, Luhn) */
export function cedulaValida(c: string) {
  if (!/^\d{11}$/.test(c)) return false;
  let s = 0;
  for (let i = 0; i < 10; i++) { let x = Number(c[i]) * (i % 2 ? 2 : 1); if (x > 9) x -= 9; s += x; }
  return (10 - (s % 10)) % 10 === Number(c[10]);
}
export const formatoIdent = (tipo: string, v: string | null) =>
  !v ? '' : tipo === 'CEDULA' && v.length === 11 ? `${v.slice(0, 3)}-${v.slice(3, 10)}-${v.slice(10)}` : tipo === 'RNC' && v.length === 9 ? `${v[0]}-${v.slice(1, 3)}-${v.slice(3, 8)}-${v[8]}` : v;

export const hoyISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santo_Domingo' }).format(new Date());
export const sumarDias = (iso: string, d: number) => { const x = new Date(iso + 'T12:00:00'); x.setDate(x.getDate() + d); return x.toISOString().slice(0, 10); };
