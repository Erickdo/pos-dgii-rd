import { useCallback, useEffect, useState } from 'react';
import { MagnifyingGlass, UserPlus, Buildings, User, PencilSimple, HandCoins, Users, Wallet, CheckCircle, WarningCircle, X } from '@phosphor-icons/react';
import { api, ApiError, type Cliente } from '../api';
import { useApp } from '../contexto';
import { FormCliente } from '../components/SelectorCliente';
import { Boton, Campo, Celda, EncabezadoPagina, Entrada, Insignia, Interruptor, KPI, Modal, Pestanas, Selector, Tabla, Tarjeta } from '../components/ui';
import { avisar, cedulaValida, formatoIdent, num, rd, rncValido } from '../util';

type Filtro = 'todos' | 'contribuyentes' | 'credito';
interface EstadoCuenta { cliente: { nombre: string; identificacion: string | null; limite_credito: string; saldo: string }; movimientos: { fecha: string; tipo: 'cargo' | 'abono'; documento: string; monto: string; estado: string; saldo: string }[] }

export default function Clientes() {
  const { usuario } = useApp();
  const esAdmin = usuario.rol === 'administrador';
  const veCredito = usuario.rol !== 'cajero';
  const [lista, setLista] = useState<Cliente[]>([]);
  const [q, setQ] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [nuevo, setNuevo] = useState(false);
  const [editar, setEditar] = useState<Cliente | null>(null);
  const [cuenta, setCuenta] = useState<Cliente | null>(null);

  const cargar = useCallback(() => {
    api<Cliente[]>(`/clientes?todos=1&q=${encodeURIComponent(q)}`).then((l) => setLista(l.filter((c) => c.id !== '00000000-0000-0000-0000-000000000001')));
  }, [q]);
  useEffect(() => { const t = setTimeout(cargar, 200); return () => clearTimeout(t); }, [cargar]);

  const filtrados = lista.filter((c) => filtro === 'todos' || (filtro === 'contribuyentes' ? c.es_contribuyente : Number(c.limite_credito) > 0 || Number(c.saldo) > 0));
  const porCobrar = lista.reduce((s, c) => s + Number(c.saldo ?? 0), 0);

  return (
    <>
      <EncabezadoPagina titulo="Clientes" descripcion="Directorio con RNC y cédulas validadas para emitir E31, E44 y E45. Crédito y cuentas por cobrar."
        acciones={<Boton data-atajo="nuevo" title="Alt+N" variante="primario" icono={<UserPlus size={18} />} onClick={() => setNuevo(true)}>Nuevo cliente</Boton>} />
      <div className="mb-6 grid gap-4 md:grid-cols-4">
        <KPI titulo="Clientes registrados" valor={lista.length} icono={<Users size={20} />} tono="blue" />
        <KPI titulo="Contribuyentes (E31)" valor={lista.filter((c) => c.es_contribuyente).length} icono={<Buildings size={20} />} />
        <KPI titulo="Con crédito" valor={lista.filter((c) => Number(c.limite_credito) > 0).length} icono={<HandCoins size={20} />} />
        {veCredito && <KPI titulo="Cuentas por cobrar" valor={rd(porCobrar)} icono={<Wallet size={20} />} tono={porCobrar > 0 ? 'amber' : 'emerald'} />}
      </div>
      <Tarjeta>
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-4">
          <div className="relative max-w-sm flex-1">
            <MagnifyingGlass size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Entrada data-buscar value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') { setQ(''); e.currentTarget.blur(); } }} placeholder="Nombre, RNC o cédula (F2)" className="pl-10" />
          </div>
          <Pestanas valor={filtro} onChange={setFiltro} opciones={[{ id: 'todos', texto: 'Todos' }, { id: 'contribuyentes', texto: 'Contribuyentes' }, { id: 'credito', texto: 'Crédito' }]} />
        </div>
        <Tabla columnas={['Cliente', 'Identificación', 'Comprobantes', 'Contacto', ...(veCredito ? [{ t: 'Límite', derecha: true }, { t: 'Saldo', derecha: true }] : []), '']} vacio="No hay clientes">
          {filtrados.map((c) => {
            const dv = c.tipo_identificacion === 'RNC' ? rncValido(c.identificacion ?? '') : c.tipo_identificacion === 'CEDULA' ? cedulaValida(c.identificacion ?? '') : true;
            return (
              <tr key={c.id} className={`hover:bg-slate-50/70 ${c.activo === false ? 'opacity-50' : ''}`}>
                <Celda>
                  <div className="flex items-center gap-3">
                    <span className={`grid size-9 place-items-center rounded-full ${c.tipo_identificacion === 'RNC' ? 'bg-blue-50 text-blue-600' : 'bg-slate-100 text-slate-500'}`}>
                      {c.tipo_identificacion === 'RNC' ? <Buildings size={18} /> : <User size={18} />}
                    </span>
                    <span className="font-semibold">{c.nombre}</span>
                  </div>
                </Celda>
                <Celda>
                  <div className="flex items-center gap-1.5 whitespace-nowrap">
                    <span className="text-xs text-slate-500">{c.tipo_identificacion === 'CEDULA' ? 'Cédula' : c.tipo_identificacion}</span>
                    <span className="codigo font-medium">{formatoIdent(c.tipo_identificacion, c.identificacion)}</span>
                    {c.tipo_identificacion !== 'PASAPORTE' && (dv
                      ? <CheckCircle size={15} weight="fill" className="text-emerald-500" aria-label="Dígito verificador válido" />
                      : <WarningCircle size={15} weight="fill" className="text-amber-500" aria-label="Dígito verificador no coincide" />)}
                  </div>
                </Celda>
                <Celda>
                  <div className="flex flex-wrap gap-1">
                    <Insignia>E32</Insignia>
                    {c.es_contribuyente && <Insignia tono="blue">E31</Insignia>}
                    {c.tipo_identificacion === 'RNC' && <><Insignia tono="violet">E44</Insignia><Insignia tono="violet">E45</Insignia></>}
                  </div>
                </Celda>
                <Celda className="text-slate-600">{c.correo_fe ?? c.telefono ?? <span className="text-slate-300">—</span>}</Celda>
                {veCredito && <Celda derecha className="num text-slate-600">{Number(c.limite_credito) > 0 ? num(c.limite_credito!) : '—'}</Celda>}
                {veCredito && <Celda derecha className={`num font-semibold ${Number(c.saldo) > 0 ? 'text-amber-700' : 'text-slate-400'}`}>{num(c.saldo ?? 0)}</Celda>}
                <Celda derecha>
                  <div className="flex justify-end gap-1">
                    {veCredito && (Number(c.saldo) > 0 || Number(c.limite_credito) > 0) && <Boton tamano="sm" variante="fantasma" onClick={() => setCuenta(c)} icono={<Wallet size={16} />}>Cuenta</Boton>}
                    {esAdmin && <Boton tamano="sm" variante="fantasma" onClick={() => setEditar(c)}><PencilSimple size={16} /></Boton>}
                  </div>
                </Celda>
              </tr>
            );
          })}
        </Tabla>
      </Tarjeta>

      {nuevo && (
        <Modal titulo="Nuevo cliente" descripcion="El RNC y la cédula se validan con su dígito verificador" onCerrar={() => setNuevo(false)}>
          <FormCliente onCancelar={() => setNuevo(false)} onGuardado={() => { setNuevo(false); cargar(); }} />
        </Modal>
      )}
      {editar && <EditarCliente cliente={editar} onCerrar={() => setEditar(null)} onGuardado={() => { setEditar(null); cargar(); }} />}
      {cuenta && <Cuenta cliente={cuenta} onCerrar={() => { setCuenta(null); cargar(); }} />}
    </>
  );
}

