import { useCallback, useEffect, useState } from 'react';
import { guardarSesion, leerSesion, type Sesion } from './api';
import { ProveedorApp, type Ruta } from './contexto';
import Login, { type ModoAcceso } from './screens/Login';
import Shell, { MODULOS } from './layout/Shell';
import Avisos from './components/Avisos';

/** Ruta en el hash (#/ventas): recargar la página conserva la vista. */
function leerRuta(): Ruta {
  const r = location.hash.replace(/^#\/?/, '').split('/')[0] as Ruta;
  return MODULOS.some((m) => m.id === r) ? r : 'pos';
}

export default function App() {
  const [sesion, setSesion] = useState<Sesion | null>(leerSesion);
  const [ruta, setRuta] = useState<Ruta>(leerRuta);

  const salir = useCallback(() => { guardarSesion(null); setSesion(null); }, []);
  const ir = useCallback((r: Ruta) => { location.hash = `/${r}`; }, []);

  useEffect(() => {
    const h = () => setRuta(leerRuta());
    window.addEventListener('hashchange', h);
    window.addEventListener('sesion-vencida', salir);
    return () => { window.removeEventListener('hashchange', h); window.removeEventListener('sesion-vencida', salir); };
  }, [salir]);

  // Al entrar, cada rol cae en su módulo natural
  // Pestaña Caja → Punto de Venta (si no hay caja abierta, ahí mismo pide abrirla).
  // Pestaña Administrador → Reportes, el tablero del negocio.
  function entrar(s: Sesion, modo: ModoAcceso) {
    guardarSesion(s);
    setSesion(s);
    ir(modo === 'caja' ? 'pos' : 'reportes');
  }

  return (
    <>
      {!sesion ? <Login onEntrar={entrar} /> : (
        <ProveedorApp key={sesion.usuario.id} usuario={sesion.usuario} salir={salir} ir={ir}>
          <Shell ruta={ruta} />
        </ProveedorApp>
      )}
      <Avisos />
    </>
  );
}
