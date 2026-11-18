import { FirmaSistema } from '../components/Marca360';
import { useCallback, useEffect, useState } from 'react';
import {
  ArrowsClockwise, CloudArrowDown, CheckCircle, Sparkle, ShieldCheck, ArrowCounterClockwise, GithubLogo, Gear, WarningCircle, CircleNotch, Info,
} from '@phosphor-icons/react';
import { api, ApiError } from '../api';
import { Boton, Campo, EncabezadoTarjeta, Entrada, Insignia, Modal, Tarjeta } from '../components/ui';
import { avisar } from '../util';

interface Entrada { version: string; fecha: string; titulo?: string; cambios: string[] }
interface Estado {
  instalada: { version: string; fecha: string; historial: Entrada[] };
  origen: { tipo: 'github' | 'url'; repo?: string; rama?: string; url?: string; tieneToken: boolean; descripcion: string; fijadoPorVariable: boolean };
  ultimaVerificacion: { verificadoEn: string; versionRemota: string; disponible: boolean; novedades: Entrada[] } | null;
  ultimoResultado: { desde: string; hacia: string; ok: boolean; revertido: boolean; mensaje: string; fin: string } | null;
  supervisado: boolean;
}
type Fase = 'descargando' | 'reiniciando' | 'instalando' | 'listo' | 'fallo';

