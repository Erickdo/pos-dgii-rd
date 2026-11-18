import { config, urlsDGII } from '../../config.js';
import { firmarXml, type Firmante } from './firma.js';

/**
 * Cliente de los servicios web de la DGII.
 *
 * Autenticación (token Bearer de corta duración):
 *   GET  semilla           → XML <SemillaModel><valor/><fecha/></SemillaModel>
 *   POST validarsemilla    → se envía la semilla FIRMADA (multipart "xml") → { token, expira }
 *
 * Envío:
 *   e-CF completo (E31, E33, E34, E32 ≥ 250k) → recepción → { trackId }  → consulta por trackId
 *   E32 < 250k → se envía el RFCE a recepcionfc → respuesta inmediata, SIN trackId
 */

export class ErrorRed extends Error {}            // reintentable (sin internet, timeout, 5xx)
export class ErrorDGII extends Error {            // respuesta de negocio (4xx) sobre el DOCUMENTO
  constructor(msg: string, public status: number, public cuerpo: unknown) { super(msg); }
}
/** Falla de login (certificado no registrado, vencido, reloj desfasado...). No es culpa
 *  del comprobante: NO se marca rechazado, queda en cola y se alerta al administrador. */
export class ErrorAutenticacion extends Error {
  constructor(msg: string, public status: number, public cuerpo: unknown) { super(msg); }
}

export interface RespuestaEstado {
  estado: 'Aceptado' | 'Aceptado Condicional' | 'Rechazado' | 'En Proceso' | string;
  mensajes?: { codigo?: number | string; valor?: string }[];
  encf?: string;
  secuenciaUtilizada?: boolean;
  [k: string]: unknown;
}

export class ClienteDGII {
  private token: { valor: string; expira: number } | null = null;
  private urls = urlsDGII(config.ambiente);

  constructor(private firmante: () => Firmante) {}

  /** Olvida el token (p. ej. al cambiar de certificado). */
  reiniciar() { this.token = null; }

  private async http(url: string, init: RequestInit): Promise<Response> {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(config.worker.timeoutHttpMs) });
      if (res.status >= 500 || res.status === 429) throw new ErrorRed(`DGII respondió ${res.status}`);
      return res;
    } catch (e) {
      if (e instanceof ErrorRed) throw e;
      throw new ErrorRed(`Sin conexión con la DGII: ${(e as Error).message}`);
    }
  }

  async obtenerToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expira - 60_000) return this.token.valor;

    const semilla = await (await this.http(this.urls.semilla, { method: 'GET' })).text();
    const { xmlFirmado } = firmarXml(semilla.replace(/^﻿/, ''), this.firmante());

    const form = new FormData();
    form.append('xml', new Blob([xmlFirmado], { type: 'text/xml' }), 'semilla.xml');
    const res = await this.http(this.urls.validarSemilla, { method: 'POST', body: form });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.token) throw new ErrorAutenticacion('Autenticación rechazada por la DGII', res.status, body);

    this.token = { valor: body.token, expira: new Date(body.expira).getTime() || Date.now() + 50 * 60_000 };
    return this.token.valor;
  }

  private async postXml(url: string, xml: string, nombre: string) {
    const token = await this.obtenerToken();
    const form = new FormData();
    form.append('xml', new Blob([xml], { type: 'text/xml' }), nombre);
    const res = await this.http(url, { method: 'POST', body: form, headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 401) { this.token = null; throw new ErrorRed('Token expirado'); }
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new ErrorDGII(`Recepción rechazada (${res.status})`, res.status, body);
    return body;
  }

  /** e-CF completo → devuelve trackId */
  async enviarECF(xmlFirmado: string, nombre: string): Promise<string> {
    const body = await this.postXml(this.urls.recepcionECF, xmlFirmado, nombre);
    if (!body?.trackId) throw new ErrorDGII('Respuesta sin trackId', 200, body);
    return body.trackId;
  }

  /** RFCE (E32 < 250k) → respuesta de validación inmediata */
  async enviarRFCE(xmlFirmado: string, nombre: string): Promise<RespuestaEstado> {
    return this.postXml(this.urls.recepcionRFCE, xmlFirmado, nombre);
  }

  async consultarEstado(trackId: string): Promise<RespuestaEstado> {
    const token = await this.obtenerToken();
    const res = await this.http(`${this.urls.consultaResultado}?trackid=${encodeURIComponent(trackId)}`, {
      method: 'GET', headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new ErrorDGII(`Consulta falló (${res.status})`, res.status, body);
    return body;
  }
}
