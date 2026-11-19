import { useEffect, useState } from 'react';
import { CashRegister, Lock } from '@phosphor-icons/react';
import { api, ApiError } from '../api';
import { useApp } from '../contexto';
import Teclado, { aplicarTecla } from './Teclado';
import { Boton, Tarjeta, Tecla } from './ui';
import { avisar, rd } from '../util';

interface Terminal { id: string; codigo: string; descripcion: string | null; sucursal: string; ocupada: boolean }

/** Apertura de turno: terminal + fondo inicial. Se usa en Punto de Venta y en Control de Caja. */
export default function AbrirCaja({ mensaje }: { mensaje?: string }) {
  const { recargarCaja } = useApp();
  const [terminales, setTerminales] = useState<Terminal[]>([]);
  const [terminal, setTerminal] = useState('');
  const [monto, setMonto] = useState('');
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    api<Terminal[]>('/terminales').then((t) => { setTerminales(t); setTerminal(t.find((x) => !x.ocupada)?.id ?? ''); });
  }, []);

  // Teclado físico: números para el fondo, ↑↓ para la terminal, Enter para abrir
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (document.querySelector('[data-modal]')) return;
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return;
      if (/^[\d.]$/.test(e.key)) { e.preventDefault(); setMonto((m) => aplicarTecla(m, e.key)); }
      else if (e.key === 'Backspace') { e.preventDefault(); setMonto((m) => aplicarTecla(m, '⌫')); }
      else if (e.key === 'Delete') { e.preventDefault(); setMonto(''); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const libres = terminales.filter((x) => !x.ocupada);
        const i = libres.findIndex((x) => x.id === terminal);
        const n = libres[(i + (e.key === 'ArrowDown' ? 1 : -1) + libres.length) % libres.length];
        if (n) setTerminal(n.id);
      }
      else if (e.key === 'Enter' && terminal && !enviando) { e.preventDefault(); abrir(); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  async function abrir() {
    setEnviando(true);
    try {
      await api('/cajas/abrir', { body: { terminalId: terminal, montoInicial: monto || '0' } });
      avisar('Caja abierta. ¡Buen turno!', 'ok');
      await recargarCaja();
    } catch (e) { avisar(e instanceof ApiError ? e.message : 'No se pudo abrir la caja', 'error'); }
    finally { setEnviando(false); }
  }

  return (
    <Tarjeta className="mx-auto grid max-w-2xl overflow-hidden md:grid-cols-2">
      <div className="border-b border-slate-200 p-5 md:border-b-0 md:border-r">
        <span className="grid size-10 place-items-center rounded-lg bg-blue-50 text-blue-600"><CashRegister size={22} weight="duotone" /></span>
        <h2 className="mt-3 text-lg font-bold tracking-tight">Abrir caja</h2>
        <p className="mt-0.5 text-[13px] text-slate-500">{mensaje ?? 'Elige la terminal y cuenta el efectivo con que empiezas el turno.'}</p>
        <div className="mt-4 space-y-1.5">
          {terminales.map((t) => (
            <button key={t.id} disabled={t.ocupada} onClick={() => setTerminal(t.id)}
              className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-[13px] transition disabled:opacity-50
                ${terminal === t.id ? 'border-blue-600 bg-blue-50 ring-1 ring-blue-600' : 'border-slate-200 hover:border-slate-300'}`}>
              <span><span className="codigo font-semibold">{t.codigo}</span><span className="text-slate-500"> · {t.descripcion ?? t.sucursal}</span></span>
              {t.ocupada && <span className="flex items-center gap-1 text-xs text-slate-500"><Lock size={13} /> En uso</span>}
            </button>
          ))}
        </div>
      </div>
      <div className="bg-slate-50 p-5">
        <div className="text-xs font-medium text-slate-500">Fondo inicial en efectivo</div>
        <div className="num mb-3 text-2xl font-bold">{rd(monto || 0)}</div>
        <Teclado decimal compacto onTecla={(t) => setMonto((m) => aplicarTecla(m, t))} />
        <Boton variante="primario" tamano="lg" className="mt-3 w-full" cargando={enviando} disabled={!terminal} onClick={abrir}>Abrir caja <Tecla oscura>Enter</Tecla></Boton>
        <p className="mt-2 text-center text-[11px] text-slate-400">Escribe el monto con el teclado · <Tecla>↑</Tecla><Tecla>↓</Tecla> terminal · <Tecla>Supr</Tecla> borrar</p>
      </div>
    </Tarjeta>
  );
}
