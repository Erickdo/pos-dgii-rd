import { useEffect, useRef, useState } from 'react';
import { Bell, Check, X, EnvelopeSimple, Phone, Eye, EyeSlash, UserPlus, ChatText, CashRegister, ShieldCheck } from '@phosphor-icons/react';
import { api, ApiError } from '../api';
import { useApp } from '../contexto';
import { Boton, Campo, EncabezadoTarjeta, Entrada, Insignia, Modal, Selector, Tarjeta } from './ui';
import { avisar } from '../util';

export interface Solicitud {
  id: string; nombre: string; contacto: string; rol_solicitado: 'cajero' | 'administrador' | 'contador'; nota: string | null;
  estado: 'pendiente' | 'aprobada' | 'rechazada'; fecha: string; resuelta: string | null; usuario_creado: string | null;
  resuelta_por: string | null; motivo_rechazo: string | null; minutos: number;
}

const ROLES = { cajero: 'Cajero / Caja', administrador: 'Administrador', contador: 'Contador' };

/** Igual que el servidor: PIN de 4–6 dígitos o contraseña de 6+ caracteres con letras. */
export const secretoValido = (s: string) => /^\d{4,6}$/.test(s) || (s.length >= 6 && /[a-zA-Z]/.test(s));

export function sugerirUsuario(nombre: string) {
  const p = nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z\s]/g, '').trim().split(/\s+/).filter(Boolean);
  if (!p.length) return '';
  return p.length === 1 ? p[0] : p[0][0] + p[p.length - 1];
}

export const hace = (min: number) => {
  if (min < 1) return 'ahora';
  if (min < 60) return `hace ${Math.floor(min)} min`;
  if (min < 1440) return `hace ${Math.floor(min / 60)} h`;
  const d = Math.floor(min / 1440);
  return `hace ${d} día${d > 1 ? 's' : ''}`;
};

/** Campo de contraseña o PIN con ojito, reutilizado en aprobar y en el formulario de usuarios. */
export function EntradaSecreto({ valor, onChange, placeholder, autoFocus }: { valor: string; onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean }) {
  const [ver, setVer] = useState(false);
  return (
    <div className="relative">
      <Entrada type={ver ? 'text' : 'password'} value={valor} autoFocus={autoFocus} autoComplete="new-password"
        onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="pr-11 codigo" />
      <button type="button" onClick={() => setVer((v) => !v)} aria-label={ver ? 'Ocultar' : 'Mostrar'}
        className="absolute right-0 top-0 grid h-10 w-10 place-items-center text-slate-400 hover:text-slate-700">
        {ver ? <EyeSlash size={18} /> : <Eye size={18} />}
      </button>
    </div>
  );
}

const Contacto = ({ c }: { c: string }) => (
  <span className="inline-flex items-center gap-1 text-slate-500">
    {c.includes('@') ? <EnvelopeSimple size={14} /> : <Phone size={14} />}{c}
  </span>
);

