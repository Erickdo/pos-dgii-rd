/** Firma del sistema: NexTech 360 · Creado por Erick. Aparece junto a la versión. */
export const MARCA_SISTEMA = 'NexTech 360';
export const AUTOR_SISTEMA = 'Erick';

export function FirmaSistema({ version, oscuro, className = '' }: { version?: string; oscuro?: boolean; className?: string }) {
  return (
    <span className={`inline-flex flex-wrap items-center gap-x-1.5 ${className}`}>
      <span className={`font-semibold ${oscuro ? 'text-slate-300' : 'text-slate-600'}`}>
        Nex<span className="text-blue-500">Tech</span> 360
      </span>
      <span>· Creado por {AUTOR_SISTEMA}</span>
      {version && <span>· v<span className="codigo">{version}</span></span>}
    </span>
  );
}
