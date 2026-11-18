import { useEffect, useState } from 'react';
import { Receipt, TrendUp, TrendDown, Coins, ShoppingBag, DownloadSimple, Warning, Wallet, FileCsv, Info } from '@phosphor-icons/react';
import { api, descargar } from '../api';
import Barras from '../components/Barras';
import { Boton, Celda, EncabezadoPagina, EncabezadoTarjeta, Entrada, Insignia, KPI, Pestanas, Tabla, Tarjeta, TIPOS_ECF } from '../components/ui';
import { avisar, hoyISO, num, rd, sumarDias } from '../util';

interface Hoy {
  hoy: string;
  totales: { ventas_hoy: string; tickets_hoy: number; itbis_hoy: string; anuladas_hoy: number; ventas_ayer: string; ventas_semana_pasada: string };
  porHora: { hora: number; total: string; tickets: number }[];
  top: { nombre: string; cantidad: string; total: string }[];
  porMetodo: { metodo: string; monto: string }[];
  cajas: { terminal: string; cajero: string; desde: string; total_ventas: string; efectivo_esperado: string }[];
  stockBajo: { nombre: string; stock_actual: string; stock_minimo: string }[];
  cxc: { total: string; clientes: number };
}
interface Resumen {
  totales: { ventas: string; tickets: number; base: string; itbis18: string; itbis16: string; itbis: string; descuentos: string; anuladas: number; monto_anulado: string };
  porDia: { dia: string; total: string; tickets: number }[];
  porCajero: { cajero: string; total: string; tickets: number }[];
  porMetodo: { metodo: string; monto: string }[];
  productos: { codigo_interno: string; nombre: string; cantidad: string; base: string; total: string; costo: string }[];
  comprobantes: { tipo_ecf: string; estado: string; cantidad: number; monto: string }[];
}
const METODOS: Record<string, string> = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia', credito: 'Crédito', cheque: 'Cheque', bono: 'Bonos', otro: 'Otro' };

export default function Reportes() {
  const [vista, setVista] = useState<'hoy' | 'periodo' | 'dgii'>('hoy');
  return (
    <>
      <EncabezadoPagina titulo="Reportes y Contabilidad" descripcion="Ventas diarias y mensuales, cuadre de ITBIS, productos más vendidos y exportación para la DGII." />
      <div className="mb-6"><Pestanas valor={vista} onChange={setVista} opciones={[{ id: 'hoy', texto: 'Resumen del día' }, { id: 'periodo', texto: 'Ventas por período' }, { id: 'dgii', texto: 'Formato 607 (DGII)' }]} /></div>
      {vista === 'hoy' && <Dia />}
      {vista === 'periodo' && <Periodo />}
      {vista === 'dgii' && <Formato607 />}
    </>
  );
}

function Variacion({ actual, anterior, texto }: { actual: number; anterior: number; texto: string }) {
  if (!anterior) return <span className="text-slate-400">Sin datos {texto}</span>;
  const v = ((actual - anterior) / anterior) * 100;
  const sube = v >= 0;
  return (
    <span className={`inline-flex items-center gap-1 font-medium ${sube ? 'text-emerald-600' : 'text-red-600'}`}>
      {sube ? <TrendUp size={14} weight="bold" /> : <TrendDown size={14} weight="bold" />}{Math.abs(v).toFixed(1)}% <span className="font-normal text-slate-500">{texto}</span>
    </span>
  );
}