// ---------------------------------------------------------------- aprobar
export function ModalAprobar({ solicitud, onCerrar, onHecho }: { solicitud: Solicitud; onCerrar: () => void; onHecho: () => void }) {
  const [d, setD] = useState({ nombre: solicitud.nombre, usuario: sugerirUsuario(solicitud.nombre), rol: solicitud.rol_solicitado, secreto: '' });
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');
  const secretoOk = secretoValido(d.secreto);

  async function aprobar() {
    setEnviando(true); setError('');
    try {
      await api(`/admin/solicitudes/${solicitud.id}/aprobar`, { body: d });
      avisar(`Acceso aprobado: ${d.usuario}`, 'ok');
      onHecho();
    } catch (e) { setError(e instanceof ApiError ? e.message : 'No se pudo aprobar'); }
    finally { setEnviando(false); }
  }

  return (
    <Modal titulo="Aprobar acceso" descripcion="Asigna el usuario y la contraseña o PIN con que entrará." onCerrar={onCerrar} ancho="max-w-md"
      pie={<><Boton onClick={onCerrar}>Cancelar</Boton>
        <Boton variante="exito" icono={<Check size={18} weight="bold" />} cargando={enviando} disabled={!secretoOk || d.usuario.length < 3 || d.nombre.trim().length < 2} onClick={aprobar}>Aprobar y crear usuario</Boton></>}>
      <div className="mb-5 rounded-xl bg-slate-50 p-4 ring-1 ring-inset ring-slate-200">
        <div className="font-semibold text-slate-900">{solicitud.nombre}</div>
        <div className="mt-0.5 text-sm"><Contacto c={solicitud.contacto} /></div>
        <div className="mt-2 flex items-center gap-2 text-xs text-slate-500">
          Pidió <Insignia tono={solicitud.rol_solicitado === 'administrador' ? 'blue' : 'slate'}>{ROLES[solicitud.rol_solicitado]}</Insignia> · {solicitud.fecha}
        </div>
        {solicitud.nota && <p className="mt-2 flex gap-1.5 text-sm text-slate-600"><ChatText size={16} className="mt-0.5 shrink-0 text-slate-400" />{solicitud.nota}</p>}
      </div>
      <div className="space-y-4">
        <Campo etiqueta="Nombre"><Entrada value={d.nombre} onChange={(e) => setD({ ...d, nombre: e.target.value })} /></Campo>
        <div className="grid grid-cols-2 gap-3">
          <Campo etiqueta="Usuario">
            <Entrada value={d.usuario} onChange={(e) => setD({ ...d, usuario: e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, '') })} className="codigo" />
          </Campo>
          <Campo etiqueta="Rol">
            <Selector value={d.rol} onChange={(e) => setD({ ...d, rol: e.target.value as Solicitud['rol_solicitado'] })}>
              <option value="cajero">Cajero</option><option value="contador">Contador</option><option value="administrador">Administrador</option>
            </Selector>
          </Campo>
        </div>
        <Campo etiqueta="Contraseña o PIN" error={d.secreto && !secretoOk ? 'PIN de 4 a 6 dígitos, o contraseña de 6+ caracteres con letras' : undefined}
          ayuda={`Compártela con la persona en privado. Entrará con su usuario${solicitud.contacto.includes('@') ? ' o con su correo' : ''}.`}>
          <EntradaSecreto valor={d.secreto} onChange={(v) => setD({ ...d, secreto: v })} placeholder="Ej. 4821" autoFocus />
        </Campo>
        {error && <p className="text-sm font-medium text-red-600">{error}</p>}
      </div>
    </Modal>
  );
}

async function rechazar(s: Solicitud, hecho: () => void) {
  try { await api(`/admin/solicitudes/${s.id}/rechazar`, { body: {} }); avisar('Solicitud rechazada', 'ok'); hecho(); }
  catch (e) { avisar(e instanceof ApiError ? e.message : 'Error', 'error'); }
}

// ---------------------------------------------------------------- campana en la barra superior
export function CampanaSolicitudes() {
  const { solicitudesPendientes, recargarSolicitudes } = useApp();
  const [abierta, setAbierta] = useState(false);
  const [lista, setLista] = useState<Solicitud[]>([]);
  const [aprobar, setAprobar] = useState<Solicitud | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const cargar = () => api<Solicitud[]>('/admin/solicitudes?estado=pendiente').then(setLista).catch(() => {});
  useEffect(() => { if (abierta) cargar(); }, [abierta]);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (!aprobar && !ref.current?.contains(e.target as Node)) setAbierta(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [aprobar]);
  const hecho = () => { cargar(); recargarSolicitudes(); setAprobar(null); setAbierta(false); };

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setAbierta((a) => !a)} aria-label={`Solicitudes de acceso pendientes: ${solicitudesPendientes}`}
        title="Solicitudes de acceso"
        className={`relative grid size-10 place-items-center rounded-lg transition ${abierta ? 'bg-slate-100 text-slate-900' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'}`}>
        <Bell size={21} weight={solicitudesPendientes ? 'fill' : 'regular'} />
        {solicitudesPendientes > 0 && (
          <span className="num absolute right-1 top-1 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white ring-2 ring-white">
            {solicitudesPendientes > 9 ? '9+' : solicitudesPendientes}
          </span>
        )}
      </button>

      {abierta && (
        <div className="animar-entrada absolute right-0 top-12 z-40 w-[min(380px,calc(100vw-2rem))] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <span className="font-semibold text-slate-900">Solicitudes pendientes</span>
            {solicitudesPendientes > 0 && <Insignia tono="red">{solicitudesPendientes}</Insignia>}
          </div>
          <div className="scroll-fino max-h-[360px] overflow-y-auto">
            {!lista.length && (
              <div className="flex flex-col items-center px-6 py-8 text-center text-sm text-slate-500">
                <UserPlus size={28} className="mb-2 text-slate-300" />
                No hay solicitudes. Los nuevos integrantes las envían desde «Solicitar acceso» en la pantalla de entrada.
              </div>
            )}
            {lista.map((s) => (
              <div key={s.id} className="border-b border-slate-100 px-4 py-3 last:border-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-slate-900">{s.nombre}</div>
                    <div className="truncate text-xs"><Contacto c={s.contacto} /></div>
                  </div>
                  <span className="shrink-0 text-xs text-slate-400">{hace(s.minutos)}</span>
                </div>
                <div className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-500">
                  {s.rol_solicitado === 'administrador' ? <ShieldCheck size={14} /> : <CashRegister size={14} />}{ROLES[s.rol_solicitado]}
                </div>
                {s.nota && <p className="mt-1 line-clamp-2 text-xs text-slate-500">“{s.nota}”</p>}
                <div className="mt-2.5 flex gap-2">
                  <Boton tamano="sm" variante="exito" icono={<Check size={15} weight="bold" />} onClick={() => setAprobar(s)}>Aprobar</Boton>
                  <Boton tamano="sm" variante="fantasma" icono={<X size={15} />} onClick={() => rechazar(s, hecho)}>Rechazar</Boton>
                </div>
              </div>
            ))}
          </div>
          <button onClick={() => { setAbierta(false); location.hash = '/configuracion/usuarios'; }}
            className="w-full border-t border-slate-100 bg-slate-50 px-4 py-2.5 text-sm font-medium text-blue-600 hover:bg-slate-100">
            Ver usuarios y solicitudes
          </button>
        </div>
      )}
      {aprobar && <ModalAprobar solicitud={aprobar} onCerrar={() => setAprobar(null)} onHecho={hecho} />}
    </div>
  );
}

