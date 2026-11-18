import { useEffect, type ReactNode, type ButtonHTMLAttributes, type InputHTMLAttributes, type SelectHTMLAttributes } from 'react';
import { X, CircleNotch } from '@phosphor-icons/react';

// ---------------------------------------------------------------- botones
type Variante = 'primario' | 'exito' | 'secundario' | 'peligro' | 'fantasma';
const VARIANTES: Record<Variante, string> = {
  primario: 'bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800 shadow-sm shadow-blue-600/20',
  exito: 'bg-emerald-500 text-white hover:bg-emerald-600 active:bg-emerald-700 shadow-sm shadow-emerald-500/20',
  secundario: 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 hover:border-slate-300 active:bg-slate-100',
  peligro: 'bg-red-600 text-white hover:bg-red-700 active:bg-red-800',
  fantasma: 'text-slate-600 hover:bg-slate-100 active:bg-slate-200',
};
const TAMANOS = { sm: 'h-8 px-3 text-sm gap-1.5 rounded-lg', md: 'h-10 px-4 text-sm gap-2 rounded-lg', lg: 'h-12 px-5 text-[15px] gap-2 rounded-xl', xl: 'h-14 px-6 text-base gap-2.5 rounded-xl' };

export function Boton({ variante = 'secundario', tamano = 'md', cargando, icono, children, className = '', ...p }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variante?: Variante; tamano?: keyof typeof TAMANOS; cargando?: boolean; icono?: ReactNode }) {
  return (
    <button {...p} disabled={p.disabled || cargando}
      className={`inline-flex items-center justify-center font-semibold transition-colors disabled:opacity-45 ${VARIANTES[variante]} ${TAMANOS[tamano]} ${className}`}>
      {cargando ? <CircleNotch size={18} className="animate-spin" /> : icono}
      {children}
    </button>
  );
}

// ---------------------------------------------------------------- contenedores
export const Tarjeta = ({ children, className = '' }: { children: ReactNode; className?: string }) => (
  <div className={`rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] ${className}`}>{children}</div>
);

export function EncabezadoTarjeta({ titulo, descripcion, accion }: { titulo: string; descripcion?: string; accion?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-slate-100 px-5 py-4">
      <div>
        <h3 className="text-[15px] font-semibold text-slate-900">{titulo}</h3>
        {descripcion && <p className="mt-0.5 text-sm text-slate-500">{descripcion}</p>}
      </div>
      {accion}
    </div>
  );
}

export function KPI({ titulo, valor, detalle, icono, tono = 'slate' }: {
  titulo: string; valor: ReactNode; detalle?: ReactNode; icono?: ReactNode; tono?: 'slate' | 'blue' | 'emerald' | 'amber' | 'red';
}) {
  const fondos = { slate: 'bg-slate-100 text-slate-600', blue: 'bg-blue-50 text-blue-600', emerald: 'bg-emerald-50 text-emerald-600', amber: 'bg-amber-50 text-amber-600', red: 'bg-red-50 text-red-600' };
  return (
    <Tarjeta className="p-5">
      <div className="flex items-start justify-between">
        <span className="text-sm font-medium text-slate-500">{titulo}</span>
        {icono && <span className={`grid size-9 place-items-center rounded-lg ${fondos[tono]}`}>{icono}</span>}
      </div>
      <div className="num mt-2 text-2xl font-bold tracking-tight text-slate-900">{valor}</div>
      {detalle && <div className="mt-1 text-sm text-slate-500">{detalle}</div>}
    </Tarjeta>
  );
}

// ---------------------------------------------------------------- formularios
export function Campo({ etiqueta, ayuda, error, children, className = '' }: { etiqueta: string; ayuda?: ReactNode; error?: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1.5 block text-sm font-medium text-slate-700">{etiqueta}</span>
      {children}
      {error ? <span className="mt-1 block text-xs text-red-600">{error}</span> : ayuda && <span className="mt-1 block text-xs text-slate-500">{ayuda}</span>}
    </label>
  );
}

