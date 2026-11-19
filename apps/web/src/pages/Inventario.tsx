import { useCallback, useEffect, useState } from 'react';
import { Plus, MagnifyingGlass, PencilSimple, Package, Warning, Coins, Truck, Trash, ClockCounterClockwise, Tag, Archive, ArrowCounterClockwise } from '@phosphor-icons/react';
import { api, ApiError } from '../api';
import { Boton, Campo, Celda, EncabezadoPagina, EncabezadoTarjeta, Entrada, Insignia, Interruptor, KPI, Modal, Pestanas, Selector, Tabla, Tarjeta, Tecla } from '../components/ui';
import { avisar, num, rd } from '../util';

interface ProductoAdmin {
  id: string; codigo_interno: string; codigo_barras: string | null; nombre: string; categoria_id: string | null; categoria: string | null;
  precio_venta: string; precio_final: string; indicador_itbis: number; costo: string; margen: string | null; es_servicio: boolean;
  maneja_inventario: boolean; stock_actual: string; stock_minimo: string; activo: boolean;
}
type Vista = 'productos' | 'compras' | 'kardex' | 'categorias';
interface Categoria { id: string; nombre: string; productos: number; activos: number }
const ITBIS: Record<number, string> = { 1: 'ITBIS 18%', 2: 'ITBIS 16%', 3: 'Tasa 0%', 4: 'Exento' };
const TASA: Record<number, number> = { 1: 0.18, 2: 0.16, 3: 0, 4: 0 };

