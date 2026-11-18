import { useCallback, useEffect, useState } from 'react';
import { ArrowsClockwise, CheckCircle, CloudArrowUp, WarningOctagon, Timer, FileCode, MagnifyingGlass, Plus, WifiSlash, ShieldWarning, Info } from '@phosphor-icons/react';
import { api, ApiError, descargar } from '../api';
import { useApp } from '../contexto';
import { Boton, Campo, Celda, EncabezadoPagina, EncabezadoTarjeta, Entrada, Insignia, InsigniaFiscal, InsigniaTipo, KPI, Modal, Pestanas, Selector, Tabla, Tarjeta } from '../components/ui';
import { avisar, num } from '../util';

interface Comprobante {
  id: string; encf: string; tipo_ecf: string; estado: string; monto_total: string; rnc_comprador: string | null; codigo_seguridad: string;
  track_id: string | null; intentos: number; ultimo_error: string | null; es_consumo_resumido: boolean; motivo: string | null;
  firmado: string; actualizado: string; horas_restantes: number | null; modifica: string | null; cliente: string | null;
  mensajes: { codigo?: string; valor?: string }[] | null;
}
interface Secuencia { id: string; comprobante: string; desde: string; hasta: string; ultimo_usado: string; restantes: string; fecha_vencimiento: string | null; numero_autorizacion: string | null; activa: boolean }
type Grupo = '' | 'cola' | 'aceptados' | 'rechazados';

