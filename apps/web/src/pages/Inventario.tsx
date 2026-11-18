import { useCallback, useEffect, useState } from 'react';
import { Plus, MagnifyingGlass, PencilSimple, Package, Warning, Coins, Truck, Trash, ClockCounterClockwise } from '@phosphor-icons/react';
import { api, ApiError, type Categoria } from '../api';
import { Boton, Campo, Celda, EncabezadoPagina, EncabezadoTarjeta, Entrada, Insignia, Interruptor, KPI, Modal, Pestanas, Selector, Tabla, Tarjeta } from '../components/ui';
import { avisar, num, rd } from '../util';

interface ProductoAdmin {
  id: string; codigo_interno: string; codigo_barras: string | null; nombre: string; categoria_id: string | null; categoria: string | null;
  precio_venta: string; precio_final: string; indicador_itbis: number; costo: string; margen: string | null; es_servicio: boolean;
  maneja_inventario: boolean; stock_actual: string; stock_minimo: string; activo: boolean;
}
type Vista = 'productos' | 'compras' | 'kardex' | 'categorias';
const ITBIS: Record<number, string> = { 1: 'ITBIS 18%', 2: 'ITBIS 16%', 3: 'Tasa 0%', 4: 'Exento' };
const TASA: Record<number, number> = { 1: 0.18, 2: 0.16, 3: 0, 4: 0 };