function Dia() {
  const [d, setD] = useState<Hoy | null>(null);
  useEffect(() => { const c = () => api<Hoy>('/reportes/hoy').then(setD); c(); const t = setInterval(c, 30_000); return () => clearInterval(t); }, []);
  if (!d) return <p className="text-slate-400">Cargando…</p>;
  const t = d.totales;
  const ventas = Number(t.ventas_hoy);
  const totalMetodos = d.porMetodo.reduce((s, m) => s + Number(m.monto), 0) || 1;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KPI titulo="Ventas de hoy" valor={rd(ventas)} detalle={<Variacion actual={ventas} anterior={Number(t.ventas_ayer)} texto="vs. ayer" />} icono={<Coins size={20} />} tono="blue" />
        <KPI titulo="Facturas" valor={t.tickets_hoy} detalle={t.anuladas_hoy ? `${t.anuladas_hoy} anulada(s)` : 'sin anulaciones'} icono={<Receipt size={20} />} />
        <KPI titulo="Ticket promedio" valor={rd(t.tickets_hoy ? ventas / t.tickets_hoy : 0)} icono={<ShoppingBag size={20} />} />
        <KPI titulo="ITBIS cobrado hoy" valor={rd(t.itbis_hoy)} detalle={<Variacion actual={ventas} anterior={Number(t.ventas_semana_pasada)} texto="vs. mismo día semana pasada" />} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <Tarjeta>
          <EncabezadoTarjeta titulo="Ventas por hora" descripcion="RD$ facturado en cada hora de hoy" />
          <div className="p-5">
            <Barras datos={d.porHora.map((h) => ({ etiqueta: String(h.hora), valor: Number(h.total), extra: `${h.tickets} factura(s)` }))} formatoEtiqueta={(e) => `${e}h`} />
          </div>
        </Tarjeta>
        <Tarjeta>
          <EncabezadoTarjeta titulo="Cobros por método" />
          <div className="space-y-4 p-5">
            {d.porMetodo.map((m) => (
              <div key={m.metodo}>
                <div className="mb-1.5 flex justify-between text-sm"><span className="font-medium">{METODOS[m.metodo] ?? m.metodo}</span><span className="num text-slate-600">{rd(m.monto)}</span></div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-blue-600" style={{ width: `${(Number(m.monto) / totalMetodos) * 100}%` }} /></div>
              </div>
            ))}
            {!d.porMetodo.length && <p className="text-sm text-slate-500">Aún no hay cobros hoy.</p>}
          </div>
        </Tarjeta>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Tarjeta>
          <EncabezadoTarjeta titulo="Más vendidos hoy" />
          <Tabla columnas={['Producto', { t: 'Cant.', derecha: true }, { t: 'Total', derecha: true }]} vacio="Sin ventas">
            {d.top.map((p) => (
              <tr key={p.nombre}><Celda className="font-medium">{p.nombre}</Celda><Celda derecha className="num">{Number(p.cantidad)}</Celda><Celda derecha className="num font-semibold">{num(p.total)}</Celda></tr>
            ))}
          </Tabla>
        </Tarjeta>
        <Tarjeta>
          <EncabezadoTarjeta titulo="Cajas abiertas" />
          <Tabla columnas={['Caja', 'Cajero', { t: 'Ventas', derecha: true }, { t: 'Efectivo', derecha: true }]} vacio="No hay cajas abiertas">
            {d.cajas.map((c) => (
              <tr key={c.terminal}><Celda className="codigo font-medium">{c.terminal}</Celda><Celda>{c.cajero}<div className="text-xs text-slate-400">desde {c.desde}</div></Celda>
                <Celda derecha className="num">{num(c.total_ventas)}</Celda><Celda derecha className="num font-semibold">{num(c.efectivo_esperado)}</Celda></tr>
            ))}
          </Tabla>
        </Tarjeta>
        <div className="space-y-6">
          <Tarjeta className="p-5">
            <div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-lg bg-amber-50 text-amber-600"><Wallet size={20} /></span>
              <div><div className="text-sm text-slate-500">Cuentas por cobrar</div><div className="num text-xl font-bold">{rd(d.cxc.total)}</div></div>
              <span className="ml-auto text-sm text-slate-500">{d.cxc.clientes} cliente(s)</span></div>
          </Tarjeta>
          <Tarjeta>
            <EncabezadoTarjeta titulo="Stock bajo" accion={d.stockBajo.length ? <Insignia tono="amber">{d.stockBajo.length}</Insignia> : undefined} />
            <div className="divide-y divide-slate-100">
              {d.stockBajo.map((s) => (
                <div key={s.nombre} className="flex items-center gap-2 px-5 py-2.5 text-sm">
                  <Warning size={16} className="text-amber-500" /><span className="flex-1">{s.nombre}</span>
                  <span className="num font-semibold text-red-600">{Number(s.stock_actual)}</span><span className="num text-xs text-slate-400">/ {Number(s.stock_minimo)}</span>
                </div>
              ))}
              {!d.stockBajo.length && <p className="px-5 py-4 text-sm text-slate-500">Todo el inventario está sobre el mínimo.</p>}
            </div>
          </Tarjeta>
        </div>
      </div>
    </div>
  );
}

