import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Printer, ArrowRight, CheckCircle } from '@phosphor-icons/react';
import { api } from '../api';
import { useApp } from '../contexto';
import { num } from '../util';
import { Boton } from './ui';

interface DatosTicket {
  venta: Record<string, any>;
  items: { numero_linea: number; nombre: string; cantidad: string; precio_unitario: string; monto_item: string; indicador_itbis: number; descuento_monto: string }[];
  pagos: { metodo: string; monto: string; referencia: string | null }[];
}

const TITULOS: Record<string, string> = {
  '31': 'Factura de Crédito Fiscal Electrónica', '32': 'Factura de Consumo Electrónica', '34': 'Nota de Crédito Electrónica',
  '44': 'Comprobante Electrónico para Regímenes Especiales', '45': 'Comprobante Electrónico Gubernamental',
};
const MARCA: Record<number, string> = { 1: '', 2: ' (16%)', 3: ' (0%)', 4: ' (E)' };

/** Representación impresa (RI) del e-CF en 80 o 58 mm. */
export default function Ticket({ ventaId, onCerrar, reimpresion }: { ventaId: string; onCerrar: () => void; reimpresion?: boolean }) {
  const { impresora } = useApp();
  const [d, setD] = useState<DatosTicket | null>(null);
  const [qr, setQr] = useState('');
  const angosto = impresora.ancho === '58';

  useEffect(() => {
    api<DatosTicket>(`/ventas/${ventaId}/ticket`).then(async (t) => {
      setD(t);
      setQr(await QRCode.toDataURL(t.venta.url_qr, { margin: 0, width: 240, errorCorrectionLevel: 'M' }));
      if (impresora.imprimirAutomatico && !reimpresion) setTimeout(() => window.print(), 300);
    });
  }, [ventaId]); // eslint-disable-line

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === 'Escape') onCerrar();
      if (e.key.toLowerCase() === 'p' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); window.print(); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onCerrar]);

  const v = d?.venta;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center gap-10 bg-slate-900/60 p-6 backdrop-blur-[2px]">
      <style>{`@media print { @page { size: ${impresora.ancho}mm auto; margin: 0; } .ticket-impresion { width: ${impresora.ancho}mm !important; } }`}</style>
      <div className={`ticket-impresion scroll-fino max-h-full overflow-y-auto bg-white font-mono leading-[1.45] text-black shadow-2xl ${angosto ? 'w-[230px] px-3 py-5 text-[10px]' : 'w-[310px] px-5 py-6 text-[11.5px]'}`}>
        {!v ? <div className="py-20 text-center">Cargando…</div> : (
          <>
            <div className="text-center">
              <div className="text-[1.25em] font-bold uppercase">{v.nombre_comercial ?? v.razon_social}</div>
              {v.nombre_comercial && <div>{v.razon_social}</div>}
              <div>RNC {v.rnc}</div>
              <div>{v.direccion}</div>
              {v.telefono && <div>Tel. {v.telefono}</div>}
            </div>
            <Raya />
            <div className="text-center font-bold uppercase">{TITULOS[v.tipo_ecf] ?? 'Comprobante Fiscal Electrónico'}</div>
            <div className="mt-1 flex justify-between"><span>e-NCF:</span><b>{v.encf}</b></div>
            {['31', '44', '45'].includes(v.tipo_ecf) && v.fecha_vencimiento_sec && (
              <div className="flex justify-between"><span>Válido hasta:</span><span>{new Date(v.fecha_vencimiento_sec).toLocaleDateString('es-DO', { timeZone: 'UTC' })}</span></div>
            )}
            <div className="flex justify-between"><span>Fecha:</span><span>{v.fecha}</span></div>
            <div className="flex justify-between"><span>Cajero:</span><span>{v.cajero}</span></div>
            {v.cliente_ident && (
              <>
                <div className="mt-1 flex justify-between"><span>RNC/Céd.:</span><span>{v.cliente_ident}</span></div>
                <div className="truncate">{v.cliente_nombre}</div>
              </>
            )}
            {v.estado === 'anulada' && <div className="mt-1 border border-black p-0.5 text-center font-bold">ANULADA — ver nota de crédito</div>}
            <Raya />
            {d!.items.map((it) => (
              <div key={it.numero_linea} className="mb-1">
                <div>{it.nombre}{MARCA[it.indicador_itbis]}</div>
                <div className="flex justify-between pl-2"><span>{Number(it.cantidad)} x {num(it.precio_unitario)}</span><span>{num(it.monto_item)}</span></div>
                {Number(it.descuento_monto) > 0 && <div className="flex justify-between pl-2"><span>Descuento</span><span>-{num(it.descuento_monto)}</span></div>}
              </div>
            ))}
            <Raya />
            {Number(v.total_descuento) > 0 && <Fila k="Descuentos" v={`-${num(v.total_descuento)}`} />}
            {Number(v.monto_gravado_i1) > 0 && <Fila k="Gravado 18%" v={num(v.monto_gravado_i1)} />}
            {Number(v.monto_gravado_i2) > 0 && <Fila k="Gravado 16%" v={num(v.monto_gravado_i2)} />}
            {Number(v.monto_exento) > 0 && <Fila k="Exento" v={num(v.monto_exento)} />}
            {Number(v.total_itbis1) > 0 && <Fila k="ITBIS 18%" v={num(v.total_itbis1)} />}
            {Number(v.total_itbis2) > 0 && <Fila k="ITBIS 16%" v={num(v.total_itbis2)} />}
            <div className="mt-1 flex justify-between text-[1.3em] font-bold"><span>TOTAL RD$</span><span>{num(v.monto_total)}</span></div>
            <Raya />
            {d!.pagos.map((p, i) => <Fila key={i} k={p.metodo === 'credito' ? 'Crédito' : p.metodo.charAt(0).toUpperCase() + p.metodo.slice(1)} v={num(p.monto)} />)}
            {Number(v.cambio) > 0 && <Fila k="Cambio" v={num(v.cambio)} />}
            <Raya />
            <div className="flex flex-col items-center gap-1.5 text-center">
              {qr && <img src={qr} alt="QR DGII" className={angosto ? 'size-[100px]' : 'size-[120px]'} style={{ imageRendering: 'pixelated' }} />}
              <div>Código de seguridad: <b>{v.codigo_seguridad}</b></div>
              <div>Fecha de firma: {v.fecha_firma}</div>
            </div>
            {v.ambiente !== 'eCF' && <div className="mt-2 border border-black p-1 text-center text-[0.85em] font-bold">AMBIENTE DE PRUEBAS · SIN VALOR FISCAL</div>}
            {reimpresion && <div className="mt-1 text-center text-[0.85em]">*** REIMPRESIÓN ***</div>}
            <div className="mt-3 text-center">{impresora.mensajePie}</div>
          </>
        )}
      </div>

      <div className="flex w-72 flex-col gap-3">
        <div className="rounded-2xl bg-white p-5 shadow-xl">
          <div className="flex items-center gap-2 text-sm font-semibold text-emerald-600">
            <CheckCircle size={20} weight="fill" /> {reimpresion ? 'Comprobante' : 'Venta completada'}
          </div>
          {v && <div className="codigo mt-1 text-xl font-semibold text-slate-900">{v.encf}</div>}
          {v && !reimpresion && Number(v.cambio) > 0 && (
            <div className="mt-4 rounded-xl bg-emerald-50 p-4 ring-1 ring-emerald-200">
              <div className="text-sm font-semibold text-emerald-800">Entregar cambio</div>
              <div className="num text-3xl font-bold text-emerald-700">RD$ {num(v.cambio)}</div>
            </div>
          )}
        </div>
        <Boton tamano="xl" onClick={() => window.print()} icono={<Printer size={20} />}>Imprimir ticket ({impresora.ancho} mm)</Boton>
        <Boton tamano="xl" variante="primario" onClick={onCerrar}>{reimpresion ? 'Cerrar' : 'Nueva venta'} <ArrowRight size={20} weight="bold" /></Boton>
        <p className="text-center text-xs text-slate-300">Enter = continuar · Ctrl+P = imprimir</p>
      </div>
    </div>
  );
}

const Raya = () => <div className="my-2 border-t border-dashed border-black" />;
const Fila = ({ k, v }: { k: string; v: string }) => <div className="flex justify-between"><span>{k}</span><span>{v}</span></div>;
