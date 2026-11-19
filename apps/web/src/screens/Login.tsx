import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  Storefront, CashRegister, ShieldCheck, User, LockKey, Eye, EyeSlash, CircleNotch, Check,
  WarningCircle, PaperPlaneTilt, CheckCircle,
} from '@phosphor-icons/react';
import { api, ApiError, type Sesion } from '../api';
import { Boton, Modal } from '../components/ui';
import { FirmaSistema } from '../components/Marca360';
import { EnlacesLegales } from '../components/Legal';

export interface Marca {
  nombre: string; logo: string | null;
  razonSocial?: string | null; rnc?: string | null; direccion?: string | null; telefono?: string | null; correo?: string | null;
}

const RECORDAR = 'pos.ultimoAcceso';
function leerRecordado(): { usuario: string } {
  try { return { usuario: '', ...JSON.parse(localStorage.getItem(RECORDAR) ?? '{}') }; } catch { return { usuario: '' }; }
}

/** Logo de la empresa, o un ícono neutro si todavía no se ha subido. */
export function LogoEmpresa({ marca, tamano = 'md' }: { marca: Marca | null; tamano?: 'sm' | 'md' | 'lg' }) {
  const caja = { sm: 'size-9 rounded-lg', md: 'size-14 rounded-xl', lg: 'size-20 rounded-2xl' }[tamano];
  if (marca?.logo) return <img src={marca.logo} alt={marca.nombre} className={`${caja} shrink-0 bg-white object-contain`} />;
  return (
    <span className={`${caja} grid shrink-0 place-items-center bg-blue-600 text-white`}>
      <Storefront size={tamano === 'lg' ? 40 : tamano === 'md' ? 28 : 20} weight="fill" />
    </span>
  );
}

