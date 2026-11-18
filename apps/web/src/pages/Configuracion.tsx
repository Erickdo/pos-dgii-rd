import { useEffect, useRef, useState } from 'react';
import { Buildings, Users, Printer, Certificate, CloudArrowDown, Plus, PencilSimple, UploadSimple, ShieldCheck, ShieldWarning, Info } from '@phosphor-icons/react';
import { api, ApiError, type ConfigImpresora } from '../api';
import { useApp } from '../contexto';
import { Boton, Campo, Celda, EncabezadoPagina, EncabezadoTarjeta, Entrada, Insignia, Interruptor, Modal, Selector, Tabla, Tarjeta } from '../components/ui';
import { avisar, rncValido } from '../util';
import Actualizaciones from './Actualizaciones';

type Seccion = 'empresa' | 'usuarios' | 'impresora' | 'certificado' | 'actualizaciones';
const SECCIONES: { id: Seccion; nombre: string; Icono: typeof Buildings }[] = [
  { id: 'empresa', nombre: 'Datos de la empresa', Icono: Buildings },
  { id: 'usuarios', nombre: 'Usuarios y PIN', Icono: Users },
  { id: 'impresora', nombre: 'Impresora térmica', Icono: Printer },
  { id: 'certificado', nombre: 'Certificado digital', Icono: Certificate },
  { id: 'actualizaciones', nombre: 'Actualizaciones', Icono: CloudArrowDown },
];