function Periodo() {
  const hoy = hoyISO();
  const inicioMes = hoy.slice(0, 8) + '01';
  const [desde, setDesde] = useState(inicioMes);
  const [hasta, setHasta] = useState(hoy);
  const [r, setR] = useState<Resumen | null>(null);
  useEffect(() => { api<Resumen>(`/reportes/resumen?desde=${desde}&hasta=${hasta}`).then(setR).catch((e) => avisar(e.message, 'error')); }, [desde, hasta]);

  const preset = (k: string) => {
    if (k === 'hoy') { setDesde(hoy); setHasta(hoy); }
    if (k === '7') { setDesde(sumarDias(hoy, -6)); setHasta(hoy); }
    if (k === 'mes') { setDesde(inicioMes); setHasta(hoy); }
    if (k === 'ant') { const f = new Date(inicioMes + 'T12:00:00'); f.setDate(0); const fin = f.toISOString().slice(0, 10); setDesde(fin.slice(0, 8) + '01'); setHasta(fin); }
  };

  const t = r?.totales;
  return (
    <div className="space-y-6">
      <Tarjeta className="flex flex-wrap items-center gap-3 p-4">
        <Entrada type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="w-40" />
        <span className="text-slate-400">—</span>
        <Entrada type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="w-40" />
        {[['hoy', 'Hoy'], ['7', 'Últimos 7 días'], ['mes', 'Este mes'], ['ant', 'Mes anterior']].map(([k, txt]) => (
          <Boton key={k} tamano="sm" variante="fantasma" onClick={() => preset(k)}>{txt}</Boton>
        ))}
      </Tarjeta>
      {t && r && (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <KPI titulo="Ventas netas" valor={rd(t.ventas)} detalle={`${t.tickets} facturas`} icono={<Coins size={20} />} tono="blue" />
            <KPI titulo="Ticket promedio" valor={rd(t.tickets ? Number(t.ventas) / t.tickets : 0)} />
            <KPI titulo="Descuentos otorgados" valor={rd(t.descuentos)} />
            <KPI titulo="Anuladas (E34)" valor={t.anuladas} detalle={rd(t.monto_anulado)} tono={t.anuladas ? 'red' : 'slate'} />
          </div>

          <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
            <Tarjeta>
              <EncabezadoTarjeta titulo="Ventas por día" descripcion="RD$ facturado (sin anuladas)" />
              <div className="p-5">
                <Barras datos={r.porDia.map((x) => ({ etiqueta: x.dia, valor: Number(x.total), extra: `${x.tickets} factura(s)` }))}
                  formatoEtiqueta={(e) => `${e.slice(8)}/${e.slice(5, 7)}`} />
              </div>
            </Tarjeta>
            <Tarjeta>
              <EncabezadoTarjeta titulo="Cuadre de ITBIS" descripcion="Para la declaración IT-1" />
              <dl className="num space-y-2.5 p-5 text-sm">
                <div className="flex justify-between text-slate-600"><dt>Ventas sin ITBIS (base)</dt><dd>{num(t.base)}</dd></div>
                <div className="flex justify-between text-slate-600"><dt>ITBIS 18%</dt><dd>{num(t.itbis18)}</dd></div>
                <div className="flex justify-between text-slate-600"><dt>ITBIS 16%</dt><dd>{num(t.itbis16)}</dd></div>
                <div className="flex justify-between border-t border-slate-200 pt-2.5 font-bold"><dt>ITBIS cobrado total</dt><dd>{num(t.itbis)}</dd></div>
                <div className="flex justify-between font-bold"><dt>Total facturado</dt><dd>{num(t.ventas)}</dd></div>
              </dl>
              <div className="border-t border-slate-100 p-5">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Por método de pago</div>
                {r.porMetodo.map((m) => <div key={m.metodo} className="num flex justify-between py-1 text-sm"><span>{METODOS[m.metodo] ?? m.metodo}</span><span>{num(m.monto)}</span></div>)}
              </div>
            </Tarjeta>
          </div>

          <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
            <Tarjeta>
              <EncabezadoTarjeta titulo="Productos más vendidos" />
              <Tabla columnas={['Producto', { t: 'Cant.', derecha: true }, { t: 'Venta (sin ITBIS)', derecha: true }, { t: 'Costo', derecha: true }, { t: 'Ganancia', derecha: true }, { t: 'Margen', derecha: true }]} vacio="Sin ventas">
                {r.productos.map((p) => {
                  const g = Number(p.base) - Number(p.costo);
                  return (
                    <tr key={p.codigo_interno}>
                      <Celda><div className="font-medium">{p.nombre}</div><div className="codigo text-xs text-slate-400">{p.codigo_interno}</div></Celda>
                      <Celda derecha className="num">{Number(p.cantidad)}</Celda>
                      <Celda derecha className="num">{num(p.base)}</Celda>
                      <Celda derecha className="num text-slate-500">{num(p.costo)}</Celda>
                      <Celda derecha className="num font-semibold">{num(g)}</Celda>
                      <Celda derecha className="num text-slate-600">{Number(p.base) ? `${((g / Number(p.base)) * 100).toFixed(0)}%` : '—'}</Celda>
                    </tr>
                  );
                })}
              </Tabla>
            </Tarjeta>
            <div className="space-y-6">
              <Tarjeta>
                <EncabezadoTarjeta titulo="Ventas por cajero" />
                <Tabla columnas={['Cajero', { t: 'Facturas', derecha: true }, { t: 'Total', derecha: true }]} vacio="Sin ventas">
                  {r.porCajero.map((c) => <tr key={c.cajero}><Celda>{c.cajero}</Celda><Celda derecha className="num">{c.tickets}</Celda><Celda derecha className="num font-semibold">{num(c.total)}</Celda></tr>)}
                </Tabla>
              </Tarjeta>
              <Tarjeta>
                <EncabezadoTarjeta titulo="Comprobantes emitidos" />
                <Tabla columnas={['Tipo', 'Estado', { t: 'Cant.', derecha: true }, { t: 'Monto', derecha: true }]} vacio="Ninguno">
                  {r.comprobantes.map((c, i) => <tr key={i}><Celda><span className="codigo font-semibold">E{c.tipo_ecf}</span> <span className="text-slate-500">{TIPOS_ECF[c.tipo_ecf]}</span></Celda><Celda className="capitalize text-slate-600">{c.estado.replace('_', ' ')}</Celda><Celda derecha className="num">{c.cantidad}</Celda><Celda derecha className="num">{num(c.monto)}</Celda></tr>)}
                </Tabla>
              </Tarjeta>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Formato607() {
  const anterior = (() => { const f = new Date(); f.setDate(1); f.setMonth(f.getMonth() - 1); return f.toISOString().slice(0, 7); })();
  const [mes, setMes] = useState(hoyISO().slice(0, 7));
  const [cargando, setCargando] = useState(false);
  async function exportar() {
    setCargando(true);
    try { await descargar(`/reportes/607.csv?mes=${mes}`, `607-${mes}.csv`); avisar('Archivo 607 descargado', 'ok'); }
    catch (e) { avisar((e as Error).message, 'error'); }
    finally { setCargando(false); }
  }
  return (
    <Tarjeta className="max-w-2xl p-6">
      <div className="flex items-start gap-4">
        <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-600"><FileCsv size={26} weight="duotone" /></span>
        <div>
          <h3 className="text-lg font-semibold">Formato 607 · Envío de datos de ventas</h3>
          <p className="mt-1 text-sm text-slate-500">Una línea por comprobante emitido en el mes (E31, E32, E34, E44, E45) con montos, ITBIS y forma de pago. Las notas de crédito incluyen el NCF modificado.</p>
        </div>
      </div>
      <div className="mt-6 flex items-end gap-3">
        <label className="block"><span className="mb-1.5 block text-sm font-medium text-slate-700">Período</span>
          <Entrada type="month" value={mes} onChange={(e) => setMes(e.target.value)} className="w-48" /></label>
        <Boton tamano="sm" variante="fantasma" onClick={() => setMes(anterior)}>Mes anterior</Boton>
        <Boton variante="primario" className="ml-auto" cargando={cargando} icono={<DownloadSimple size={18} weight="bold" />} onClick={exportar}>Descargar 607 (CSV)</Boton>
      </div>
      <p className="mt-6 flex gap-2 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
        <Info size={18} className="mt-0.5 shrink-0 text-blue-600" />
        Abre el archivo en Excel y cárgalo en la Herramienta de Envío de Datos de la DGII para validarlo antes de presentarlo.
      </p>
    </Tarjeta>
  );
}