export default function Inventario() {
  const [vista, setVista] = useState<Vista>('productos');
  const [productos, setProductos] = useState<ProductoAdmin[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [valor, setValor] = useState<{ productos: number; valor_costo: string; bajo_minimo: number } | null>(null);

  const cargar = useCallback(() => {
    api<ProductoAdmin[]>('/admin/productos').then(setProductos);
    api<Categoria[]>('/categorias').then(setCategorias);
    api<typeof valor>('/inventario/valorizado').then(setValor);
  }, []);
  useEffect(cargar, [cargar]);

  return (
    <>
      <EncabezadoPagina titulo="Inventario y Productos" descripcion="Catálogo, precios, ITBIS, compras a proveedores, ajustes y kardex." />
      <div className="mb-6 grid gap-4 md:grid-cols-4">
        <KPI titulo="Productos activos" valor={productos.filter((p) => p.activo).length} icono={<Package size={20} />} tono="blue" />
        <KPI titulo="Inventario valorizado" valor={rd(valor?.valor_costo ?? 0)} detalle="al costo" icono={<Coins size={20} />} tono="emerald" />
        <KPI titulo="Bajo el mínimo" valor={valor?.bajo_minimo ?? 0} detalle="requieren reorden" icono={<Warning size={20} />} tono={valor?.bajo_minimo ? 'amber' : 'slate'} />
        <KPI titulo="Categorías" valor={categorias.length} />
      </div>
      <div className="mb-4">
        <Pestanas valor={vista} onChange={setVista} opciones={[
          { id: 'productos', texto: 'Productos' }, { id: 'compras', texto: 'Compras' },
          { id: 'kardex', texto: 'Ajustes y kardex' }, { id: 'categorias', texto: 'Categorías' }]} />
      </div>
      {vista === 'productos' && <Productos productos={productos} categorias={categorias} recargar={cargar} />}
      {vista === 'compras' && <Compras productos={productos} recargar={cargar} />}
      {vista === 'kardex' && <Kardex productos={productos} recargar={cargar} />}
      {vista === 'categorias' && <Categorias categorias={categorias} recargar={cargar} />}
    </>
  );
}

// ================================================================ productos
function Productos({ productos, categorias, recargar }: { productos: ProductoAdmin[]; categorias: Categoria[]; recargar: () => void }) {
  const [q, setQ] = useState('');
  const [editar, setEditar] = useState<ProductoAdmin | 'nuevo' | null>(null);
  const f = q.trim().toLowerCase();
  const lista = productos.filter((p) => !f || p.nombre.toLowerCase().includes(f) || p.codigo_interno.toLowerCase().includes(f) || p.codigo_barras === q.trim());

  return (
    <Tarjeta>
      <div className="flex items-center gap-3 border-b border-slate-100 p-4">
        <div className="relative max-w-sm flex-1">
          <MagnifyingGlass size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Entrada value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nombre, código o código de barras" className="pl-10" />
        </div>
        <Boton variante="primario" className="ml-auto" icono={<Plus size={18} weight="bold" />} onClick={() => setEditar('nuevo')}>Nuevo producto</Boton>
      </div>
      <Tabla columnas={['Código', 'Producto', 'Categoría', 'Impuesto', { t: 'Costo', derecha: true }, { t: 'Precio final', derecha: true }, { t: 'Margen', derecha: true }, { t: 'Stock', derecha: true }, '']}>
        {lista.map((p) => {
          const bajo = p.maneja_inventario && Number(p.stock_actual) <= Number(p.stock_minimo);
          return (
            <tr key={p.id} className={`hover:bg-slate-50/70 ${!p.activo ? 'opacity-50' : ''}`}>
              <Celda><div className="codigo text-xs font-semibold">{p.codigo_interno}</div>{p.codigo_barras && <div className="codigo text-xs text-slate-400">{p.codigo_barras}</div>}</Celda>
              <Celda className="font-medium">{p.nombre}{!p.activo && <span className="ml-2"><Insignia>Inactivo</Insignia></span>}</Celda>
              <Celda className="text-slate-600">{p.categoria ?? '—'}</Celda>
              <Celda><Insignia tono={p.indicador_itbis === 1 ? 'blue' : p.indicador_itbis === 2 ? 'violet' : 'slate'}>{ITBIS[p.indicador_itbis]}</Insignia></Celda>
              <Celda derecha className="num text-slate-600">{num(p.costo)}</Celda>
              <Celda derecha className="num font-semibold">{num(p.precio_final)}</Celda>
              <Celda derecha className={`num ${Number(p.margen) < 20 ? 'text-amber-600' : 'text-slate-600'}`}>{p.margen != null ? `${p.margen}%` : '—'}</Celda>
              <Celda derecha>
                {p.maneja_inventario
                  ? <span className={`num font-semibold ${bajo ? 'text-red-600' : ''}`}>{Number(p.stock_actual)}<span className="ml-1 text-xs font-normal text-slate-400">/ mín {Number(p.stock_minimo)}</span></span>
                  : <span className="text-xs text-slate-400">{p.es_servicio ? 'Servicio' : 'Sin control'}</span>}
              </Celda>
              <Celda derecha><Boton tamano="sm" variante="fantasma" onClick={() => setEditar(p)}><PencilSimple size={16} /></Boton></Celda>
            </tr>
          );
        })}
      </Tabla>
      {editar && <FormProducto producto={editar === 'nuevo' ? null : editar} categorias={categorias} onCerrar={() => setEditar(null)} onGuardado={() => { setEditar(null); recargar(); }} />}
    </Tarjeta>
  );
}

function FormProducto({ producto, categorias, onCerrar, onGuardado }: { producto: ProductoAdmin | null; categorias: Categoria[]; onCerrar: () => void; onGuardado: () => void }) {
  const [d, setD] = useState({
    codigoInterno: producto?.codigo_interno ?? '', codigoBarras: producto?.codigo_barras ?? '', nombre: producto?.nombre ?? '',
    categoriaId: producto?.categoria_id ?? '', precioFinal: producto?.precio_final ?? '', indicadorItbis: producto?.indicador_itbis ?? 1,
    costo: producto?.costo ? Number(producto.costo).toFixed(2) : '', esServicio: producto?.es_servicio ?? false,
    manejaInventario: producto?.maneja_inventario ?? true, stockMinimo: producto ? String(Number(producto.stock_minimo)) : '5',
    stockInicial: '', activo: producto?.activo ?? true,
  });
  const [enviando, setEnviando] = useState(false);
  const set = <K extends keyof typeof d>(k: K, v: (typeof d)[K]) => setD((x) => ({ ...x, [k]: v }));

  const precio = Number(d.precioFinal) || 0;
  const sinItbis = precio / (1 + TASA[d.indicadorItbis]);
  const margen = sinItbis > 0 ? ((sinItbis - (Number(d.costo) || 0)) / sinItbis) * 100 : 0;

  async function guardar() {
    setEnviando(true);
    try {
      const body = { ...d, costo: Number(d.costo) || 0, precioFinal: precio, stockMinimo: Number(d.stockMinimo) || 0, stockInicial: Number(d.stockInicial) || 0 };
      if (producto) await api(`/admin/productos/${producto.id}`, { method: 'PUT', body });
      else await api('/admin/productos', { body });
      avisar(producto ? 'Producto actualizado' : 'Producto creado', 'ok');
      onGuardado();
    } catch (e) { avisar(e instanceof ApiError ? e.message : 'No se pudo guardar', 'error'); }
    finally { setEnviando(false); }
  }

  return (
    <Modal titulo={producto ? 'Editar producto' : 'Nuevo producto'} onCerrar={onCerrar} ancho="max-w-2xl"
      pie={<><Boton onClick={onCerrar}>Cancelar</Boton><Boton variante="primario" cargando={enviando} disabled={!d.nombre || !d.codigoInterno || !precio} onClick={guardar}>Guardar</Boton></>}>
      <div className="grid grid-cols-2 gap-4">
        <Campo etiqueta="Nombre del producto" className="col-span-2"><Entrada autoFocus value={d.nombre} onChange={(e) => set('nombre', e.target.value)} maxLength={80} /></Campo>
        <Campo etiqueta="Código interno"><Entrada value={d.codigoInterno} onChange={(e) => set('codigoInterno', e.target.value)} className="codigo uppercase" placeholder="CAF-01" /></Campo>
        <Campo etiqueta="Código de barras" ayuda="Escanéalo aquí con el lector"><Entrada value={d.codigoBarras} onChange={(e) => set('codigoBarras', e.target.value)} className="codigo" /></Campo>
        <Campo etiqueta="Categoría">
          <Selector value={d.categoriaId} onChange={(e) => set('categoriaId', e.target.value)}>
            <option value="">Sin categoría</option>
            {categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </Selector>
        </Campo>
        <Campo etiqueta="Impuesto (ITBIS)">
          <Selector value={d.indicadorItbis} onChange={(e) => set('indicadorItbis', Number(e.target.value))}>
            <option value={1}>ITBIS 18% (tasa general)</option>
            <option value={2}>ITBIS 16% (tasa reducida)</option>
            <option value={4}>Exento</option>
            <option value={3}>Tasa 0%</option>
          </Selector>
        </Campo>
        <Campo etiqueta="Precio de venta final (con ITBIS)" ayuda={`Sin ITBIS: ${rd(sinItbis)}`}>
          <Entrada type="number" min="0" step="0.01" value={d.precioFinal} onChange={(e) => set('precioFinal', e.target.value)} className="num text-base font-semibold" />
        </Campo>
        <Campo etiqueta="Costo (sin ITBIS)" ayuda={<span className={margen < 20 ? 'text-amber-600' : 'text-emerald-600'}>Margen: {margen.toFixed(1)}%</span>}>
          <Entrada type="number" min="0" step="0.01" value={d.costo} onChange={(e) => set('costo', e.target.value)} className="num" />
        </Campo>
        <div className="col-span-2 space-y-3 rounded-xl bg-slate-50 p-4">
          <Interruptor activo={d.esServicio} onChange={(v) => { set('esServicio', v); if (v) set('manejaInventario', false); }} etiqueta="Es un servicio" descripcion="No tiene existencias físicas" />
          {!d.esServicio && <Interruptor activo={d.manejaInventario} onChange={(v) => set('manejaInventario', v)} etiqueta="Controlar inventario" descripcion="Descuenta stock en cada venta y alerta cuando baja del mínimo" />}
          {!d.esServicio && d.manejaInventario && (
            <div className="grid grid-cols-2 gap-3 pt-1">
              {!producto && <Campo etiqueta="Stock inicial"><Entrada type="number" min="0" value={d.stockInicial} onChange={(e) => set('stockInicial', e.target.value)} className="num" /></Campo>}
              <Campo etiqueta="Stock mínimo (alerta)"><Entrada type="number" min="0" value={d.stockMinimo} onChange={(e) => set('stockMinimo', e.target.value)} className="num" /></Campo>
            </div>
          )}
          {producto && <Interruptor activo={d.activo} onChange={(v) => set('activo', v)} etiqueta="Activo" descripcion="Los productos inactivos no aparecen en el punto de venta" />}
        </div>
      </div>
    </Modal>
  );
}

// ================================================================ compras
interface Compra { id: string; fecha: string; proveedor_nombre: string; proveedor_rnc: string | null; ncf_proveedor: string | null; total: string; itbis_pagado: string; usuario: string; lineas: number }

function Compras({ productos, recargar }: { productos: ProductoAdmin[]; recargar: () => void }) {
  const [compras, setCompras] = useState<Compra[]>([]);
  const [nueva, setNueva] = useState(false);
  const cargar = () => api<Compra[]>('/inventario/compras').then(setCompras);
  useEffect(() => { cargar(); }, []);
  return (
    <Tarjeta>
      <EncabezadoTarjeta titulo="Compras a proveedores" descripcion="Cada compra suma existencias y actualiza el último costo" accion={<Boton variante="primario" icono={<Truck size={18} />} onClick={() => setNueva(true)}>Registrar compra</Boton>} />
      <Tabla columnas={['Fecha', 'Proveedor', 'NCF proveedor', 'Líneas', 'Registró', { t: 'ITBIS', derecha: true }, { t: 'Total', derecha: true }]} vacio="Aún no hay compras registradas">
        {compras.map((c) => (
          <tr key={c.id}>
            <Celda className="num text-slate-600">{c.fecha}</Celda>
            <Celda><div className="font-medium">{c.proveedor_nombre}</div>{c.proveedor_rnc && <div className="codigo text-xs text-slate-400">{c.proveedor_rnc}</div>}</Celda>
            <Celda className="codigo text-slate-600">{c.ncf_proveedor ?? '—'}</Celda>
            <Celda className="num">{c.lineas}</Celda>
            <Celda className="text-slate-600">{c.usuario}</Celda>
            <Celda derecha className="num">{num(c.itbis_pagado)}</Celda>
            <Celda derecha className="num font-semibold">{num(c.total)}</Celda>
          </tr>
        ))}
      </Tabla>
      {nueva && <FormCompra productos={productos.filter((p) => p.activo && p.maneja_inventario)} onCerrar={() => setNueva(false)} onGuardada={() => { setNueva(false); cargar(); recargar(); }} />}
    </Tarjeta>
  );
}

function FormCompra({ productos, onCerrar, onGuardada }: { productos: ProductoAdmin[]; onCerrar: () => void; onGuardada: () => void }) {
  const [prov, setProv] = useState({ nombre: '', rnc: '', ncf: '', itbis: '' });
  const [lineas, setLineas] = useState<{ productoId: string; cantidad: string; costo: string }[]>([{ productoId: '', cantidad: '', costo: '' }]);
  const [enviando, setEnviando] = useState(false);
  const total = lineas.reduce((s, l) => s + (Number(l.cantidad) || 0) * (Number(l.costo) || 0), 0);
  const validas = lineas.filter((l) => l.productoId && Number(l.cantidad) > 0);

  async function guardar() {
    setEnviando(true);
    try {
      await api('/inventario/compras', { body: {
        proveedorNombre: prov.nombre, proveedorRnc: prov.rnc.replace(/\D/g, ''), ncfProveedor: prov.ncf, itbisPagado: Number(prov.itbis) || 0,
        items: validas.map((l) => ({ productoId: l.productoId, cantidad: Number(l.cantidad), costoUnitario: Number(l.costo) || 0 })),
      } });
      avisar('Compra registrada: inventario actualizado', 'ok');
      onGuardada();
    } catch (e) { avisar(e instanceof ApiError ? e.message : 'No se pudo guardar', 'error'); }
    finally { setEnviando(false); }
  }

  return (
    <Modal titulo="Registrar compra" onCerrar={onCerrar} ancho="max-w-3xl"
      pie={<><span className="num mr-auto self-center text-sm text-slate-600">Total: <b className="text-slate-900">{rd(total)}</b></span><Boton onClick={onCerrar}>Cancelar</Boton><Boton variante="primario" cargando={enviando} disabled={!prov.nombre || !validas.length} onClick={guardar}>Guardar compra</Boton></>}>
      <div className="grid grid-cols-4 gap-3">
        <Campo etiqueta="Proveedor" className="col-span-2"><Entrada autoFocus value={prov.nombre} onChange={(e) => setProv({ ...prov, nombre: e.target.value })} /></Campo>
        <Campo etiqueta="RNC"><Entrada value={prov.rnc} onChange={(e) => setProv({ ...prov, rnc: e.target.value })} className="codigo" /></Campo>
        <Campo etiqueta="NCF del proveedor"><Entrada value={prov.ncf} onChange={(e) => setProv({ ...prov, ncf: e.target.value.toUpperCase() })} className="codigo" placeholder="E31…" /></Campo>
      </div>
      <div className="mt-5 space-y-2">
        <div className="grid grid-cols-[1fr_100px_120px_100px_36px] gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          <span>Producto</span><span>Cantidad</span><span>Costo unit.</span><span className="text-right">Importe</span><span />
        </div>
        {lineas.map((l, i) => (
          <div key={i} className="grid grid-cols-[1fr_100px_120px_100px_36px] items-center gap-2">
            <Selector value={l.productoId} onChange={(e) => {
              const p = productos.find((x) => x.id === e.target.value);
              setLineas((ls) => ls.map((x, j) => (j === i ? { ...x, productoId: e.target.value, costo: x.costo || (p ? Number(p.costo).toFixed(2) : '') } : x)));
            }}>
              <option value="">Elegir…</option>
              {productos.map((p) => <option key={p.id} value={p.id}>{p.nombre} (stock {Number(p.stock_actual)})</option>)}
            </Selector>
            <Entrada type="number" min="0" value={l.cantidad} onChange={(e) => setLineas((ls) => ls.map((x, j) => (j === i ? { ...x, cantidad: e.target.value } : x)))} className="num" />
            <Entrada type="number" min="0" step="0.01" value={l.costo} onChange={(e) => setLineas((ls) => ls.map((x, j) => (j === i ? { ...x, costo: e.target.value } : x)))} className="num" />
            <span className="num text-right text-sm font-medium">{num((Number(l.cantidad) || 0) * (Number(l.costo) || 0))}</span>
            <button onClick={() => setLineas((ls) => ls.filter((_, j) => j !== i))} className="grid size-9 place-items-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash size={16} /></button>
          </div>
        ))}
        <Boton tamano="sm" variante="fantasma" icono={<Plus size={14} />} onClick={() => setLineas((l) => [...l, { productoId: '', cantidad: '', costo: '' }])}>Agregar línea</Boton>
      </div>
      <Campo etiqueta="ITBIS pagado en la factura (para el 606)" className="mt-4 max-w-56">
        <Entrada type="number" min="0" step="0.01" value={prov.itbis} onChange={(e) => setProv({ ...prov, itbis: e.target.value })} className="num" />
      </Campo>
    </Modal>
  );
}

// ================================================================ ajustes y kardex
interface MovK { tipo: string; cantidad: string; stock_resultante: string; costo_unitario: string | null; referencia_tipo: string | null; fecha: string; usuario: string | null }
const TIPOS_MOV: Record<string, [string, 'emerald' | 'red' | 'blue' | 'amber' | 'slate']> = {
  venta: ['Venta', 'blue'], compra: ['Compra', 'emerald'], ajuste_pos: ['Ajuste +', 'emerald'], ajuste_neg: ['Ajuste −', 'amber'],
  anulacion_venta: ['Devolución E34', 'slate'], devolucion: ['Devolución', 'slate'],
};

function Kardex({ productos, recargar }: { productos: ProductoAdmin[]; recargar: () => void }) {
  const conInv = productos.filter((p) => p.maneja_inventario);
  const [id, setId] = useState(conInv[0]?.id ?? '');
  const [movs, setMovs] = useState<MovK[]>([]);
  const [cantidad, setCantidad] = useState('');
  const [motivo, setMotivo] = useState('');
  const p = conInv.find((x) => x.id === id);
  const cargar = useCallback(() => { if (id) api<MovK[]>(`/inventario/kardex/${id}`).then(setMovs); }, [id]);
  useEffect(cargar, [cargar]);

  async function ajustar(signo: 1 | -1) {
    try {
      const r = await api<{ stock: string }>('/inventario/ajustes', { body: { productoId: id, cantidad: signo * Math.abs(Number(cantidad)), motivo } });
      avisar(`Stock actualizado: ${Number(r.stock)}`, 'ok');
      setCantidad(''); setMotivo(''); cargar(); recargar();
    } catch (e) { avisar(e instanceof ApiError ? e.message : 'Error', 'error'); }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
      <Tarjeta className="p-5">
        <h3 className="font-semibold">Ajuste de inventario</h3>
        <p className="mb-4 text-sm text-slate-500">Conteo físico, mermas, vencidos o roturas</p>
        <div className="space-y-4">
          <Campo etiqueta="Producto">
            <Selector value={id} onChange={(e) => setId(e.target.value)}>
              {conInv.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
            </Selector>
          </Campo>
          {p && <div className="flex items-center justify-between rounded-lg bg-slate-50 px-4 py-3"><span className="text-sm text-slate-500">Stock actual</span><span className="num text-2xl font-bold">{Number(p.stock_actual)}</span></div>}
          <Campo etiqueta="Cantidad"><Entrada type="number" min="0" value={cantidad} onChange={(e) => setCantidad(e.target.value)} className="num" /></Campo>
          <Campo etiqueta="Motivo"><Entrada value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej.: conteo físico, merma" /></Campo>
          <div className="grid grid-cols-2 gap-2">
            <Boton variante="exito" disabled={!Number(cantidad) || motivo.length < 3} onClick={() => ajustar(1)}>+ Sumar</Boton>
            <Boton variante="peligro" disabled={!Number(cantidad) || motivo.length < 3} onClick={() => ajustar(-1)}>− Restar</Boton>
          </div>
        </div>
      </Tarjeta>
      <Tarjeta>
        <EncabezadoTarjeta titulo={`Kardex · ${p?.nombre ?? ''}`} descripcion="Todos los movimientos de existencias" accion={<ClockCounterClockwise size={20} className="text-slate-400" />} />
        <Tabla columnas={['Fecha', 'Movimiento', 'Detalle', 'Usuario', { t: 'Cantidad', derecha: true }, { t: 'Saldo', derecha: true }]} vacio="Sin movimientos">
          {movs.map((m, i) => {
            const [t, tono] = TIPOS_MOV[m.tipo] ?? [m.tipo, 'slate'];
            return (
              <tr key={i}>
                <Celda className="num text-slate-500">{m.fecha}</Celda>
                <Celda><Insignia tono={tono}>{t}</Insignia></Celda>
                <Celda className="text-slate-600">{m.referencia_tipo?.replace('_', ' ') ?? '—'}{m.costo_unitario && <span className="num text-xs text-slate-400"> · costo {num(m.costo_unitario)}</span>}</Celda>
                <Celda className="text-slate-500">{m.usuario ?? '—'}</Celda>
                <Celda derecha className={`num font-semibold ${Number(m.cantidad) < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{Number(m.cantidad) > 0 ? '+' : ''}{Number(m.cantidad)}</Celda>
                <Celda derecha className="num">{Number(m.stock_resultante)}</Celda>
              </tr>
            );
          })}
        </Tabla>
      </Tarjeta>
    </div>
  );
}

// ================================================================ categorías
function Categorias({ categorias, recargar }: { categorias: Categoria[]; recargar: () => void }) {
  const [nombre, setNombre] = useState('');
  const [editando, setEditando] = useState<{ id: string; nombre: string } | null>(null);
  async function crear() {
    try { await api('/admin/categorias', { body: { nombre } }); setNombre(''); recargar(); avisar('Categoría creada', 'ok'); }
    catch (e) { avisar(e instanceof ApiError ? e.message : 'Error', 'error'); }
  }
  async function renombrar() {
    if (!editando) return;
    try { await api(`/admin/categorias/${editando.id}`, { method: 'PUT', body: { nombre: editando.nombre } }); setEditando(null); recargar(); }
    catch (e) { avisar(e instanceof ApiError ? e.message : 'Error', 'error'); }
  }
  return (
    <Tarjeta className="max-w-2xl">
      <div className="flex gap-2 border-b border-slate-100 p-4">
        <Entrada value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nueva categoría" onKeyDown={(e) => e.key === 'Enter' && nombre.length > 1 && crear()} />
        <Boton variante="primario" disabled={nombre.length < 2} onClick={crear} icono={<Plus size={16} />}>Agregar</Boton>
      </div>
      <Tabla columnas={['Categoría', { t: 'Productos', derecha: true }, '']}>
        {categorias.map((c) => (
          <tr key={c.id}>
            <Celda>{editando?.id === c.id
              ? <Entrada autoFocus value={editando.nombre} onChange={(e) => setEditando({ ...editando, nombre: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && renombrar()} onBlur={renombrar} className="h-8" />
              : <span className="font-medium">{c.nombre}</span>}</Celda>
            <Celda derecha className="num">{c.productos}</Celda>
            <Celda derecha><Boton tamano="sm" variante="fantasma" onClick={() => setEditando({ id: c.id, nombre: c.nombre })}><PencilSimple size={16} /></Boton></Celda>
          </tr>
        ))}
      </Tabla>
    </Tarjeta>
  );
}