export default function Login({ onEntrar }: { onEntrar: (s: Sesion) => void }) {
  const recordado = leerRecordado();
  const [marca, setMarca] = useState<Marca | null>(null);
  const [usuario, setUsuario] = useState(recordado.usuario);
  const [secreto, setSecreto] = useState('');
  const [ver, setVer] = useState(false);
  const [errores, setErrores] = useState<{ usuario?: string; secreto?: string; general?: string }>({});
  const [estado, setEstado] = useState<'listo' | 'cargando' | 'exito'>('listo');
  const [sacudir, setSacudir] = useState(0);
  const [solicitar, setSolicitar] = useState(false);
  const [version, setVersion] = useState('');
  const refSecreto = useRef<HTMLInputElement>(null);
  const refUsuario = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch('/api/version').then((r) => r.json()).then((v) => setVersion(v.version)).catch(() => {});
    api<Marca>('/marca').then(setMarca).catch(() => setMarca({ nombre: 'Punto de Venta', logo: null }));
    (recordado.usuario ? refSecreto : refUsuario).current?.focus();
  }, []); // eslint-disable-line

  useEffect(() => { if (marca) document.title = `${marca.nombre} · Iniciar sesión`; }, [marca]);

  function fallar(e: typeof errores) { setErrores(e); setSacudir((n) => n + 1); }

  async function enviar(ev: FormEvent) {
    ev.preventDefault();
    if (estado !== 'listo') return;
    const e: typeof errores = {};
    if (!usuario.trim()) e.usuario = 'Escribe tu usuario o correo';
    if (!secreto) e.secreto = 'Escribe tu contraseña o PIN';
    if (e.usuario || e.secreto) { fallar(e); (e.usuario ? refUsuario : refSecreto).current?.focus(); return; }

    setErrores({});
    setEstado('cargando');
    try {
      const s = await api<Sesion>('/auth/entrar', { body: { usuario: usuario.trim(), secreto } });
      try { localStorage.setItem(RECORDAR, JSON.stringify({ usuario: usuario.trim() })); } catch { /* */ }
      setEstado('exito');
      setTimeout(() => onEntrar(s), 650);
    } catch (err) {
      setEstado('listo');
      setSecreto('');
      fallar({ general: err instanceof ApiError ? err.message : 'No se pudo iniciar sesión' });
      refSecreto.current?.focus();
    }
  }

  return (
    <div className="flex min-h-dvh flex-col bg-slate-50 px-4">
      <main className="flex flex-1 items-center justify-center py-6">
        <div key={sacudir} className={`w-full max-w-[380px] ${sacudir ? 'sacudir' : ''}`}>
          <div className="rounded-2xl border border-slate-200 bg-white px-6 pb-5 pt-7 shadow-[0_1px_2px_rgba(15,23,42,.04),0_12px_32px_-8px_rgba(15,23,42,.12)] sm:px-8">
            {/* marca */}
            <div className="flex flex-col items-center text-center">
              {marca ? <LogoEmpresa marca={marca} tamano="md" /> : <span className="size-14 animate-pulse rounded-xl bg-slate-100" />}
              <h1 className="mt-3 text-lg font-bold leading-tight tracking-tight text-slate-900">{marca?.nombre ?? '\u00a0'}</h1>
            </div>

            <form onSubmit={enviar} noValidate className="mt-6 space-y-3.5">
              <CampoIcono etiqueta="Usuario o correo" icono={<User size={19} />} error={errores.usuario}>
                <input ref={refUsuario} value={usuario} autoComplete="username" autoCapitalize="none" spellCheck={false}
                  onChange={(e) => { setUsuario(e.target.value); setErrores((x) => ({ ...x, usuario: undefined, general: undefined })); }}
                  placeholder="Digite su usuario o correo" aria-label="Usuario o correo" disabled={estado !== 'listo'}
                  className="h-11 w-full bg-transparent pl-11 pr-3 text-[15px] text-slate-900 outline-none placeholder:text-slate-400" />
              </CampoIcono>

              <CampoIcono etiqueta="Contraseña o PIN" icono={<LockKey size={19} />} error={errores.secreto}
                accion={
                  <button type="button" onClick={() => setVer((v) => !v)} aria-label={ver ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                    className="grid size-10 place-items-center rounded-lg text-slate-400 hover:text-slate-700">
                    {ver ? <EyeSlash size={20} /> : <Eye size={20} />}
                  </button>
                }>
                <input ref={refSecreto} value={secreto} type={ver ? 'text' : 'password'} autoComplete="current-password"
                  onChange={(e) => { setSecreto(e.target.value); setErrores((x) => ({ ...x, secreto: undefined, general: undefined })); }}
                  placeholder="Digite su contraseña" aria-label="Contraseña o PIN" disabled={estado !== 'listo'}
                  className="h-11 w-full bg-transparent pl-11 pr-12 text-[15px] text-slate-900 outline-none placeholder:text-slate-400" />
              </CampoIcono>

              {errores.general && (
                <div role="alert" className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700 ring-1 ring-inset ring-red-200">
                  <WarningCircle size={18} weight="fill" className="mt-px shrink-0" /> {errores.general}
                </div>
              )}

              <button type="submit" disabled={estado !== 'listo'}
                className={`!mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-xl text-[15px] font-semibold text-white shadow-sm transition
                  ${estado === 'exito' ? 'bg-emerald-500 shadow-emerald-500/25' : 'bg-blue-600 shadow-blue-600/25 hover:bg-blue-700 active:bg-blue-800'}`}>
                {estado === 'cargando' && <><CircleNotch size={20} className="animate-spin" /> Verificando…</>}
                {estado === 'exito' && <><Check size={20} weight="bold" className="aparecer-check" /> ¡Bienvenido!</>}
                {estado === 'listo' && 'Iniciar sesión'}
              </button>
            </form>

            <div className="mt-5 border-t border-slate-100 pt-4 text-center text-sm text-slate-500">
              ¿Eres nuevo integrante?{' '}
              <button type="button" onClick={() => setSolicitar(true)} className="font-semibold text-blue-600 hover:text-blue-700 hover:underline">
                Solicitar acceso
              </button>
            </div>
          </div>
        </div>
      </main>

      <footer className="flex flex-col items-center gap-1.5 pb-4 text-center text-xs">
        <EnlacesLegales marca={marca} version={version} />
        <FirmaSistema className="justify-center" />
      </footer>

      {solicitar && <SolicitarAcceso onCerrar={() => setSolicitar(false)} />}
    </div>
  );
}

function CampoIcono({ etiqueta, icono, error, accion, children }: { etiqueta: string; icono: ReactNode; error?: string; accion?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="sr-only">{etiqueta}</span>
      <span className={`relative flex items-center rounded-xl border bg-white transition focus-within:ring-4
        ${error ? 'border-red-400 focus-within:ring-red-500/10' : 'border-slate-300 focus-within:border-blue-500 focus-within:ring-blue-500/10'}`}>
        <span className={`pointer-events-none absolute left-3.5 ${error ? 'text-red-400' : 'text-slate-400'}`}>{icono}</span>
        {children}
        {accion && <span className="absolute right-0.5">{accion}</span>}
      </span>
      {error && <span className="mt-1.5 flex items-center gap-1 text-xs font-medium text-red-600"><WarningCircle size={14} weight="fill" />{error}</span>}
    </label>
  );
}