export default function Actualizaciones() {
  const [e, setE] = useState<Estado | null>(null);
  const [verificando, setVerificando] = useState(false);
  const [fase, setFase] = useState<Fase | null>(null);
  const [mensajeFase, setMensajeFase] = useState('');
  const [config, setConfig] = useState(false);

  const cargar = useCallback(() => api<Estado>('/admin/actualizaciones').then(setE).catch(() => {}), []);
  useEffect(() => { cargar(); }, [cargar]);

  async function verificar() {
    setVerificando(true);
    try {
      const r = await api<{ disponible: boolean; versionRemota: string }>('/admin/actualizaciones/verificar', { body: {} });
      avisar(r.disponible ? `Hay una versión nueva: ${r.versionRemota}` : 'Tu sistema está al día', r.disponible ? 'info' : 'ok');
      await cargar();
    } catch (err) { avisar(err instanceof ApiError ? err.message : 'No se pudo verificar', 'error'); }
    finally { setVerificando(false); }
  }

  async function instalar() {
    if (!e) return;
    const anterior = e.instalada.version;
    setFase('descargando'); setMensajeFase('Descargando la actualización…');
    try {
      const r = await api<{ version: string }>('/admin/actualizaciones/instalar', { body: {} });
      setFase('reiniciando'); setMensajeFase('Respaldando datos e instalando la versión ' + r.version + '…');
      // El servidor se reinicia: esperamos a que vuelva con la versión nueva (o revertido)
      await new Promise((ok) => setTimeout(ok, 4000));
      setFase('instalando');
      const limite = Date.now() + 8 * 60_000;
      while (Date.now() < limite) {
        try {
          const v = await fetch('/api/version').then((x) => x.json());
          if (v.version === r.version) { setFase('listo'); setMensajeFase(`Sistema actualizado a la versión ${r.version}`); setTimeout(() => location.reload(), 2500); return; }
          if (v.version === anterior) {
            const est = await api<Estado>('/admin/actualizaciones').catch(() => null);
            if (est?.ultimoResultado?.revertido && est.ultimoResultado.hacia === r.version) {
              setFase('fallo'); setMensajeFase(`No se pudo instalar: ${est.ultimoResultado.mensaje}. El sistema volvió a la versión ${anterior}; tus datos están intactos.`);
              cargar(); return;
            }
          }
        } catch { /* servidor reiniciando */ }
        await new Promise((ok) => setTimeout(ok, 3000));
      }
      setFase('fallo'); setMensajeFase('La actualización está tardando más de lo normal. Revisa la ventana del servidor.');
    } catch (err) {
      setFase('fallo'); setMensajeFase(err instanceof ApiError ? err.message : 'No se pudo actualizar');
    }
  }

  if (!e) return null;
  const v = e.ultimaVerificacion;
  const disponible = v?.disponible;

  return (
    <div className="space-y-6">
      {/* Estado principal */}
      <Tarjeta className="overflow-hidden">
        <div className={`flex flex-wrap items-center gap-5 p-6 ${disponible ? 'bg-gradient-to-r from-blue-50 to-white' : ''}`}>
          <span className={`grid size-14 place-items-center rounded-2xl ${disponible ? 'bg-blue-600 text-white' : 'bg-emerald-50 text-emerald-600'}`}>
            {disponible ? <Sparkle size={28} weight="fill" /> : <CheckCircle size={28} weight="fill" />}
          </span>
          <div className="min-w-60 flex-1">
            <div className="text-sm text-slate-500">Versión instalada</div>
            <div className="flex items-center gap-2">
              <span className="codigo text-2xl font-bold">v{e.instalada.version}</span>
              {disponible ? <Insignia tono="blue" punto>Nueva versión v{v!.versionRemota}</Insignia> : v ? <Insignia tono="emerald">Al día</Insignia> : null}
            </div>
            <div className="mt-0.5 text-sm text-slate-500">
              {v ? `Última revisión: ${new Date(v.verificadoEn).toLocaleString('es-DO')}` : 'Aún no se ha buscado actualizaciones'}
            </div>
            <FirmaSistema className="mt-1 text-xs text-slate-400" />
          </div>
          <div className="flex gap-2">
            <Boton cargando={verificando} icono={<ArrowsClockwise size={18} />} onClick={verificar}>Buscar actualizaciones</Boton>
            {disponible && <Boton variante="primario" icono={<CloudArrowDown size={18} weight="bold" />} onClick={instalar} disabled={!e.supervisado}>Actualizar ahora</Boton>}
          </div>
        </div>

        {disponible && !!v!.novedades.length && (
          <div className="border-t border-slate-100 p-6">
            <h3 className="mb-3 font-semibold">Qué trae la actualización</h3>
            <div className="space-y-4">{v!.novedades.map((n) => <Notas key={n.version} n={n} />)}</div>
          </div>
        )}

        {!e.supervisado && (
          <div className="flex gap-3 border-t border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <WarningCircle size={20} className="shrink-0" />
            El POS se abrió sin el lanzador, así que no puede reiniciarse solo. Ciérralo y ábrelo con el acceso directo <b>“Punto de Venta”</b> del escritorio para poder actualizar desde aquí.
          </div>
        )}
      </Tarjeta>

      {e.ultimoResultado && (
        <div className={`flex items-start gap-3 rounded-xl p-4 text-sm ring-1 ${e.ultimoResultado.ok ? 'bg-emerald-50 text-emerald-900 ring-emerald-200' : 'bg-red-50 text-red-900 ring-red-200'}`}>
          {e.ultimoResultado.ok ? <CheckCircle size={20} weight="fill" className="shrink-0 text-emerald-500" /> : <ArrowCounterClockwise size={20} className="shrink-0" />}
          <div>
            <b>Última actualización ({new Date(e.ultimoResultado.fin).toLocaleString('es-DO')}):</b>{' '}
            {e.ultimoResultado.ok ? `v${e.ultimoResultado.desde} → v${e.ultimoResultado.hacia}, instalada correctamente.`
              : `falló al pasar a v${e.ultimoResultado.hacia} (${e.ultimoResultado.mensaje}).${e.ultimoResultado.revertido ? ` Se restauró la v${e.ultimoResultado.desde}.` : ''}`}
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <Tarjeta>
          <EncabezadoTarjeta titulo="Historial de versiones" />
          <div className="space-y-5 p-5">{e.instalada.historial.map((n) => <Notas key={n.version} n={n} actual={n.version === e.instalada.version} />)}</div>
        </Tarjeta>
        <div className="space-y-6">
          <Tarjeta className="p-5">
            <h3 className="flex items-center gap-2 font-semibold"><ShieldCheck size={20} className="text-emerald-600" /> Actualización segura</h3>
            <ul className="mt-3 space-y-2 text-sm text-slate-600">
              <li>• Antes de instalar se respalda la base de datos y el código actual.</li>
              <li>• Las ventas, clientes, configuración y certificado no se tocan.</li>
              <li>• Si la versión nueva no arranca, el sistema vuelve solo a la anterior.</li>
              <li>• Mejor actualizar con las cajas cerradas: el POS se reinicia (1–3 min).</li>
            </ul>
          </Tarjeta>
          <Tarjeta className="p-5">
            <div className="flex items-start justify-between">
              <h3 className="flex items-center gap-2 font-semibold">{e.origen.tipo === 'github' ? <GithubLogo size={20} /> : <CloudArrowDown size={20} />} Origen</h3>
              {!e.origen.fijadoPorVariable && <Boton tamano="sm" variante="fantasma" icono={<Gear size={16} />} onClick={() => setConfig(true)}>Cambiar</Boton>}
            </div>
            <div className="codigo mt-2 break-all text-sm text-slate-600">{e.origen.descripcion}</div>
            {e.origen.tieneToken && <div className="mt-1 text-xs text-slate-500">Con token de acceso (repositorio privado)</div>}
          </Tarjeta>
        </div>
      </div>

      {config && <ConfigOrigen origen={e.origen} onCerrar={() => setConfig(false)} onGuardado={() => { setConfig(false); cargar(); }} />}

      {fase && (
        <div className="fixed inset-0 z-[80] grid place-items-center bg-slate-900/70 p-6 backdrop-blur-sm">
          <div className="animar-entrada w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-2xl">
            {fase === 'listo' ? <CheckCircle size={56} weight="fill" className="mx-auto text-emerald-500" />
              : fase === 'fallo' ? <WarningCircle size={56} weight="fill" className="mx-auto text-red-500" />
              : <CircleNotch size={56} className="mx-auto animate-spin text-blue-600" />}
            <h2 className="mt-4 text-xl font-bold">
              {fase === 'listo' ? '¡Actualizado!' : fase === 'fallo' ? 'No se completó la actualización' : 'Actualizando el sistema'}
            </h2>
            <p className="mt-2 text-sm text-slate-600">{mensajeFase}</p>
            {['descargando', 'reiniciando', 'instalando'].includes(fase) && (
              <>
                <div className="mt-6 space-y-2 text-left text-sm">
                  {[['descargando', 'Descargar actualización'], ['reiniciando', 'Respaldar base de datos y código'], ['instalando', 'Instalar, compilar y reiniciar']].map(([f, t], i) => {
                    const orden = ['descargando', 'reiniciando', 'instalando'].indexOf(fase);
                    const estado = i < orden ? 'hecho' : i === orden ? 'actual' : 'pendiente';
                    return (
                      <div key={f} className={`flex items-center gap-2.5 ${estado === 'pendiente' ? 'text-slate-400' : 'text-slate-800'}`}>
                        {estado === 'hecho' ? <CheckCircle size={18} weight="fill" className="text-emerald-500" /> : estado === 'actual' ? <CircleNotch size={18} className="animate-spin text-blue-600" /> : <span className="size-[18px] rounded-full border-2 border-slate-200" />}
                        {t}
                      </div>
                    );
                  })}
                </div>
                <p className="mt-6 text-xs text-slate-400">No cierres esta ventana ni apagues la computadora.</p>
              </>
            )}
            {fase === 'fallo' && <Boton className="mt-6" onClick={() => setFase(null)}>Cerrar</Boton>}
          </div>
        </div>
      )}
    </div>
  );
}

function Notas({ n, actual }: { n: Entrada; actual?: boolean }) {
  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="codigo font-semibold">v{n.version}</span>
        {n.titulo && <span className="font-medium text-slate-800">· {n.titulo}</span>}
        {actual && <Insignia tono="emerald">Instalada</Insignia>}
        <span className="ml-auto text-xs text-slate-400">{n.fecha}</span>
      </div>
      <ul className="mt-1.5 space-y-1 text-sm text-slate-600">
        {n.cambios.map((c, i) => <li key={i} className="flex gap-2"><span className="mt-2 size-1 shrink-0 rounded-full bg-slate-400" />{c}</li>)}
      </ul>
    </div>
  );
}

function ConfigOrigen({ origen, onCerrar, onGuardado }: { origen: Estado['origen']; onCerrar: () => void; onGuardado: () => void }) {
  const [tipo, setTipo] = useState(origen.tipo);
  const [repo, setRepo] = useState(origen.repo ?? 'Erickdo/pos-dgii-rd');
  const [rama, setRama] = useState(origen.rama ?? 'main');
  const [url, setUrl] = useState(origen.url ?? '');
  const [token, setToken] = useState('');
  async function guardar() {
    try {
      await api('/admin/actualizaciones/origen', { method: 'PUT', body: tipo === 'github' ? { tipo, repo, rama, token } : { tipo, url } });
      avisar('Origen de actualizaciones guardado', 'ok');
      onGuardado();
    } catch (e) { avisar(e instanceof ApiError ? e.message : 'Error', 'error'); }
  }
  return (
    <Modal titulo="Origen de las actualizaciones" onCerrar={onCerrar} pie={<><Boton onClick={onCerrar}>Cancelar</Boton><Boton variante="primario" onClick={guardar}>Guardar</Boton></>}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          {(['github', 'url'] as const).map((t) => (
            <button key={t} onClick={() => setTipo(t)} className={`h-10 rounded-lg border text-sm font-semibold ${tipo === t ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-200'}`}>{t === 'github' ? 'GitHub' : 'URL propia'}</button>
          ))}
        </div>
        {tipo === 'github' ? (
          <>
            <Campo etiqueta="Repositorio" ayuda="usuario/repositorio"><Entrada value={repo} onChange={(e) => setRepo(e.target.value)} className="codigo" /></Campo>
            <Campo etiqueta="Rama"><Entrada value={rama} onChange={(e) => setRama(e.target.value)} className="codigo" /></Campo>
            <Campo etiqueta="Token de acceso (solo si el repositorio es privado)" ayuda={origen.tieneToken ? 'Hay un token guardado. Déjalo vacío para conservarlo o escribe "-" para borrarlo.' : 'Token de GitHub con permiso de solo lectura del contenido'}>
              <Entrada type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" />
            </Campo>
          </>
        ) : (
          <Campo etiqueta="URL base" ayuda="Debe servir version.json y paquete.zip"><Entrada value={url} onChange={(e) => setUrl(e.target.value)} className="codigo" placeholder="https://…" /></Campo>
        )}
        <p className="flex gap-2 rounded-lg bg-slate-50 p-3 text-xs text-slate-600"><Info size={16} className="shrink-0" />El token se guarda solo en este equipo.</p>
      </div>
    </Modal>
  );
}
