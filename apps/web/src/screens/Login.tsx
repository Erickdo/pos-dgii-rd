import { useEffect, useState } from 'react';
import { ArrowLeft, Storefront, ShieldCheck, User, Calculator, CloudCheck, WifiSlash, Receipt } from '@phosphor-icons/react';
import { api, ApiError, type Sesion, type Usuario } from '../api';
import Teclado, { aplicarTecla } from '../components/Teclado';

const ICONOS = { administrador: ShieldCheck, cajero: User, contador: Calculator };
const ROLES = { administrador: 'Administrador', cajero: 'Cajero', contador: 'Contador' };

export default function Login({ onEntrar }: { onEntrar: (s: Sesion) => void }) {
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [elegido, setElegido] = useState<Usuario | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);

  useEffect(() => { api<Usuario[]>('/auth/usuarios').then(setUsuarios).catch((e) => setError(e.message)); }, []);

  async function entrar(p: string) {
    if (!elegido || cargando) return;
    setCargando(true);
    try { onEntrar(await api<Sesion>('/auth/login', { body: { usuarioId: elegido.id, pin: p } })); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'No se pudo entrar'); setPin(''); }
    finally { setCargando(false); }
  }

  function tecla(t: string) { setError(''); setPin((p) => aplicarTecla(p, t, 8, true)); }
  useEffect(() => { if (pin.length === 4) entrar(pin); }, [pin]); // eslint-disable-line

  useEffect(() => {
    if (!elegido) return;
    const h = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) tecla(e.key);
      else if (e.key === 'Backspace') tecla('⌫');
      else if (e.key === 'Escape') { setElegido(null); setPin(''); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  return (
    <div className="grid h-full lg:grid-cols-[minmax(420px,1fr)_1.2fr]">
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-slate-900 p-12 text-white lg:flex">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-blue-600"><Storefront size={22} weight="fill" /></span>
          <span className="text-lg font-semibold">Punto de Venta</span>
        </div>
        <div className="relative z-10">
          <h1 className="text-4xl font-bold leading-tight tracking-tight">Factura electrónica<br />sin detener la caja.</h1>
          <ul className="mt-8 space-y-4 text-[15px] text-slate-300">
            <li className="flex gap-3"><Receipt size={22} className="shrink-0 text-blue-400" /> Cada venta sale con su e-CF firmado, e-NCF y código QR.</li>
            <li className="flex gap-3"><WifiSlash size={22} className="shrink-0 text-blue-400" /> Si se cae el internet, sigues vendiendo en modo contingencia.</li>
            <li className="flex gap-3"><CloudCheck size={22} className="shrink-0 text-blue-400" /> Los comprobantes se envían a la DGII cuando vuelve la conexión.</li>
          </ul>
        </div>
        <div className="text-xs text-slate-500">e-CF v1.0 · Ley 32-23 · Norma General 01-2020</div>
        <div className="pointer-events-none absolute -bottom-40 -right-40 size-[28rem] rounded-full bg-blue-600/20 blur-3xl" />
      </aside>

      <main className="flex items-center justify-center bg-slate-50 p-8">
        <div className="w-full max-w-sm">
          {!elegido ? (
            <>
              <h2 className="text-2xl font-bold tracking-tight">Iniciar sesión</h2>
              <p className="mb-6 mt-1 text-slate-500">Selecciona tu usuario</p>
              <div className="space-y-2.5">
                {usuarios.map((u) => {
                  const Icono = ICONOS[u.rol];
                  return (
                    <button key={u.id} onClick={() => { setElegido(u); setPin(''); setError(''); }}
                      className="flex w-full items-center gap-4 rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-blue-300 hover:shadow-md">
                      <span className={`grid size-11 place-items-center rounded-full ${u.rol === 'administrador' ? 'bg-blue-50 text-blue-600' : 'bg-slate-100 text-slate-600'}`}>
                        <Icono size={22} weight="duotone" />
                      </span>
                      <span>
                        <span className="block font-semibold text-slate-900">{u.nombre}</span>
                        <span className="block text-sm text-slate-500">{ROLES[u.rol]}</span>
                      </span>
                    </button>
                  );
                })}
                {!usuarios.length && !error && <p className="text-slate-500">Cargando…</p>}
              </div>
              {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
            </>
          ) : (
            <>
              <button onClick={() => setElegido(null)} className="mb-6 flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-800">
                <ArrowLeft size={16} /> Cambiar usuario
              </button>
              <h2 className="text-2xl font-bold tracking-tight">{elegido.nombre}</h2>
              <p className="mt-1 text-slate-500">Escribe tu PIN de 4 dígitos</p>
              <div className="my-7 flex justify-center gap-4">
                {[0, 1, 2, 3].map((i) => (
                  <span key={i} className={`size-4 rounded-full transition ${error ? 'bg-red-500' : i < pin.length ? 'bg-blue-600' : 'bg-slate-200'}`} />
                ))}
              </div>
              <Teclado onTecla={tecla} />
              <p className="mt-4 h-5 text-center text-sm text-red-600">{error}</p>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