// ---------------------------------------------------------------- tarjeta en Configuración → Usuarios
export function TarjetaSolicitudes({ onCambio }: { onCambio: () => void }) {
  const { recargarSolicitudes } = useApp();
  const [lista, setLista] = useState<Solicitud[]>([]);
  const [verTodas, setVerTodas] = useState(false);
  const [aprobar, setAprobar] = useState<Solicitud | null>(null);
  const cargar = () => api<Solicitud[]>('/admin/solicitudes').then(setLista).catch(() => {});
  useEffect(() => { cargar(); }, []);
  const hecho = () => { cargar(); recargarSolicitudes(); onCambio(); setAprobar(null); };

  const pendientes = lista.filter((s) => s.estado === 'pendiente');
  const resueltas = lista.filter((s) => s.estado !== 'pendiente');
  if (!lista.length) return null;

  return (
    <Tarjeta>
      <EncabezadoTarjeta titulo={`Solicitudes de acceso${pendientes.length ? ` · ${pendientes.length} pendiente${pendientes.length > 1 ? 's' : ''}` : ''}`}
        descripcion="Personas que pidieron entrar desde la pantalla de inicio de sesión" />
      <div className="divide-y divide-slate-100">
        {pendientes.map((s) => (
          <div key={s.id} className="flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3.5">
            <div className="min-w-[200px] flex-1">
              <div className="font-semibold text-slate-900">{s.nombre}</div>
              <div className="text-sm"><Contacto c={s.contacto} /></div>
              {s.nota && <div className="mt-0.5 text-sm text-slate-500">“{s.nota}”</div>}
            </div>
            <div className="text-sm text-slate-600">
              <Insignia tono={s.rol_solicitado === 'administrador' ? 'blue' : 'slate'}>{ROLES[s.rol_solicitado]}</Insignia>
              <div className="mt-1 text-xs text-slate-400">{hace(s.minutos)}</div>
            </div>
            <div className="flex gap-2">
              <Boton tamano="sm" variante="fantasma" icono={<X size={15} />} onClick={() => rechazar(s, hecho)}>Rechazar</Boton>
              <Boton tamano="sm" variante="exito" icono={<Check size={15} weight="bold" />} onClick={() => setAprobar(s)}>Aprobar</Boton>
            </div>
          </div>
        ))}
        {!pendientes.length && <p className="px-5 py-4 text-sm text-slate-500">No hay solicitudes pendientes.</p>}
      </div>
      {resueltas.length > 0 && (
        <div className="border-t border-slate-100 px-5 py-3">
          <button onClick={() => setVerTodas((v) => !v)} className="text-sm font-medium text-blue-600 hover:underline">
            {verTodas ? 'Ocultar historial' : `Ver historial (${resueltas.length})`}
          </button>
          {verTodas && (
            <ul className="mt-2 space-y-1.5 text-sm">
              {resueltas.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-2 text-slate-600">
                  {s.estado === 'aprobada' ? <Insignia tono="emerald">Aprobada</Insignia> : <Insignia tono="red">Rechazada</Insignia>}
                  <span className="font-medium text-slate-800">{s.nombre}</span>
                  {s.usuario_creado && <span className="codigo text-slate-500">→ {s.usuario_creado}</span>}
                  <span className="text-xs text-slate-400">{s.resuelta}{s.resuelta_por ? ` · ${s.resuelta_por}` : ''}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {aprobar && <ModalAprobar solicitud={aprobar} onCerrar={() => setAprobar(null)} onHecho={hecho} />}
    </Tarjeta>
  );
}