export default function Fiscal() {
  const { fiscal, refrescarFiscal, usuario } = useApp();
  const [grupo, setGrupo] = useState<Grupo>('');
  const [q, setQ] = useState('');
  const [lista, setLista] = useState<Comprobante[]>([]);
  const [sincronizando, setSincronizando] = useState(false);
  const [detalle, setDetalle] = useState<Comprobante | null>(null);
  const puedeSync = usuario.rol !== 'cajero';

  const cargar = useCallback(() => {
    api<Comprobante[]>(`/fiscal/comprobantes?estado=${grupo}&q=${encodeURIComponent(q)}`).then(setLista);
  }, [grupo, q]);
  useEffect(() => { const t = setTimeout(cargar, 200); return () => clearTimeout(t); }, [cargar]);

  async function sincronizar() {
    setSincronizando(true);
    try {
      const r = await api<{ procesados: number; worker: { ultimoTipoError: string | null } }>('/fiscal/sincronizar', { body: {} });
      const err = r.worker.ultimoTipoError;
      avisar(err === 'red' ? 'Sin conexión con la DGII: los comprobantes siguen en cola' : err === 'autenticacion' ? 'La DGII rechazó la autenticación: revisa el certificado' : `Sincronización completa (${r.procesados} procesados)`, err ? 'error' : 'ok');
      cargar(); refrescarFiscal();
    } catch (e) { avisar(e instanceof ApiError ? e.message : 'Error', 'error'); }
    finally { setSincronizando(false); }
  }

  if (!fiscal) return null;
  const c = fiscal.cola;
  const horas = c.limite_mas_proximo ? Math.max(0, Math.round((new Date(c.limite_mas_proximo).getTime() - Date.now()) / 3_600_000)) : null;
  const errorTipo = fiscal.worker.ultimoTipoError;

  return (
    <>
      <EncabezadoPagina titulo="Facturación Electrónica" descripcion={`Monitor de e-CF ante la DGII · ambiente ${fiscal.ambiente} · RNC ${fiscal.emisor?.rnc ?? ''}`}
        acciones={puedeSync && <Boton variante="primario" cargando={sincronizando} icono={<ArrowsClockwise size={18} weight="bold" />} onClick={sincronizar}>Sincronizar con la DGII</Boton>} />

      {/* Estado de conexión */}
      <div className={`mb-6 flex items-start gap-4 rounded-xl p-5 ring-1 ${c.pendientes === 0 && !c.rechazados ? 'bg-emerald-50 ring-emerald-200' : c.rechazados ? 'bg-red-50 ring-red-200' : 'bg-amber-50 ring-amber-200'}`}>
        {c.pendientes === 0 && !c.rechazados
          ? <CheckCircle size={28} weight="fill" className="shrink-0 text-emerald-500" />
          : errorTipo === 'red' ? <WifiSlash size={28} className="shrink-0 text-amber-600" /> : <CloudArrowUp size={28} className="shrink-0 text-amber-600" />}
        <div className="flex-1">
          <div className="font-semibold text-slate-900">
            {c.pendientes === 0 && !c.rechazados ? 'DGII en línea: todo enviado'
              : c.rechazados ? `${c.rechazados} comprobante(s) rechazado(s): revisa el detalle y corrige`
              : `Modo contingencia: ${c.pendientes} comprobante(s) pendiente(s) de envío`}
          </div>
          <div className="mt-0.5 text-sm text-slate-600">
            {c.pendientes > 0 && (errorTipo === 'red' ? 'No hay conexión con la DGII. Las ventas siguen emitiéndose firmadas y se envían automáticamente al volver el internet. '
              : errorTipo === 'autenticacion' ? 'La DGII rechazó la autenticación. Verifica que el certificado esté registrado en la Oficina Virtual. ' : '')}
            {horas !== null && <>Plazo del más antiguo: <b>{horas} h</b> de 72 h. </>}
            {fiscal.worker.ultimoExito && <>Último contacto exitoso: {new Date(fiscal.worker.ultimoExito).toLocaleString('es-DO')}.</>}
          </div>
        </div>
      </div>
      {fiscal.certificado.esPrueba && (
        <div className="mb-6 flex items-center gap-3 rounded-xl bg-white p-4 text-sm ring-1 ring-amber-200">
          <ShieldWarning size={24} className="text-amber-600" />
          <span className="flex-1">Estás firmando con un <b>certificado de prueba</b>. La DGII no aceptará estos comprobantes. Carga tu certificado en <b>Configuración → Certificado digital</b>.</span>
        </div>
      )}

      <div className="mb-6 grid gap-4 md:grid-cols-4">
        <KPI titulo="Aceptados" valor={c.aceptados} icono={<CheckCircle size={20} />} tono="emerald" />
        <KPI titulo="En cola / contingencia" valor={c.pendientes} icono={<CloudArrowUp size={20} />} tono={c.pendientes ? 'amber' : 'slate'} />
        <KPI titulo="Rechazados" valor={c.rechazados} icono={<WarningOctagon size={20} />} tono={c.rechazados ? 'red' : 'slate'} />
        <KPI titulo="Plazo más próximo" valor={horas !== null ? `${horas} h` : '—'} detalle="máximo 72 h sin conexión" icono={<Timer size={20} />} />
      </div>

      <Tarjeta className="mb-6">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-4">
          <Pestanas valor={grupo} onChange={setGrupo} opciones={[
            { id: '', texto: 'Todos', cuenta: c.total }, { id: 'cola', texto: 'En cola', cuenta: c.pendientes },
            { id: 'aceptados', texto: 'Aceptados', cuenta: c.aceptados }, { id: 'rechazados', texto: 'Rechazados', cuenta: c.rechazados }]} />
          <div className="relative ml-auto w-72">
            <MagnifyingGlass size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Entrada value={q} onChange={(e) => setQ(e.target.value)} placeholder="e-NCF o RNC" className="pl-10" />
          </div>
        </div>
        <Tabla columnas={['e-NCF', 'Tipo', 'Firmado', 'Comprador', 'Envío', 'Estado', 'Intentos', { t: 'Monto', derecha: true }, '']} vacio="No hay comprobantes">
          {lista.map((f) => (
            <tr key={f.id} className="cursor-pointer hover:bg-slate-50/70" onClick={() => setDetalle(f)}>
              <Celda><div className="codigo font-semibold">{f.encf}</div>{f.modifica && <div className="codigo text-xs text-violet-600">modifica {f.modifica}</div>}</Celda>
              <Celda><InsigniaTipo tipo={f.tipo_ecf} /></Celda>
              <Celda className="num whitespace-nowrap text-slate-500">{f.firmado}</Celda>
              <Celda><div className="max-w-44 truncate">{f.cliente ?? 'Consumidor final'}</div>{f.rnc_comprador && <div className="codigo text-xs text-slate-400">{f.rnc_comprador}</div>}</Celda>
              <Celda className="text-xs text-slate-500">{f.es_consumo_resumido ? 'Resumen RFCE' : 'e-CF completo'}</Celda>
              <Celda><InsigniaFiscal estado={f.estado} /></Celda>
              <Celda className="num text-slate-500">{f.intentos}</Celda>
              <Celda derecha className="num font-semibold">{num(f.monto_total)}</Celda>
              <Celda derecha>
                <Boton tamano="sm" variante="fantasma" title="Descargar XML firmado"
                  onClick={(e) => { e.stopPropagation(); descargar(`/fiscal/comprobantes/${f.id}/xml`, `${fiscal.emisor?.rnc}${f.encf}.xml`).catch((er) => avisar(er.message, 'error')); }}>
                  <FileCode size={18} />
                </Boton>
              </Celda>
            </tr>
          ))}
        </Tabla>
      </Tarjeta>

      <Secuencias esAdmin={usuario.rol === 'administrador'} />

      {detalle && (
        <Modal titulo={detalle.encf} descripcion="Detalle del comprobante electrónico" onCerrar={() => setDetalle(null)} ancho="max-w-lg"
          pie={<Boton icono={<FileCode size={16} />} onClick={() => descargar(`/fiscal/comprobantes/${detalle.id}/xml`, `${fiscal.emisor?.rnc}${detalle.encf}.xml`)}>Descargar XML</Boton>}>
          <dl className="grid grid-cols-[150px_1fr] gap-y-2.5 text-sm">
            <dt className="text-slate-500">Estado</dt><dd><InsigniaFiscal estado={detalle.estado} /></dd>
            <dt className="text-slate-500">Tipo</dt><dd><InsigniaTipo tipo={detalle.tipo_ecf} /></dd>
            <dt className="text-slate-500">Código seguridad</dt><dd className="codigo">{detalle.codigo_seguridad}</dd>
            <dt className="text-slate-500">TrackId</dt><dd className="codigo break-all">{detalle.track_id ?? (detalle.es_consumo_resumido ? 'No aplica (RFCE)' : '—')}</dd>
            <dt className="text-slate-500">Firmado</dt><dd className="num">{detalle.firmado}</dd>
            <dt className="text-slate-500">Última actualización</dt><dd className="num">{detalle.actualizado}</dd>
            <dt className="text-slate-500">Intentos de envío</dt><dd className="num">{detalle.intentos}</dd>
            {detalle.motivo && <><dt className="text-slate-500">Motivo</dt><dd>{detalle.motivo}</dd></>}
          </dl>
          {(detalle.ultimo_error || detalle.mensajes?.length) && (
            <div className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800 ring-1 ring-red-200">
              {detalle.mensajes?.map((m, i) => <div key={i}><b>{m.codigo}</b> {m.valor}</div>)}
              {!detalle.mensajes?.length && detalle.ultimo_error}
            </div>
          )}
        </Modal>
      )}
    </>
  );
}