// ---------------------------------------------------------------- solicitar acceso
function SolicitarAcceso({ onCerrar }: { onCerrar: () => void }) {
  const [f, setF] = useState({ nombre: '', contacto: '', rol: 'cajero', nota: '' });
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [enviando, setEnviando] = useState(false);
  const [enviada, setEnviada] = useState(false);

  async function enviar(ev?: FormEvent) {
    ev?.preventDefault();
    const e: Record<string, string> = {};
    if (f.nombre.trim().split(/\s+/).length < 2) e.nombre = 'Escribe nombre y apellido';
    const c = f.contacto.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c) && !/^[\d\s()+-]{7,20}$/.test(c)) e.contacto = 'Escribe un correo o teléfono válido';
    setErrores(e);
    if (Object.keys(e).length) return;
    setEnviando(true);
    try {
      await api('/auth/solicitudes', { body: { nombre: f.nombre.trim(), contacto: c, rol: f.rol, nota: f.nota.trim() || undefined } });
      setEnviada(true);
    } catch (err) {
      setErrores({ general: err instanceof ApiError ? err.message : 'No se pudo enviar la solicitud' });
    } finally { setEnviando(false); }
  }

  if (enviada) {
    return (
      <Modal titulo="Solicitud enviada" onCerrar={onCerrar} ancho="max-w-md" pie={<Boton variante="primario" onClick={onCerrar}>Entendido</Boton>}>
        <div className="flex flex-col items-center py-3 text-center">
          <span className="aparecer-check grid size-16 place-items-center rounded-full bg-emerald-50 text-emerald-500">
            <CheckCircle size={40} weight="fill" />
          </span>
          <p className="mt-4 text-[15px] leading-relaxed text-slate-700">
            El administrador revisará tu petición y te asignará tus credenciales.
          </p>
          <p className="mt-2 text-sm text-slate-500">Te contactará por <span className="font-medium text-slate-700">{f.contacto}</span>.</p>
        </div>
      </Modal>
    );
  }

  const inp = (err?: string) => `h-11 w-full rounded-xl border bg-white px-3.5 text-[15px] outline-none transition focus:ring-4 ${err ? 'border-red-400 focus:ring-red-500/10' : 'border-slate-300 focus:border-blue-500 focus:ring-blue-500/10'}`;
  return (
    <Modal titulo="Solicitar acceso" descripcion="Completa tus datos y el administrador creará tu usuario." onCerrar={onCerrar} ancho="max-w-md"
      pie={<>
        <Boton onClick={onCerrar}>Cancelar</Boton>
        <Boton variante="primario" cargando={enviando} icono={<PaperPlaneTilt size={18} />} onClick={() => enviar()}>Enviar solicitud</Boton>
      </>}>
      <form onSubmit={enviar} noValidate className="space-y-4">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-slate-700">Nombre completo</span>
          <input autoFocus value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} className={inp(errores.nombre)} placeholder="Ej. María Pérez" maxLength={100} />
          {errores.nombre && <span className="mt-1 block text-xs font-medium text-red-600">{errores.nombre}</span>}
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-slate-700">Correo o teléfono</span>
          <input value={f.contacto} onChange={(e) => setF({ ...f, contacto: e.target.value })} className={inp(errores.contacto)} placeholder="maria@correo.com o 809-555-0000" maxLength={120} autoCapitalize="none" />
          {errores.contacto && <span className="mt-1 block text-xs font-medium text-red-600">{errores.contacto}</span>}
        </label>
        <div>
          <span className="mb-1.5 block text-sm font-medium text-slate-700">Rol solicitado</span>
          <div className="grid grid-cols-2 gap-2">
            {([['cajero', 'Cajero / Caja', CashRegister], ['administrador', 'Administrador', ShieldCheck]] as const).map(([id, texto, Icono]) => (
              <button key={id} type="button" onClick={() => setF({ ...f, rol: id })}
                className={`flex h-12 items-center justify-center gap-2 rounded-xl border text-sm font-semibold transition
                  ${f.rol === id ? 'border-blue-500 bg-blue-50 text-blue-700 ring-4 ring-blue-500/10' : 'border-slate-300 text-slate-600 hover:border-slate-400'}`}>
                <Icono size={19} weight={f.rol === id ? 'fill' : 'regular'} /> {texto}
              </button>
            ))}
          </div>
        </div>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-slate-700">Nota <span className="font-normal text-slate-400">(opcional)</span></span>
          <textarea value={f.nota} onChange={(e) => setF({ ...f, nota: e.target.value })} rows={2} maxLength={300}
            className="w-full resize-none rounded-xl border border-slate-300 px-3.5 py-2.5 text-[15px] outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
            placeholder="Ej. Entro en el turno de la tarde" />
        </label>
        {errores.general && <p className="flex items-center gap-1.5 text-sm text-red-600"><WarningCircle size={16} weight="fill" />{errores.general}</p>}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

