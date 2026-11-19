import { useEffect, useState } from 'react';
import { Money, CreditCard, Bank, HandCoins, X, Plus, CheckCircle, Trash } from '@phosphor-icons/react';
import type { Cliente, MetodoPago, Pago, TipoComprobante, Totales } from '../api';
import Teclado, { aplicarTecla } from './Teclado';
import { InsigniaTipo, Tecla } from './ui';
import { avisar, num, rd } from '../util';

const BILLETES = [100, 200, 500, 1000, 2000];
const r2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;

export default function Cobro({ totales, tipo, cliente, onCancelar, onConfirmar }: {
  totales: Totales; tipo: TipoComprobante; cliente: Cliente | null;
  onCancelar: () => void; onConfirmar: (pagos: Pago[]) => Promise<void>;
}) {
  const total = Number(totales.montoTotal);
  const creditoDisponible = cliente ? Math.max(0, Number(cliente.limite_credito ?? 0) - Number(cliente.saldo ?? 0)) : 0;
  const METODOS: { id: MetodoPago; nombre: string; Icono: typeof Money; deshabilitado?: string }[] = [
    { id: 'efectivo', nombre: 'Efectivo', Icono: Money },
    { id: 'tarjeta', nombre: 'Tarjeta', Icono: CreditCard },
    { id: 'transferencia', nombre: 'Transferencia', Icono: Bank },
    { id: 'credito', nombre: 'Crédito', Icono: HandCoins, deshabilitado: !cliente ? 'Elige un cliente' : creditoDisponible <= 0 ? 'Sin crédito disponible' : undefined },
  ];

  const [pagos, setPagos] = useState<Pago[]>([]);
  const [metodo, setMetodo] = useState<MetodoPago>('efectivo');
  const [monto, setMonto] = useState('');
  const [referencia, setReferencia] = useState('');
  const [ultimos4, setUltimos4] = useState('');
  const [enviando, setEnviando] = useState(false);

  const pagado = r2(pagos.reduce((s, p) => s + Number(p.monto), 0));
  const restante = r2(Math.max(0, total - pagado));
  const enCurso = Number(monto) || 0;
  const pagadoFinal = r2(pagado + enCurso);
  const cambio = r2(Math.max(0, pagadoFinal - total));
  const necesitaRef = metodo === 'tarjeta' || metodo === 'transferencia';
  const listo = pagadoFinal + 0.001 >= total;

  useEffect(() => {
    if (metodo !== 'efectivo') setMonto(restante ? Math.min(restante, metodo === 'credito' ? creditoDisponible : Infinity).toFixed(2) : '');
  }, [metodo]); // eslint-disable-line

  function pagoActual(): Pago | null {
    if (enCurso <= 0) return null;
    if (restante <= 0) { avisar('El total ya está cubierto', 'error'); return null; }
    if (metodo !== 'efectivo' && enCurso > restante + 0.001) { avisar('Este método no puede pasar del monto restante', 'error'); return null; }
    if (metodo === 'credito' && enCurso > creditoDisponible + 0.001) { avisar(`Crédito disponible: ${rd(creditoDisponible)}`, 'error'); return null; }
    if (necesitaRef && !referencia.trim()) { avisar(`Escribe el número de ${metodo === 'tarjeta' ? 'aprobación' : 'referencia'}`, 'error'); return null; }
    return {
      metodo, monto: enCurso.toFixed(2),
      ...(necesitaRef ? { referencia: referencia.trim() } : {}),
      ...(metodo === 'tarjeta' && /^\d{4}$/.test(ultimos4) ? { ultimos4 } : {}),
    };
  }

  function agregarPago() {
    const p = pagoActual();
    if (!p) return;
    setPagos((l) => [...l, p]);
    setMonto(''); setReferencia(''); setUltimos4(''); setMetodo('efectivo');
  }

  async function confirmar() {
    if (enviando) return;
    const actual = enCurso > 0 ? pagoActual() : null;
    if (enCurso > 0 && !actual) return;
    const lista = actual ? [...pagos, actual] : pagos;
    if (r2(lista.reduce((s, p) => s + Number(p.monto), 0)) + 0.001 < total) return avisar('Falta dinero para completar el pago', 'error');
    setEnviando(true);
    try { await onConfirmar(lista); } catch { setEnviando(false); }
  }

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'F7') { e.preventDefault(); const orden: MetodoPago[] = ['efectivo', 'tarjeta', 'transferencia', 'credito']; setMetodo((m) => orden[(orden.indexOf(m) + 1) % orden.length]); return; }
      if (e.key === 'Insert' || (e.key === '+' && !(e.target instanceof HTMLInputElement))) { e.preventDefault(); agregarPago(); return; }
      if (e.target instanceof HTMLInputElement) { if (e.key === 'Enter') confirmar(); if (e.key === 'Escape' && !enviando) onCancelar(); return; }
      if (/^[\d.]$/.test(e.key)) setMonto((m) => aplicarTecla(m, e.key));
      else if (e.key === 'Backspace') setMonto((m) => aplicarTecla(m, '⌫'));
      else if (e.key === 'Enter') confirmar();
      else if (e.key === 'Escape' && !enviando) onCancelar();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  return (
    <div data-modal="" className="fixed inset-0 z-50 grid place-items-center bg-slate-900/50 p-4 backdrop-blur-[2px]">
      <div className="animar-entrada grid w-full max-w-4xl grid-cols-[1fr_1.2fr] overflow-hidden rounded-2xl bg-white shadow-2xl">
        {/* Resumen */}
        <section className="flex flex-col border-r border-slate-200 bg-slate-50 p-6">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold uppercase tracking-wide text-slate-500">Total a pagar</span>
            <InsigniaTipo tipo={tipo} />
          </div>
          <div className="num mt-2 text-[42px] font-bold leading-none tracking-tight text-slate-900">{rd(total)}</div>
          {cliente && <div className="mt-2 truncate text-sm text-slate-500">{cliente.nombre}</div>}
          <dl className="num mt-5 space-y-1.5 border-t border-slate-200 pt-4 text-sm text-slate-600">
            <Fila k="Subtotal" v={Number(totales.montoGravadoI1) + Number(totales.montoGravadoI2) + Number(totales.montoGravadoI3) + Number(totales.montoExento) + Number(totales.totalDescuento)} />
            {Number(totales.totalDescuento) > 0 && <Fila k="Descuento" v={-Number(totales.totalDescuento)} />}
            {Number(totales.totalItbis1) > 0 && <Fila k="ITBIS 18%" v={totales.totalItbis1} />}
            {Number(totales.totalItbis2) > 0 && <Fila k="ITBIS 16%" v={totales.totalItbis2} />}
            {Number(totales.montoExento) > 0 && <Fila k="Exento" v={totales.montoExento} />}
          </dl>

          <div className="mt-5 flex-1 space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Pagos registrados</div>
            {pagos.map((p, i) => (
              <div key={i} className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm">
                <span className="font-medium capitalize">{p.metodo === 'credito' ? 'Crédito' : p.metodo}{p.referencia && <span className="codigo ml-1.5 text-xs text-slate-400">#{p.referencia}</span>}</span>
                <span className="flex items-center gap-3">
                  <span className="num font-semibold">{num(p.monto)}</span>
                  <button onClick={() => setPagos((l) => l.filter((_, j) => j !== i))} className="text-slate-400 hover:text-red-600"><Trash size={16} /></button>
                </span>
              </div>
            ))}
            {!pagos.length && <p className="text-sm text-slate-400">Un solo método, o usa “Pago mixto” para combinar.</p>}
          </div>

          <div className="mt-4 space-y-2 rounded-xl bg-white p-4 ring-1 ring-slate-200">
            <div className="flex justify-between text-sm text-slate-600"><span>Recibido</span><span className="num font-semibold text-slate-900">{rd(pagadoFinal)}</span></div>
            {listo
              ? <div className="flex items-baseline justify-between"><span className="font-semibold text-emerald-700">Cambio</span><span className="num text-3xl font-bold text-emerald-600">{rd(cambio)}</span></div>
              : <div className="flex items-baseline justify-between"><span className="font-semibold text-slate-700">Falta</span><span className="num text-3xl font-bold text-slate-900">{rd(r2(total - pagadoFinal))}</span></div>}
          </div>
        </section>

        {/* Captura */}
        <section className="flex flex-col p-6">
          <div className="mb-4 flex items-start gap-2">
            <div className="grid flex-1 grid-cols-4 gap-2">
              {METODOS.map(({ id, nombre, Icono, deshabilitado }) => (
                <button key={id} onClick={() => setMetodo(id)} disabled={!!deshabilitado} title={deshabilitado}
                  className={`flex h-16 flex-col items-center justify-center gap-1 rounded-xl border text-sm font-semibold transition disabled:opacity-40
                    ${metodo === id ? 'border-blue-600 bg-blue-600 text-white shadow-md shadow-blue-600/25' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'}`}>
                  <Icono size={22} weight={metodo === id ? 'fill' : 'regular'} />{nombre}
                </button>
              ))}
            </div>
            <button onClick={onCancelar} disabled={enviando} className="grid size-9 place-items-center rounded-lg text-slate-400 hover:bg-slate-100"><X size={20} /></button>
          </div>

          <div className="flex items-end justify-between rounded-xl border-2 border-blue-600/80 bg-blue-50/40 px-4 py-3">
            <span className="text-sm font-medium text-slate-500">Monto · {METODOS.find((m) => m.id === metodo)?.nombre}</span>
            <span className="num text-3xl font-bold text-slate-900">{monto ? num(monto) : <span className="text-slate-300">0.00</span>}</span>
          </div>

          {metodo === 'efectivo' && (
            <div className="mt-3 grid grid-cols-6 gap-2">
              <button onClick={() => setMonto(restante.toFixed(2))} className="h-11 rounded-lg bg-blue-50 text-sm font-semibold text-blue-700 hover:bg-blue-100">Exacto</button>
              {BILLETES.map((b) => (
                <button key={b} onClick={() => setMonto((m) => String(r2((Number(m) || 0) + b)))}
                  className="num h-11 rounded-lg border border-slate-200 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50">+{b}</button>
              ))}
            </div>
          )}
          {necesitaRef && (
            <div className="mt-3 grid grid-cols-[1fr_120px] gap-2">
              <input value={referencia} onChange={(e) => setReferencia(e.target.value)} autoFocus
                placeholder={metodo === 'tarjeta' ? 'No. de aprobación' : 'No. de referencia'}
                className="h-11 rounded-lg border border-slate-300 px-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
              {metodo === 'tarjeta' && (
                <input value={ultimos4} onChange={(e) => setUltimos4(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="Últimos 4" inputMode="numeric"
                  className="num h-11 rounded-lg border border-slate-300 px-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
              )}
            </div>
          )}
          {metodo === 'credito' && (
            <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2.5 text-sm text-slate-600">
              Crédito disponible de <b>{cliente?.nombre}</b>: <span className="num font-semibold text-slate-900">{rd(creditoDisponible)}</span>
            </div>
          )}

          <div className="mt-3"><Teclado decimal compacto onTecla={(t) => setMonto((m) => aplicarTecla(m, t))} /></div>

          <div className="mt-4 grid grid-cols-[auto_1fr] gap-2">
            <button onClick={agregarPago} disabled={!enCurso || !restante}
              className="flex h-14 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40">
              <Plus size={18} weight="bold" /> Pago mixto <Tecla>Insert</Tecla>
            </button>
            <button onClick={confirmar} disabled={!listo || enviando}
              className="flex h-14 items-center justify-center gap-2 rounded-xl bg-emerald-500 text-lg font-bold text-white shadow-lg shadow-emerald-500/25 transition hover:bg-emerald-600 disabled:opacity-40 disabled:shadow-none">
              <CheckCircle size={24} weight="fill" /> {enviando ? 'Emitiendo e-CF…' : 'Confirmar pago'} <Tecla oscura>Enter</Tecla>
            </button>
          </div>
          <p className="mt-2 text-center text-[11px] text-slate-400">Escribe el monto con el teclado · <Tecla>F7</Tecla> forma de pago · <Tecla>Insert</Tecla> agregar pago · <Tecla>Esc</Tecla> cancelar</p>
        </section>
      </div>
    </div>
  );
}

const Fila = ({ k, v }: { k: string; v: string | number }) => (
  <div className="flex justify-between"><dt>{k}</dt><dd className={Number(v) < 0 ? 'text-red-600' : ''}>{Number(v) < 0 ? '−' : ''}{num(Math.abs(Number(v)))}</dd></div>
);
