import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import forge from 'node-forge';

/**
 * Genera un .p12 AUTOFIRMADO para trabajar sin certificado real.
 * Las ventas se firman igual, pero la DGII rechazará la autenticación: los e-CF quedan en
 * cola hasta que se configure CERT_P12_PATH con el certificado emitido por una entidad autorizada.
 */
export function asegurarCertificadoPrueba(ruta: string, clave: string) {
  if (existsSync(ruta)) return;
  mkdirSync(dirname(ruta), { recursive: true });
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = Date.now().toString(16);
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date(Date.now() + 3 * 365 * 86_400_000);
  const attrs = [{ name: 'commonName', value: 'CERTIFICADO DE PRUEBA - SIN VALIDEZ' }, { name: 'countryName', value: 'DO' }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], clave, { algorithm: '3des' });
  writeFileSync(ruta, Buffer.from(forge.asn1.toDer(asn1).getBytes(), 'binary'));
}
