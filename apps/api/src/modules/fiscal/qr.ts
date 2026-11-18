import { Decimal } from 'decimal.js';
import { config, urlsDGII } from '../../config.js';
import { fechaDGII } from './ecf.builder.js';

/**
 * URL del timbre (QR) de la representación impresa.
 *  - E32 < RD$250,000  → ConsultaTimbreFC?RncEmisor&ENCF&MontoTotal&CodigoSeguridad
 *  - Resto (E31, E32 ≥ 250k, E33, E34) → ConsultaTimbre con datos del comprador y fecha de firma
 * El código de seguridad puede traer '+' o '/' (base64): siempre URL-encode.
 */
export function urlTimbre(p: {
  tipoECF: string;
  rncEmisor: string;
  rncComprador?: string | null;
  encf: string;
  fechaEmision: Date;
  montoTotal: Decimal;
  fechaHoraFirma: string;   // dd-MM-yyyy HH:mm:ss, tal cual va en el XML
  codigoSeguridad: string;
}): string {
  const urls = urlsDGII(config.ambiente);
  const e = encodeURIComponent;
  const monto = p.montoTotal.toFixed(2);

  if (p.tipoECF === '32' && p.montoTotal.lt(250_000)) {
    return `${urls.timbreFC}?RncEmisor=${e(p.rncEmisor)}&ENCF=${e(p.encf)}` +
           `&MontoTotal=${monto}&CodigoSeguridad=${e(p.codigoSeguridad)}`;
  }
  return `${urls.timbre}?RncEmisor=${e(p.rncEmisor)}` +
         (p.rncComprador ? `&RncComprador=${e(p.rncComprador)}` : '') +
         `&ENCF=${e(p.encf)}&FechaEmision=${e(fechaDGII(p.fechaEmision))}` +
         `&MontoTotal=${monto}&FechaFirma=${e(p.fechaHoraFirma)}` +
         `&CodigoSeguridad=${e(p.codigoSeguridad)}`;
}