function EditarCliente({ cliente, onCerrar, onGuardado }: { cliente: Cliente; onCerrar: () => void; onGuardado: () => void }) {
  const [d, setD] = useState({
    nombre: cliente.nombre, correo: cliente.correo_fe ?? '', telefono: cliente.telefono ?? '',
    esContribuyente: cliente.es_contribuyente, limiteCredito: String(Number(cliente.limite_credito ?? 0)), activo: cliente.activo !== false,
  });
  const [enviando, setEnviando] = useState(false);
  async function guardar() {
    setEnviando(true);
    try { await api(`/admin/clientes/${cliente.id}`, { method: 'PUT', body: { ...d, limiteCredito: Number(d.limiteCredito) || 0 } }); avisar('Cliente actualizado', 'ok'); onGuardado(); }
    catch (e) { avisar(e instanceof ApiError ? e.message : 'Error', 'error'); }
    finally { setEnviando(false); }
  }
  return (
    <Modal titulo="Editar cliente" descripcion={`${cliente.tipo_identificacion} ${formatoIdent(cliente.tipo_identificacion, cliente.identificacion)}`} onCerrar={onCerrar}
      pie={<><Boton onClick={onCerrar}>Cancelar</Boton><Boton variante="primario" cargando={enviando} onClick={guardar}>Guardar</Boton></>}>
      <div className="space-y-4">
        <Campo etiqueta="Nombre / razón social"><Entrada value={d.nombre} onChange={(e) => setD({ ...d, nombre: e.target.value })} /></Campo>
        <div className="grid grid-cols-2 gap-3">
          <Campo etiqueta="Correo"><Entrada type="email" value={d.correo} onChange={(e) => setD({ ...d, correo: e.target.value })} /></Campo>
          <Campo etiqueta="Teléfono"><Entrada value={d.telefono} onChange={(e) => setD({ ...d, telefono: e.target.value })} /></Campo>
        </div>
        <Campo etiqueta="Límite de crédito (RD$)" ayuda="0 = no puede comprar a crédito">
          <Entrada type="number" min="0" value={d.limiteCredito} onChange={(e) => setD({ ...d, limiteCredito: e.target.value })} className="num" />
        </Campo>
        <div className="space-y-2 rounded-xl bg-slate-50 p-4">
          {cliente.tipo_identificacion !== 'PASAPORTE' && <Interruptor activo={d.esContribuyente} onChange={(v) => setD({ ...d, esContribuyente: v })} etiqueta="Contribuyente (E31)" />}
          <Interruptor activo={d.activo} onChange={(v) => setD({ ...d, activo: v })} etiqueta="Activo" />
        </div>
      </div>
    </Modal>
  );
}

