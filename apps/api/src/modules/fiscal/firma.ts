import { readFileSync } from 'node:fs';
import forge from 'node-forge';
import { SignedXml } from 'xml-crypto';

/**
 * Firma XMLDSig "enveloped" exigida por la DGII:
 *  - RSA-SHA256, digest SHA-256
 *  - Canonicalización C14N 1.0 inclusiva
 *  - Reference URI="" (documento completo) + transform enveloped-signature
 *  - <KeyInfo><X509Data><X509Certificate> con el certificado del firmante
 *  - <Signature> como ÚLTIMO hijo del elemento raíz (ECF, RFCE, SemillaModel, ...)
 */
export interface Firmante {
  privateKeyPem: string;
  certPem: string;
  vence: Date;
  titular: string;
}

export function cargarP12(ruta: string, clave: string): Firmante {
  const der = readFileSync(ruta).toString('binary');
  const p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(der), clave);

  const keyBag =
    p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0] ??
    p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag]?.[0];
  const certBag = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag]?.[0];

  if (!keyBag?.key || !certBag?.cert) throw new Error('El .p12 no contiene llave privada y certificado');

  const vence = certBag.cert.validity.notAfter;
  if (vence < new Date()) throw new Error(`Certificado de firma vencido el ${vence.toISOString()}`);

  return {
    privateKeyPem: forge.pki.privateKeyToPem(keyBag.key),
    certPem: forge.pki.certificateToPem(certBag.cert),
    vence,
    titular: String(certBag.cert.subject.getField('CN')?.value ?? 'Sin nombre'),
  };
}

export interface ResultadoFirma {
  xmlFirmado: string;
  signatureValue: string;
  /** 6 primeros caracteres del SignatureValue: va en la representación impresa y en el QR */
  codigoSeguridad: string;
}

export function firmarXml(xml: string, f: Firmante): ResultadoFirma {
  const sig = new SignedXml({
    privateKey: f.privateKeyPem,
    publicCert: f.certPem,
    signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
    canonicalizationAlgorithm: 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
  });
  sig.addReference({
    xpath: '/*',
    isEmptyUri: true,
    digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
    transforms: [
      'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
      'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
    ],
  });
  sig.computeSignature(xml, { location: { reference: '/*', action: 'append' } });

  const xmlFirmado = sig.getSignedXml();
  const m = xmlFirmado.match(/<SignatureValue>([^<]+)<\/SignatureValue>/);
  if (!m) throw new Error('No se encontró SignatureValue en el XML firmado');
  const signatureValue = m[1].replace(/\s+/g, '');

  return { xmlFirmado, signatureValue, codigoSeguridad: signatureValue.slice(0, 6) };
}

/** Verificación local (útil en pruebas y antes de reenviar un XML guardado). */
export function verificarFirma(xmlFirmado: string, certPem: string): boolean {
  const sig = new SignedXml({ publicCert: certPem });
  const nodo = xmlFirmado.match(/<Signature[\s\S]*<\/Signature>/)?.[0];
  if (!nodo) return false;
  sig.loadSignature(nodo);
  return sig.checkSignature(xmlFirmado);
}
