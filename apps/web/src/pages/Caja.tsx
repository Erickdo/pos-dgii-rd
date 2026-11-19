import { useCallback, useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, LockKey, Money, CreditCard, Bank, Wallet, Printer, Receipt } from '@phosphor-icons/react';
import { api, ApiError } from '../api';
import { useApp } from '../contexto';
import AbrirCaja from '../components/AbrirCaja';
import { Boton, Campo, Celda, EncabezadoPagina, EncabezadoTarjeta, Entrada, Insignia, KPI, Modal, Tabla, Tarjeta } from '../components/ui';
import { avisar, DENOMINACIONES, num, rd } from '../util';

interface Resumen {
  monto_inicial: string; ventas_efectivo: string; cambio_entregado: string; entradas: string; salidas: string;
  efectivo_esperado: string; total_ventas: string; total_itbis: string; num_ventas: string; por_metodo: Record<string, number> | null;
}
interface Movimiento { tipo: 'entrada' | 'salida'; monto: string; motivo: string; hora: string; usuario: string; usuario_rol: string; autorizado_por: string | null }
const ROL: Record<string, string> = { administrador: 'Admin.', cajero: 'Cajero', contador: 'Contador' };
interface Turno {
  id: string; terminal: string; cajero: string; cajero_rol: string; cerrada_por: string | null; cerrada_por_rol: string | null; estado: string; abierta: string; cerrada: string | null; monto_inicial: string;
  efectivo_esperado: string | null; efectivo_contado: string | null; diferencia: string | null; tarjeta_lote: string | null;
  total_ventas: string; num_ventas: string; por_metodo: Record<string, number> | null;
}

export default function Caja() {
  const { caja, usuario } = useApp();
  if (caja === undefined) return <p className="text-slate-400">Cargando…</p>;
  return (
    <>
      <EncabezadoPagina titulo="Control de Caja" descripcion="Apertura de turno, entradas y salidas de efectivo, arqueo y cierre con cuadre de efectivo y tarjetas." />
      {caja ? <TurnoAbierto /> : <AbrirCaja />}
      {usuario.rol !== 'contador' && <Historial />}
    </>
  );
}

