import { useEffect, useState } from 'react';
import { CashRegister, Lock } from '@phosphor-icons/react';
import { api, ApiError } from '../api';
import { useApp } from '../contexto';
import Teclado, { aplicarTecla } from './Teclado';
import { Boton, Tarjeta } from './ui';
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
    <Tarjeta className="mx-auto grid max-w-3xl overflow-hidden md:grid-cols-2">
      <div className="border-b border-slate-200 p-7 md:border-b-0 md:border-r">
        <span className="grid size-12 place-items-center rounded-xl bg-blue-50 text-blue-600"><CashRegister size={26} weight="duotone" /></span>
        <h2 className="mt-4 text-xl font-bold tracking-tight">Abrir caja</h2>
        <p className="mt-1 text-sm text-slate-500">{mensaje ?? 'Elige la terminal y cuenta el efectivo con que empiezas el turno.'}</p>
        <div className="mt-6 space-y-2">
          {terminales.map((t) => (
            <button key={t.id} disabled={t.ocupada} onClick={() => setTerminal(t.id)}
              className={`flex w-full items-center justify-between rounded-lg border px-4 py-3 text-left text-sm transition disabled:opacity-50
                ${terminal === t.id ? 'border-blue-600 bg-blue-50 ring-1 ring-blue-600' : 'border-slate-200 hover:border-slate-300'}`}>
              <span><span className="codigo font-semibold">{t.codigo}</span><span className="text-slate-500"> · {t.descripcion ?? t.sucursal}</span></span>
              {t.ocupada && <span className="flex items-center gap-1 text-xs text-slate-500"><Lock size={13} /> En uso</span>}
            </button>
          ))}
        </div>
      </div>
      <div className="bg-slate-50 p-7">
        <div className="text-sm font-medium text-slate-500">Fondo inicial en efectivo</div>
        <div className="num mb-4 mt-1 text-3xl font-bold">{rd(monto || 0)}</div>
        <Teclado decimal compacto onTecla={(t) => setMonto((m) => aplicarTecla(m, t))} />
        <Boton variante="primario" tamano="xl" className="mt-4 w-full" cargando={enviando} disabled={!terminal} onClick={abrir}>Abrir caja</Boton>
      </div>
    </Tarjeta>
  );
}
