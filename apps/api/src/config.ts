export type AmbienteDGII = 'TesteCF' | 'CerteCF' | 'eCF';

export const config = {
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://pos:pos@localhost:5432/pos',
  ambiente: (process.env.DGII_AMBIENTE ?? 'TesteCF') as AmbienteDGII,
  // El .p12 vive en un volumen/secret montado, nunca en el repositorio ni en la BD.
  certificado: {
    rutaP12: process.env.CERT_P12_PATH ?? '/run/secrets/firma.p12',
    clave: process.env.CERT_P12_PASSWORD ?? '',
  },
  zonaHoraria: 'America/Santo_Domingo',
  worker: {
    intervaloMs: 15_000,
    loteMaximo: 20,
    backoffMaxMs: 5 * 60_000,
    timeoutHttpMs: 20_000,
  },
};

/**
 * Endpoints de los servicios web de la DGII.
 * Verificar contra la "Descripción Técnica Servicios DGII" vigente antes de certificar:
 * la DGII ha cambiado rutas entre versiones del documento.
 */
export function urlsDGII(amb: AmbienteDGII) {
  const ecf = `https://ecf.dgii.gov.do/${amb.toLowerCase()}`;
  const fc = `https://fc.dgii.gov.do/${amb.toLowerCase()}`;
  return {
    semilla: `${ecf}/autenticacion/api/autenticacion/semilla`,
    validarSemilla: `${ecf}/autenticacion/api/autenticacion/validarsemilla`,
    recepcionECF: `${ecf}/recepcion/api/facturaselectronicas`,
    consultaResultado: `${ecf}/consultaresultado/api/consultas/estado`,
    recepcionRFCE: `${fc}/recepcionfc/api/recepcion/ecf`,
    // Timbres (QR) de la representación impresa
    timbre: `https://ecf.dgii.gov.do/${amb}/ConsultaTimbre`,
    timbreFC: `https://fc.dgii.gov.do/${amb}/ConsultaTimbreFC`,
  };
}