function TurnoAbierto() {
  const { caja, usuario, recargarCaja } = useApp();
  const [datos, setDatos] = useState<{ resumen: Resumen; movimientos: Movimiento[] } | null>(null);
  const [mov, setMov] = useState<'entrada' | 'salida' | null>(null);
  const [cerrar, setCerrar] = useState(false);

  const cargar = useCallback(() => { api<{ resumen: Resumen; movimientos: Movimiento[] }>(`/cajas/${caja!.id}/resumen`).then(setDatos); }, [caja]);
  useEffect(cargar, [cargar]);
  if (!datos) return null;
  const r = datos.resumen;
  const pm = r.por_metodo ?? {};

  return (
    <div className="space-y-6">
      <Tarjeta className="flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="flex items-center gap-4">
          <span className="grid size-12 place-items-center rounded-xl bg-emerald-50 text-emerald-600"><Wallet size={26} weight="duotone" /></span>
          <div>
            <div className="flex items-center gap-2 text-lg font-bold">Caja <span className="codigo">{caja!.terminal}</span> <Insignia tono="emerald" punto>Abierta</Insignia></div>
            <div className="text-sm text-slate-500">{usuario.nombre} ({usuario.rol === 'administrador' ? 'Administrador' : 'Cajero'}) · desde {caja!.abierta_en} · {caja!.sucursal}</div>
          </div>
        </div>
        <div className="flex gap-2">
          <Boton icono={<ArrowDown size={18} />} onClick={() => setMov('entrada')}>Entrada</Boton>
          <Boton icono={<ArrowUp size={18} />} onClick={() => setMov('salida')}>Salida / gasto</Boton>
          <Boton variante="primario" icono={<LockKey size={18} />} onClick={() => setCerrar(true)}>Arqueo y cierre</Boton>
        </div>
      </Tarjeta>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <KPI titulo="Ventas del turno" valor={rd(r.total_ventas)} detalle={`${r.num_ventas} facturas · ITBIS ${num(r.total_itbis)}`} icono={<Receipt size={20} />} tono="blue" />
        <KPI titulo="Efectivo esperado" valor={rd(r.efectivo_esperado)} detalle="en la gaveta ahora" icono={<Money size={20} />} tono="emerald" />
        <KPI titulo="Tarjeta" valor={rd(pm.tarjeta ?? 0)} icono={<CreditCard size={20} />} />
        <KPI titulo="Transferencia" valor={rd(pm.transferencia ?? 0)} icono={<Bank size={20} />} />
        <KPI titulo="A crédito" valor={rd(pm.credito ?? 0)} detalle="cuentas por cobrar" />
      </div>

      <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
        <Tarjeta>
          <EncabezadoTarjeta titulo="Cuadre de efectivo" />
          <dl className="num space-y-2.5 p-5 text-sm">
            <Fila k="Fondo inicial" v={r.monto_inicial} />
            <Fila k="+ Cobros en efectivo" v={r.ventas_efectivo} />
            <Fila k="− Cambio entregado" v={r.cambio_entregado} />
            <Fila k="+ Entradas" v={r.entradas} />
            <Fila k="− Salidas y gastos" v={r.salidas} />
            <div className="border-t border-slate-200 pt-2.5"><Fila k="Efectivo esperado" v={r.efectivo_esperado} fuerte /></div>
          </dl>
        </Tarjeta>
        <Tarjeta>
          <EncabezadoTarjeta titulo="Entradas y salidas de efectivo" descripcion="Gastos menores, retiros, cambio adicional y abonos de clientes" />
          <Tabla columnas={['Hora', 'Tipo', 'Motivo', 'Usuario', { t: 'Monto', derecha: true }]} vacio="Sin movimientos en este turno">
            {datos.movimientos.map((m, i) => (
              <tr key={i}>
                <Celda className="num text-slate-500">{m.hora}</Celda>
                <Celda>{m.tipo === 'entrada' ? <Insignia tono="emerald">Entrada</Insignia> : <Insignia tono="red">Salida</Insignia>}</Celda>
                <Celda>{m.motivo}</Celda>
                <Celda className="text-slate-500">{m.usuario} <span className="text-[11px] text-slate-400">({ROL[m.usuario_rol] ?? m.usuario_rol})</span>{m.autorizado_por && <div className="text-[11px] text-slate-400">Autorizó: {m.autorizado_por}</div>}</Celda>
                <Celda derecha className="num font-semibold">{m.tipo === 'salida' ? '−' : '+'}{num(m.monto)}</Celda>
              </tr>
            ))}
          </Tabla>
        </Tarjeta>
      </div>

      {mov && <ModalMovimiento tipo={mov} esAdmin={usuario.rol === 'administrador'} onCerrar={() => setMov(null)} onListo={() => { setMov(null); cargar(); }} />}
      {cerrar && <ModalCierre resumen={r} onCerrar={() => setCerrar(false)} onCerrada={() => { setCerrar(false); recargarCaja(); }} />}
    </div>
  );
}

function ModalMovimiento({ tipo, esAdmin, onCerrar, onListo }: { tipo: 'entrada' | 'salida'; esAdmin: boolean; onCerrar: () => void; onListo: () => void }) {
  const { caja } = useApp();
  const [monto, setMonto] = useState('');
  const [motivo, setMotivo] = useState('');
  const [pin, setPin] = useState('');
  const [enviando, setEnviando] = useState(false);
  const sugerencias = tipo === 'salida' ? ['Compra de hielo', 'Pago de delivery', 'Gas', 'Limpieza', 'Retiro a caja fuerte'] : ['Cambio adicional', 'Fondo extra'];

  async function guardar() {
    setEnviando(true);
    try {
      await api(`/cajas/${caja!.id}/movimientos`, { body: { tipo, monto: Number(monto).toFixed(2), motivo, pinSupervisor: pin || undefined } });
      avisar(tipo === 'entrada' ? 'Entrada registrada' : 'Salida registrada', 'ok');
      onListo();
    } catch (e) { avisar(e instanceof ApiError ? e.message : 'Error', 'error'); }
    finally { setEnviando(false); }
  }

  return (
    <Modal titulo={tipo === 'entrada' ? 'Entrada de efectivo' : 'Salida de efectivo / gasto menor'} onCerrar={onCerrar} ancho="max-w-md"
      pie={<><Boton onClick={onCerrar}>Cancelar</Boton><Boton variante={tipo === 'salida' ? 'peligro' : 'exito'} cargando={enviando} disabled={!Number(monto) || motivo.trim().length < 3} onClick={guardar}>Registrar</Boton></>}>
      <div className="space-y-4">
        <Campo etiqueta="Monto (RD$)"><Entrada autoFocus type="number" min="0" step="0.01" value={monto} onChange={(e) => setMonto(e.target.value)} className="num h-12 text-xl font-semibold" /></Campo>
        <Campo etiqueta="Motivo">
          <Entrada value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {sugerencias.map((s) => <button key={s} type="button" onClick={() => setMotivo(s)} className="rounded-full border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50">{s}</button>)}
          </div>
        </Campo>
        {tipo === 'salida' && !esAdmin && (
          <Campo etiqueta="PIN o contraseña del administrador" ayuda="Las salidas de efectivo requieren autorización">
            <Entrada type="password" maxLength={60} value={pin} onChange={(e) => setPin(e.target.value)} placeholder="PIN o contraseña" className="codigo" />
          </Campo>
        )}
      </div>
    </Modal>
  );
}

