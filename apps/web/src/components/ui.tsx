import { useEffect, useRef, type KeyboardEvent as KeyEv, type ReactNode, type ButtonHTMLAttributes, type InputHTMLAttributes, type SelectHTMLAttributes } from 'react';
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
const TAMANOS = { sm: 'h-7 px-2.5 text-xs gap-1 rounded-md', md: 'h-9 px-3.5 text-sm gap-1.5 rounded-lg', lg: 'h-10 px-4 text-sm gap-2 rounded-lg', xl: 'h-12 px-5 text-base gap-2 rounded-xl' };

export function Boton({ variante = 'secundario', tamano = 'md', cargando, icono, children, className = '', ...p }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variante?: Variante; tamano?: keyof typeof TAMANOS; cargando?: boolean; icono?: ReactNode }) {
  return (
    <button {...p} disabled={p.disabled || cargando} data-principal={variante === 'primario' || variante === 'exito' || variante === 'peligro' ? '' : undefined}
      className={`inline-flex items-center justify-center font-semibold transition-colors disabled:opacity-45 ${VARIANTES[variante]} ${TAMANOS[tamano]} ${className}`}>
      {cargando ? <CircleNotch size={16} className="animate-spin" /> : icono}
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
    <div className="flex min-h-12 items-center justify-between gap-3 border-b border-slate-100 px-4 py-2.5">
      <div>
        <h3 className="text-sm font-semibold text-slate-900">{titulo}</h3>
        {descripcion && <p className="text-xs text-slate-500">{descripcion}</p>}
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
    <Tarjeta className="flex h-full flex-col p-4">
      <div className="flex min-h-8 items-start justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{titulo}</span>
        {icono && <span className={`grid size-8 shrink-0 place-items-center rounded-lg ${fondos[tono]}`}>{icono}</span>}
      </div>
      <div className="num mt-1 text-xl font-bold tracking-tight text-slate-900">{valor}</div>
      {detalle && <div className="mt-auto pt-0.5 text-xs text-slate-500">{detalle}</div>}
    </Tarjeta>
  );
}

// ---------------------------------------------------------------- formularios
export function Campo({ etiqueta, ayuda, error, children, className = '' }: { etiqueta: string; ayuda?: ReactNode; error?: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-xs font-medium text-slate-600">{etiqueta}</span>
      {children}
      {error ? <span className="mt-1 block text-xs text-red-600">{error}</span> : ayuda && <span className="mt-1 block text-xs text-slate-500">{ayuda}</span>}
    </label>
  );
}

