import { useApp } from '../contexto';

/** Punto verde "DGII en línea" · ámbar "Modo contingencia: X pendientes" · rojo si hay rechazos. */
export default function IndicadorDGII() {
  const { fiscal, ir } = useApp();
  if (!fiscal) return null;
  const { pendientes, rechazados } = fiscal.cola;
  const sinRed = fiscal.worker.ultimoTipoError === 'red';

  let color = 'bg-emerald-500', fondo = 'bg-emerald-50 text-emerald-800 ring-emerald-200', texto = 'DGII en línea';
  if (rechazados) { color = 'bg-red-500'; fondo = 'bg-red-50 text-red-800 ring-red-200'; texto = `${rechazados} rechazado${rechazados > 1 ? 's' : ''} por la DGII`; }
  else if (pendientes) {
    color = 'bg-amber-500'; fondo = 'bg-amber-50 text-amber-900 ring-amber-200';
    texto = `Modo contingencia: ${pendientes} pendiente${pendientes > 1 ? 's' : ''}`;
  }

  return (
    <button onClick={() => ir('fiscal')} title={sinRed ? 'Sin conexión con la DGII' : fiscal.cola.ultimo_error ?? 'Ver monitor DGII'}
      className={`flex h-9 items-center gap-2 rounded-full px-3.5 text-sm font-medium ring-1 ring-inset transition hover:brightness-95 ${fondo}`}>
      <span className="relative flex size-2.5">
        {(pendientes > 0 || rechazados > 0) && <span className={`absolute inline-flex size-full animate-ping rounded-full opacity-60 ${color}`} />}
        <span className={`relative inline-flex size-2.5 rounded-full ${color}`} />
      </span>
      {texto}
      <span className="codigo rounded bg-white/70 px-1.5 text-[11px] text-slate-600">{fiscal.ambiente}</span>
    </button>
  );
}
