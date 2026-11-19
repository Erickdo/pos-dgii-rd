import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Printer, ArrowRight, CheckCircle } from '@phosphor-icons/react';
import { api } from '../api';
import { useApp } from '../contexto';
import { num } from '../util';
import '@fontsource/share-tech-mono/400.css';
import '@fontsource/courier-prime/400.css';
import '@fontsource/courier-prime/700.css';
import { Boton } from './ui';

interface DatosTicket {
  venta: Record<string, any>;
  items: { numero_linea: number; nombre: string; cantidad: string; precio_unitario: string; monto_item: string; indicador_itbis: number; descuento_monto: string; itbis_item: string }[];
  pagos: { metodo: string; monto: string; referencia: string | null }[];
}

const TITULOS: Record<string, string> = {
  '31': 'Factura de Crédito Fiscal Electrónica', '32': 'Factura de Consumo Electrónica', '34': 'Nota de Crédito Electrónica',
  '44': 'Comprobante Electrónico para Regímenes Especiales', '45': 'Comprobante Electrónico Gubernamental',
};
const ROLES: Record<string, string> = { administrador: 'Administrador', cajero: 'Cajero', contador: 'Contador' };
const METODOS: Record<string, string> = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia', credito: 'Crédito' };
/** Cantidad sin ceros de más: 2 → "2", 1.5 → "1.5" */
const cant = (x: string) => String(Number(x));

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
      if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); onCerrar(); }
      if (e.key.toLowerCase() === 'p' || e.key.toLowerCase() === 'i') { e.preventDefault(); window.print(); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onCerrar]);

  const v = d?.venta;
  // columnas del detalle: CANT. | DESCRIPCIÓN | ITBIS | VALOR
  const cols = angosto ? 'grid-cols-[5ch_1fr_7ch_8.5ch]' : 'grid-cols-[5.5ch_1fr_8.5ch_10.5ch]';
  const subtotal = v ? Number(v.monto_gravado_i1) + Number(v.monto_gravado_i2) + Number(v.monto_gravado_i3) + Number(v.monto_exento) : 0;
  return (
    <div data-modal="" className="fixed inset-0 z-50 flex items-center justify-center gap-8 bg-slate-900/60 p-6 backdrop-blur-[2px]">
      <style>{`@media print { @page { size: ${impresora.ancho}mm auto; margin: 0; } }`}</style>
      <div className={`ticket-impresion ticket-termico ${angosto ? 'ticket-58' : 'ticket-80'} scroll-fino max-h-full shrink-0 overflow-y-auto shadow-2xl`}>
        {!v ? <div className="py-20 text-center">Cargando…</div> : (
          <>
            {/* emisor */}
            <div className="text-center">
              <div className="t-grande uppercase">{v.nombre_comercial ?? v.razon_social}</div>
              {v.nombre_comercial && <div className="uppercase">{v.razon_social}</div>}
              <div>RNC: {v.rnc}</div>
              {v.direccion && <div>{v.direccion}</div>}
              {v.telefono && <div>Tel.: {v.telefono}</div>}
            </div>
            <Raya />
            <div className="text-center font-bold uppercase">{TITULOS[v.tipo_ecf] ?? 'Comprobante Fiscal Electrónico'}</div>
            <Raya fina />
            <Fila k="e-NCF:" v={<b>{v.encf}</b>} />
            {['31', '33', '34', '44', '45'].includes(v.tipo_ecf) && v.fecha_vencimiento_sec && (
              <Fila k="Válido hasta:" v={new Date(v.fecha_vencimiento_sec).toLocaleDateString('es-DO', { timeZone: 'UTC' })} />
            )}
            <Fila k="Fecha:" v={v.fecha} />
            <Fila k="Caja:" v={`${v.caja_codigo ?? '—'}${v.caja_descripcion ? ` · ${v.caja_descripcion}` : ''}`} />
            <div>Atendido por: <b>{v.cajero}</b> ({ROLES[v.cajero_rol] ?? v.cajero_rol})</div>
            {v.cliente_ident && (
              <>
                <Raya fina />
                <Fila k={v.cliente_tipo_ident === 'CEDULA' ? 'Cédula:' : 'RNC comprador:'} v={v.cliente_ident} />
                <div className="uppercase">Razón social: {v.cliente_nombre}</div>
              </>
            )}
            {v.estado === 'anulada' && <div className="mt-1 border border-black p-0.5 text-center font-bold">ANULADA — VER NOTA DE CRÉDITO</div>}
            <Raya />

            {/* detalle */}
            <div className={`grid ${cols} gap-x-1 font-bold`}>
              <span>CANT.</span><span>DESCRIPCIÓN</span><span className="text-right">ITBIS</span><span className="text-right">VALOR</span>
            </div>
            <Raya fina />
            {d!.items.map((it) => (
              <div key={it.numero_linea} className="mb-0.5">
                <div className={`grid ${cols} gap-x-1`}>
                  <span>{cant(it.cantidad)}</span>
                  <span className="break-words">{it.nombre}</span>
                  <span className="text-right">{it.indicador_itbis === 4 || it.indicador_itbis === 3 ? (it.indicador_itbis === 4 ? 'E' : '0.00') : num(it.itbis_item)}</span>
                  <span className="text-right">{num(it.monto_item)}</span>
                </div>
                <div className={`t-chico grid ${cols} gap-x-1 text-neutral-700`}>
                  <span />
                  <span>{num(it.precio_unitario)}{it.indicador_itbis === 2 ? ' · ITBIS 16%' : it.indicador_itbis === 4 ? ' · Exento' : ''}</span>
                  <span />
                  <span className="text-right">{Number(it.descuento_monto) > 0 ? `-${num(it.descuento_monto)}` : ''}</span>
                </div>
              </div>
            ))}
            <Raya />

            {/* desglose DGII */}
            <Fila k="SUBTOTAL" v={num(subtotal)} />
            {Number(v.total_descuento) > 0 && <Fila k="Descuentos aplicados" v={`-${num(v.total_descuento)}`} />}
            {Number(v.monto_exento) > 0 && <Fila k="Monto exento (E)" v={num(v.monto_exento)} />}
            {Number(v.monto_gravado_i1) > 0 && <Fila k="Monto gravado 18%" v={num(v.monto_gravado_i1)} />}
            {Number(v.monto_gravado_i2) > 0 && <Fila k="Monto gravado 16%" v={num(v.monto_gravado_i2)} />}
            {Number(v.monto_gravado_i3) > 0 && <Fila k="Monto gravado 0%" v={num(v.monto_gravado_i3)} />}
            {Number(v.total_itbis1) > 0 && <Fila k="ITBIS 18%" v={num(v.total_itbis1)} />}
            {Number(v.total_itbis2) > 0 && <Fila k="ITBIS 16%" v={num(v.total_itbis2)} />}
            <Raya fina />
            <div className="t-grande flex justify-between"><span>TOTAL RD$</span><span>{num(v.monto_total)}</span></div>
            <Raya />
            {d!.pagos.map((p, i) => <Fila key={i} k={`${METODOS[p.metodo] ?? p.metodo}${p.referencia ? ` #${p.referencia}` : ''}`} v={num(p.monto)} />)}
            {Number(v.cambio) > 0 && <Fila k="Cambio / Devuelta" v={num(v.cambio)} />}
            <Raya />
            <div className="flex flex-col items-center gap-1 text-center">
              {qr && <img src={qr} alt="QR DGII" style={{ imageRendering: 'pixelated', width: angosto ? '24mm' : '28mm', height: angosto ? '24mm' : '28mm' }} />}
              <div>Código de seguridad: <b>{v.codigo_seguridad}</b></div>
              <div>Fecha de firma digital: {v.fecha_firma}</div>
            </div>
            {v.ambiente !== 'eCF' && <div className="t-chico mt-2 border border-black p-1 text-center font-bold">AMBIENTE DE PRUEBAS · SIN VALOR FISCAL</div>}
            {reimpresion && <div className="t-chico mt-1 text-center">*** REIMPRESIÓN ***</div>}
            <div className="mt-2 text-center">{impresora.mensajePie}</div>
          </>
        )}
      </div>

      <div className="flex w-64 flex-col gap-2.5">
        <div className="rounded-xl bg-white p-4 shadow-xl">
          <div className="flex items-center gap-2 text-sm font-semibold text-emerald-600">
            <CheckCircle size={20} weight="fill" /> {reimpresion ? 'Comprobante' : 'Venta completada'}
          </div>
          {v && <div className="codigo mt-1 text-lg font-semibold text-slate-900">{v.encf}</div>}
          {v && <div className="mt-1 text-xs text-slate-500">{v.cajero} ({ROLES[v.cajero_rol] ?? v.cajero_rol}) · {v.caja_codigo}</div>}
          {v && !reimpresion && Number(v.cambio) > 0 && (
            <div className="mt-3 rounded-lg bg-emerald-50 p-3 ring-1 ring-emerald-200">
              <div className="text-sm font-semibold text-emerald-800">Entregar cambio</div>
              <div className="num text-2xl font-bold text-emerald-700">RD$ {num(v.cambio)}</div>
            </div>
          )}
        </div>
        <Boton tamano="lg" onClick={() => window.print()} icono={<Printer size={18} />}>Imprimir ticket ({impresora.ancho} mm)</Boton>
        <Boton tamano="lg" variante="primario" onClick={onCerrar}>{reimpresion ? 'Cerrar' : 'Nueva venta'} <ArrowRight size={18} weight="bold" /></Boton>
        <p className="text-center text-xs text-slate-300">Enter = nueva venta · P = imprimir · Esc = cerrar</p>
      </div>
    </div>
  );
}

const Raya = ({ fina }: { fina?: boolean }) => <div className={fina ? 't-sep-fino' : 't-sep'} />;
const Fila = ({ k, v }: { k: string; v: React.ReactNode }) => <div className="flex justify-between gap-2"><span>{k}</span><span className="text-right">{v}</span></div>;