function Secuencias({ esAdmin }: { esAdmin: boolean }) {
  const { fiscal, refrescarFiscal } = useApp();
  const [lista, setLista] = useState<Secuencia[]>([]);
  const [nueva, setNueva] = useState(false);
  const cargar = useCallback(() => { if (esAdmin) api<Secuencia[]>('/admin/secuencias').then(setLista); }, [esAdmin]);
  useEffect(cargar, [cargar]);
  const filas = esAdmin ? lista : (fiscal?.secuencias ?? []).map((s: any) => ({ ...s, activa: true, id: s.comprobante }));

  return (
    <Tarjeta>
      <EncabezadoTarjeta titulo="Secuencias de e-NCF autorizadas" descripcion="Rangos aprobados en la Oficina Virtual de la DGII"
        accion={esAdmin && <Boton icono={<Plus size={16} />} onClick={() => setNueva(true)}>Cargar nuevo rango</Boton>} />
      <Tabla columnas={['Comprobante', 'Rango', 'Último usado', { t: 'Disponibles', derecha: true }, 'Uso', 'Vence', 'Estado']}>
        {filas.map((s: any) => {
          const usados = Number(s.ultimo_usado ?? 0) - Number(s.desde ?? 1) + 1;
          const total = Number(s.hasta ?? 0) - Number(s.desde ?? 1) + 1;
          const pct = total > 0 ? Math.max(0, usados) / total * 100 : 0;
          const quedan = Number(s.restantes);
          return (
            <tr key={s.id} className={!s.activa ? 'opacity-50' : ''}>
              <Celda><span className="codigo font-semibold">{s.comprobante}</span></Celda>
              <Celda className="codigo text-slate-600">{s.desde ? `${s.desde} – ${s.hasta}` : '—'}</Celda>
              <Celda className="codigo">{s.ultimo_usado ?? '—'}</Celda>
              <Celda derecha className={`num font-semibold ${quedan < 100 ? 'text-red-600' : ''}`}>{quedan.toLocaleString('es-DO')}</Celda>
              <Celda>
                <div className="h-1.5 w-32 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${pct > 90 ? 'bg-red-500' : 'bg-blue-600'}`} style={{ width: `${Math.min(100, pct)}%` }} /></div>
              </Celda>
              <Celda className="num text-slate-600">{s.fecha_vencimiento ? new Date(s.fecha_vencimiento).toLocaleDateString('es-DO', { timeZone: 'UTC' }) : 'No aplica'}</Celda>
              <Celda>{s.activa ? <Insignia tono="emerald" punto>Activa</Insignia> : <Insignia>Agotada / reemplazada</Insignia>}</Celda>
            </tr>
          );
        })}
      </Tabla>
      {nueva && <NuevaSecuencia onCerrar={() => setNueva(false)} onGuardada={() => { setNueva(false); cargar(); refrescarFiscal(); }} />}
    </Tarjeta>
  );
}

