import { Modal, Boton, Tecla } from './ui';

const GRUPOS: { titulo: string; atajos: [string[], string][] }[] = [
  { titulo: 'En todo el sistema', atajos: [
    [['Alt', '1…8'], 'Ir a un módulo (1 Punto de Venta, 2 Historial, 3 Caja…)'],
    [['F1'], 'Ver esta lista de atajos'],
    [['F2'], 'Ir al buscador de la página'],
    [['Alt', 'N'], 'Nuevo (producto, cliente, compra o usuario, según la página)'],
    [['Tab'], 'Pasar al siguiente botón o campo (Shift+Tab para volver)'],
    [['←', '→'], 'Cambiar de pestaña cuando una pestaña tiene el foco'],
    [['Alt', 'Q'], 'Cerrar sesión'],
  ] },
  { titulo: 'Ventanas', atajos: [
    [['Enter'], 'Confirmar (Guardar, Aplicar, Aprobar…)'],
    [['Esc'], 'Cerrar o cancelar'],
    [['↑', '↓'], 'Moverse por la lista (clientes, terminales)'],
  ] },
  { titulo: 'Punto de Venta', atajos: [
    [['F2'], 'Buscar producto o escanear código'],
    [['↑', '↓', '←', '→'], 'Moverse por los productos'],
    [['Enter'], 'Agregar el producto marcado (o el código escrito)'],
    [['3', '*'], 'Cantidad: escribe 3* y luego el producto agrega 3 unidades'],
    [['+', '−'], 'Sumar o restar 1 a la línea marcada del carrito'],
    [['Supr'], 'Quitar la línea marcada del carrito'],
    [['Insert'], 'Cambiar cantidad o descuento de la línea marcada'],
    [['Re Pág', 'Av Pág'], 'Categoría anterior o siguiente'],
    [['F3'], 'Elegir cliente (RNC / cédula)'],
    [['F4'], 'Cambiar comprobante: E32 → E31 → E44 → E45'],
    [['F6'], 'Escribir el efectivo recibido o la referencia'],
    [['F7'], 'Cambiar forma de pago'],
    [['F8'], 'Descuento a toda la venta'],
    [['F9'], 'Cobrar y emitir'],
    [['Ctrl', 'Supr'], 'Vaciar la venta'],
    [['Esc'], 'Limpiar la búsqueda'],
  ] },
  { titulo: 'Después de cobrar', atajos: [
    [['Enter'], 'Nueva venta'],
    [['P'], 'Imprimir el ticket'],
  ] },
];

export default function Atajos({ onCerrar }: { onCerrar: () => void }) {
  return (
    <Modal titulo="Atajos de teclado" descripcion="Todo el sistema se puede usar sin ratón" onCerrar={onCerrar} ancho="max-w-3xl"
      pie={<Boton variante="primario" onClick={onCerrar}>Entendido</Boton>}>
      <div className="grid gap-x-8 gap-y-5 md:grid-cols-2">
        {GRUPOS.map((g) => (
          <section key={g.titulo} className={g.titulo === 'Punto de Venta' ? 'md:row-span-3' : ''}>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{g.titulo}</h3>
            <ul className="divide-y divide-slate-100">
              {g.atajos.map(([teclas, texto]) => (
                <li key={texto} className="flex items-center justify-between gap-3 py-1.5 text-[13px]">
                  <span className="text-slate-700">{texto}</span>
                  <span className="flex shrink-0 items-center gap-0.5">{teclas.map((t) => <Tecla key={t}>{t}</Tecla>)}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Modal>
  );
}
