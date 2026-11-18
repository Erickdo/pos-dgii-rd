import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Marca } from './screens/Login';
import { api, type Caja, type ConfigImpresora, type EstadoFiscal, type Usuario } from './api';

interface Ctx {
  usuario: Usuario;
  caja: Caja | null | undefined;          // undefined = cargando
  recargarCaja: () => Promise<void>;
  fiscal: EstadoFiscal | null;
  refrescarFiscal: () => void;
  impresora: ConfigImpresora;
  recargarConfig: () => void;
  salir: () => void;
  ir: (ruta: Ruta) => void;
  actualizacionDisponible: string | null;   // versión nueva disponible (solo administradores)
  version: string;
  marca: Marca | null;
  recargarMarca: () => void;
  solicitudesPendientes: number;
  recargarSolicitudes: () => void;
}

export type Ruta = 'pos' | 'ventas' | 'caja' | 'inventario' | 'clientes' | 'fiscal' | 'reportes' | 'configuracion';

const AppCtx = createContext<Ctx | null>(null);
export const useApp = () => useContext(AppCtx)!;

const IMPRESORA_DEFECTO: ConfigImpresora = { ancho: '80', copias: 1, mensajePie: '¡Gracias por su compra!', imprimirAutomatico: false };

export function ProveedorApp({ usuario, salir, ir, children }: { usuario: Usuario; salir: () => void; ir: (r: Ruta) => void; children: ReactNode }) {
  const [caja, setCaja] = useState<Caja | null | undefined>(undefined);
  const [fiscal, setFiscal] = useState<EstadoFiscal | null>(null);
  const [impresora, setImpresora] = useState<ConfigImpresora>(IMPRESORA_DEFECTO);
  const [actualizacionDisponible, setActualizacion] = useState<string | null>(null);
  const [version, setVersion] = useState('');
  const [marca, setMarca] = useState<Marca | null>(null);
  const [solicitudesPendientes, setSolicitudes] = useState(0);
  const recargarMarca = useCallback(() => { api<Marca>('/marca').then(setMarca).catch(() => {}); }, []);
  const recargarSolicitudes = useCallback(() => {
    if (usuario.rol !== 'administrador') return;
    api<{ pendientes: number }>('/admin/solicitudes/conteo').then((r) => setSolicitudes(r.pendientes)).catch(() => {});
  }, [usuario.rol]);

  const recargarCaja = useCallback(async () => {
    try { setCaja(await api<Caja | null>('/cajas/actual')); } catch { setCaja(null); }
  }, []);
  const refrescarFiscal = useCallback(() => { api<EstadoFiscal>('/fiscal/estado').then(setFiscal).catch(() => {}); }, []);
  const recargarConfig = useCallback(() => {
    api<{ impresora?: ConfigImpresora }>('/config').then((c) => c.impresora && setImpresora(c.impresora)).catch(() => {});
  }, []);

  useEffect(() => {
    recargarCaja(); refrescarFiscal(); recargarConfig(); recargarMarca(); recargarSolicitudes();
    fetch('/api/version').then((r) => r.json()).then((v) => setVersion(v.version)).catch(() => {});
    const revisarActualizacion = () => {
      if (usuario.rol !== 'administrador') return;
      api<{ ultimaVerificacion: { disponible: boolean; versionRemota: string } | null }>('/admin/actualizaciones')
        .then((e) => setActualizacion(e.ultimaVerificacion?.disponible ? e.ultimaVerificacion.versionRemota : null)).catch(() => {});
    };
    revisarActualizacion();
    const t = setInterval(refrescarFiscal, 20_000);
    const t2 = setInterval(revisarActualizacion, 10 * 60_000);
    const t3 = setInterval(recargarSolicitudes, 30_000);
    return () => { clearInterval(t); clearInterval(t2); clearInterval(t3); };
  }, [recargarCaja, refrescarFiscal, recargarConfig, recargarMarca, recargarSolicitudes, usuario.rol]);

  return (
    <AppCtx.Provider value={{ usuario, caja, recargarCaja, fiscal, refrescarFiscal, impresora, recargarConfig, salir, ir, actualizacionDisponible, version, marca, recargarMarca, solicitudesPendientes, recargarSolicitudes }}>
      {children}
    </AppCtx.Provider>
  );
}
