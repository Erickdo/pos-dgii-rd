import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Barcode, MagnifyingGlass, Minus, Plus, Trash, User, X, Package, Percent, Buildings, Warning, ShoppingCart, PencilSimple,
  Money, CreditCard, Bank, HandCoins, Stack, CircleNotch, Receipt,
} from '@phosphor-icons/react';
import {
  api, ApiError, type Categoria, type Cliente, type MetodoPago, type Pago, type Producto, type ResultadoVenta, type TipoComprobante, type Totales,
} from '../api';
import { useApp } from '../contexto';
import { useBarcodeScanner } from '../hooks/useBarcodeScanner';
import { avisar, formatoIdent, num, previsualizar, rd, redondear2, uuid } from '../util';
import Cobro from '../components/Cobro';
import Ticket from '../components/Ticket';
import SelectorCliente, { type Requisito } from '../components/SelectorCliente';
import AbrirCaja from '../components/AbrirCaja';
import { Boton, Campo, Entrada, Modal } from '../components/ui';

interface Linea { p: Producto; cantidad: number; descPct?: number; descMonto?: number }

const COMPROBANTES: { tipo: TipoComprobante; codigo: string; nombre: string; requisito: Requisito }[] = [
  { tipo: '32', codigo: 'E32', nombre: 'Consumo', requisito: null },
  { tipo: '31', codigo: 'E31', nombre: 'Crédito fiscal', requisito: 'contribuyente' },
  { tipo: '44', codigo: 'E44', nombre: 'Especial', requisito: 'rnc' },
  { tipo: '45', codigo: 'E45', nombre: 'Gubernamental', requisito: 'rnc' },
];
const TASA: Record<number, number> = { 1: 0.18, 2: 0.16, 3: 0, 4: 0 };

const cumpleRequisito = (c: Cliente | null, r: Requisito) =>
  !r || (!!c && (r === 'contribuyente' ? c.es_contribuyente : c.tipo_identificacion === 'RNC'));

export default function PuntoVenta() {
  const { caja } = useApp();
  if (caja === undefined) return <div className="grid h-full place-items-center text-slate-400">Cargando…</div>;
  if (!caja) {
    return (
      <div className="scroll-fino h-full overflow-y-auto p-4 lg:p-6">
        <AbrirCaja mensaje="Para empezar a facturar abre tu caja: elige la terminal y cuenta el fondo inicial." />
      </div>
    );
  }
  return <Facturar />;
}

