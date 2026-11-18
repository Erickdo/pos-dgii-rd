import { useEffect, useRef, useState, type ComponentType } from 'react';
import {
  ShoppingCart, Receipt, CashRegister, Package, AddressBook, CloudCheck, ChartBar, GearSix,
  SidebarSimple, SignOut, CaretDown, type IconProps,
} from '@phosphor-icons/react';
import { useApp, type Ruta } from '../contexto';
import IndicadorDGII from '../components/IndicadorDGII';
import { CampanaSolicitudes } from '../components/Solicitudes';
import { LogoEmpresa } from '../screens/Login';
import PuntoVenta from '../pages/PuntoVenta';
import Ventas from '../pages/Ventas';
import Caja from '../pages/Caja';
import Inventario from '../pages/Inventario';
import Clientes from '../pages/Clientes';
import Fiscal from '../pages/Fiscal';
import Reportes from '../pages/Reportes';
import Configuracion from '../pages/Configuracion';

type Rol = 'cajero' | 'administrador' | 'contador';
export const MODULOS: { id: Ruta; nombre: string; corto: string; Icono: ComponentType<IconProps>; roles: Rol[]; Pagina: ComponentType }[] = [
  { id: 'pos', nombre: 'Punto de Venta', corto: 'Facturar', Icono: ShoppingCart, roles: ['cajero', 'administrador'], Pagina: PuntoVenta },
  { id: 'ventas', nombre: 'Historial de Ventas', corto: 'Facturas y notas de crédito', Icono: Receipt, roles: ['cajero', 'administrador', 'contador'], Pagina: Ventas },
  { id: 'caja', nombre: 'Control de Caja', corto: 'Turnos y arqueo', Icono: CashRegister, roles: ['cajero', 'administrador'], Pagina: Caja },
  { id: 'inventario', nombre: 'Inventario y Productos', corto: 'Catálogo, compras, kardex', Icono: Package, roles: ['administrador'], Pagina: Inventario },
  { id: 'clientes', nombre: 'Clientes', corto: 'RNC, cédulas y crédito', Icono: AddressBook, roles: ['cajero', 'administrador', 'contador'], Pagina: Clientes },
  { id: 'fiscal', nombre: 'Facturación Electrónica', corto: 'Monitor DGII', Icono: CloudCheck, roles: ['cajero', 'administrador', 'contador'], Pagina: Fiscal },
  { id: 'reportes', nombre: 'Reportes y Contabilidad', corto: 'Ventas, ITBIS, 607', Icono: ChartBar, roles: ['administrador', 'contador'], Pagina: Reportes },
  { id: 'configuracion', nombre: 'Configuración', corto: 'Empresa, usuarios, certificado', Icono: GearSix, roles: ['administrador'], Pagina: Configuracion },
];

const ROLES: Record<Rol, string> = { cajero: 'Cajero', administrador: 'Administrador', contador: 'Contador' };