export default function Inventario() {
  const [vista, setVista] = useState<Vista>('productos');
  const [productos, setProductos] = useState<ProductoAdmin[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [valor, setValor] = useState<{ productos: number; valor_costo: string; bajo_minimo: number } | null>(null);

  const cargar = useCallback(() => {
    api<ProductoAdmin[]>('/admin/productos').then(setProductos);
    api<Categoria[]>('/admin/categorias').then(setCategorias);
    api<typeof valor>('/inventario/valorizado').then(setValor);
  }, []);
  useEffect(cargar, [cargar]);

  return (
    <>
      <EncabezadoPagina titulo="Inventario y Productos" descripcion="Catálogo, precios, ITBIS, compras a proveedores, ajustes y kardex." />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KPI titulo="Productos activos" valor={productos.filter((p) => p.activo).length} icono={<Package size={17} />} tono="blue" />
        <KPI titulo="Inventario valorizado" valor={rd(valor?.valor_costo ?? 0)} detalle="al costo" icono={<Coins size={17} />} tono="emerald" />
        <KPI titulo="Bajo el mínimo" valor={valor?.bajo_minimo ?? 0} detalle="requieren reorden" icono={<Warning size={17} />} tono={valor?.bajo_minimo ? 'amber' : 'slate'} />
        <KPI titulo="Categorías" valor={categorias.length} detalle={`${productos.filter((p) => !p.activo).length} productos inactivos`} icono={<Tag size={17} />} tono="slate" />
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Pestanas valor={vista} onChange={setVista} opciones={[
          { id: 'productos', texto: 'Productos', cuenta: productos.length }, { id: 'compras', texto: 'Compras' },
          { id: 'kardex', texto: 'Ajustes y kardex' }, { id: 'categorias', texto: 'Categorías', cuenta: categorias.length }]} />
        <span className="text-xs text-slate-500">{{
          productos: 'Alta, edición y eliminación del catálogo',
          compras: 'Facturas de suplidores: suman stock y registran el ITBIS para el 606',
          kardex: 'Entradas y salidas manuales por conteo físico, merma, vencido o rotura',
          categorias: 'Agrupa los productos en el punto de venta',
        }[vista]}</span>
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
  const [estado, setEstado] = useState<'activos' | 'inactivos' | 'todos'>('activos');
  const [cat, setCat] = useState('');
  const [editar, setEditar] = useState<ProductoAdmin | 'nuevo' | null>(null);
  const [eliminar, setEliminar] = useState<ProductoAdmin | null>(null);
  const f = q.trim().toLowerCase();
  const lista = productos.filter((p) =>
    (estado === 'todos' || (estado === 'activos' ? p.activo : !p.activo)) &&
    (!cat || (cat === 'sin' ? !p.categoria_id : p.categoria_id === cat)) &&
    (!f || p.nombre.toLowerCase().includes(f) || p.codigo_interno.toLowerCase().includes(f) || p.codigo_barras === q.trim()));

  async function reactivar(p: ProductoAdmin) {
    try {
      await api(`/admin/productos/${p.id}`, { method: 'PUT', body: {
        codigoInterno: p.codigo_interno, codigoBarras: p.codigo_barras ?? '', nombre: p.nombre, categoriaId: p.categoria_id ?? '',
        precioFinal: Number(p.precio_final), indicadorItbis: p.indicador_itbis, costo: Number(p.costo), esServicio: p.es_servicio,
        manejaInventario: p.maneja_inventario, stockMinimo: Number(p.stock_minimo), activo: true } });
      avisar(`«${p.nombre}» está activo otra vez`, 'ok'); recargar();
    } catch (e) { avisar(e instanceof ApiError ? e.message : 'Error', 'error'); }
  }

  return (
    <Tarjeta>
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
        <div className="relative w-full max-w-xs">
          <MagnifyingGlass size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Entrada data-buscar value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') { setQ(''); e.currentTarget.blur(); } }} placeholder="Nombre, código o código de barras (F2)" className="pl-9" />
        </div>
        <Selector value={cat} onChange={(e) => setCat(e.target.value)} className="w-44">
          <option value="">Todas las categorías</option>
          {categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          <option value="sin">Sin categoría</option>
        </Selector>
        <Pestanas valor={estado} onChange={setEstado} opciones={[
          { id: 'activos', texto: 'Activos' }, { id: 'inactivos', texto: 'Inactivos', cuenta: productos.filter((p) => !p.activo).length }, { id: 'todos', texto: 'Todos' }]} />
        <Boton data-atajo="nuevo" title="Alt+N" variante="primario" className="ml-auto" icono={<Plus size={16} weight="bold" />} onClick={() => setEditar('nuevo')}>Nuevo producto <Tecla oscura>Alt+N</Tecla></Boton>
      </div>
      <Tabla columnas={['Código', 'Producto', 'Categoría', 'Impuesto', { t: 'Costo', derecha: true }, { t: 'Precio final', derecha: true }, { t: 'Margen', derecha: true }, { t: 'Stock', derecha: true }, { t: 'Acciones', derecha: true }]}
        vacio={estado === 'inactivos' ? 'No hay productos inactivos' : 'No hay productos que coincidan'}>
        {lista.map((p) => {
          const bajo = p.maneja_inventario && Number(p.stock_actual) <= Number(p.stock_minimo);
          return (
            <tr key={p.id} className={`hover:bg-slate-50/70 ${!p.activo ? 'bg-slate-50/50 text-slate-400' : ''}`}>
              <Celda><div className="codigo text-xs font-semibold">{p.codigo_interno}</div>{p.codigo_barras && <div className="codigo text-[11px] text-slate-400">{p.codigo_barras}</div>}</Celda>
              <Celda className="font-medium">{p.nombre}{!p.activo && <span className="ml-2"><Insignia>Inactivo</Insignia></span>}</Celda>
              <Celda className="text-slate-600">{p.categoria ?? '—'}</Celda>
              <Celda><Insignia tono={p.indicador_itbis === 1 ? 'blue' : p.indicador_itbis === 2 ? 'violet' : 'slate'}>{ITBIS[p.indicador_itbis]}</Insignia></Celda>
              <Celda derecha className="num text-slate-600">{num(p.costo)}</Celda>
              <Celda derecha className="num font-semibold">{num(p.precio_final)}</Celda>
              <Celda derecha className={`num ${Number(p.margen) < 20 ? 'text-amber-600' : 'text-slate-600'}`}>{p.margen != null ? `${p.margen}%` : '—'}</Celda>
              <Celda derecha>
                {p.maneja_inventario
                  ? <span className={`num font-semibold ${bajo ? 'text-red-600' : ''}`}>{Number(p.stock_actual)}<span className="ml-1 text-[11px] font-normal text-slate-400">/ mín {Number(p.stock_minimo)}</span></span>
                  : <span className="text-xs text-slate-400">{p.es_servicio ? 'Servicio' : 'Sin control'}</span>}
              </Celda>
              <Celda derecha>
                <div className="flex justify-end gap-0.5">
                  {!p.activo && <Boton tamano="sm" variante="fantasma" title="Reactivar" onClick={() => reactivar(p)}><ArrowCounterClockwise size={15} /></Boton>}
                  <Boton tamano="sm" variante="fantasma" title="Editar" onClick={() => setEditar(p)}><PencilSimple size={15} /></Boton>
                  <Boton tamano="sm" variante="fantasma" title="Eliminar" className="hover:!bg-red-50 hover:!text-red-600" onClick={() => setEliminar(p)}><Trash size={15} /></Boton>
                </div>
              </Celda>
            </tr>
          );
        })}
      </Tabla>
      {editar && <FormProducto producto={editar === 'nuevo' ? null : editar} categorias={categorias} onCerrar={() => setEditar(null)} onGuardado={() => { setEditar(null); recargar(); }}
        onEliminar={editar !== 'nuevo' ? () => { setEliminar(editar); setEditar(null); } : undefined} />}
      {eliminar && <EliminarProducto producto={eliminar} onCerrar={() => setEliminar(null)} onHecho={() => { setEliminar(null); recargar(); }} />}
    </Tarjeta>
  );
}

/** Confirmación de borrado. Si el producto ya tiene ventas o compras, ofrece desactivarlo en su lugar. */
function EliminarProducto({ producto, onCerrar, onHecho }: { producto: ProductoAdmin; onCerrar: () => void; onHecho: () => void }) {
  const [paso, setPaso] = useState<'confirmar' | 'historial'>('confirmar');
  const [detalle, setDetalle] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function borrar() {
    setEnviando(true);
    try {
      await api(`/admin/productos/${producto.id}`, { method: 'DELETE' });
      avisar(`«${producto.nombre}» eliminado`, 'ok'); onHecho();
    } catch (e) {
      if (e instanceof ApiError && e.codigo === 'CON_HISTORIAL') { setDetalle(e.message); setPaso('historial'); }
      else avisar(e instanceof ApiError ? e.message : 'No se pudo eliminar', 'error');
    } finally { setEnviando(false); }
  }
  async function desactivar() {
    setEnviando(true);
    try {
      await api(`/admin/productos/${producto.id}?desactivar=1`, { method: 'DELETE' });
      avisar(`«${producto.nombre}» desactivado: ya no aparece en el punto de venta`, 'ok'); onHecho();
    } catch (e) { avisar(e instanceof ApiError ? e.message : 'Error', 'error'); }
    finally { setEnviando(false); }
  }

  if (paso === 'historial') {
    return (
      <Modal titulo="No se puede eliminar" onCerrar={onCerrar} ancho="max-w-md"
        pie={<><Boton onClick={onCerrar}>Cancelar</Boton><Boton variante="primario" icono={<Archive size={16} />} cargando={enviando} onClick={desactivar}>Desactivar producto</Boton></>}>
        <p className="text-sm text-slate-600">{detalle}</p>
        <p className="mt-3 rounded-lg bg-blue-50 px-3 py-2 text-[13px] text-blue-800">Al desactivarlo deja de salir en el punto de venta, pero sus facturas, compras y kardex se conservan. Puedes reactivarlo cuando quieras desde el filtro «Inactivos».</p>
      </Modal>
    );
  }
  return (
    <Modal titulo="Eliminar producto" onCerrar={onCerrar} ancho="max-w-md"
      pie={<><Boton onClick={onCerrar}>Cancelar</Boton><Boton variante="peligro" icono={<Trash size={16} />} cargando={enviando} onClick={borrar}>Sí, eliminar</Boton></>}>
      <p className="text-sm text-slate-600">¿Seguro que quieres eliminar <b className="text-slate-900">{producto.nombre}</b> <span className="codigo text-xs text-slate-400">({producto.codigo_interno})</span>? Esta acción no se puede deshacer.</p>
      <p className="mt-2 text-xs text-slate-500">Si el producto ya tiene ventas o compras, el sistema no lo borrará y te ofrecerá desactivarlo.</p>
    </Modal>
  );
}

function FormProducto({ producto, categorias, onCerrar, onGuardado, onEliminar }: { producto: ProductoAdmin | null; categorias: Categoria[]; onCerrar: () => void; onGuardado: () => void; onEliminar?: () => void }) {
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
      pie={<>
        {onEliminar && <Boton variante="fantasma" className="mr-auto !text-red-600 hover:!bg-red-50" icono={<Trash size={16} />} onClick={onEliminar}>Eliminar</Boton>}
        <Boton onClick={onCerrar}>Cancelar</Boton><Boton variante="primario" cargando={enviando} disabled={!d.nombre || !d.codigoInterno || !precio} onClick={guardar}>{producto ? 'Guardar cambios' : 'Crear producto'}</Boton></>}>
      <div className="grid grid-cols-2 gap-3">
        <Campo etiqueta="Nombre del producto" className="col-span-2"><Entrada autoFocus value={d.nombre} onChange={(e) => set('nombre', e.target.value)} maxLength={80} /></Campo>
        <Campo etiqueta="Código de inventario"><Entrada value={d.codigoInterno} onChange={(e) => set('codigoInterno', e.target.value)} className="codigo uppercase" placeholder="CAF-01" /></Campo>
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
          <Entrada type="number" min="0" step="0.01" value={d.precioFinal} onChange={(e) => set('precioFinal', e.target.value)} className="num font-semibold" />
        </Campo>
        <Campo etiqueta="Costo (sin ITBIS)" ayuda={<span className={margen < 20 ? 'text-amber-600' : 'text-emerald-600'}>Margen: {margen.toFixed(1)}%</span>}>
          <Entrada type="number" min="0" step="0.01" value={d.costo} onChange={(e) => set('costo', e.target.value)} className="num" />
        </Campo>
        <div className="col-span-2 space-y-2.5 rounded-lg bg-slate-50 p-3">
          <Interruptor activo={d.esServicio} onChange={(v) => { set('esServicio', v); if (v) set('manejaInventario', false); }} etiqueta="Es un servicio" descripcion="No tiene existencias físicas" />
          {!d.esServicio && <Interruptor activo={d.manejaInventario} onChange={(v) => set('manejaInventario', v)} etiqueta="Controlar inventario" descripcion="Descuenta stock en cada venta y alerta cuando baja del mínimo" />}
          {!d.esServicio && d.manejaInventario && (
            <div className="grid grid-cols-2 gap-3 pt-1">
              {!producto && <Campo etiqueta="Stock inicial"><Entrada type="number" min="0" value={d.stockInicial} onChange={(e) => set('stockInicial', e.target.value)} className="num" /></Campo>}
              <Campo etiqueta="Stock mínimo (alerta)"><Entrada type="number" min="0" value={d.stockMinimo} onChange={(e) => set('stockMinimo', e.target.value)} className="num" /></Campo>
            </div>
          )}
          <Interruptor activo={d.activo} onChange={(v) => set('activo', v)} etiqueta="Activo" descripcion="Los productos inactivos no aparecen en el punto de venta" />
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
      <EncabezadoTarjeta titulo="Compras a proveedores" descripcion="Cada compra suma existencias y actualiza el último costo" accion={<Boton data-atajo="nuevo" title="Alt+N" variante="primario" icono={<Truck size={16} />} onClick={() => setNueva(true)}>Registrar compra</Boton>} />
      <Tabla columnas={['Fecha', 'Proveedor', 'NCF proveedor', 'Líneas', 'Registró', { t: 'Monto', derecha: true }, { t: 'ITBIS', derecha: true }, { t: 'Total', derecha: true }]} vacio="Aún no hay compras registradas">
        {compras.map((c) => (
          <tr key={c.id}>
            <Celda className="num text-slate-600">{c.fecha}</Celda>
            <Celda><div className="font-medium">{c.proveedor_nombre}</div>{c.proveedor_rnc && <div className="codigo text-xs text-slate-400">{c.proveedor_rnc}</div>}</Celda>
            <Celda className="codigo text-slate-600">{c.ncf_proveedor ?? '—'}</Celda>
            <Celda className="num">{c.lineas}</Celda>
            <Celda className="text-slate-600">{c.usuario}</Celda>
            <Celda derecha className="num text-slate-600">{num(c.total)}</Celda>
            <Celda derecha className="num">{num(c.itbis_pagado)}</Celda>
            <Celda derecha className="num font-semibold">{num(Number(c.total) + Number(c.itbis_pagado))}</Celda>
          </tr>
        ))}
      </Tabla>
      {nueva && <FormCompra productos={productos.filter((p) => p.activo && p.maneja_inventario)} onCerrar={() => setNueva(false)} onGuardada={() => { setNueva(false); cargar(); recargar(); }} />}
    </Tarjeta>
  );
}

function FormCompra({ productos, onCerrar, onGuardada }: { productos: ProductoAdmin[]; onCerrar: () => void; onGuardada: () => void }) {
  const [prov, setProv] = useState({ nombre: '', rnc: '', ncf: '' });
  const [lineas, setLineas] = useState<{ productoId: string; cantidad: string; costo: string }[]>([{ productoId: '', cantidad: '', costo: '' }]);
  const [itbisManual, setItbisManual] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const calc = lineas.map((l) => {
    const p = productos.find((x) => x.id === l.productoId);
    const importe = (Number(l.cantidad) || 0) * (Number(l.costo) || 0);
    return { importe, itbis: importe * (p ? TASA[p.indicador_itbis] : 0), tasa: p ? ITBIS[p.indicador_itbis] : '' };
  });
  const subtotal = calc.reduce((s, c) => s + c.importe, 0);
  const itbisSugerido = calc.reduce((s, c) => s + c.itbis, 0);
  const itbis = itbisManual !== null ? Number(itbisManual) || 0 : itbisSugerido;
  const validas = lineas.filter((l) => l.productoId && Number(l.cantidad) > 0);
  const rncOk = !prov.rnc || /^\d{9}(\d{2})?$/.test(prov.rnc.replace(/\D/g, ''));
  const ncfOk = !prov.ncf || /^(E\d{12}|B\d{10})$/.test(prov.ncf);
  const setL = (i: number, k: 'productoId' | 'cantidad' | 'costo', v: string) => setLineas((ls) => ls.map((x, j) => (j === i ? { ...x, [k]: v } : x)));

  async function guardar() {
    setEnviando(true);
    try {
      await api('/inventario/compras', { body: {
        proveedorNombre: prov.nombre, proveedorRnc: prov.rnc.replace(/\D/g, ''), ncfProveedor: prov.ncf, itbisPagado: Number(itbis.toFixed(2)),
        items: validas.map((l) => ({ productoId: l.productoId, cantidad: Number(l.cantidad), costoUnitario: Number(l.costo) || 0 })),
      } });
      avisar('Compra registrada: inventario actualizado', 'ok');
      onGuardada();
    } catch (e) { avisar(e instanceof ApiError ? e.message : 'No se pudo guardar', 'error'); }
    finally { setEnviando(false); }
  }

  return (
    <Modal titulo="Registrar compra" descripcion="Factura del suplidor: suma existencias y actualiza el último costo" onCerrar={onCerrar} ancho="max-w-4xl"
      pie={<><Boton onClick={onCerrar}>Cancelar</Boton><Boton variante="primario" cargando={enviando} disabled={prov.nombre.trim().length < 2 || !validas.length || !rncOk || !ncfOk} onClick={guardar}>Guardar compra</Boton></>}>
      <div className="grid grid-cols-4 gap-3">
        <Campo etiqueta="Proveedor" className="col-span-2"><Entrada autoFocus value={prov.nombre} onChange={(e) => setProv({ ...prov, nombre: e.target.value })} placeholder="Nombre o razón social" /></Campo>
        <Campo etiqueta="RNC / Cédula" error={rncOk ? undefined : '9 u 11 dígitos'}><Entrada value={prov.rnc} onChange={(e) => setProv({ ...prov, rnc: e.target.value })} className="codigo" /></Campo>
        <Campo etiqueta="NCF del proveedor" error={ncfOk ? undefined : 'Formato E31… o B01…'}><Entrada value={prov.ncf} onChange={(e) => setProv({ ...prov, ncf: e.target.value.toUpperCase().trim() })} className="codigo" placeholder="E310000000001" /></Campo>
      </div>
      <div className="mt-4 overflow-hidden rounded-lg border border-slate-200">
        <div className="grid grid-cols-[1fr_80px_100px_70px_100px_90px_32px] gap-2 bg-slate-50 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          <span>Producto</span><span>Cant.</span><span>Costo unit.</span><span>Tasa</span><span className="text-right">Importe</span><span className="text-right">ITBIS</span><span />
        </div>
        <div className="divide-y divide-slate-100">
          {lineas.map((l, i) => (
            <div key={i} className="grid grid-cols-[1fr_80px_100px_70px_100px_90px_32px] items-center gap-2 px-3 py-1.5">
              <Selector value={l.productoId} onChange={(e) => {
                const p = productos.find((x) => x.id === e.target.value);
                setLineas((ls) => ls.map((x, j) => (j === i ? { ...x, productoId: e.target.value, costo: x.costo || (p ? Number(p.costo).toFixed(2) : '') } : x)));
              }}>
                <option value="">Elegir producto…</option>
                {productos.map((p) => <option key={p.id} value={p.id}>{p.nombre} · stock {Number(p.stock_actual)}</option>)}
              </Selector>
              <Entrada type="number" min="0" value={l.cantidad} onChange={(e) => setL(i, 'cantidad', e.target.value)} className="num" />
              <Entrada type="number" min="0" step="0.01" value={l.costo} onChange={(e) => setL(i, 'costo', e.target.value)} className="num" />
              <span className="text-[11px] text-slate-500">{calc[i].tasa || '—'}</span>
              <span className="num text-right text-[13px] font-medium">{num(calc[i].importe)}</span>
              <span className="num text-right text-[13px] text-slate-600">{num(calc[i].itbis)}</span>
              <button onClick={() => setLineas((ls) => ls.length > 1 ? ls.filter((_, j) => j !== i) : [{ productoId: '', cantidad: '', costo: '' }])} className="grid size-8 place-items-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash size={15} /></button>
            </div>
          ))}
        </div>
        <div className="border-t border-slate-100 px-3 py-1.5">
          <Boton tamano="sm" variante="fantasma" icono={<Plus size={13} />} onClick={() => setLineas((l) => [...l, { productoId: '', cantidad: '', costo: '' }])}>Agregar línea</Boton>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-[1fr_260px] items-start gap-6">
        <p className="text-xs text-slate-500">El costo unitario se registra <b>sin ITBIS</b>. El ITBIS se calcula con la tasa de cada producto; si la factura del suplidor trae otro monto, corrígelo a la derecha. Ese valor se usa para el formato 606.</p>
        <div className="space-y-1.5 rounded-lg bg-slate-50 p-3 text-[13px]">
          <div className="flex justify-between"><span className="text-slate-500">Monto facturado</span><span className="num">{rd(subtotal)}</span></div>
          <div className="flex items-center justify-between gap-2"><span className="text-slate-500">ITBIS facturado</span>
            <Entrada type="number" min="0" step="0.01" value={itbisManual ?? itbisSugerido.toFixed(2)} onChange={(e) => setItbisManual(e.target.value)} className="num h-8 w-28 text-right" /></div>
          <div className="flex justify-between border-t border-slate-200 pt-1.5 font-semibold"><span>Total factura</span><span className="num">{rd(subtotal + itbis)}</span></div>
        </div>
      </div>
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
  const [motivo, setMotivo] = useState('Conteo físico');
  const [otro, setOtro] = useState('');
  const p = conInv.find((x) => x.id === id);
  const motivoFinal = motivo === 'Otro' ? otro.trim() : motivo;
  const cargar = useCallback(() => { if (id) api<MovK[]>(`/inventario/kardex/${id}`).then(setMovs); }, [id]);
  useEffect(cargar, [cargar]);

  async function ajustar(signo: 1 | -1) {
    try {
      const r = await api<{ stock: string }>('/inventario/ajustes', { body: { productoId: id, cantidad: signo * Math.abs(Number(cantidad)), motivo: motivoFinal } });
      avisar(`Stock actualizado: ${Number(r.stock)}`, 'ok');
      setCantidad(''); setOtro(''); cargar(); recargar();
    } catch (e) { avisar(e instanceof ApiError ? e.message : 'Error', 'error'); }
  }

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[320px_1fr]">
      <Tarjeta className="p-4">
        <h3 className="text-sm font-semibold">Ajuste de inventario</h3>
        <p className="mb-3 text-xs text-slate-500">Conteo físico, mermas, vencidos o roturas</p>
        <div className="space-y-3">
          <Campo etiqueta="Producto">
            <Selector value={id} onChange={(e) => setId(e.target.value)}>
              {conInv.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
            </Selector>
          </Campo>
          {p && <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2"><span className="text-xs text-slate-500">Stock actual</span><span className="num text-xl font-bold">{Number(p.stock_actual)}</span></div>}
          <Campo etiqueta="Cantidad"><Entrada type="number" min="0" value={cantidad} onChange={(e) => setCantidad(e.target.value)} className="num" /></Campo>
          <Campo etiqueta="Motivo">
            <Selector value={motivo} onChange={(e) => setMotivo(e.target.value)}>
              {['Conteo físico', 'Merma', 'Vencido', 'Rotura', 'Consumo interno', 'Otro'].map((m) => <option key={m}>{m}</option>)}
            </Selector>
          </Campo>
          {motivo === 'Otro' && <Campo etiqueta="Describe el motivo"><Entrada value={otro} onChange={(e) => setOtro(e.target.value)} maxLength={20} placeholder="Máx. 20 caracteres" /></Campo>}
          <div className="grid grid-cols-2 gap-2">
            <Boton variante="exito" disabled={!Number(cantidad) || motivoFinal.length < 3} onClick={() => ajustar(1)}>+ Entrada</Boton>
            <Boton variante="peligro" disabled={!Number(cantidad) || motivoFinal.length < 3} onClick={() => ajustar(-1)}>− Salida</Boton>
          </div>
        </div>
      </Tarjeta>
      <Tarjeta>
        <EncabezadoTarjeta titulo={`Kardex · ${p?.nombre ?? ''}`} descripcion="Todos los movimientos de existencias" accion={<ClockCounterClockwise size={18} className="text-slate-400" />} />
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
  const [eliminar, setEliminar] = useState<Categoria | null>(null);
  async function crear() {
    try { await api('/admin/categorias', { body: { nombre } }); setNombre(''); recargar(); avisar('Categoría creada', 'ok'); }
    catch (e) { avisar(e instanceof ApiError ? e.message : 'Error', 'error'); }
  }
  async function renombrar() {
    if (!editando) return;
    const c = categorias.find((x) => x.id === editando.id);
    if (!c || c.nombre === editando.nombre.trim()) { setEditando(null); return; }
    try { await api(`/admin/categorias/${editando.id}`, { method: 'PUT', body: { nombre: editando.nombre } }); setEditando(null); recargar(); avisar('Categoría renombrada', 'ok'); }
    catch (e) { avisar(e instanceof ApiError ? e.message : 'Error', 'error'); }
  }
  return (
    <Tarjeta className="max-w-3xl">
      <div className="flex gap-2 border-b border-slate-100 p-3">
        <Entrada data-buscar value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nueva categoría (ej.: Postres) · F2" maxLength={60} onKeyDown={(e) => e.key === 'Enter' && nombre.trim().length > 1 && crear()} />
        <Boton variante="primario" disabled={nombre.trim().length < 2} onClick={crear} icono={<Plus size={15} weight="bold" />}>Agregar</Boton>
      </div>
      <Tabla columnas={['Categoría', { t: 'Productos', derecha: true }, { t: 'Activos', derecha: true }, { t: 'Acciones', derecha: true }]} vacio="Aún no hay categorías">
        {categorias.map((c) => (
          <tr key={c.id} className="hover:bg-slate-50/70">
            <Celda>{editando?.id === c.id
              ? <Entrada autoFocus value={editando.nombre} onChange={(e) => setEditando({ ...editando, nombre: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') renombrar(); if (e.key === 'Escape') setEditando(null); }} onBlur={renombrar} className="h-8 max-w-xs" />
              : <span className="font-medium">{c.nombre}</span>}</Celda>
            <Celda derecha className="num">{c.productos}</Celda>
            <Celda derecha className="num text-slate-500">{c.activos}</Celda>
            <Celda derecha>
              <div className="flex justify-end gap-0.5">
                <Boton tamano="sm" variante="fantasma" title="Renombrar" onClick={() => setEditando({ id: c.id, nombre: c.nombre })}><PencilSimple size={15} /></Boton>
                <Boton tamano="sm" variante="fantasma" title="Eliminar" className="hover:!bg-red-50 hover:!text-red-600" onClick={() => setEliminar(c)}><Trash size={15} /></Boton>
              </div>
            </Celda>
          </tr>
        ))}
      </Tabla>
      {eliminar && <EliminarCategoria categoria={eliminar} otras={categorias.filter((x) => x.id !== eliminar.id)} onCerrar={() => setEliminar(null)} onHecho={() => { setEliminar(null); recargar(); }} />}
    </Tarjeta>
  );
}

function EliminarCategoria({ categoria, otras, onCerrar, onHecho }: { categoria: Categoria; otras: Categoria[]; onCerrar: () => void; onHecho: () => void }) {
  const [destino, setDestino] = useState(otras[0]?.id ?? 'ninguna');
  const [enviando, setEnviando] = useState(false);
  const conProductos = categoria.productos > 0;
  async function borrar() {
    setEnviando(true);
    try {
      const r = await api<{ reasignados: number }>(`/admin/categorias/${categoria.id}${conProductos ? `?reasignarA=${destino}` : ''}`, { method: 'DELETE' });
      avisar(r.reasignados ? `Categoría eliminada: ${r.reasignados} producto(s) reasignado(s)` : 'Categoría eliminada', 'ok');
      onHecho();
    } catch (e) { avisar(e instanceof ApiError ? e.message : 'No se pudo eliminar', 'error'); }
    finally { setEnviando(false); }
  }
  return (
    <Modal titulo="Eliminar categoría" onCerrar={onCerrar} ancho="max-w-md"
      pie={<><Boton onClick={onCerrar}>Cancelar</Boton><Boton variante="peligro" icono={<Trash size={16} />} cargando={enviando} onClick={borrar}>{conProductos ? 'Reasignar y eliminar' : 'Sí, eliminar'}</Boton></>}>
      {conProductos ? (
        <div className="space-y-3">
          <p className="text-sm text-slate-600"><b className="text-slate-900">{categoria.nombre}</b> tiene <b>{categoria.productos}</b> producto(s). Antes de eliminarla, elige a dónde pasarlos:</p>
          <Campo etiqueta="Mover los productos a">
            <Selector value={destino} onChange={(e) => setDestino(e.target.value)}>
              {otras.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              <option value="ninguna">Sin categoría</option>
            </Selector>
          </Campo>
        </div>
      ) : (
        <p className="text-sm text-slate-600">¿Eliminar la categoría <b className="text-slate-900">{categoria.nombre}</b>? No tiene productos asociados.</p>
      )}
    </Modal>
  );
}
