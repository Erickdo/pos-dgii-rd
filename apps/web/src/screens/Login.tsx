import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  Storefront, CashRegister, ShieldCheck, User, LockKey, Eye, EyeSlash, CircleNotch, Check, ArrowRight,
  WarningCircle, PaperPlaneTilt, CheckCircle,
} from '@phosphor-icons/react';
import { api, ApiError, type Sesion } from '../api';
import { Boton, Modal } from '../components/ui';
import { FirmaSistema } from '../components/Marca360';
import { EnlacesLegales } from '../components/Legal';
import { logoRecortado } from '../logo';

export interface Marca {
  nombre: string; logo: string | null;
  razonSocial?: string | null; rnc?: string | null; direccion?: string | null; telefono?: string | null; correo?: string | null;
}

const RECORDAR = 'pos.ultimoAcceso';
function leerRecordado(): { usuario: string } {
  try { return { usuario: '', ...JSON.parse(localStorage.getItem(RECORDAR) ?? '{}') }; } catch { return { usuario: '' }; }
}

/** Logo de la empresa (se ajusta por alto, así los logos anchos no se encogen), o un ícono si no hay. */
export function LogoEmpresa({ marca, tamano = 'md' }: { marca: Marca | null; tamano?: 'sm' | 'md' | 'lg' | 'login' }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!marca?.logo) { setSrc(null); return; }
    let vivo = true;
    logoRecortado(marca.logo).then((s) => { if (vivo) setSrc(s); });
    return () => { vivo = false; };
  }, [marca?.logo]);
  if (marca?.logo) {
    if (!src) return <span className={tamano === 'login' ? 'h-24 w-40' : tamano === 'sm' ? 'h-9 w-20' : 'h-14 w-24'} />;
    const img = { sm: 'h-7 max-w-[120px]', md: 'h-12 max-w-[180px]', lg: 'h-16 max-w-[220px]', login: 'h-20 max-w-[280px]' }[tamano];
    const marco = tamano === 'sm' ? 'rounded-lg bg-white px-1.5 py-1' : '';
    return <span className={`inline-flex shrink-0 items-center justify-center ${marco}`}><img src={src} alt={marca.nombre} className={`${img} w-auto object-contain`} /></span>;
  }
  const caja = { sm: 'size-9 rounded-lg', md: 'size-14 rounded-xl', lg: 'size-20 rounded-2xl', login: 'size-16 rounded-2xl' }[tamano];
  return (
    <span className={`${caja} grid shrink-0 place-items-center bg-gradient-to-br from-blue-500 to-blue-700 text-white shadow-lg shadow-blue-600/25`}>
      <Storefront size={tamano === 'sm' ? 20 : tamano === 'md' ? 28 : 34} weight="fill" />
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
    <div className="relative isolate flex min-h-dvh flex-col overflow-hidden bg-slate-50 px-4">
      {/* fondo: halos suaves de la paleta y una trama de puntos muy tenue */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-40 left-1/2 h-[520px] w-[820px] -translate-x-1/2 rounded-full bg-blue-400/20 blur-3xl" />
        <div className="absolute -bottom-48 -right-24 h-[420px] w-[520px] rounded-full bg-emerald-300/20 blur-3xl" />
        <div className="absolute inset-0 bg-[radial-gradient(#cbd5e1_1px,transparent_1px)] [background-size:22px_22px] [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)] opacity-60" />
      </div>

      <main className="flex flex-1 items-center justify-center py-6">
        <div key={sacudir} className={`w-full max-w-[400px] ${sacudir ? 'sacudir' : ''}`}>
          <div className="relative overflow-hidden rounded-3xl border border-white/70 bg-white px-7 pb-6 pt-8 shadow-[0_1px_2px_rgba(15,23,42,.05),0_24px_48px_-16px_rgba(15,23,42,.18)] ring-1 ring-slate-900/5 sm:px-9">
            <div aria-hidden className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-blue-600 via-blue-500 to-emerald-500" />

            {/* marca */}
            <div className="flex flex-col items-center text-center">
              <div className="flex min-h-[72px] items-center justify-center">
                {marca ? <LogoEmpresa marca={marca} tamano="login" /> : <span className="size-16 animate-pulse rounded-2xl bg-slate-100" />}
              </div>
              <h1 className="mt-4 text-xl font-bold leading-tight tracking-tight text-slate-900">{marca?.nombre ?? '\u00a0'}</h1>
              <p className="mt-1 text-sm text-slate-500">Bienvenido, inicia sesión para continuar</p>
            </div>

            <form onSubmit={enviar} noValidate className="mt-7 space-y-3.5">
              <CampoIcono etiqueta="Usuario o correo" icono={<User size={19} />} error={errores.usuario}>
                <input ref={refUsuario} value={usuario} autoComplete="username" autoCapitalize="none" spellCheck={false}
                  onChange={(e) => { setUsuario(e.target.value); setErrores((x) => ({ ...x, usuario: undefined, general: undefined })); }}
                  placeholder="Digite su usuario o correo" aria-label="Usuario o correo" disabled={estado !== 'listo'}
                  className="h-12 w-full bg-transparent pl-11 pr-3 text-[15px] text-slate-900 outline-none placeholder:text-slate-400" />
              </CampoIcono>

              <CampoIcono etiqueta="Contraseña o PIN" icono={<LockKey size={19} />} error={errores.secreto}
                accion={
                  <button type="button" onClick={() => setVer((v) => !v)} aria-label={ver ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                    className="grid size-11 place-items-center rounded-lg text-slate-400 hover:text-slate-700">
                    {ver ? <EyeSlash size={20} /> : <Eye size={20} />}
                  </button>
                }>
                <input ref={refSecreto} value={secreto} type={ver ? 'text' : 'password'} autoComplete="current-password"
                  onChange={(e) => { setSecreto(e.target.value); setErrores((x) => ({ ...x, secreto: undefined, general: undefined })); }}
                  placeholder="Digite su contraseña" aria-label="Contraseña o PIN" disabled={estado !== 'listo'}
                  className="h-12 w-full bg-transparent pl-11 pr-12 text-[15px] text-slate-900 outline-none placeholder:text-slate-400" />
              </CampoIcono>

              {errores.general && (
                <div role="alert" className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700 ring-1 ring-inset ring-red-200">
                  <WarningCircle size={18} weight="fill" className="mt-px shrink-0" /> {errores.general}
                </div>
              )}

              <button type="submit" disabled={estado !== 'listo'}
                className={`group !mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-xl text-[15px] font-semibold text-white shadow-lg transition active:scale-[.99]
                  ${estado === 'exito' ? 'bg-emerald-500 shadow-emerald-500/30' : 'bg-gradient-to-b from-blue-500 to-blue-600 shadow-blue-600/30 hover:from-blue-600 hover:to-blue-700'}`}>
                {estado === 'cargando' && <><CircleNotch size={20} className="animate-spin" /> Verificando…</>}
                {estado === 'exito' && <><Check size={20} weight="bold" className="aparecer-check" /> ¡Bienvenido!</>}
                {estado === 'listo' && <>Iniciar sesión <ArrowRight size={18} weight="bold" className="transition group-hover:translate-x-0.5" /></>}
              </button>
            </form>

            <div className="mt-6 border-t border-slate-100 pt-5 text-center text-sm text-slate-500">
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
    <label className="group/campo block">
      <span className="sr-only">{etiqueta}</span>
      <span className={`relative flex items-center rounded-xl border transition focus-within:bg-white focus-within:ring-4
        ${error ? 'border-red-400 bg-red-50/40 focus-within:ring-red-500/10' : 'border-slate-200 bg-slate-50 hover:border-slate-300 focus-within:border-blue-500 focus-within:ring-blue-500/15'}`}>
        <span className={`pointer-events-none absolute left-3.5 transition ${error ? 'text-red-400' : 'text-slate-400 group-focus-within/campo:text-blue-600'}`}>{icono}</span>
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