function NuevaSecuencia({ onCerrar, onGuardada }: { onCerrar: () => void; onGuardada: () => void }) {
  const [d, setD] = useState({ comprobante: 'E32', desde: '', hasta: '', fechaVencimiento: '', numeroAutorizacion: '' });
  const [enviando, setEnviando] = useState(false);
  const llevaVenc = ['E31', 'E33', 'E44', 'E45', 'B01'].includes(d.comprobante);
  async function guardar() {
    setEnviando(true);
    try { await api('/admin/secuencias', { body: { ...d, fechaVencimiento: llevaVenc ? d.fechaVencimiento : '' } }); avisar('Secuencia cargada', 'ok'); onGuardada(); }
    catch (e) { avisar(e instanceof ApiError ? e.message : 'Error', 'error'); }
    finally { setEnviando(false); }
  }
  return (
    <Modal titulo="Cargar rango de e-NCF" descripcion="Copia los datos exactos de la autorización en la Oficina Virtual" onCerrar={onCerrar}
      pie={<><Boton onClick={onCerrar}>Cancelar</Boton><Boton variante="primario" cargando={enviando} disabled={!d.desde || !d.hasta || (llevaVenc && !d.fechaVencimiento)} onClick={guardar}>Guardar rango</Boton></>}>
      <div className="grid grid-cols-2 gap-4">
        <Campo etiqueta="Tipo de comprobante" className="col-span-2">
          <Selector value={d.comprobante} onChange={(e) => setD({ ...d, comprobante: e.target.value })}>
            {[['E32', 'Consumo'], ['E31', 'Crédito fiscal'], ['E34', 'Nota de crédito'], ['E33', 'Nota de débito'], ['E44', 'Regímenes especiales'], ['E45', 'Gubernamental'], ['B02', 'Consumo (serie B, contingencia)'], ['B01', 'Crédito fiscal (serie B, contingencia)']]
              .map(([v, t]) => <option key={v} value={v}>{v} · {t}</option>)}
          </Selector>
        </Campo>
        <Campo etiqueta="Desde (secuencial)"><Entrada type="number" min="1" value={d.desde} onChange={(e) => setD({ ...d, desde: e.target.value })} className="num" /></Campo>
        <Campo etiqueta="Hasta"><Entrada type="number" min="1" value={d.hasta} onChange={(e) => setD({ ...d, hasta: e.target.value })} className="num" /></Campo>
        {llevaVenc && <Campo etiqueta="Fecha de vencimiento"><Entrada type="date" value={d.fechaVencimiento} onChange={(e) => setD({ ...d, fechaVencimiento: e.target.value })} /></Campo>}
        <Campo etiqueta="No. de autorización"><Entrada value={d.numeroAutorizacion} onChange={(e) => setD({ ...d, numeroAutorizacion: e.target.value })} /></Campo>
      </div>
      <p className="mt-4 flex gap-2 rounded-lg bg-blue-50 p-3 text-sm text-blue-900"><Info size={18} className="shrink-0" /> El rango activo anterior del mismo tipo queda reemplazado.</p>
    </Modal>
  );
}
