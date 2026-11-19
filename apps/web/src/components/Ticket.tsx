import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Printer, ArrowRight, CheckCircle } from '@phosphor-icons/react';
import { api } from '../api';
import { useApp } from '../contexto';
import { num } from '../util';
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
  const subtotal = v ? Number(v.monto_gravado_i1) + Number(v.monto_gravado_i2) + Number(v.monto_gravado_i3) + Number(v.monto_exento) : 0;
  const articulos = d ? d.items.reduce((n, it) => n + Number(it.cantidad), 0) : 0;
  const conVencimiento = v && ['31', '33', '34', '44', '45'].includes(v.tipo_ecf) && v.fecha_vencimiento_sec;
  return (
    <div data-modal="" className="fixed inset-0 z-50 flex items-center justify-center gap-8 bg-slate-900/60 p-6 backdrop-blur-[2px]">
      <style>{`@media print { @page { size: ${impresora.ancho}mm auto; margin: 0; } }`}</style>
      <div className={`ticket-impresion ticket-termico ${angosto ? 'ticket-58' : 'ticket-80'} scroll-fino max-h-full shrink-0 overflow-y-auto shadow-2xl`}>
        {!v ? <div className="py-20 text-center">Cargando…</div> : (
          <>
            {/* ───────── 1. emisor */}
            <header className="text-center">
              <div className="t-grande uppercase">{v.nombre_comercial ?? v.razon_social}</div>
              {v.nombre_comercial && v.nombre_comercial !== v.razon_social && <div className="uppercase">{v.razon_social}</div>}
              <div>RNC: <b>{v.rnc}</b></div>
              {v.direccion && <div className="t-chico">{v.direccion}</div>}
              {v.telefono && <div className="t-chico">Tel.: {v.telefono}</div>}
            </header>

            {/* ───────── 2. tipo de comprobante */}
            <div className="t-banda my-2">{TITULOS[v.tipo_ecf] ?? 'Comprobante Fiscal Electrónico'}</div>

            {/* ───────── 3. datos del comprobante */}
            <Datos filas={[
              ['e-NCF', <b key="e">{v.encf}</b>],
              ...(conVencimiento ? [['Vence', new Date(v.fecha_vencimiento_sec).toLocaleDateString('es-DO', { timeZone: 'UTC' })] as [string, React.ReactNode]] : []),
              ['Fecha', v.fecha],
              ['Caja', `${v.caja_codigo ?? '—'}${v.caja_descripcion ? ` · ${v.caja_descripcion}` : ''}`],
              ['Atendió', <span key="a"><b>{v.cajero}</b> ({ROLES[v.cajero_rol] ?? v.cajero_rol})</span>],
            ]} />

            {/* ───────── 4. cliente */}
            <Seccion titulo="Cliente" />
            {v.cliente_ident ? (
              <Datos filas={[
                [v.cliente_tipo_ident === 'CEDULA' ? 'Cédula' : 'RNC', <b key="r">{v.cliente_ident}</b>],
                ['Nombre', <span key="n" className="uppercase">{v.cliente_nombre}</span>],
              ]} />
            ) : <div>CONSUMIDOR FINAL</div>}
            {v.estado === 'anulada' && <div className="t-banda mt-2">Anulada · ver nota de crédito</div>}

            {/* ───────── 5. detalle */}
            <Seccion titulo="Detalle" />
            <div className="t-col-titulos grid grid-cols-[1fr_auto_auto] gap-x-2 font-bold">
              <span>DESCRIPCIÓN</span><span className={`text-right ${angosto ? 'w-[6.5ch]' : 'w-[8.5ch]'}`}>ITBIS</span><span className={`text-right ${angosto ? 'w-[8.5ch]' : 'w-[10.5ch]'}`}>VALOR</span>
            </div>
            <div className="t-sep-fino" />
            {d!.items.map((it) => (
              <div key={it.numero_linea} className="t-item">
                <div className="font-bold">{it.nombre}</div>
                <div className="grid grid-cols-[1fr_auto_auto] gap-x-2">
                  <span className="pl-[1ch]">{cant(it.cantidad)} x {num(it.precio_unitario)}{it.indicador_itbis === 2 ? ' (16%)' : it.indicador_itbis === 4 ? ' (E)' : ''}</span>
                  <span className={`text-right ${angosto ? 'w-[6.5ch]' : 'w-[8.5ch]'}`}>{it.indicador_itbis === 4 ? 'E' : num(it.itbis_item)}</span>
                  <span className={`text-right ${angosto ? 'w-[8.5ch]' : 'w-[10.5ch]'}`}>{num(it.monto_item)}</span>
                </div>
                {Number(it.descuento_monto) > 0 && <div className="t-chico pl-[1ch]">Descuento: -{num(it.descuento_monto)}</div>}
              </div>
            ))}
            <div className="t-sep-fino" />
            <Fila k="Cantidad de artículos" v={cant(String(articulos))} />

            {/* ───────── 6. totales */}
            <Seccion titulo="Resumen" />
            {/* Subtotal antes de descuentos; los montos gravados y exentos ya van netos */}
            <Fila k="Subtotal" v={num(subtotal + Number(v.total_descuento))} />
            {Number(v.total_descuento) > 0 && <><Fila k="Descuentos" v={`-${num(v.total_descuento)}`} /><Fila k="Subtotal neto" v={num(subtotal)} /></>}
            {Number(v.monto_exento) > 0 && <Fila k="Monto exento (E)" v={num(v.monto_exento)} />}
            {Number(v.monto_gravado_i1) > 0 && <Fila k="Gravado 18%" v={num(v.monto_gravado_i1)} />}
            {Number(v.monto_gravado_i2) > 0 && <Fila k="Gravado 16%" v={num(v.monto_gravado_i2)} />}
            {Number(v.monto_gravado_i3) > 0 && <Fila k="Gravado 0%" v={num(v.monto_gravado_i3)} />}
            {Number(v.total_itbis1) > 0 && <Fila k="ITBIS 18%" v={num(v.total_itbis1)} />}
            {Number(v.total_itbis2) > 0 && <Fila k="ITBIS 16%" v={num(v.total_itbis2)} />}
            <div className="t-banda t-total t-grande mt-1.5 flex justify-between !text-left"><span>TOTAL RD$</span><span>{num(v.monto_total)}</span></div>

            {/* ───────── 7. pago */}
            <Seccion titulo="Forma de pago" />
            {d!.pagos.map((p, i) => <Fila key={i} k={`${METODOS[p.metodo] ?? p.metodo}${p.referencia ? ` #${p.referencia}` : ''}`} v={num(p.monto)} />)}
            {Number(v.cambio) > 0 && <Fila k={<b>Devuelta</b>} v={<b>{num(v.cambio)}</b>} />}

            {/* ───────── 8. validación DGII */}
            <div className="t-sep mt-2" />
            <div className="flex flex-col items-center gap-0.5 pt-1 text-center">
              {qr && <img src={qr} alt="QR DGII" style={{ imageRendering: 'pixelated', width: angosto ? '24mm' : '28mm', height: angosto ? '24mm' : '28mm' }} />}
              <div className="mt-1">Código de seguridad: <b>{v.codigo_seguridad}</b></div>
              <div className="t-chico">Firma digital: {v.fecha_firma}</div>
              <div className="t-chico">Consulte este comprobante en dgii.gov.do</div>
            </div>
            {v.ambiente !== 'eCF' && <div className="t-chico mt-2 border border-black p-1 text-center font-bold">AMBIENTE DE PRUEBAS · SIN VALOR FISCAL</div>}
            {reimpresion && <div className="t-chico mt-1 text-center">*** REIMPRESIÓN ***</div>}
            <div className="t-sep mt-2" />
            <div className="text-center font-bold">{impresora.mensajePie}</div>
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

const Fila = ({ k, v }: { k: React.ReactNode; v: React.ReactNode }) => <div className="flex justify-between gap-2"><span>{k}</span><span className="text-right">{v}</span></div>;
/** Título de sección: ─── DETALLE ─── */
const Seccion = ({ titulo }: { titulo: string }) => <div className="t-seccion"><span>{titulo}</span></div>;
/** Pares etiqueta : valor con las etiquetas alineadas */
const Datos = ({ filas }: { filas: [string, React.ReactNode][] }) => (
  <div className="grid grid-cols-[auto_1fr] gap-x-2">
    {filas.map(([k, v]) => <React.Fragment key={k}><span>{k}:</span><span className="text-right">{v}</span></React.Fragment>)}
  </div>
);
