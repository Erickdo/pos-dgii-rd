import { Decimal } from 'decimal.js';

Decimal.set({ precision: 30, rounding: Decimal.ROUND_HALF_UP });

export const TASAS_ITBIS: Record<number, Decimal> = {
  1: new Decimal('0.18'), // ITBIS1 tasa general
  2: new Decimal('0.16'), // ITBIS2 tasa reducida
  3: new Decimal('0'),    // ITBIS3 0 %
  4: new Decimal('0'),    // exento
};

export const r2 = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

export interface LineaEntrada {
  productoId: string;
  codigoInterno: string;
  nombre: string;
  esServicio: boolean;
  unidadMedida: number | null;
  cantidad: Decimal;
  precioUnitario: Decimal;      // sin ITBIS, tomado de la BD (nunca del cliente)
  descuentoMonto: Decimal;
  indicadorItbis: 1 | 2 | 3 | 4;
}

export interface LineaCalculada extends LineaEntrada {
  numeroLinea: number;
  montoItem: Decimal;           // <MontoItem> sin ITBIS
  itbisItem: Decimal;           // informativo
}

export interface Totales {
  montoGravadoI1: Decimal;
  montoGravadoI2: Decimal;
  montoGravadoI3: Decimal;
  montoExento: Decimal;
  totalItbis1: Decimal;
  totalItbis2: Decimal;
  totalItbis: Decimal;
  totalDescuento: Decimal;
  montoTotal: Decimal;
}

/**
 * Calcula líneas y totales con la misma partición que exige <Totales> del e-CF.
 * El ITBIS total se calcula sobre la BASE ACUMULADA de cada tasa (no sumando el ITBIS
 * redondeado de cada línea) para cuadrar con la validación de la DGII:
 *   TotalITBIS1 = MontoGravadoI1 × 18 %
 */
export function calcularVenta(lineas: LineaEntrada[]): { lineas: LineaCalculada[]; totales: Totales } {
  if (lineas.length === 0) throw new Error('La venta no tiene ítems');
  if (lineas.length > 1000) throw new Error('Máximo 1,000 ítems por comprobante');

  const base: Record<number, Decimal> = { 1: new Decimal(0), 2: new Decimal(0), 3: new Decimal(0), 4: new Decimal(0) };
  let totalDescuento = new Decimal(0);

  const calculadas = lineas.map((l, i): LineaCalculada => {
    if (l.cantidad.lte(0)) throw new Error(`Línea ${i + 1}: cantidad inválida`);
    const bruto = l.cantidad.mul(l.precioUnitario);
    if (l.descuentoMonto.gt(bruto)) throw new Error(`Línea ${i + 1}: el descuento supera el importe`);

    const montoItem = r2(bruto.minus(l.descuentoMonto));
    base[l.indicadorItbis] = base[l.indicadorItbis].plus(montoItem);
    totalDescuento = totalDescuento.plus(l.descuentoMonto);

    return {
      ...l,
      numeroLinea: i + 1,
      montoItem,
      itbisItem: r2(montoItem.mul(TASAS_ITBIS[l.indicadorItbis])),
    };
  });

  const totalItbis1 = r2(base[1].mul(TASAS_ITBIS[1]));
  const totalItbis2 = r2(base[2].mul(TASAS_ITBIS[2]));
  const totales: Totales = {
    montoGravadoI1: r2(base[1]),
    montoGravadoI2: r2(base[2]),
    montoGravadoI3: r2(base[3]),
    montoExento: r2(base[4]),
    totalItbis1,
    totalItbis2,
    totalItbis: totalItbis1.plus(totalItbis2),
    totalDescuento: r2(totalDescuento),
    montoTotal: r2(base[1].plus(base[2]).plus(base[3]).plus(base[4]).plus(totalItbis1).plus(totalItbis2)),
  };
  return { lineas: calculadas, totales };
}

export type MetodoPago = 'efectivo' | 'tarjeta' | 'transferencia' | 'cheque' | 'credito' | 'bono' | 'otro';

export interface PagoEntrada { metodo: MetodoPago; monto: Decimal; referencia?: string; ultimos4?: string }

/** Valida pagos múltiples. Solo el efectivo puede exceder el total (genera cambio). */
export function validarPagos(total: Decimal, pagos: PagoEntrada[]): { totalPagado: Decimal; cambio: Decimal } {
  if (pagos.length === 0) throw new Error('Debe registrar al menos un pago');
  const totalPagado = pagos.reduce((s, p) => s.plus(p.monto), new Decimal(0));
  const noEfectivo = pagos.filter((p) => p.metodo !== 'efectivo').reduce((s, p) => s.plus(p.monto), new Decimal(0));

  if (totalPagado.lt(total)) throw new Error(`Pago incompleto: faltan RD$${total.minus(totalPagado).toFixed(2)}`);
  if (noEfectivo.gt(total)) throw new Error('Los pagos con tarjeta/transferencia no pueden exceder el total');
  if (noEfectivo.gte(total) && totalPagado.gt(noEfectivo)) throw new Error('El pago ya está cubierto: no hace falta efectivo');

  return { totalPagado: r2(totalPagado), cambio: r2(totalPagado.minus(total)) };
}

/** Código de <FormaPago> del e-CF */
export const FORMA_PAGO_DGII: Record<MetodoPago, number> = {
  efectivo: 1,
  cheque: 2,
  transferencia: 2,
  tarjeta: 3,
  credito: 4,
  bono: 5,
  otro: 8,
};