const baseInput = 'h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-3 focus:ring-blue-500/10 disabled:bg-slate-50';
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
      <span className={`relative h-5 w-9 shrink-0 rounded-full transition ${activo ? 'bg-blue-600' : 'bg-slate-300'}`}>
        <span className={`absolute top-0.5 size-4 rounded-full bg-white shadow transition-all ${activo ? 'left-[18px]' : 'left-0.5'}`} />
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
  <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-px text-[11px] font-medium ring-1 ring-inset ${TONOS[tono]}`}>
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
const ENFOCABLES = 'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
/** ¿Es esta la ventana de más arriba? (con ventanas una sobre otra, solo la de arriba responde al teclado) */
export const esLaDeArriba = (el: Element | null) => { const t = document.querySelectorAll('[data-modal]'); return !!el && t[t.length - 1] === el; };

/**
 * Ventana modal manejable con teclado:
 *  - Al abrir enfoca el primer campo (o el botón principal si no hay campos).
 *  - Enter en un campo ejecuta el botón principal del pie (Guardar, Aplicar, Confirmar…).
 *  - Tab y Shift+Tab recorren solo los controles de la ventana.
 *  - Escape cierra solo la ventana de más arriba.
 */
export function Modal({ titulo, descripcion, onCerrar, children, ancho = 'max-w-lg', pie }: {
  titulo: string; descripcion?: string; onCerrar: () => void; children: ReactNode; ancho?: string; pie?: ReactNode;
}) {
  const raiz = useRef<HTMLDivElement>(null);
  const cuerpo = useRef<HTMLDivElement>(null);
  const piePanel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape' && esLaDeArriba(raiz.current)) { e.preventDefault(); e.stopImmediatePropagation(); onCerrar(); } };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [onCerrar]);

  useEffect(() => {
    const t = setTimeout(() => {
      if (raiz.current?.contains(document.activeElement)) return;
      const campo = cuerpo.current?.querySelector<HTMLElement>('input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled])');
      const principal = [...(piePanel.current?.querySelectorAll<HTMLButtonElement>('[data-principal]:not(:disabled)') ?? [])].pop();
      (campo ?? principal ?? raiz.current?.querySelector<HTMLElement>(ENFOCABLES))?.focus();
    }, 30);
    return () => clearTimeout(t);
  }, []);

  function teclas(e: KeyEv<HTMLDivElement>) {
    if (!esLaDeArriba(raiz.current)) return;
    const t = e.target as HTMLElement;
    if (e.key === 'Enter' && !e.defaultPrevented && !e.shiftKey && !e.nativeEvent.isComposing) {
      if (t.tagName === 'TEXTAREA' || t.tagName === 'BUTTON' || t.tagName === 'A' || t.closest('form')) return;
      const principal = [...(piePanel.current?.querySelectorAll<HTMLButtonElement>('[data-principal]:not(:disabled)') ?? [])].pop();
      if (principal) { e.preventDefault(); principal.click(); }
    }
    if (e.key === 'Tab') {
      const lista = [...(raiz.current?.querySelectorAll<HTMLElement>(ENFOCABLES) ?? [])].filter((x) => x.offsetParent !== null);
      if (!lista.length) return;
      const i = lista.indexOf(document.activeElement as HTMLElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); lista[lista.length - 1].focus(); }
      else if (!e.shiftKey && i === lista.length - 1) { e.preventDefault(); lista[0].focus(); }
    }
  }

  return (
    <div ref={raiz} data-modal="" role="dialog" aria-modal="true" aria-label={titulo} onKeyDown={teclas}
      className="fixed inset-0 z-50 grid place-items-center bg-slate-900/50 p-4 backdrop-blur-[2px]" onMouseDown={onCerrar}>
      <div onMouseDown={(e) => e.stopPropagation()} className={`animar-entrada flex max-h-[92vh] w-full ${ancho} flex-col overflow-hidden rounded-xl bg-white text-left shadow-2xl`}>
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">{titulo}</h2>
            {descripcion && <p className="text-xs text-slate-500">{descripcion}</p>}
          </div>
          <button onClick={onCerrar} tabIndex={-1} title="Cerrar (Esc)" className="grid size-7 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"><X size={18} /></button>
        </div>
        <div ref={cuerpo} className="scroll-fino min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {pie && (
          <div ref={piePanel} className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-5 py-2.5">
            <span className="mr-auto hidden text-[11px] text-slate-400 sm:inline"><Tecla>Enter</Tecla> confirmar · <Tecla>Esc</Tecla> cerrar</span>
            {pie}
          </div>
        )}
      </div>
    </div>
  );
}

/** Indicador de tecla, para mostrar atajos junto a los botones. */
export const Tecla = ({ children, oscura }: { children: ReactNode; oscura?: boolean }) => (
  <kbd className={`inline-flex h-4 min-w-4 items-center justify-center rounded px-1 font-sans text-[10px] font-semibold leading-none ${oscura ? 'bg-white/20 text-white' : 'border border-slate-200 bg-white text-slate-500'}`}>{children}</kbd>
);

// ---------------------------------------------------------------- pestañas
export function Pestanas<T extends string>({ opciones, valor, onChange }: { opciones: { id: T; texto: string; cuenta?: number }[]; valor: T; onChange: (v: T) => void }) {
  return (
    <div role="tablist" className="inline-flex rounded-lg bg-slate-100 p-1"
      onKeyDown={(e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        e.preventDefault();
        const caja = e.currentTarget;
        const i = opciones.findIndex((o) => o.id === valor);
        const n = opciones[(i + (e.key === 'ArrowRight' ? 1 : -1) + opciones.length) % opciones.length];
        onChange(n.id);
        setTimeout(() => caja.querySelector<HTMLElement>('[aria-selected=true]')?.focus(), 0);
      }}>
      {opciones.map((o) => (
        <button key={o.id} role="tab" aria-selected={valor === o.id} tabIndex={valor === o.id ? 0 : -1} onClick={() => onChange(o.id)}
          className={`flex h-7 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition ${valor === o.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>
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
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50/80">
            {columnas.map((c, i) => {
              const t = typeof c === 'string' ? c : c.t;
              const der = typeof c !== 'string' && c.derecha;
              return <th key={i} className={`whitespace-nowrap px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 ${der ? 'text-right' : 'text-left'}`}>{t}</th>;
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
  <td className={`px-3 py-2 align-middle ${derecha ? 'text-right' : ''} ${className}`}>{children}</td>
);

export function EncabezadoPagina({ titulo, descripcion, acciones }: { titulo: string; descripcion?: string; acciones?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900">{titulo}</h1>
        {descripcion && <p className="mt-0.5 text-[13px] text-slate-500">{descripcion}</p>}
      </div>
      {acciones && <div className="flex flex-wrap items-center gap-2">{acciones}</div>}
    </div>
  );
}