function ModalCierre({ resumen, onCerrar, onCerrada }: { resumen: Resumen; onCerrar: () => void; onCerrada: () => void }) {
  const { caja } = useApp();
  const [conteo, setConteo] = useState<Record<number, string>>({});
  const [tarjetaLote, setTarjetaLote] = useState('');
  const [obs, setObs] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<{ cierre: { efectivo_esperado: string; efectivo_contado: string; diferencia: string }; tarjeta: { sistema: string; lote: string; diferencia: string } | null } | null>(null);

  const esperado = Number(resumen.efectivo_esperado);
  const tarjetaSistema = Number(resumen.por_metodo?.tarjeta ?? 0);
  const contado = DENOMINACIONES.reduce((s, d) => s + d * (Number(conteo[d]) || 0), 0);
  const dif = Math.round((contado - esperado) * 100) / 100;
  const difTarjeta = tarjetaLote === '' ? null : Math.round((Number(tarjetaLote) - tarjetaSistema) * 100) / 100;

  async function cerrar() {
    setEnviando(true);
    try {
      const detalle = Object.fromEntries(DENOMINACIONES.filter((d) => Number(conteo[d])).map((d) => [String(d), Number(conteo[d])]));
      setResultado(await api(`/cajas/${caja!.id}/cerrar`, {
        body: { efectivoContado: contado.toFixed(2), detalleArqueo: detalle, observaciones: obs || undefined, ...(tarjetaLote !== '' ? { tarjetaLote: Number(tarjetaLote).toFixed(2) } : {}) },
      }));
    } catch (e) { avisar(e instanceof ApiError ? e.message : 'No se pudo cerrar', 'error'); }
    finally { setEnviando(false); }
  }

  if (resultado) {
    const d = Number(resultado.cierre.diferencia);
    return (
      <Modal titulo="Turno cerrado" onCerrar={onCerrada} ancho="max-w-md"
        pie={<><Boton icono={<Printer size={16} />} onClick={() => window.print()}>Imprimir</Boton><Boton variante="primario" onClick={onCerrada}>Terminar</Boton></>}>
        <dl className="num space-y-2 text-sm">
          <Fila k="Efectivo esperado" v={resultado.cierre.efectivo_esperado} />
          <Fila k="Efectivo contado" v={resultado.cierre.efectivo_contado} />
          <EstadoDif titulo="Efectivo" dif={d} />
          {resultado.tarjeta && <>
            <div className="pt-3" /><Fila k="Tarjeta según sistema" v={resultado.tarjeta.sistema} />
            <Fila k="Cierre de lote (datáfono)" v={resultado.tarjeta.lote} />
            <EstadoDif titulo="Tarjetas" dif={Number(resultado.tarjeta.diferencia)} />
          </>}
        </dl>
      </Modal>
    );
  }

  return (
    <Modal titulo="Arqueo y cierre de turno" descripcion="Cuenta el efectivo por denominación y anota el cierre de lote del datáfono." onCerrar={onCerrar} ancho="max-w-3xl"
      pie={<><Boton onClick={onCerrar}>Cancelar</Boton><Boton variante="primario" cargando={enviando} onClick={cerrar} icono={<LockKey size={16} />}>Cerrar caja con {rd(contado)}</Boton></>}>
      <div className="grid gap-6 md:grid-cols-[1.2fr_1fr]">
        <div>
          <h4 className="mb-3 text-sm font-semibold text-slate-700">Conteo de efectivo</h4>
          <div className="space-y-1.5">
            {DENOMINACIONES.map((d) => (
              <label key={d} className="flex items-center gap-3">
                <span className={`num w-20 rounded-md px-2 py-1 text-right text-sm font-semibold ${d >= 50 ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-slate-700'}`}>{d >= 50 ? `$${d}` : `${d}`}</span>
                <span className="text-slate-400">×</span>
                <Entrada inputMode="numeric" value={conteo[d] ?? ''} placeholder="0" className="num h-9 w-20 text-center"
                  onChange={(e) => setConteo((c) => ({ ...c, [d]: e.target.value.replace(/\D/g, '').slice(0, 5) }))} />
                <span className="num ml-auto text-sm text-slate-500">{num(d * (Number(conteo[d]) || 0))}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="space-y-4">
          <div className="rounded-xl bg-slate-50 p-4">
            <dl className="num space-y-2 text-sm">
              <Fila k="Esperado" v={esperado} />
              <Fila k="Contado" v={contado} fuerte />
            </dl>
            <div className="mt-3"><EstadoDif titulo="Efectivo" dif={dif} /></div>
          </div>
          <div className="rounded-xl bg-slate-50 p-4">
            <Campo etiqueta="Cierre de lote del datáfono (RD$)" ayuda={`Según el sistema: ${rd(tarjetaSistema)}`}>
              <Entrada type="number" min="0" step="0.01" value={tarjetaLote} onChange={(e) => setTarjetaLote(e.target.value)} className="num" />
            </Campo>
            {difTarjeta !== null && <div className="mt-3"><EstadoDif titulo="Tarjetas" dif={difTarjeta} /></div>}
          </div>
          <Campo etiqueta="Observaciones"><textarea value={obs} onChange={(e) => setObs(e.target.value)} className="h-20 w-full rounded-lg border border-slate-300 p-3 text-sm outline-none focus:border-blue-500" /></Campo>
        </div>
      </div>
    </Modal>
  );
}

function Historial() {
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const { caja } = useApp();
  useEffect(() => { api<Turno[]>('/cajas/historial').then(setTurnos).catch(() => {}); }, [caja]);
  const cerrados = turnos.filter((t) => t.estado === 'cerrada');
  if (!cerrados.length) return null;
  return (
    <Tarjeta className="mt-6">
      <EncabezadoTarjeta titulo="Turnos anteriores" descripcion="Cuadres de efectivo y tarjetas por cierre" />
      <Tabla columnas={['Terminal', 'Abrió / operó', 'Apertura', 'Cierre', { t: 'Ventas', derecha: true }, { t: 'Esperado', derecha: true }, { t: 'Contado', derecha: true }, { t: 'Efectivo', derecha: true }, { t: 'Tarjetas', derecha: true }]}>
        {cerrados.map((t) => {
          const d = Number(t.diferencia);
          const dt = t.tarjeta_lote != null ? Number(t.tarjeta_lote) - Number(t.por_metodo?.tarjeta ?? 0) : null;
          return (
            <tr key={t.id}>
              <Celda className="codigo font-medium">{t.terminal}</Celda>
              <Celda>{t.cajero} <Insignia tono={t.cajero_rol === 'administrador' ? 'blue' : 'slate'}>{ROL[t.cajero_rol] ?? t.cajero_rol}</Insignia>{t.cerrada_por && t.cerrada_por !== t.cajero && <div className="text-[11px] text-slate-400">Cerró: {t.cerrada_por} ({ROL[t.cerrada_por_rol ?? ''] ?? ''})</div>}</Celda>
              <Celda className="num whitespace-nowrap text-slate-500">{t.abierta}</Celda>
              <Celda className="num whitespace-nowrap text-slate-500">{t.cerrada}</Celda>
              <Celda derecha className="num">{num(t.total_ventas)}</Celda>
              <Celda derecha className="num">{num(t.efectivo_esperado ?? 0)}</Celda>
              <Celda derecha className="num">{num(t.efectivo_contado ?? 0)}</Celda>
              <Celda derecha><Insignia tono={d === 0 ? 'emerald' : 'red'}>{d === 0 ? 'Cuadrada' : `${d > 0 ? 'Sobra' : 'Falta'} ${num(Math.abs(d))}`}</Insignia></Celda>
              <Celda derecha>{dt === null ? <span className="text-slate-400">—</span> : <Insignia tono={Math.abs(dt) < 0.01 ? 'emerald' : 'amber'}>{Math.abs(dt) < 0.01 ? 'Cuadrada' : `Dif. ${num(dt)}`}</Insignia>}</Celda>
            </tr>
          );
        })}
      </Tabla>
    </Tarjeta>
  );
}

const Fila = ({ k, v, fuerte }: { k: string; v: string | number; fuerte?: boolean }) => (
  <div className={`flex justify-between ${fuerte ? 'font-bold text-slate-900' : 'text-slate-600'}`}><dt>{k}</dt><dd>{num(v)}</dd></div>
);
function EstadoDif({ titulo, dif }: { titulo: string; dif: number }) {
  const ok = Math.abs(dif) < 0.01;
  return (
    <div className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm font-semibold ${ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
      <span>{titulo}: {ok ? 'cuadrado' : dif > 0 ? 'sobrante' : 'faltante'}</span>
      <span className="num">{ok ? '✓' : rd(Math.abs(dif))}</span>
    </div>
  );
}
