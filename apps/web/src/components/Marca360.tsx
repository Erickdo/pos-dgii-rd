/**
 * Firma de la casa, idéntica en todos los programas de NexTech360 (ClipSphere, POS DGII…):
 * fondo oscuro, texto gris, «Erick Nex» y «NexTech» en blanco negrita, «360» en amarillo.
 * Sobre fondos claros: mismo gris, nombres en tinta oscura y el 360 en el mismo tono amarillo.
 */
export const COLORES_FIRMA = { texto: '#8B8B94', fuerte: '#FFFFFF', fuerteClaro: '#0F172A', acento: '#FACC15', acentoClaro: '#EAB308' };

export function FirmaSistema({ version, oscuro, className = '' }: { version?: string; oscuro?: boolean; className?: string }) {
  const c = COLORES_FIRMA;
  const fuerte = oscuro ? c.fuerte : c.fuerteClaro;
  const acento = oscuro ? c.acento : c.acentoClaro;
  return (
    <span
      className={`codigo inline-flex flex-wrap items-center gap-x-1.5 ${className}`} style={{ color: c.texto }}>
      <span>POS DGII © {new Date().getFullYear()}</span>
      <span>·</span>
      <span>Creado por <b className="font-bold" style={{ color: fuerte }}>Erick Nex</b></span>
      <span>·</span>
      <b className="font-bold" style={{ color: fuerte }}>NexTech<span style={{ color: acento }}>360</span></b>
      {version && <><span>·</span><span>v{version}</span></>}
    </span>
  );
}