function Facturar() {
  const { caja, refrescarFiscal } = useApp();
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [cat, setCat] = useState('');
  const [q, setQ] = useState('');
  const [productos, setProductos] = useState<Producto[]>([]);
  const [carrito, setCarrito] = useState<Linea[]>([]);
  const [tipo, setTipo] = useState<TipoComprobante>('32');
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [cobro, setCobro] = useState<{ totales: Totales; clave: string } | null>(null);
  const [ticketId, setTicketId] = useState<string | null>(null);
  const [selCliente, setSelCliente] = useState(false);
  const [editarLinea, setEditarLinea] = useState<string | null>(null);
  const [descGlobal, setDescGlobal] = useState(false);
  const [preparando, setPreparando] = useState(false);
  const [metodo, setMetodo] = useState<MetodoPago | 'mixto'>('efectivo');
  const [recibido, setRecibido] = useState('');
  const [referencia, setReferencia] = useState('');
  const buscador = useRef<HTMLInputElement>(null);
  const finCarrito = useRef<HTMLDivElement>(null);

  const comp = COMPROBANTES.find((c) => c.tipo === tipo)!;
  const clienteOk = cumpleRequisito(cliente, comp.requisito);
  const hayModal = !!(cobro || ticketId || selCliente || editarLinea || descGlobal);

  // ---------------------------------------------------------------- catálogo
  useEffect(() => { api<Categoria[]>('/categorias').then(setCategorias); }, []);
  const cargarProductos = useCallback(async () => {
    const params = q.trim() ? `?q=${encodeURIComponent(q.trim())}` : cat ? `?categoria=${cat}` : '';
    setProductos((await api<{ productos: Producto[] }>(`/productos${params}`)).productos);
  }, [q, cat]);
  useEffect(() => {
    const t = setTimeout(() => cargarProductos().catch(() => {}), q ? 180 : 0);
    return () => clearTimeout(t);
  }, [cargarProductos, q]);

  // ---------------------------------------------------------------- carrito
  const agregar = useCallback((p: Producto, delta = 1) => {
    setCarrito((c) => {
      const i = c.findIndex((l) => l.p.id === p.id);
      const nueva = (i >= 0 ? c[i].cantidad : 0) + delta;
      if (delta > 0 && p.maneja_inventario && nueva > Number(p.stock_actual)) {
        avisar(`Solo quedan ${Number(p.stock_actual)} unidades de ${p.nombre}`, 'error');
        return c;
      }
      if (nueva <= 0) return c.filter((l) => l.p.id !== p.id);
      if (i >= 0) return c.map((l, j) => (j === i ? { ...l, cantidad: nueva } : l));
      return [...c, { p, cantidad: nueva }];
    });
    setTimeout(() => finCarrito.current?.scrollIntoView({ block: 'nearest' }), 30);
  }, []);

  const tasaDe = (p: Producto) => (tipo === '44' ? 0 : TASA[p.indicador_itbis]);
  const baseDe = (l: Linea) => redondear2(Number(l.p.precio_venta) * l.cantidad);
  const descDe = (l: Linea) => l.descPct != null ? redondear2(baseDe(l) * l.descPct / 100) : Math.min(l.descMonto ?? 0, baseDe(l));
  const totalLinea = (l: Linea) => redondear2((baseDe(l) - descDe(l)) * (1 + tasaDe(l.p)));

  const resumen = useMemo(() => previsualizar(carrito.map((l) => ({
    precio: Number(l.p.precio_venta), cantidad: l.cantidad, indicador: tipo === '44' ? 4 : l.p.indicador_itbis, descuento: descDe(l),
  }))), [carrito, tipo]); // eslint-disable-line
  const unidades = carrito.reduce((s, l) => s + l.cantidad, 0);

  function limpiar() { setCarrito([]); setCliente(null); setTipo('32'); setMetodo('efectivo'); setRecibido(''); setReferencia(''); }

  // ---------------------------------------------------------------- pago rápido (en el mismo carrito)
  const total = resumen.total;
  const recibidoN = Number(recibido) || 0;
  const devuelta = metodo === 'efectivo' && recibidoN > 0 ? redondear2(recibidoN - total) : 0;
  const creditoDisp = cliente ? Math.max(0, Number(cliente.limite_credito ?? 0) - Number(cliente.saldo ?? 0)) : 0;
  const billetes = useMemo(() => {
    if (total <= 0) return [];
    const sig = [100, 200, 500, 1000, 2000].filter((b) => b > total);
    const redondo = Math.ceil(total / 100) * 100;
    return [...new Set([redondo, ...sig])].filter((b) => b > total).slice(0, 3);
  }, [total]);
  const faltaPago = !carrito.length ? 'Agrega productos'
    : metodo === 'efectivo' && recibidoN > 0 && recibidoN + 0.001 < total ? `Faltan ${rd(total - recibidoN)}`
    : (metodo === 'tarjeta' || metodo === 'transferencia') && !referencia.trim() ? `Escribe el nº de ${metodo === 'tarjeta' ? 'aprobación' : 'referencia'}`
    : metodo === 'credito' && !cliente ? 'Elige un cliente para venta a crédito'
    : metodo === 'credito' && creditoDisp + 0.001 < total ? `Crédito disponible: ${rd(creditoDisp)}`
    : null;

  function elegirTipo(t: TipoComprobante) {
    setTipo(t);
    const r = COMPROBANTES.find((c) => c.tipo === t)!.requisito;
    if (r && !cumpleRequisito(cliente, r)) setSelCliente(true);
  }

  // ---------------------------------------------------------------- escáner y atajos
  const porCodigo = useCallback(async (codigo: string) => {
    try {
      const r = await api<{ exacto: boolean; productos: Producto[] }>(`/productos?q=${encodeURIComponent(codigo)}`);
      if (r.exacto && r.productos[0]) { agregar(r.productos[0]); setQ(''); }
      else avisar(`Código ${codigo} no encontrado`, 'error');
    } catch (e) { avisar((e as Error).message, 'error'); }
  }, [agregar]);
  useBarcodeScanner((c) => { if (!hayModal) porCodigo(c); });

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (hayModal) return;
      if (e.key === 'F2') { e.preventDefault(); buscador.current?.focus(); }
      if (e.key === 'F9') { e.preventDefault(); iniciarCobro(); }
      if (e.key === 'Escape') setQ('');
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  // ---------------------------------------------------------------- cobro
  const itemsApi = () => carrito.map((l) => {
    const d = descDe(l);
    return { productoId: l.p.id, cantidad: String(l.cantidad), ...(d > 0 ? { descuentoMonto: d.toFixed(2) } : {}) };
  });

  async function iniciarCobro() {
    if (!carrito.length || preparando) return;
    if (!clienteOk) { avisar(`${comp.codigo} ${comp.nombre}: falta el cliente con RNC`, 'error'); return setSelCliente(true); }
    if (metodo !== 'mixto' && faltaPago) { avisar(faltaPago, 'error'); return; }
    setPreparando(true);
    try {
      const r = await api<{ totales: Totales }>('/ventas/cotizar', { body: { items: itemsApi(), tipoComprobante: tipo } });
      if (metodo === 'mixto') { setCobro({ totales: r.totales, clave: uuid() }); return; }
      const totalServidor = Number(r.totales.montoTotal);
      const monto = metodo === 'efectivo' ? Math.max(recibidoN, totalServidor) : totalServidor;
      if (metodo === 'efectivo' && recibidoN > 0 && recibidoN + 0.001 < totalServidor) { avisar(`Faltan ${rd(totalServidor - recibidoN)}`, 'error'); return; }
      await emitir(uuid(), [{ metodo, monto: monto.toFixed(2), ...(metodo === 'tarjeta' || metodo === 'transferencia' ? { referencia: referencia.trim() } : {}) }]);
    } catch (e) { if (!(e instanceof ApiError)) avisar((e as Error).message, 'error'); }
    finally { setPreparando(false); }
  }

  async function emitir(clave: string, pagos: Pago[]) {
    if (!caja) return;
    try {
      const r = await api<ResultadoVenta>('/ventas', {
        body: { idempotencyKey: clave, cajaId: caja.id, clienteId: cliente?.id, tipoComprobante: tipo, items: itemsApi(), pagos },
      });
      setCobro(null); limpiar(); setTicketId(r.ventaId);
      cargarProductos().catch(() => {});
      setTimeout(refrescarFiscal, 1500);
      avisar(Number(r.cambio) > 0 ? `${r.encf} emitido · Devuelta ${rd(r.cambio)}` : `${r.encf} emitido y firmado`, 'ok');
    } catch (e) {
      avisar(e instanceof ApiError ? e.message : 'No se pudo registrar la venta', 'error');
      throw e;
    }
  }

  async function confirmarVenta(pagos: Pago[]) {
    if (!cobro) return;
    await emitir(cobro.clave, pagos);
  }

  const lineaEditada = carrito.find((l) => l.p.id === editarLinea);

  const METODOS: { id: MetodoPago | 'mixto'; nombre: string; Icono: typeof Money }[] = [
    { id: 'efectivo', nombre: 'Efectivo', Icono: Money }, { id: 'tarjeta', nombre: 'Tarjeta', Icono: CreditCard },
    { id: 'transferencia', nombre: 'Transf.', Icono: Bank }, { id: 'credito', nombre: 'Crédito', Icono: HandCoins }, { id: 'mixto', nombre: 'Mixto', Icono: Stack },
  ];

  return (
    <div className="grid h-full grid-cols-[1fr_380px] xl:grid-cols-[1fr_410px]">
      {/* ======================================== catálogo */}
      <section className="flex min-h-0 flex-col">
        <div className="space-y-2.5 border-b border-slate-200 bg-white px-4 py-3">
          <div className="relative">
            <MagnifyingGlass size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input ref={buscador} value={q} onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && q.trim()) { e.preventDefault(); porCodigo(q.trim()); } }}
              placeholder="Buscar por nombre, código o escanear código de barras…"
              className="h-10 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-20 text-sm outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-3 focus:ring-blue-500/10" />
            <div className="absolute right-2.5 top-1/2 flex -translate-y-1/2 items-center gap-2">
              {q ? <button onClick={() => setQ('')} className="text-slate-400 hover:text-slate-600"><X size={16} /></button> : <Barcode size={19} className="text-slate-300" />}
              <kbd className="rounded border border-slate-200 bg-slate-50 px-1.5 text-[10px] font-medium text-slate-500">F2</kbd>
            </div>
          </div>
          {!q && (
            <div className="scroll-fino flex gap-1.5 overflow-x-auto pb-0.5">
              {[{ id: '', nombre: 'Todos', productos: 0 }, ...categorias].map((c) => (
                <button key={c.id} onClick={() => setCat(c.id)}
                  className={`h-7 shrink-0 rounded-full px-3 text-xs font-medium transition
                    ${cat === c.id ? 'bg-slate-900 text-white' : 'border border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900'}`}>
                  {c.nombre}{c.id && <span className="num ml-1 text-[10px] text-slate-400">{c.productos}</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="scroll-fino grid min-h-0 flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(138px,1fr))] gap-2.5 overflow-y-auto bg-slate-50 p-4">
          {productos.map((p) => {
            const enCarrito = carrito.find((l) => l.p.id === p.id)?.cantidad ?? 0;
            const agotado = p.maneja_inventario && Number(p.stock_actual) <= 0;
            const bajo = p.maneja_inventario && !agotado && Number(p.stock_actual) <= Number(p.stock_minimo);
            return (
              <button key={p.id} onClick={() => agregar(p)} disabled={agotado}
                className={`group relative flex h-[92px] flex-col justify-between rounded-lg border bg-white p-2.5 text-left transition
                  hover:border-blue-400 hover:shadow-sm active:scale-[.98] disabled:opacity-45
                  ${enCarrito ? 'border-blue-500 ring-2 ring-blue-500/15' : 'border-slate-200'}`}>
                <div className="min-w-0">
                  <div className="truncate text-[10px] font-medium uppercase tracking-wide text-slate-400">{p.categoria ?? 'General'}</div>
                  <div className="line-clamp-2 text-[13px] font-semibold leading-tight text-slate-900">{p.nombre}</div>
                </div>
                <div className="flex items-end justify-between gap-1">
                  <div className="num text-[15px] font-bold text-slate-900">{num(p.precio_final)}</div>
                  <div className="flex flex-col items-end leading-tight">
                    {p.indicador_itbis !== 1 && <span className="text-[9px] font-semibold uppercase text-violet-600">{p.indicador_itbis === 2 ? 'ITBIS 16%' : 'Exento'}</span>}
                    {p.maneja_inventario && <span className={`num text-[10px] ${agotado || bajo ? 'font-semibold text-red-600' : 'text-slate-400'}`}>{agotado ? 'Agotado' : `${Number(p.stock_actual)} disp.`}</span>}
                  </div>
                </div>
                {enCarrito > 0 && <span className="num absolute -right-1.5 -top-1.5 grid size-6 place-items-center rounded-full bg-blue-600 text-xs font-bold text-white shadow">{enCarrito}</span>}
              </button>
            );
          })}
          {!productos.length && (
            <div className="col-span-full flex flex-col items-center py-16 text-slate-400">
              <Package size={38} weight="duotone" />
              <p className="mt-2 text-sm">{q ? `Nada coincide con “${q}”` : 'No hay productos en esta categoría'}</p>
            </div>
          )}
        </div>
      </section>

      {/* ======================================== venta */}
      <aside className="flex min-h-0 flex-col border-l border-slate-200 bg-white">
        <div className="space-y-2 border-b border-slate-200 px-3.5 py-3">
          {/* comprobante */}
          <div className="grid grid-cols-4 gap-1 rounded-lg bg-slate-100 p-0.5">
            {COMPROBANTES.map((c) => (
              <button key={c.tipo} onClick={() => elegirTipo(c.tipo)} title={c.nombre}
                className={`rounded-md py-1 text-center transition ${tipo === c.tipo ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>
                <div className="codigo text-xs font-bold leading-tight">{c.codigo}</div>
                <div className="truncate text-[10px] leading-tight">{c.nombre}</div>
              </button>
            ))}
          </div>
          {/* cliente */}
          <button onClick={() => setSelCliente(true)}
            className={`flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-1.5 text-left transition
              ${!clienteOk ? 'border-amber-300 bg-amber-50 hover:bg-amber-100/70' : 'border-slate-200 hover:bg-slate-50'}`}>
            <span className={`grid size-7 shrink-0 place-items-center rounded-full ${cliente ? 'bg-blue-50 text-blue-600' : !clienteOk ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'}`}>
              {cliente?.tipo_identificacion === 'RNC' ? <Buildings size={15} /> : !clienteOk ? <Warning size={15} weight="bold" /> : <User size={15} />}
            </span>
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate text-[13px] font-semibold text-slate-900">{cliente?.nombre ?? (!clienteOk ? 'Buscar cliente por RNC (obligatorio)' : 'Consumidor final')}</span>
              <span className="codigo block truncate text-[11px] text-slate-500">
                {cliente ? `${cliente.tipo_identificacion} ${formatoIdent(cliente.tipo_identificacion, cliente.identificacion)}` : !clienteOk ? `${comp.codigo} requiere RNC del cliente` : 'Buscar por RNC, cédula o nombre'}
              </span>
            </span>
            {cliente ? <span onClick={(e) => { e.stopPropagation(); setCliente(null); }} className="grid size-6 place-items-center rounded-md text-slate-400 hover:bg-slate-200"><X size={13} /></span>
              : <MagnifyingGlass size={15} className="text-slate-400" />}
          </button>
        </div>

        {/* líneas */}
        <div className="scroll-fino min-h-0 flex-1 overflow-y-auto">
          {carrito.map((l) => {
            const d = descDe(l);
            return (
              <div key={l.p.id} className="group flex items-center gap-2 border-b border-slate-100 px-3.5 py-2">
                <button onClick={() => setEditarLinea(l.p.id)} className="min-w-0 flex-1 text-left leading-tight">
                  <div className="flex items-center gap-1 truncate text-[13px] font-medium text-slate-900">{l.p.nombre}<PencilSimple size={12} className="shrink-0 text-slate-300 group-hover:text-blue-500" /></div>
                  <div className="num text-[11px] text-slate-500">
                    {num(Number(l.p.precio_venta) * (1 + tasaDe(l.p)))} c/u
                    {d > 0 && <span className="ml-1 font-medium text-emerald-600">−{l.descPct != null ? `${l.descPct}%` : num(d * (1 + tasaDe(l.p)))}</span>}
                  </div>
                </button>
                <div className="flex items-center rounded-md border border-slate-200">
                  <button onClick={() => agregar(l.p, -1)} className="grid size-7 place-items-center text-slate-500 hover:text-slate-900"><Minus size={12} weight="bold" /></button>
                  <span className="num w-6 text-center text-[13px] font-semibold">{l.cantidad}</span>
                  <button onClick={() => agregar(l.p, 1)} className="grid size-7 place-items-center text-slate-500 hover:text-slate-900"><Plus size={12} weight="bold" /></button>
                </div>
                <div className="num w-[72px] text-right text-[13px] font-semibold">{num(totalLinea(l))}</div>
              </div>
            );
          })}
          <div ref={finCarrito} />
          {!carrito.length && (
            <div className="flex h-full flex-col items-center justify-center px-8 text-center text-slate-400">
              <ShoppingCart size={30} />
              <p className="mt-2 text-[13px] font-medium text-slate-500">El carrito está vacío</p>
              <p className="text-xs">Escanea un código o toca un producto</p>
            </div>
          )}
        </div>

        {/* totales DGII */}
        <div className="border-t border-slate-200 bg-slate-50/70 px-3.5 py-2.5">
          <dl className="num space-y-0.5 text-[12px] text-slate-600">
            <div className="flex justify-between"><dt>Subtotal <span className="text-slate-400">({unidades} art.)</span></dt><dd>{num(resumen.bruto)}</dd></div>
            <div className="flex justify-between">
              <dt className="flex items-center gap-1.5">Descuento
                <button onClick={() => carrito.length && setDescGlobal(true)} className="rounded border border-slate-200 bg-white px-1 text-[10px] font-semibold text-blue-600 hover:bg-blue-50"><Percent size={9} weight="bold" className="inline" /> aplicar</button>
              </dt>
              <dd className={resumen.descuento > 0 ? 'text-emerald-600' : ''}>{resumen.descuento > 0 ? '−' : ''}{num(resumen.descuento)}</dd>
            </div>
            {resumen.exento > 0 && <div className="flex justify-between"><dt>Monto exento</dt><dd>{num(resumen.exento)}</dd></div>}
            {resumen.itbis1 > 0 && <div className="flex justify-between"><dt>ITBIS 18%</dt><dd>{num(resumen.itbis1)}</dd></div>}
            {resumen.itbis2 > 0 && <div className="flex justify-between"><dt>ITBIS 16%</dt><dd>{num(resumen.itbis2)}</dd></div>}
            {tipo === '44' && carrito.length > 0 && <div className="text-[11px] text-slate-500">E44: venta exenta de ITBIS</div>}
          </dl>
          <div className="mt-1.5 flex items-baseline justify-between border-t border-slate-200 pt-1.5">
            <span className="text-[13px] font-semibold text-slate-700">Total</span>
            <span className="num text-2xl font-bold tracking-tight text-slate-900">{rd(total)}</span>
          </div>
        </div>

        {/* pago */}
        <div className="space-y-2 border-t border-slate-200 px-3.5 py-2.5">
          <div className="grid grid-cols-5 gap-1">
            {METODOS.map(({ id, nombre, Icono }) => (
              <button key={id} onClick={() => { setMetodo(id); setReferencia(''); }}
                className={`flex flex-col items-center gap-0.5 rounded-md border py-1 text-[10px] font-semibold transition
                  ${metodo === id ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-500 hover:border-slate-300 hover:text-slate-800'}`}>
                <Icono size={16} weight={metodo === id ? 'fill' : 'regular'} />{nombre}
              </button>
            ))}
          </div>
          {metodo === 'efectivo' && (
            <div className="grid grid-cols-[1fr_auto] items-center gap-2">
              <div className="flex gap-1">
                <input value={recibido} onChange={(e) => setRecibido(e.target.value.replace(/[^\d.]/g, ''))} inputMode="decimal" placeholder="Recibido (vacío = exacto)" onKeyDown={(e) => { if (e.key === 'Enter') iniciarCobro(); }}
                  className="num h-8 w-full min-w-0 rounded-md border border-slate-300 px-2 text-[13px] outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10" />
                {billetes.map((b) => <button key={b} onClick={() => setRecibido(String(b))} className="num h-8 shrink-0 rounded-md border border-slate-200 px-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50">{b}</button>)}
              </div>
              <div className={`num text-right leading-tight ${devuelta < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                <div className="text-[10px] font-medium uppercase text-slate-400">{devuelta < 0 ? 'Falta' : 'Devuelta'}</div>
                <div className="text-[15px] font-bold">{num(Math.abs(devuelta))}</div>
              </div>
            </div>
          )}
          {(metodo === 'tarjeta' || metodo === 'transferencia') && (
            <input value={referencia} onChange={(e) => setReferencia(e.target.value)} placeholder={metodo === 'tarjeta' ? 'Nº de aprobación del voucher' : 'Nº de referencia de la transferencia'}
              className="codigo h-8 w-full rounded-md border border-slate-300 px-2 text-[13px] outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10" />
          )}
          {metodo === 'credito' && <div className="text-[11px] text-slate-500">{cliente ? `Crédito disponible: ${rd(creditoDisp)}` : 'Elige el cliente al que se le fía'}</div>}
          {metodo === 'mixto' && <div className="text-[11px] text-slate-500">Combina efectivo, tarjeta, transferencia o crédito en la siguiente ventana.</div>}

          <div className="grid grid-cols-[auto_1fr] gap-1.5">
            <Boton tamano="lg" onClick={limpiar} disabled={!carrito.length} title="Vaciar venta" className="px-3"><Trash size={17} /></Boton>
            <button onClick={iniciarCobro} disabled={!carrito.length || preparando || (metodo !== 'mixto' && !!faltaPago)} title={faltaPago ?? undefined}
              className="flex h-10 items-center justify-center gap-2 rounded-lg bg-blue-600 text-sm font-bold text-white shadow-md shadow-blue-600/25 transition hover:bg-blue-700 disabled:bg-slate-300 disabled:shadow-none">
              {preparando ? <><CircleNotch size={16} className="animate-spin" /> Emitiendo…</>
                : <><Receipt size={17} weight="bold" />{metodo === 'mixto' ? 'Cobrar…' : `Cobrar y emitir ${comp.codigo}`}<kbd className="rounded bg-white/20 px-1 text-[10px] font-medium">F9</kbd></>}
            </button>
          </div>
          {carrito.length > 0 && faltaPago && metodo !== 'mixto' && <p className="text-center text-[11px] font-medium text-amber-600">{faltaPago}</p>}
        </div>
      </aside>

      {cobro && <Cobro totales={cobro.totales} tipo={tipo} cliente={cliente} onCancelar={() => setCobro(null)} onConfirmar={confirmarVenta} />}
      {ticketId && <Ticket ventaId={ticketId} onCerrar={() => { setTicketId(null); buscador.current?.focus(); }} />}
      {selCliente && (
        <SelectorCliente actual={cliente} requisito={comp.requisito} onCerrar={() => setSelCliente(false)}
          onElegir={(c) => { setCliente(c); setSelCliente(false); }} />
      )}
      {lineaEditada && (
        <EditorLinea linea={lineaEditada} tasa={tasaDe(lineaEditada.p)} onCerrar={() => setEditarLinea(null)}
          onGuardar={(l) => { setCarrito((c) => c.map((x) => (x.p.id === l.p.id ? l : x))); setEditarLinea(null); }}
          onQuitar={() => { setCarrito((c) => c.filter((x) => x.p.id !== lineaEditada.p.id)); setEditarLinea(null); }} />
      )}
      {descGlobal && (
        <DescuentoGlobal onCerrar={() => setDescGlobal(false)}
          onAplicar={(pct) => { setCarrito((c) => c.map((l) => ({ ...l, descPct: pct || undefined, descMonto: undefined }))); setDescGlobal(false); }} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- editor de línea (cantidad + descuento)
function EditorLinea({ linea, tasa, onGuardar, onQuitar, onCerrar }: {
  linea: Linea; tasa: number; onGuardar: (l: Linea) => void; onQuitar: () => void; onCerrar: () => void;
}) {
  const [cantidad, setCantidad] = useState(String(linea.cantidad));
  const [modo, setModo] = useState<'pct' | 'monto'>(linea.descMonto != null ? 'monto' : 'pct');
  const [valor, setValor] = useState(linea.descPct != null ? String(linea.descPct) : linea.descMonto != null ? (linea.descMonto * (1 + tasa)).toFixed(2) : '');
  const cant = Number(cantidad) || 0;
  const precioFinal = Number(linea.p.precio_venta) * (1 + tasa);
  const brutoFinal = precioFinal * cant;
  const descFinal = modo === 'pct' ? brutoFinal * (Number(valor) || 0) / 100 : Math.min(Number(valor) || 0, brutoFinal);
  const excedeStock = linea.p.maneja_inventario && cant > Number(linea.p.stock_actual);

  function guardar() {
    if (cant <= 0) return onQuitar();
    if (excedeStock) return avisar(`Solo hay ${Number(linea.p.stock_actual)} disponibles`, 'error');
    const v = Number(valor) || 0;
    if (modo === 'pct' && v > 100) return avisar('El descuento no puede pasar de 100%', 'error');
    onGuardar({
      ...linea, cantidad: cant,
      descPct: modo === 'pct' && v > 0 ? v : undefined,
      descMonto: modo === 'monto' && v > 0 ? redondear2(v / (1 + tasa)) : undefined, // se guarda sin ITBIS
    });
  }

  return (
    <Modal titulo={linea.p.nombre} descripcion={`${rd(precioFinal)} c/u · ${linea.p.codigo_interno}`} onCerrar={onCerrar} ancho="max-w-md"
      pie={<>
        <Boton variante="fantasma" className="mr-auto text-red-600 hover:bg-red-50" icono={<Trash size={16} />} onClick={onQuitar}>Quitar</Boton>
        <Boton onClick={onCerrar}>Cancelar</Boton>
        <Boton variante="primario" onClick={guardar}>Aplicar</Boton>
      </>}>
      <div className="space-y-4">
        <Campo etiqueta="Cantidad" error={excedeStock ? `Disponible: ${Number(linea.p.stock_actual)}` : undefined}>
          <Entrada type="number" min="0" step="any" value={cantidad} onChange={(e) => setCantidad(e.target.value)} autoFocus className="num h-11 text-lg" />
        </Campo>
        <div>
          <span className="mb-1.5 block text-sm font-medium text-slate-700">Descuento</span>
          <div className="flex gap-2">
            <div className="flex rounded-lg bg-slate-100 p-1">
              {(['pct', 'monto'] as const).map((m) => (
                <button key={m} onClick={() => setModo(m)} className={`h-9 rounded-md px-3 text-sm font-semibold ${modo === m ? 'bg-white shadow-sm' : 'text-slate-500'}`}>{m === 'pct' ? '%' : 'RD$'}</button>
              ))}
            </div>
            <Entrada type="number" min="0" step="any" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="0" className="num h-11 flex-1" />
          </div>
          <div className="mt-2 flex gap-1.5">
            {[5, 10, 15, 20].map((p) => (
              <button key={p} onClick={() => { setModo('pct'); setValor(String(p)); }} className="h-8 flex-1 rounded-md border border-slate-200 text-sm font-medium hover:bg-slate-50">{p}%</button>
            ))}
          </div>
        </div>
        <dl className="num space-y-1 rounded-lg bg-slate-50 p-3 text-sm">
          <div className="flex justify-between text-slate-600"><dt>Importe</dt><dd>{num(brutoFinal)}</dd></div>
          <div className="flex justify-between text-emerald-700"><dt>Descuento</dt><dd>−{num(descFinal)}</dd></div>
          <div className="flex justify-between font-semibold"><dt>Total línea</dt><dd>{num(brutoFinal - descFinal)}</dd></div>
        </dl>
      </div>
    </Modal>
  );
}

function DescuentoGlobal({ onAplicar, onCerrar }: { onAplicar: (pct: number) => void; onCerrar: () => void }) {
  const [pct, setPct] = useState('');
  return (
    <Modal titulo="Descuento a toda la venta" descripcion="Se aplica el mismo porcentaje a cada línea (así lo exige el e-CF)." onCerrar={onCerrar} ancho="max-w-sm"
      pie={<><Boton onClick={() => onAplicar(0)}>Quitar descuentos</Boton><Boton variante="primario" onClick={() => onAplicar(Math.min(100, Number(pct) || 0))}>Aplicar</Boton></>}>
      <div className="grid grid-cols-4 gap-2">
        {[5, 10, 15, 20].map((p) => (
          <button key={p} onClick={() => setPct(String(p))} className={`h-11 rounded-lg border text-sm font-semibold ${pct === String(p) ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-slate-200 hover:bg-slate-50'}`}>{p}%</button>
        ))}
      </div>
      <Campo etiqueta="Otro porcentaje" className="mt-4">
        <Entrada type="number" min="0" max="100" value={pct} onChange={(e) => setPct(e.target.value)} placeholder="0" className="num" autoFocus />
      </Campo>
    </Modal>
  );
}