function Cuenta({ cliente, onCerrar }: { cliente: Cliente; onCerrar: () => void }) {
  const [ec, setEc] = useState<EstadoCuenta | null>(null);
  const [monto, setMonto] = useState('');
  const [metodo, setMetodo] = useState('efectivo');
  const [ref, setRef] = useState('');
  const [enviando, setEnviando] = useState(false);
  const cargar = useCallback(() => { api<EstadoCuenta>(`/cxc/${cliente.id}`).then(setEc); }, [cliente.id]);
  useEffect(cargar, [cargar]);

  async function abonar() {
    setEnviando(true);
    try {
      const r = await api<{ nuevoSaldo: string; enCaja: boolean }>(`/cxc/${cliente.id}/abonos`, { body: { monto: Number(monto), metodo, referencia: ref } });
      avisar(`Abono registrado. Nuevo saldo: ${rd(r.nuevoSaldo)}${r.enCaja ? ' · entró a tu caja' : ''}`, 'ok');
      setMonto(''); setRef(''); cargar();
    } catch (e) { avisar(e instanceof ApiError ? e.message : 'Error', 'error'); }
    finally { setEnviando(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40" onMouseDown={onCerrar}>
      <div onMouseDown={(e) => e.stopPropagation()} className="animar-entrada flex h-full w-full max-w-xl flex-col bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-slate-200 p-6">
          <div>
            <div className="text-sm text-slate-500">Estado de cuenta</div>
            <h2 className="text-xl font-bold">{cliente.nombre}</h2>
          </div>
          <button onClick={onCerrar} className="grid size-9 place-items-center rounded-lg text-slate-400 hover:bg-slate-100"><X size={20} /></button>
        </div>
        {ec && (
          <div className="scroll-fino flex-1 overflow-y-auto p-6">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-amber-50 p-4 ring-1 ring-amber-200">
                <div className="text-sm text-amber-800">Saldo pendiente</div>
                <div className="num text-2xl font-bold text-amber-900">{rd(ec.cliente.saldo)}</div>
              </div>
              <div className="rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200">
                <div className="text-sm text-slate-500">Crédito disponible</div>
                <div className="num text-2xl font-bold">{rd(Math.max(0, Number(ec.cliente.limite_credito) - Number(ec.cliente.saldo)))}</div>
              </div>
            </div>
            {Number(ec.cliente.saldo) > 0 && (
              <div className="mt-5 rounded-xl border border-slate-200 p-4">
                <h3 className="mb-3 font-semibold">Registrar abono</h3>
                <div className="grid grid-cols-2 gap-3">
                  <Campo etiqueta="Monto"><Entrada type="number" min="0" value={monto} onChange={(e) => setMonto(e.target.value)} className="num" /></Campo>
                  <Campo etiqueta="Método">
                    <Selector value={metodo} onChange={(e) => setMetodo(e.target.value)}>
                      <option value="efectivo">Efectivo</option><option value="transferencia">Transferencia</option>
                      <option value="tarjeta">Tarjeta</option><option value="cheque">Cheque</option>
                    </Selector>
                  </Campo>
                  {metodo !== 'efectivo' && <Campo etiqueta="Referencia" className="col-span-2"><Entrada value={ref} onChange={(e) => setRef(e.target.value)} /></Campo>}
                </div>
                <div className="mt-3 flex gap-2">
                  <Boton tamano="sm" onClick={() => setMonto(Number(ec.cliente.saldo).toFixed(2))}>Saldo completo</Boton>
                  <Boton variante="exito" className="ml-auto" cargando={enviando} disabled={!Number(monto) || (metodo !== 'efectivo' && !ref)} onClick={abonar}>Registrar abono</Boton>
                </div>
              </div>
            )}
            <h3 className="mb-2 mt-6 font-semibold">Movimientos</h3>
            <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
              {ec.movimientos.map((m, i) => (
                <div key={i} className={`flex items-center gap-3 px-4 py-3 text-sm ${m.estado !== 'completada' ? 'opacity-50' : ''}`}>
                  <Insignia tono={m.tipo === 'cargo' ? 'amber' : 'emerald'}>{m.tipo === 'cargo' ? 'Factura' : 'Abono'}</Insignia>
                  <div className="min-w-0 flex-1">
                    <div className="codigo truncate font-medium">{m.documento}{m.estado !== 'completada' && ' (anulada)'}</div>
                    <div className="num text-xs text-slate-500">{m.fecha}</div>
                  </div>
                  <div className="num text-right">
                    <div className="font-semibold">{m.tipo === 'abono' ? '−' : '+'}{num(m.monto)}</div>
                    <div className="text-xs text-slate-400">saldo {num(m.saldo)}</div>
                  </div>
                </div>
              ))}
              {!ec.movimientos.length && <p className="p-6 text-center text-sm text-slate-500">Sin movimientos</p>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
