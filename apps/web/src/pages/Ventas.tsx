import { useCallback, useEffect, useState } from 'react';
import { MagnifyingGlass, Printer, ArrowCounterClockwise, Receipt, LockKey, CheckCircle } from '@phosphor-icons/react';
import { api, ApiError } from '../api';
import { useApp } from '../contexto';
import Ticket from '../components/Ticket';
import { Boton, Campo, Celda, EncabezadoPagina, Entrada, Insignia, InsigniaFiscal, InsigniaTipo, KPI, Modal, Pestanas, Tabla, Tarjeta } from '../components/ui';
import { avisar, hoyISO, num, rd, sumarDias } from '../util';

interface VentaFila {
  id: string; fecha: string; monto_total: string; total_itbis: string; total_descuento: string; estado: 'completada' | 'anulada';
  motivo_anulacion: string | null; encf: string; tipo_ecf: string; estado_fiscal: string; cliente: string; identificacion: string | null;
  cajero: string; cajero_rol: string; terminal: string; metodos: string | null; nota_credito: string | null;
}
interface ResultadoNC { notaCredito: string; facturaAnulada: string; codigoSeguridad: string; devolverEfectivo: string; salidaRegistrada: boolean; devolverPorOtroMedio: { metodo: string; monto: string }[] }

export default function Ventas() {
  const { usuario, refrescarFiscal } = useApp();
  const [desde, setDesde] = useState(hoyISO());
  const [hasta, setHasta] = useState(hoyISO());
  const [q, setQ] = useState('');
  const [estado, setEstado] = useState<'' | 'completada' | 'anulada'>('');
  const [filas, setFilas] = useState<VentaFila[]>([]);
  const [ticket, setTicket] = useState<string | null>(null);
  const [anular, setAnular] = useState<VentaFila | null>(null);
  const [resultado, setResultado] = useState<ResultadoNC | null>(null);

  const cargar = useCallback(() => {
    const p = new URLSearchParams({ desde, hasta, q, ...(estado ? { estado } : {}) });
    api<VentaFila[]>(`/ventas?${p}`).then(setFilas).catch((e) => avisar(e.message, 'error'));
  }, [desde, hasta, q, estado]);
  useEffect(() => { const t = setTimeout(cargar, q ? 250 : 0); return () => clearTimeout(t); }, [cargar, q]);

  const completadas = filas.filter((f) => f.estado === 'completada');
  const total = completadas.reduce((s, f) => s + Number(f.monto_total), 0);
  const itbis = completadas.reduce((s, f) => s + Number(f.total_itbis), 0);

  const rango = (dias: number) => { setHasta(hoyISO()); setDesde(sumarDias(hoyISO(), -dias)); };

  return (
    <>
      <EncabezadoPagina titulo="Historial de Ventas" descripcion={usuario.rol === 'cajero' ? 'Tus facturas emitidas. Reimprime o emite una nota de crédito (E34).' : 'Facturas emitidas, reimpresión y notas de crédito electrónicas (E34) para devoluciones.'} />

      <div className="mb-6 grid gap-4 md:grid-cols-4">
        <KPI titulo="Ventas del período" valor={rd(total)} detalle={`${completadas.length} facturas`} icono={<Receipt size={20} />} tono="blue" />
        <KPI titulo="ITBIS facturado" valor={rd(itbis)} />
        <KPI titulo="Ticket promedio" valor={rd(completadas.length ? total / completadas.length : 0)} />
        <KPI titulo="Anuladas (E34)" valor={filas.length - completadas.length} detalle="con nota de crédito" icono={<ArrowCounterClockwise size={20} />} tono="red" />
      </div>

      <Tarjeta>
        <div className="flex flex-wrap items-end gap-3 border-b border-slate-100 p-4">
          <div className="relative min-w-64 flex-1">
            <MagnifyingGlass size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Entrada value={q} onChange={(e) => setQ(e.target.value)} placeholder="e-NCF, cliente, RNC o cédula" className="pl-10" />
          </div>
          <Entrada type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="w-40" />
          <span className="pb-2.5 text-slate-400">—</span>
          <Entrada type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="w-40" />
          <div className="flex gap-1">
            <Boton tamano="sm" variante="fantasma" onClick={() => rango(0)}>Hoy</Boton>
            <Boton tamano="sm" variante="fantasma" onClick={() => rango(6)}>7 días</Boton>
            <Boton tamano="sm" variante="fantasma" onClick={() => rango(29)}>30 días</Boton>
          </div>
          <Pestanas valor={estado} onChange={setEstado} opciones={[{ id: '', texto: 'Todas' }, { id: 'completada', texto: 'Vigentes' }, { id: 'anulada', texto: 'Anuladas' }]} />
        </div>

        <Tabla columnas={['Fecha', 'Comprobante', 'Cliente', 'Atendió / Caja', 'Pago', 'Estado DGII', { t: 'Total', derecha: true }, { t: '', derecha: true }]}
          vacio="No hay ventas en este período">
          {filas.map((f) => (
            <tr key={f.id} className={`hover:bg-slate-50/70 ${f.estado === 'anulada' ? 'opacity-70' : ''}`}>
              <Celda className="num text-slate-600"><div className="whitespace-nowrap">{f.fecha.slice(0, 10)}</div><div className="text-xs text-slate-400">{f.fecha.slice(11)}</div></Celda>
              <Celda>
                <div className="codigo whitespace-nowrap font-semibold text-slate-900">{f.encf}</div>
                <div className="mt-1"><InsigniaTipo tipo={f.tipo_ecf} /></div>
                {f.nota_credito && <div className="codigo mt-1 whitespace-nowrap text-xs text-violet-600">NC {f.nota_credito}</div>}
              </Celda>
              <Celda>
                <div className="max-w-48 truncate font-medium">{f.cliente}</div>
                {f.identificacion && <div className="codigo text-xs text-slate-500">{f.identificacion}</div>}
              </Celda>
              <Celda className="text-slate-600">{f.cajero}{f.cajero_rol === 'administrador' && <span className="ml-1 rounded bg-blue-50 px-1 text-[10px] font-semibold text-blue-700">ADMIN</span>}<div className="codigo text-[11px] text-slate-400">{f.terminal}</div></Celda>
              <Celda className="capitalize text-slate-600">{f.metodos?.replace('credito', 'crédito')}</Celda>
              <Celda>{f.estado === 'anulada' ? <Insignia tono="red">Anulada</Insignia> : <InsigniaFiscal estado={f.estado_fiscal} />}</Celda>
              <Celda derecha className={`num font-semibold ${f.estado === 'anulada' ? 'line-through' : ''}`}>{num(f.monto_total)}</Celda>
              <Celda derecha>
                <div className="flex justify-end gap-1">
                  <Boton tamano="sm" variante="fantasma" title="Reimprimir" onClick={() => setTicket(f.id)}><Printer size={16} /></Boton>
                  {f.estado === 'completada' && (
                    <Boton tamano="sm" variante="fantasma" className="text-red-600 hover:bg-red-50" onClick={() => setAnular(f)} icono={<ArrowCounterClockwise size={16} />}>E34</Boton>
                  )}
                </div>
              </Celda>
            </tr>
          ))}
        </Tabla>
      </Tarjeta>

      {ticket && <Ticket ventaId={ticket} reimpresion onCerrar={() => setTicket(null)} />}
      {anular && (
        <ModalAnular venta={anular} esAdmin={usuario.rol === 'administrador'} onCerrar={() => setAnular(null)}
          onListo={(r) => { setAnular(null); setResultado(r); cargar(); setTimeout(refrescarFiscal, 1500); }} />
      )}
      {resultado && (
        <Modal titulo="Nota de crédito emitida" onCerrar={() => setResultado(null)} ancho="max-w-md"
          pie={<Boton variante="primario" onClick={() => setResultado(null)}>Entendido</Boton>}>
          <div className="flex items-center gap-3">
            <CheckCircle size={40} weight="fill" className="text-emerald-500" />
            <div>
              <div className="codigo text-xl font-semibold">{resultado.notaCredito}</div>
              <div className="text-sm text-slate-500">Anula la factura <span className="codigo">{resultado.facturaAnulada}</span> · Código {resultado.codigoSeguridad}</div>
            </div>
          </div>
          <div className="mt-5 space-y-2 text-sm">
            {Number(resultado.devolverEfectivo) > 0 && (
              <div className="rounded-lg bg-emerald-50 p-3 ring-1 ring-emerald-200">
                Devuelve <b className="num">{rd(resultado.devolverEfectivo)}</b> en efectivo al cliente.
                {resultado.salidaRegistrada && ' Se registró la salida en tu caja.'}
              </div>
            )}
            {resultado.devolverPorOtroMedio.map((o) => (
              <div key={o.metodo} className="rounded-lg bg-amber-50 p-3 ring-1 ring-amber-200">
                <b className="num">{rd(o.monto)}</b> pagados con <b>{o.metodo}</b>: haz el reverso en el banco/datáfono.
              </div>
            ))}
            <p className="text-slate-500">El inventario se repuso automáticamente y la E34 se envía a la DGII.</p>
          </div>
        </Modal>
      )}
    </>
  );
}