const baseInput = 'h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 disabled:bg-slate-50';
/** Si className trae un ancho (w-40, w-20…) se respeta; si no, ocupa todo el ancho. */
const ancho = (c: string) => (/(^|\s)w-/.test(c) ? '' : 'w-full');
export const Entrada = ({ className = '', ...p }: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={`${baseInput} ${ancho(className)} ${className}`} />;
export const Selector = ({ className = '', children, ...p }: SelectHTMLAttributes<HTMLSelectElement>) => (
  <select {...p} className={`${baseInput} ${ancho(className)} pr-8 ${className}`}>{children}</select>
);

export function Interruptor({ activo, onChange, etiqueta, descripcion }: { activo: boolean; onChange: (v: boolean) => void; etiqueta: string; descripcion?: string }) {
  return (
    <button type="button" onClick={() => onChange(!activo)} className="flex w-full items-center justify-between gap-4 rounded-lg py-1 text-left">
      <span>
        <span className="block text-sm font-medium text-slate-800">{etiqueta}</span>
        {descripcion && <span className="block text-xs text-slate-500">{descripcion}</span>}
      </span>
      <span className={`relative h-6 w-11 shrink-0 rounded-full transition ${activo ? 'bg-blue-600' : 'bg-slate-300'}`}>
        <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all ${activo ? 'left-[22px]' : 'left-0.5'}`} />
      </span>
    </button>
  );
}

// ---------------------------------------------------------------- insignias de estado (siempre texto + color)
type TonoInsignia = 'slate' | 'blue' | 'emerald' | 'amber' | 'red' | 'violet';
const TONOS: Record<TonoInsignia, string> = {
  slate: 'bg-slate-100 text-slate-700 ring-slate-200', blue: 'bg-blue-50 text-blue-700 ring-blue-200',
  emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-200', amber: 'bg-amber-50 text-amber-800 ring-amber-200',
  red: 'bg-red-50 text-red-700 ring-red-200', violet: 'bg-violet-50 text-violet-700 ring-violet-200',
};
export const Insignia = ({ tono = 'slate', children, punto }: { tono?: TonoInsignia; children: ReactNode; punto?: boolean }) => (
  <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TONOS[tono]}`}>
    {punto && <span className="size-1.5 rounded-full bg-current" />}{children}
  </span>
);

export function InsigniaFiscal({ estado }: { estado: string }) {
  const m: Record<string, [TonoInsignia, string]> = {
    aceptado: ['emerald', 'Aceptado'], aceptado_condicional: ['emerald', 'Aceptado cond.'], rechazado: ['red', 'Rechazado'],
    firmado: ['amber', 'En cola'], enviado: ['blue', 'Enviado'], pendiente: ['amber', 'Pendiente'], anulado: ['slate', 'Anulado'],
  };
  const [t, txt] = m[estado] ?? ['slate', estado];
  return <Insignia tono={t} punto>{txt}</Insignia>;
}

export const TIPOS_ECF: Record<string, string> = {
  '31': 'Crédito fiscal', '32': 'Consumo', '33': 'Nota de débito', '34': 'Nota de crédito', '44': 'Régimen especial', '45': 'Gubernamental',
};
export const InsigniaTipo = ({ tipo }: { tipo: string }) => (
  <Insignia tono={tipo === '34' ? 'violet' : tipo === '32' ? 'slate' : 'blue'}><span className="codigo">E{tipo}</span> {TIPOS_ECF[tipo]}</Insignia>
);

// ---------------------------------------------------------------- modal
export function Modal({ titulo, descripcion, onCerrar, children, ancho = 'max-w-lg', pie }: {
  titulo: string; descripcion?: string; onCerrar: () => void; children: ReactNode; ancho?: string; pie?: ReactNode;
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onCerrar(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onCerrar]);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/50 p-4 backdrop-blur-[2px]" onMouseDown={onCerrar}>
      <div onMouseDown={(e) => e.stopPropagation()} className={`animar-entrada flex max-h-[92vh] w-full ${ancho} flex-col overflow-hidden rounded-2xl bg-white shadow-2xl`}>
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{titulo}</h2>
            {descripcion && <p className="mt-0.5 text-sm text-slate-500">{descripcion}</p>}
          </div>
          <button onClick={onCerrar} className="grid size-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"><X size={18} /></button>
        </div>
        <div className="scroll-fino min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {pie && <div className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-6 py-3.5">{pie}</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- pestañas
export function Pestanas<T extends string>({ opciones, valor, onChange }: { opciones: { id: T; texto: string; cuenta?: number }[]; valor: T; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded-lg bg-slate-100 p-1">
      {opciones.map((o) => (
        <button key={o.id} onClick={() => onChange(o.id)}
          className={`flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition ${valor === o.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>
          {o.texto}
          {o.cuenta !== undefined && <span className={`num rounded px-1.5 text-xs ${valor === o.id ? 'bg-slate-100' : 'bg-slate-200/70'}`}>{o.cuenta}</span>}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- tabla
export function Tabla({ columnas, children, vacio }: { columnas: (string | { t: string; derecha?: boolean })[]; children: ReactNode; vacio?: ReactNode }) {
  const hayFilas = Array.isArray(children) ? children.length > 0 : !!children;
  return (
    <div className="scroll-fino overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50/80">
            {columnas.map((c, i) => {
              const t = typeof c === 'string' ? c : c.t;
              const der = typeof c !== 'string' && c.derecha;
              return <th key={i} className={`whitespace-nowrap px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500 ${der ? 'text-right' : 'text-left'}`}>{t}</th>;
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
      {!hayFilas && <div className="px-4 py-12 text-center text-sm text-slate-500">{vacio ?? 'Sin registros'}</div>}
    </div>
  );
}

export const Celda = ({ children, derecha, className = '' }: { children?: ReactNode; derecha?: boolean; className?: string }) => (
  <td className={`px-4 py-3 align-middle ${derecha ? 'text-right' : ''} ${className}`}>{children}</td>
);

export function EncabezadoPagina({ titulo, descripcion, acciones }: { titulo: string; descripcion?: string; acciones?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">{titulo}</h1>
        {descripcion && <p className="mt-1 text-sm text-slate-500">{descripcion}</p>}
      </div>
      {acciones && <div className="flex flex-wrap items-center gap-2">{acciones}</div>}
    </div>
  );
}
