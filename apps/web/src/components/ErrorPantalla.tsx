import { Component, type ReactNode } from 'react';
import { WarningCircle, ArrowClockwise, SignOut } from '@phosphor-icons/react';
import { guardarSesion } from '../api';

/**
 * Si una pantalla falla, en vez de quedar en blanco se muestra qué pasó y cómo salir.
 * El caso típico: la pantalla se actualizó pero el servidor sigue siendo el de la versión anterior.
 */
export default class ErrorPantalla extends Component<{ children: ReactNode }, { error: Error | null; servidorViejo: boolean }> {
  state = { error: null as Error | null, servidorViejo: false };

  static getDerivedStateFromError(error: Error) { return { error }; }

  componentDidCatch(error: Error) {
    console.error(error);
    fetch('/api/version').then((r) => this.setState({ servidorViejo: !r.ok })).catch(() => {});
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="grid h-full place-items-center bg-slate-50 p-6">
        <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-8 shadow-xl">
          <WarningCircle size={44} weight="fill" className="text-amber-500" />
          <h1 className="mt-4 text-xl font-bold">La pantalla no pudo cargar</h1>
          {this.state.servidorViejo ? (
            <p className="mt-2 text-sm text-slate-600">
              El servidor que está corriendo es de una <b>versión anterior</b>. Cierra la ventana “POS DGII - servidor”
              (o en PowerShell: <code className="rounded bg-slate-100 px-1">Get-Process node | Stop-Process</code>) y abre el sistema con el acceso directo <b>“Punto de Venta”</b>.
            </p>
          ) : (
            <p className="mt-2 text-sm text-slate-600">Ocurrió un error inesperado. Recarga la página; si se repite, cierra sesión y vuelve a entrar.</p>
          )}
          <pre className="mt-4 max-h-28 overflow-auto rounded-lg bg-slate-50 p-3 text-xs text-slate-500">{this.state.error.message}</pre>
          <div className="mt-6 flex gap-2">
            <button onClick={() => location.reload()} className="flex h-10 items-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700">
              <ArrowClockwise size={18} /> Recargar
            </button>
            <button onClick={() => { guardarSesion(null); location.hash = ''; location.reload(); }}
              className="flex h-10 items-center gap-2 rounded-lg border border-slate-200 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              <SignOut size={18} /> Cerrar sesión
            </button>
          </div>
        </div>
      </div>
    );
  }
}
