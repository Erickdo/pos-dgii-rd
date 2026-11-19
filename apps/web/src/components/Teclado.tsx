import { Backspace } from '@phosphor-icons/react';

/** Teclado numérico táctil. `decimal` habilita el punto. */
export default function Teclado({ onTecla, decimal = false, compacto = false }: { onTecla: (t: string) => void; decimal?: boolean; compacto?: boolean }) {
  const teclas = ['1', '2', '3', '4', '5', '6', '7', '8', '9', decimal ? '.' : 'C', '0', '⌫'];
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {teclas.map((t) => (
        <button key={t} type="button" onClick={() => onTecla(t)}
          className={`num grid place-items-center rounded-lg border border-slate-200 bg-white text-lg font-semibold text-slate-800 transition hover:bg-slate-50 active:bg-slate-100 ${compacto ? 'h-10' : 'h-12'}`}>
          {t === '⌫' ? <Backspace size={20} /> : t}
        </button>
      ))}
    </div>
  );
}

/** Aplica una tecla a un texto numérico. `esCodigo`: los ceros a la izquierda cuentan (PIN). */
export function aplicarTecla(actual: string, t: string, maxLargo = 10, esCodigo = false): string {
  if (t === '⌫') return actual.slice(0, -1);
  if (t === 'C') return '';
  if (t === '.') return actual.includes('.') ? actual : (actual || '0') + '.';
  if (actual.includes('.') && actual.split('.')[1].length >= 2) return actual;
  if (actual.replace('.', '').length >= maxLargo) return actual;
  if (esCodigo) return actual + t;
  return actual === '0' ? t : actual + t;
}
