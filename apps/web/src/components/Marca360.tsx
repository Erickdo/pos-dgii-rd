/** Firma de la casa, igual que en ClipSphere: «POS DGII © 2026 · Creado por Erick Nex · NexTech360». */
export function FirmaSistema({ version, oscuro, className = '' }: { version?: string; oscuro?: boolean; className?: string }) {
  const fuerte = oscuro ? 'text-white' : 'text-slate-900';
  return (
    <span className={`codigo inline-flex flex-wrap items-center gap-x-1.5 ${oscuro ? 'text-slate-500' : 'text-slate-400'} ${className}`}>
      <span>POS DGII © {new Date().getFullYear()}</span>
      <span>·</span>
      <span>Creado por <b className={`font-bold ${fuerte}`}>Erick Nex</b></span>
      <span>·</span>
      <b className={`font-bold ${fuerte}`}>NexTech<span className={oscuro ? 'text-yellow-400' : 'text-amber-500'}>360</span></b>
      {version && <><span>·</span><span>v{version}</span></>}
    </span>
  );
}