export default function Shell({ ruta }: { ruta: Ruta }) {
  const { usuario, caja, ir, salir, fiscal, actualizacionDisponible, version, marca } = useApp();
  const [colapsado, setColapsado] = useState(() => { try { return localStorage.getItem('pos.sidebar') === '1'; } catch { return false; } });
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const visibles = MODULOS.filter((m) => m.roles.includes(usuario.rol));
  const actual = visibles.find((m) => m.id === ruta) ?? visibles[0];

  useEffect(() => { try { localStorage.setItem('pos.sidebar', colapsado ? '1' : '0'); } catch { /* */ } }, [colapsado]);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const negocio = marca?.nombre ?? fiscal?.emisor?.nombre_comercial ?? fiscal?.emisor?.razon_social ?? 'Punto de Venta';
  const iniciales = usuario.nombre.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  const esPOS = actual.id === 'pos';

  return (
    <div className="flex h-full">
      {/* ------------------------------------------------ barra lateral */}
      <aside className={`flex shrink-0 flex-col bg-slate-900 text-slate-300 transition-[width] duration-200 ${colapsado ? 'w-[72px]' : 'w-64'}`}>
        <div className={`flex h-16 items-center gap-3 border-b border-slate-800 ${colapsado ? 'justify-center px-0' : 'px-5'}`}>
          <LogoEmpresa marca={marca} tamano="sm" />
          {!colapsado && (
            <div className="min-w-0 leading-tight">
              <div className="truncate text-sm font-semibold text-white">{negocio}</div>
              <div className="text-xs text-slate-400">POS · e-CF DGII</div>
            </div>
          )}
        </div>

        <nav className="scroll-oscuro flex-1 space-y-0.5 overflow-y-auto p-3">
          {visibles.map((m, i) => {
            const activo = m.id === actual.id;
            return (
              <button key={m.id} onClick={() => ir(m.id)} title={colapsado ? m.nombre : undefined}
                className={`group flex w-full items-center gap-3 rounded-lg text-left transition
                  ${colapsado ? 'h-11 justify-center' : 'px-3 py-2.5'}
                  ${activo ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/40' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}`}>
                <span className="relative shrink-0">
                  <m.Icono size={21} weight={activo ? 'fill' : 'regular'} />
                  {colapsado && m.id === 'configuracion' && actualizacionDisponible && <span className="absolute -right-1 -top-1 size-2.5 rounded-full bg-emerald-400 ring-2 ring-slate-900" />}
                </span>
                {!colapsado && (
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between text-[14px] font-medium">
                      {m.nombre}
                      {m.id === 'configuracion' && actualizacionDisponible
                        ? <span className="rounded-full bg-emerald-500 px-1.5 text-[10px] font-bold text-white">NUEVA</span>
                        : <span className={`num text-[11px] ${activo ? 'text-blue-200' : 'text-slate-600'}`}>{i + 1}</span>}
                    </span>
                    <span className={`block truncate text-xs ${activo ? 'text-blue-100/80' : 'text-slate-500'}`}>{m.corto}</span>
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="border-t border-slate-800 p-3">
          {!colapsado && (
            <div className={`mb-2 rounded-lg px-3 py-2.5 text-xs ${caja ? 'bg-emerald-500/10 text-emerald-300' : 'bg-slate-800 text-slate-400'}`}>
              <div className="flex items-center gap-2 font-medium">
                <span className={`size-2 rounded-full ${caja ? 'bg-emerald-400' : 'bg-slate-500'}`} />
                {caja ? `Caja ${caja.terminal} abierta` : 'Sin caja abierta'}
              </div>
              {caja && <div className="mt-0.5 pl-4 text-slate-400">desde {caja.abierta_en.slice(11)}</div>}
            </div>
          )}
          <button onClick={() => setColapsado((c) => !c)}
            className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-400 hover:bg-slate-800 hover:text-white ${colapsado ? 'justify-center' : ''}`}>
            <SidebarSimple size={20} />{!colapsado && 'Contraer menú'}
          </button>
          {!colapsado && version && (
            <button onClick={() => usuario.rol === 'administrador' && (location.hash = '/configuracion/actualizaciones')}
              className="mt-1 w-full px-3 text-left text-[11px] text-slate-500 hover:text-slate-300">
              Versión <span className="codigo">{version}</span>{actualizacionDisponible && <span className="text-emerald-400"> · v{actualizacionDisponible} disponible</span>}
            </button>
          )}
        </div>
      </aside>

      {/* ------------------------------------------------ contenido */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center gap-4 border-b border-slate-200 bg-white px-6">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <actual.Icono size={18} />
              <span className="font-semibold text-slate-900">{actual.nombre}</span>
            </div>
          </div>
          <IndicadorDGII />
          {usuario.rol === 'administrador' && <CampanaSolicitudes />}
          <div ref={menuRef} className="relative">
            <button onClick={() => setMenu((m) => !m)} className="flex items-center gap-2.5 rounded-lg py-1.5 pl-1.5 pr-2.5 hover:bg-slate-100">
              <span className="grid size-8 place-items-center rounded-full bg-slate-900 text-xs font-semibold text-white">{iniciales}</span>
              <span className="text-left leading-tight">
                <span className="block text-sm font-semibold text-slate-800">{usuario.nombre}</span>
                <span className="block text-xs text-slate-500">{ROLES[usuario.rol]}</span>
              </span>
              <CaretDown size={14} className="text-slate-400" />
            </button>
            {menu && (
              <div className="animar-entrada absolute right-0 top-12 z-40 w-52 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl">
                <button onClick={salir} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50">
                  <SignOut size={18} /> Cerrar sesión
                </button>
              </div>
            )}
          </div>
        </header>

        <main className={`min-h-0 flex-1 ${esPOS ? 'overflow-hidden' : 'scroll-fino overflow-y-auto p-6 lg:p-8'}`}>
          <div className={esPOS ? 'h-full' : 'mx-auto max-w-[1400px]'}>
            <actual.Pagina key={actual.id} />
          </div>
        </main>
      </div>
    </div>
  );
}