export default function Configuracion() {
  const [s, setS] = useState<Seccion>(() => (location.hash.includes('actualizaciones') ? 'actualizaciones' : 'empresa'));
  const { actualizacionDisponible } = useApp();
  return (
    <>
      <EncabezadoPagina titulo="Configuración" descripcion="Datos fiscales de la empresa, usuarios, impresora de tickets, certificado de firma y actualizaciones del sistema." />
      <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
        <nav className="space-y-1">
          {SECCIONES.map(({ id, nombre, Icono }) => (
            <button key={id} onClick={() => setS(id)}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${s === id ? 'bg-white text-blue-700 shadow-sm ring-1 ring-slate-200' : 'text-slate-600 hover:bg-white/70'}`}>
              <Icono size={20} weight={s === id ? 'fill' : 'regular'} />{nombre}
              {id === 'actualizaciones' && actualizacionDisponible && <span className="ml-auto rounded-full bg-blue-600 px-2 text-[11px] font-semibold text-white">Nueva</span>}
            </button>
          ))}
        </nav>
        <div>
          {s === 'empresa' && <Empresa />}
          {s === 'usuarios' && <Usuarios />}
          {s === 'impresora' && <Impresora />}
          {s === 'certificado' && <CertificadoDigital />}
          {s === 'actualizaciones' && <Actualizaciones />}
        </div>
      </div>
    </>
  );
}

function Empresa() {
  const { refrescarFiscal } = useApp();
  const [d, setD] = useState<{ rnc: string; razonSocial: string; nombreComercial: string; direccion: string; telefono: string; correo: string; ambiente: string } | null>(null);
  const [enviando, setEnviando] = useState(false);
  useEffect(() => {
    api<any>('/admin/emisor').then((e) => setD({ rnc: e.rnc, razonSocial: e.razon_social, nombreComercial: e.nombre_comercial ?? '', direccion: e.direccion, telefono: e.telefono ?? '', correo: e.correo ?? '', ambiente: e.ambiente }));
  }, []);
  if (!d) return null;
  const rncOk = d.rnc.length === 11 || rncValido(d.rnc);
  async function guardar() {
    setEnviando(true);
    try { await api('/admin/emisor', { method: 'PUT', body: d }); avisar('Datos de la empresa guardados', 'ok'); refrescarFiscal(); }
    catch (e) { avisar(e instanceof ApiError ? e.message : 'Error', 'error'); }
    finally { setEnviando(false); }
  }
  return (
    <Tarjeta>
      <EncabezadoTarjeta titulo="Datos de la empresa (emisor)" descripcion="Aparecen en cada e-CF y en el ticket. Deben coincidir con tu registro en la DGII." />
      <div className="grid gap-4 p-5 md:grid-cols-2">
        <Campo etiqueta="RNC" error={d.rnc.length === 9 && !rncOk ? 'El dígito verificador no coincide' : undefined}>
          <Entrada value={d.rnc} onChange={(e) => setD({ ...d, rnc: e.target.value.replace(/\D/g, '').slice(0, 11) })} className="codigo" />
        </Campo>
        <Campo etiqueta="Ambiente DGII" ayuda="Se cambia en el arranque del servidor (DGII_AMBIENTE)"><Entrada value={d.ambiente} disabled className="codigo" /></Campo>
        <Campo etiqueta="Razón social"><Entrada value={d.razonSocial} onChange={(e) => setD({ ...d, razonSocial: e.target.value })} /></Campo>
        <Campo etiqueta="Nombre comercial"><Entrada value={d.nombreComercial} onChange={(e) => setD({ ...d, nombreComercial: e.target.value })} /></Campo>
        <Campo etiqueta="Dirección" className="md:col-span-2"><Entrada value={d.direccion} onChange={(e) => setD({ ...d, direccion: e.target.value })} maxLength={100} /></Campo>
        <Campo etiqueta="Teléfono"><Entrada value={d.telefono} onChange={(e) => setD({ ...d, telefono: e.target.value })} /></Campo>
        <Campo etiqueta="Correo de facturación"><Entrada type="email" value={d.correo} onChange={(e) => setD({ ...d, correo: e.target.value })} /></Campo>
      </div>
      <div className="flex justify-end border-t border-slate-100 px-5 py-3.5"><Boton variante="primario" cargando={enviando} onClick={guardar}>Guardar cambios</Boton></div>
    </Tarjeta>
  );
}

interface UsuarioAdmin { id: string; nombre: string; usuario: string; rol: 'cajero' | 'administrador' | 'contador'; activo: boolean; ultimo_acceso: string | null }
const ROLES = { cajero: 'Cajero', administrador: 'Administrador', contador: 'Contador' };

function Usuarios() {
  const [lista, setLista] = useState<UsuarioAdmin[]>([]);
  const [editar, setEditar] = useState<UsuarioAdmin | 'nuevo' | null>(null);
  const cargar = () => api<UsuarioAdmin[]>('/admin/usuarios').then(setLista);
  useEffect(() => { cargar(); }, []);
  return (
    <Tarjeta>
      <EncabezadoTarjeta titulo="Usuarios y cajeros" descripcion="Cada persona entra con su PIN de 4 dígitos"
        accion={<Boton variante="primario" icono={<Plus size={16} />} onClick={() => setEditar('nuevo')}>Nuevo usuario</Boton>} />
      <Tabla columnas={['Nombre', 'Usuario', 'Rol', 'Último acceso', 'Estado', '']}>
        {lista.map((u) => (
          <tr key={u.id}>
            <Celda className="font-semibold">{u.nombre}</Celda>
            <Celda className="codigo text-slate-600">{u.usuario}</Celda>
            <Celda><Insignia tono={u.rol === 'administrador' ? 'blue' : u.rol === 'contador' ? 'violet' : 'slate'}>{ROLES[u.rol]}</Insignia></Celda>
            <Celda className="num text-slate-500">{u.ultimo_acceso ?? 'Nunca'}</Celda>
            <Celda>{u.activo ? <Insignia tono="emerald" punto>Activo</Insignia> : <Insignia>Inactivo</Insignia>}</Celda>
            <Celda derecha><Boton tamano="sm" variante="fantasma" onClick={() => setEditar(u)}><PencilSimple size={16} /></Boton></Celda>
          </tr>
        ))}
      </Tabla>
      <div className="grid gap-3 border-t border-slate-100 p-5 text-sm text-slate-600 md:grid-cols-3">
        <div><b className="text-slate-800">Cajero:</b> factura, su caja y su historial.</div>
        <div><b className="text-slate-800">Contador:</b> reportes, 607, clientes y monitor DGII.</div>
        <div><b className="text-slate-800">Administrador:</b> todo, y autoriza salidas y notas de crédito con su PIN.</div>
      </div>
      {editar && <FormUsuario usuario={editar === 'nuevo' ? null : editar} onCerrar={() => setEditar(null)} onGuardado={() => { setEditar(null); cargar(); }} />}
    </Tarjeta>
  );
}

function FormUsuario({ usuario, onCerrar, onGuardado }: { usuario: UsuarioAdmin | null; onCerrar: () => void; onGuardado: () => void }) {
  const [d, setD] = useState({ nombre: usuario?.nombre ?? '', usuario: usuario?.usuario ?? '', rol: usuario?.rol ?? 'cajero', pin: '', activo: usuario?.activo ?? true });
  const [enviando, setEnviando] = useState(false);
  async function guardar() {
    setEnviando(true);
    try {
      if (usuario) await api(`/admin/usuarios/${usuario.id}`, { method: 'PUT', body: d });
      else await api('/admin/usuarios', { body: d });
      avisar(usuario ? 'Usuario actualizado' : 'Usuario creado', 'ok');
      onGuardado();
    } catch (e) { avisar(e instanceof ApiError ? e.message : 'Error', 'error'); }
    finally { setEnviando(false); }
  }
  return (
    <Modal titulo={usuario ? 'Editar usuario' : 'Nuevo usuario'} onCerrar={onCerrar}
      pie={<><Boton onClick={onCerrar}>Cancelar</Boton><Boton variante="primario" cargando={enviando} disabled={!d.nombre || d.usuario.length < 3 || (!usuario && d.pin.length !== 4)} onClick={guardar}>Guardar</Boton></>}>
      <div className="space-y-4">
        <Campo etiqueta="Nombre completo"><Entrada autoFocus value={d.nombre} onChange={(e) => setD({ ...d, nombre: e.target.value })} /></Campo>
        <div className="grid grid-cols-2 gap-3">
          <Campo etiqueta="Usuario"><Entrada value={d.usuario} onChange={(e) => setD({ ...d, usuario: e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, '') })} className="codigo" /></Campo>
          <Campo etiqueta="Rol">
            <Selector value={d.rol} onChange={(e) => setD({ ...d, rol: e.target.value as UsuarioAdmin['rol'] })}>
              <option value="cajero">Cajero</option><option value="contador">Contador</option><option value="administrador">Administrador</option>
            </Selector>
          </Campo>
        </div>
        <Campo etiqueta={usuario ? 'Nuevo PIN (opcional)' : 'PIN de 4 dígitos'} ayuda={usuario ? 'Déjalo vacío para conservar el actual' : undefined}>
          <Entrada type="password" inputMode="numeric" maxLength={4} value={d.pin} onChange={(e) => setD({ ...d, pin: e.target.value.replace(/\D/g, '') })} className="codigo tracking-[0.5em]" />
        </Campo>
        {usuario && <Interruptor activo={d.activo} onChange={(v) => setD({ ...d, activo: v })} etiqueta="Activo" descripcion="Los usuarios inactivos no pueden entrar" />}
      </div>
    </Modal>
  );
}

function Impresora() {
  const { impresora, recargarConfig } = useApp();
  const [d, setD] = useState<ConfigImpresora>(impresora);
  const [enviando, setEnviando] = useState(false);
  useEffect(() => setD(impresora), [impresora]);
  async function guardar() {
    setEnviando(true);
    try { await api('/admin/config/impresora', { method: 'PUT', body: d }); avisar('Impresora configurada', 'ok'); recargarConfig(); }
    catch (e) { avisar(e instanceof ApiError ? e.message : 'Error', 'error'); }
    finally { setEnviando(false); }
  }
  return (
    <Tarjeta>
      <EncabezadoTarjeta titulo="Impresora térmica" descripcion="Formato de la representación impresa del e-CF" />
      <div className="space-y-5 p-5">
        <div>
          <span className="mb-2 block text-sm font-medium text-slate-700">Ancho del papel</span>
          <div className="grid max-w-md grid-cols-2 gap-3">
            {(['80', '58'] as const).map((a) => (
              <button key={a} onClick={() => setD({ ...d, ancho: a })}
                className={`flex items-center gap-3 rounded-xl border p-4 text-left transition ${d.ancho === a ? 'border-blue-600 bg-blue-50 ring-1 ring-blue-600' : 'border-slate-200 hover:border-slate-300'}`}>
                <span className={`rounded-sm border-2 border-slate-400 bg-white ${a === '80' ? 'h-12 w-8' : 'h-12 w-6'}`} />
                <span><span className="block font-semibold">{a} mm</span><span className="text-xs text-slate-500">{a === '80' ? 'Estándar (recomendado)' : 'Compacta / portátil'}</span></span>
              </button>
            ))}
          </div>
        </div>
        <Campo etiqueta="Mensaje al pie del ticket" className="max-w-md"><Entrada value={d.mensajePie} onChange={(e) => setD({ ...d, mensajePie: e.target.value })} maxLength={120} /></Campo>
        <div className="max-w-md"><Interruptor activo={d.imprimirAutomatico} onChange={(v) => setD({ ...d, imprimirAutomatico: v })} etiqueta="Imprimir automáticamente al cobrar" descripcion="Abre el diálogo de impresión en cuanto se emite el e-CF" /></div>
        <p className="flex max-w-xl gap-2 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
          <Info size={18} className="mt-0.5 shrink-0 text-blue-600" />
          En el diálogo de impresión elige tu impresora térmica, márgenes “Ninguno” y desactiva encabezados y pies de página. Con Chrome en modo kiosco (<span className="codigo">--kiosk-printing</span>) imprime sin preguntar.
        </p>
      </div>
      <div className="flex justify-end border-t border-slate-100 px-5 py-3.5"><Boton variante="primario" cargando={enviando} onClick={guardar}>Guardar</Boton></div>
    </Tarjeta>
  );
}

interface InfoCert { origen: string; esPrueba: boolean; titular: string; vence: string; diasRestantes: number }

function CertificadoDigital() {
  const { refrescarFiscal } = useApp();
  const [info, setInfo] = useState<InfoCert | null>(null);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [clave, setClave] = useState('');
  const [enviando, setEnviando] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { api<InfoCert>('/admin/certificado').then(setInfo); }, []);

  async function subir() {
    if (!archivo) return;
    setEnviando(true);
    try {
      const b64 = await new Promise<string>((ok, mal) => {
        const r = new FileReader();
        r.onload = () => ok(String(r.result).split(',')[1]);
        r.onerror = mal;
        r.readAsDataURL(archivo);
      });
      setInfo(await api<InfoCert>('/admin/certificado', { body: { archivoBase64: b64, clave } }));
      avisar('Certificado instalado: los próximos e-CF se firmarán con él', 'ok');
      setArchivo(null); setClave(''); refrescarFiscal();
    } catch (e) { avisar(e instanceof ApiError ? e.message : 'No se pudo instalar', 'error'); }
    finally { setEnviando(false); }
  }

  return (
    <div className="space-y-6">
      {info && (
        <Tarjeta className={`flex items-center gap-4 p-5 ${info.esPrueba ? 'ring-1 ring-amber-200' : ''}`}>
          <span className={`grid size-12 place-items-center rounded-xl ${info.esPrueba ? 'bg-amber-50 text-amber-600' : 'bg-emerald-50 text-emerald-600'}`}>
            {info.esPrueba ? <ShieldWarning size={26} weight="duotone" /> : <ShieldCheck size={26} weight="duotone" />}
          </span>
          <div className="flex-1">
            <div className="font-semibold">{info.esPrueba ? 'Certificado de PRUEBA (sin validez ante la DGII)' : info.titular}</div>
            <div className="text-sm text-slate-500">
              {info.esPrueba ? 'Las ventas se firman, pero la DGII no aceptará los comprobantes.' : `Vence el ${info.vence} · faltan ${info.diasRestantes} días`}
            </div>
          </div>
          <Insignia tono={info.esPrueba ? 'amber' : info.diasRestantes < 30 ? 'red' : 'emerald'} punto>
            {info.esPrueba ? 'Prueba' : info.origen === 'variable' ? 'Configurado en el servidor' : 'Instalado'}
          </Insignia>
        </Tarjeta>
      )}
      <Tarjeta>
        <EncabezadoTarjeta titulo="Cargar certificado digital (.p12 / .pfx)" descripcion="Emitido por una entidad certificadora autorizada a nombre de la persona física que firma por la empresa" />
        <div className="space-y-4 p-5">
          <input ref={input} type="file" accept=".p12,.pfx" className="hidden" onChange={(e) => setArchivo(e.target.files?.[0] ?? null)} />
          <button onClick={() => input.current?.click()}
            className="flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 py-8 text-slate-500 transition hover:border-blue-400 hover:bg-blue-50/40">
            <UploadSimple size={28} />
            <span className="text-sm font-medium">{archivo ? archivo.name : 'Haz clic para seleccionar el archivo .p12'}</span>
            {archivo && <span className="text-xs">{(archivo.size / 1024).toFixed(1)} KB</span>}
          </button>
          <Campo etiqueta="Clave del certificado" className="max-w-sm"><Entrada type="password" value={clave} onChange={(e) => setClave(e.target.value)} autoComplete="new-password" /></Campo>
          <p className="flex gap-2 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
            <Info size={18} className="mt-0.5 shrink-0 text-blue-600" />
            El certificado y su clave se guardan solo en este equipo (carpeta <span className="codigo">.datos</span> del servidor). Se valida antes de reemplazar el actual.
          </p>
        </div>
        <div className="flex justify-end border-t border-slate-100 px-5 py-3.5">
          <Boton variante="primario" cargando={enviando} disabled={!archivo || !clave} icono={<Certificate size={18} />} onClick={subir}>Validar e instalar</Boton>
        </div>
      </Tarjeta>
    </div>
  );
}
