const CLAVE = 'pos.sesion';

export interface Usuario { id: string; nombre: string; rol: 'cajero' | 'administrador' | 'contador' }
export interface Sesion { token: string; usuario: Usuario }

export function leerSesion(): Sesion | null {
  try { return JSON.parse(localStorage.getItem(CLAVE) ?? 'null'); } catch { return null; }
}
export function guardarSesion(s: Sesion | null) {
  try { s ? localStorage.setItem(CLAVE, JSON.stringify(s)) : localStorage.removeItem(CLAVE); } catch { /* sin storage */ }
}

export class ApiError extends Error {
  constructor(mensaje: string, public status: number, public codigo?: string) { super(mensaje); }
}

export async function api<T>(ruta: string, opciones: { method?: string; body?: unknown } = {}): Promise<T> {
  const sesion = leerSesion();
  let res: Response;
  try {
    res = await fetch(`/api${ruta}`, {
      method: opciones.method ?? (opciones.body ? 'POST' : 'GET'),
      headers: {
        ...(opciones.body ? { 'Content-Type': 'application/json' } : {}),
        ...(sesion ? { Authorization: `Bearer ${sesion.token}` } : {}),
      },
      body: opciones.body ? JSON.stringify(opciones.body) : undefined,
    });
  } catch {
    throw new ApiError('No hay conexión con el servidor del POS', 0);
  }
  const datos = await res.json().catch(() => ({}));
  if (res.status === 401 && datos.error === 'SESION') window.dispatchEvent(new Event('sesion-vencida'));
  if (!res.ok) throw new ApiError(datos.mensaje ?? 'Error inesperado', res.status, datos.error);
  return datos as T;
}

// ---------------------------------------------------------------- tipos de dominio
export interface Producto {
  id: string; codigo_interno: string; codigo_barras: string | null; nombre: string;
  precio_venta: string; indicador_itbis: 1 | 2 | 3 | 4; tasa: string; precio_final: string;
  maneja_inventario: boolean; stock_actual: string; stock_minimo: string; categoria: string | null;
}
export interface Categoria { id: string; nombre: string; productos: number }
export interface Cliente {
  id: string; nombre: string; tipo_identificacion: string; identificacion: string | null;
  correo_fe: string | null; es_contribuyente: boolean; telefono?: string | null;
  limite_credito?: string; saldo?: string; activo?: boolean;
}
export interface Caja { id: string; monto_inicial: string; abierta_en: string; terminal: string; sucursal: string }
export interface Totales {
  montoGravadoI1: string; montoGravadoI2: string; montoGravadoI3: string; montoExento: string;
  totalItbis1: string; totalItbis2: string; totalItbis: string; totalDescuento: string; montoTotal: string;
}
export type MetodoPago = 'efectivo' | 'tarjeta' | 'transferencia' | 'credito';
export type TipoComprobante = '32' | '31' | '44' | '45';
export interface Pago { metodo: MetodoPago; monto: string; referencia?: string; ultimos4?: string }
export interface ResultadoVenta {
  ventaId: string; encf: string; tipoECF: string; montoTotal: string; cambio: string;
  codigoSeguridad: string; urlQr: string; estadoFiscal: string;
}
export interface EstadoFiscal {
  ambiente: string; certificadoPrueba: boolean;
  certificado: { esPrueba: boolean; vence: string; titular: string; origen: string; diasRestantes: number };
  worker: { ultimoIntento: string | null; ultimoExito: string | null; ultimoTipoError: 'red' | 'autenticacion' | 'otro' | null };
  emisor: { rnc: string; razon_social: string; nombre_comercial: string | null } | null;
  cola: { pendientes: number; rechazados: number; aceptados: number; total: number; limite_mas_proximo: string | null; ultimo_error: string | null };
  secuencias: { comprobante: string; restantes: string; fecha_vencimiento: string | null; alerta: boolean }[];
}

export interface ConfigImpresora { ancho: '80' | '58'; copias: number; mensajePie: string; imprimirAutomatico: boolean }

/** Descarga un archivo protegido por sesión (CSV, XML) */
export async function descargar(ruta: string, nombre: string) {
  const s = leerSesion();
  const res = await fetch(`/api${ruta}`, { headers: s ? { Authorization: `Bearer ${s.token}` } : {} });
  if (!res.ok) throw new ApiError((await res.json().catch(() => ({}))).mensaje ?? 'No se pudo descargar', res.status);
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: nombre });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
