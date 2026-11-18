import { useState } from 'react';
import { num } from '../util';

/**
 * Gráfica de barras de UNA serie (magnitud): un solo tono azul, puntas redondeadas de 4px
 * ancladas a la base, 2px de separación, cuadrícula tenue y tooltip al pasar el cursor.
 * Sin leyenda: el título de la tarjeta nombra la serie.
 */
export default function Barras({ datos, alto = 220, formatoEtiqueta }: {
  datos: { etiqueta: string; valor: number; extra?: string }[];
  alto?: number;
  formatoEtiqueta?: (e: string, i: number) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...datos.map((d) => d.valor));
  const paso = Math.pow(10, Math.floor(Math.log10(max)));
  const tope = Math.ceil(max / paso) * paso;
  const lineas = [0, 0.25, 0.5, 0.75, 1].map((f) => tope * f);
  const mostrarCada = Math.ceil(datos.length / 9);

  return (
    <div className="relative select-none" style={{ height: alto + 28 }}>
      {/* cuadrícula y eje */}
      <div className="absolute inset-x-0 top-0 ml-14" style={{ height: alto }}>
        {lineas.map((l) => (
          <div key={l} className="absolute inset-x-0 border-t border-slate-100" style={{ bottom: `${(l / tope) * 100}%` }}>
            <span className="num absolute -left-14 -translate-y-1/2 pr-2 text-right text-[11px] text-slate-400" style={{ width: 52 }}>
              {l >= 1000 ? `${+(l / 1000).toFixed(1)}k` : String(Math.round(l))}
            </span>
          </div>
        ))}
        <div className="absolute inset-0 flex items-end gap-[2px]">
          {datos.map((d, i) => (
            <div key={i} className="relative flex h-full flex-1 items-end" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <div className={`w-full rounded-t-[4px] transition-colors ${hover === i ? 'bg-blue-700' : 'bg-blue-600'}`}
                style={{ height: `${(d.valor / tope) * 100}%`, minHeight: d.valor > 0 ? 2 : 0 }} />
              {hover === i && (
                <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 -translate-x-1/2 whitespace-nowrap rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs text-white shadow-lg"
                  style={{ bottom: `${(d.valor / tope) * 100}%` }}>
                  <div className="text-slate-300">{formatoEtiqueta ? formatoEtiqueta(d.etiqueta, i) : d.etiqueta}</div>
                  <div className="num font-semibold">RD$ {num(d.valor)}</div>
                  {d.extra && <div className="text-slate-300">{d.extra}</div>}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      {/* etiquetas del eje X */}
      <div className="absolute inset-x-0 bottom-0 ml-14 flex gap-[2px]">
        {datos.map((d, i) => (
          <div key={i} className="num flex-1 truncate text-center text-[11px] text-slate-400">
            {i % mostrarCada === 0 ? (formatoEtiqueta ? formatoEtiqueta(d.etiqueta, i) : d.etiqueta) : ''}
          </div>
        ))}
      </div>
    </div>
  );
}