function ModalAnular({ venta, esAdmin, onCerrar, onListo }: { venta: VentaFila; esAdmin: boolean; onCerrar: () => void; onListo: (r: ResultadoNC) => void }) {
  const [motivo, setMotivo] = useState('');
  const [pin, setPin] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function confirmar() {
    setEnviando(true);
    try { onListo(await api<ResultadoNC>(`/ventas/${venta.id}/anular`, { body: { motivo, pinSupervisor: pin || undefined } })); }
    catch (e) { avisar(e instanceof ApiError ? e.message : 'No se pudo anular', 'error'); }
    finally { setEnviando(false); }
  }

  return (
    <Modal titulo="Emitir nota de crédito (E34)" descripcion="Anula la factura completa y repone el inventario." onCerrar={onCerrar}
      pie={<><Boton onClick={onCerrar}>Cancelar</Boton><Boton variante="peligro" cargando={enviando} disabled={motivo.trim().length < 5 || (!esAdmin && pin.length < 4)} onClick={confirmar}>Emitir E34 y anular</Boton></>}>
      <div className="mb-4 flex items-center justify-between rounded-lg bg-slate-50 p-4">
        <div>
          <div className="codigo font-semibold">{venta.encf}</div>
          <div className="text-sm text-slate-500">{venta.cliente} · {venta.fecha}</div>
        </div>
        <div className="num text-xl font-bold">{rd(venta.monto_total)}</div>
      </div>
      <div className="space-y-4">
        <Campo etiqueta="Motivo de la devolución" ayuda="Aparece en la nota de crédito (RazonModificacion)">
          <Entrada autoFocus value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={90} placeholder="Ej.: producto defectuoso, error en el cobro" />
        </Campo>
        {!esAdmin && (
          <Campo etiqueta="PIN o contraseña del administrador" ayuda="Las anulaciones requieren autorización">
            <div className="relative">
              <LockKey size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <Entrada type="password" maxLength={60} value={pin} onChange={(e) => setPin(e.target.value)} placeholder="PIN o contraseña" className="codigo pl-10" />
            </div>
          </Campo>
        )}
      </div>
    </Modal>
  );
}

