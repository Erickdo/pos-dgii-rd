import { useEffect, useState } from 'react';
import { CheckCircle, Info, WarningCircle } from '@phosphor-icons/react';
import type { TipoAviso } from '../util';

interface Aviso { id: number; texto: string; tipo: TipoAviso }

export default function Avisos() {
  const [lista, setLista] = useState<Aviso[]>([]);

  useEffect(() => {
    const h = (e: Event) => {
      const { texto, tipo } = (e as CustomEvent).detail;
      const id = Date.now() + Math.random();
      setLista((l) => [...l.slice(-2), { id, texto, tipo }]);
      setTimeout(() => setLista((l) => l.filter((a) => a.id !== id)), tipo === 'error' ? 5000 : 3000);
    };
    window.addEventListener('aviso', h);
    return () => window.removeEventListener('aviso', h);
  }, []);

  return (
    <div className="pointer-events-none fixed right-5 top-20 z-[70] flex w-96 flex-col gap-2">
      {lista.map((a) => {
        const [Icono, color] = a.tipo === 'ok' ? [CheckCircle, 'text-emerald-500'] : a.tipo === 'error' ? [WarningCircle, 'text-red-500'] : [Info, 'text-blue-500'];
        return (
          <div key={a.id} className="animar-entrada pointer-events-auto flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-lg shadow-slate-900/10">
            <Icono size={22} weight="fill" className={`shrink-0 ${color}`} />
            <p className="text-sm font-medium text-slate-800">{a.texto}</p>
          </div>
        );
      })}
    </div>
  );
}
