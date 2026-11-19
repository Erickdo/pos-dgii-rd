import React, { useEffect, useRef, useState } from 'react';
import { MagnifyingGlass, UserPlus, User, Buildings, Check, CheckCircle, WarningCircle } from '@phosphor-icons/react';
import { api, ApiError, type Cliente } from '../api';
import { avisar, cedulaValida, formatoIdent, rncValido } from '../util';
import { Tecla, Boton, Campo, Entrada, Insignia, Interruptor, Modal } from './ui';

export type Requisito = 'contribuyente' | 'rnc' | null;

export default function SelectorCliente({ actual, requisito, onElegir, onCerrar }: {
  actual: Cliente | null; requisito: Requisito; onElegir: (c: Cliente | null) => void; onCerrar: () => void;
}) {
  const [q, setQ] = useState('');
  const [lista, setLista] = useState<Cliente[]>([]);
  const [nuevo, setNuevo] = useState(false);
  const [sel, setSel] = useState(0);
  const caja = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => api<Cliente[]>(`/clientes?q=${encodeURIComponent(q)}`).then(setLista).catch(() => {}), 150);
    return () => clearTimeout(t);
  }, [q]);

  const cumple = (c: Cliente) =>
    requisito === 'contribuyente' ? c.es_contribuyente : requisito === 'rnc' ? c.tipo_identificacion === 'RNC' : true;
  const GENERICO = '00000000-0000-0000-0000-000000000001';
  const permitido = (c: Cliente) => (c.id === GENERICO ? !requisito : cumple(c));
  // Al cambiar la lista, marca el primero que se puede elegir
  useEffect(() => { setSel(Math.max(0, lista.findIndex(permitido))); }, [lista]); // eslint-disable-line

  function teclas(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const paso = e.key === 'ArrowDown' ? 1 : -1;
      let n = sel;
      for (let i = 0; i < lista.length; i++) { n = (n + paso + lista.length) % lista.length; if (permitido(lista[n])) break; }
      setSel(n);
      caja.current?.children[n]?.scrollIntoView({ block: 'nearest' });
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const c = lista[sel];
      if (c && permitido(c)) onElegir(c.id === GENERICO ? null : c);
    }
    if (e.key === 'F2') { e.preventDefault(); setNuevo(true); }
  }

  return (
    <Modal titulo={nuevo ? 'Registrar cliente' : 'Seleccionar cliente'} onCerrar={onCerrar} ancho="max-w-xl"
      descripcion={requisito === 'contribuyente' ? 'Crédito fiscal (E31): el cliente debe tener RNC o cédula de contribuyente'
        : requisito === 'rnc' ? 'Este comprobante requiere un cliente con RNC' : 'Busca por nombre, RNC o cédula'}>
      {nuevo ? <FormCliente requisito={requisito} onCancelar={() => setNuevo(false)} onGuardado={onElegir} /> : (
        <>
          <div className="relative">
            <MagnifyingGlass size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Entrada autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={teclas} placeholder="Nombre, RNC o cédula · ↑↓ elegir · Enter confirmar" className="h-10 pl-10" />
          </div>
          <div ref={caja} className="mt-3 max-h-[50vh] space-y-1 overflow-y-auto">
            {lista.map((c, i) => {
              const generico = c.id === '00000000-0000-0000-0000-000000000001';
              const ok = generico ? !requisito : cumple(c);
              const elegido = actual?.id === c.id || (!actual && generico);
              return (
                <button key={c.id} disabled={!ok} tabIndex={-1} onClick={() => onElegir(generico ? null : c)} onMouseEnter={() => ok && setSel(i)}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition disabled:opacity-40 ${i === sel && ok ? 'bg-amber-50 ring-2 ring-amber-400/50' : elegido ? 'bg-blue-50 ring-1 ring-blue-200' : 'hover:bg-slate-50'}`}>
                  <span className={`grid size-9 place-items-center rounded-full ${c.tipo_identificacion === 'RNC' ? 'bg-blue-50 text-blue-600' : 'bg-slate-100 text-slate-500'}`}>
                    {c.tipo_identificacion === 'RNC' ? <Buildings size={18} /> : <User size={18} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-slate-900">{c.nombre}</span>
                    <span className="codigo block text-xs text-slate-500">{c.identificacion ? `${c.tipo_identificacion} ${formatoIdent(c.tipo_identificacion, c.identificacion)}` : 'Sin identificación'}</span>
                  </span>
                  {c.es_contribuyente && <Insignia tono="blue">E31</Insignia>}
                  {Number(c.limite_credito) > 0 && <Insignia tono="emerald">Crédito</Insignia>}
                  {elegido && <Check size={18} weight="bold" className="text-blue-600" />}
                </button>
              );
            })}
            {!lista.length && <p className="py-6 text-center text-sm text-slate-500">No hay clientes que coincidan.</p>}
          </div>
          <Boton variante="secundario" className="mt-3 w-full" icono={<UserPlus size={17} />} onClick={() => setNuevo(true)}>Registrar cliente nuevo <Tecla>F2</Tecla></Boton>
        </>
      )}
    </Modal>
  );
}

/** Alta de cliente con validación del dígito verificador del RNC / cédula. */
export function FormCliente({ requisito = null, onCancelar, onGuardado }: { requisito?: Requisito; onCancelar: () => void; onGuardado: (c: Cliente) => void }) {
  const [tipo, setTipo] = useState<'RNC' | 'CEDULA' | 'PASAPORTE'>('RNC');
  const [ident, setIdent] = useState('');
  const [nombre, setNombre] = useState('');
  const [correo, setCorreo] = useState('');
  const [telefono, setTelefono] = useState('');
  const [contribuyente, setContribuyente] = useState(true);
  const [forzar, setForzar] = useState(false);
  const [enviando, setEnviando] = useState(false);

  const limpio = tipo === 'PASAPORTE' ? ident.trim() : ident.replace(/\D/g, '');
  const largo = tipo === 'RNC' ? 9 : tipo === 'CEDULA' ? 11 : 0;
  const completo = !largo || limpio.length === largo;
  const dvOk = tipo === 'RNC' ? rncValido(limpio) : tipo === 'CEDULA' ? cedulaValida(limpio) : true;
  const tipos = requisito === 'rnc' ? (['RNC'] as const) : requisito === 'contribuyente' ? (['RNC', 'CEDULA'] as const) : (['RNC', 'CEDULA', 'PASAPORTE'] as const);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    try {
      const c = await api<Cliente>('/clientes', {
        body: { tipoIdentificacion: tipo, identificacion: limpio, nombre, correo, telefono, esContribuyente: contribuyente && tipo !== 'PASAPORTE', forzar },
      });
      avisar('Cliente registrado', 'ok');
      onGuardado(c);
    } catch (err) { avisar(err instanceof ApiError ? err.message : 'No se pudo guardar', 'error'); }
    finally { setEnviando(false); }
  }

  return (
    <form onSubmit={guardar} className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        {tipos.map((t) => (
          <button type="button" key={t} onClick={() => { setTipo(t); setForzar(false); }}
            className={`h-10 rounded-lg border text-sm font-semibold transition ${tipo === t ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}>
            {t === 'CEDULA' ? 'Cédula' : t === 'PASAPORTE' ? 'Pasaporte' : 'RNC'}
          </button>
        ))}
      </div>
      <Campo etiqueta={tipo === 'RNC' ? 'RNC' : tipo === 'CEDULA' ? 'Número de cédula' : 'Pasaporte'}
        ayuda={largo ? `${largo} dígitos, con o sin guiones` : undefined}>
        <div className="relative">
          <Entrada autoFocus required value={ident} onChange={(e) => { setIdent(e.target.value); setForzar(false); }} className="codigo pr-10"
            placeholder={tipo === 'RNC' ? '1-01-00000-2' : tipo === 'CEDULA' ? '001-0000000-1' : ''} />
          {largo > 0 && completo && limpio && (dvOk
            ? <CheckCircle size={20} weight="fill" className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-500" />
            : <WarningCircle size={20} weight="fill" className="absolute right-3 top-1/2 -translate-y-1/2 text-amber-500" />)}
        </div>
      </Campo>
      {largo > 0 && completo && limpio && !dvOk && (
        <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200">
          El dígito verificador no coincide. Revisa el número en el documento del cliente.
          <label className="mt-2 flex items-center gap-2 font-medium">
            <input type="checkbox" checked={forzar} onChange={(e) => setForzar(e.target.checked)} className="size-4 accent-blue-600" />
            Lo verifiqué y es correcto, guardar de todos modos
          </label>
        </div>
      )}
      <Campo etiqueta={tipo === 'RNC' ? 'Razón social' : 'Nombre completo'}>
        <Entrada required value={nombre} onChange={(e) => setNombre(e.target.value)} />
      </Campo>
      <div className="grid grid-cols-2 gap-3">
        <Campo etiqueta="Correo (factura electrónica)"><Entrada type="email" value={correo} onChange={(e) => setCorreo(e.target.value)} /></Campo>
        <Campo etiqueta="Teléfono"><Entrada value={telefono} onChange={(e) => setTelefono(e.target.value)} /></Campo>
      </div>
      {tipo !== 'PASAPORTE' && (
        <Interruptor activo={contribuyente || requisito === 'contribuyente'} onChange={(v) => requisito !== 'contribuyente' && setContribuyente(v)}
          etiqueta="Contribuyente: puede recibir crédito fiscal (E31)" />
      )}
      <div className="flex justify-end gap-2 pt-2">
        <Boton type="button" onClick={onCancelar}>Cancelar</Boton>
        <Boton type="submit" variante="primario" cargando={enviando} disabled={!completo || (!dvOk && !forzar)}>Guardar cliente</Boton>
      </div>
    </form>
  );
}
