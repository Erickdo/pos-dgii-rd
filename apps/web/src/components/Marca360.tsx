/**
 * Firma de la casa, idéntica en todos los programas de NexTech360 (ClipSphere, POS DGII…):
 * fondo oscuro, texto gris, «Erick Nex» y «NexTech» en blanco negrita, «360» en amarillo.
 * Sobre fondos claros se muestra dentro de una franja oscura para conservar los mismos colores.
 */
export const COLORES_FIRMA = { fondo: '#0B0B0F', texto: '#8B8B94', fuerte: '#FFFFFF', acento: '#FACC15' };

export function FirmaSistema({ version, oscuro, className = '' }: { version?: string; oscuro?: boolean; className?: string }) {
  const c = COLORES_FIRMA;
  return (
    <span
      className={`codigo inline-flex flex-wrap items-center gap-x-1.5 ${oscuro ? '' : 'rounded-lg px-3.5 py-1.5 shadow-sm'} ${className}`}
      style={{ color: c.texto, background: oscuro ? undefined : c.fondo }}>
      <span>POS DGII © {new Date().getFullYear()}</span>
      <span>·</span>
      <span>Creado por <b className="font-bold" style={{ color: c.fuerte }}>Erick Nex</b></span>
      <span>·</span>
      <b className="font-bold" style={{ color: c.fuerte }}>NexTech<span style={{ color: c.acento }}>360</span></b>
      {version && <><span>·</span><span>v{version}</span></>}
    </span>
  );
}
