import { useState, type ReactNode } from 'react';
import { Modal, Boton } from './ui';
import type { Marca } from '../screens/Login';

export type DocLegal = 'terminos' | 'privacidad' | 'acerca';
const ACTUALIZADO = '18 de noviembre de 2026';

/** Enlaces del pie: Términos · Privacidad · Acerca de. Abren cada documento en una ventana. */
export function EnlacesLegales({ marca, version, className = '' }: { marca: Marca | null; version?: string; className?: string }) {
  const [abierto, setAbierto] = useState<DocLegal | null>(null);
  const enlaces: [DocLegal, string][] = [['terminos', 'Términos de uso'], ['privacidad', 'Política de privacidad'], ['acerca', 'Acerca de']];
  return (
    <>
      <nav className={`flex flex-wrap items-center justify-center gap-x-1 text-xs text-slate-400 ${className}`}>
        {enlaces.map(([id, texto], i) => (
          <span key={id} className="flex items-center gap-x-1">
            {i > 0 && <span aria-hidden>·</span>}
            <button type="button" onClick={() => setAbierto(id)} className="rounded px-1 py-0.5 hover:text-slate-700 hover:underline">{texto}</button>
          </span>
        ))}
      </nav>
      {abierto && <DocumentoLegal doc={abierto} marca={marca} version={version} onCerrar={() => setAbierto(null)} onIr={setAbierto} />}
    </>
  );
}

function DocumentoLegal({ doc, marca, version, onCerrar, onIr }: { doc: DocLegal; marca: Marca | null; version?: string; onCerrar: () => void; onIr: (d: DocLegal) => void }) {
  const negocio = marca?.razonSocial || marca?.nombre || 'el negocio';
  const contacto = [marca?.correo, marca?.telefono].filter(Boolean).join(' · ');
  const titulo = { terminos: 'Términos de uso', privacidad: 'Política de privacidad', acerca: 'Acerca de' }[doc];
  return (
    <Modal titulo={titulo} descripcion={doc === 'acerca' ? undefined : `Última actualización: ${ACTUALIZADO}`} onCerrar={onCerrar} ancho="max-w-2xl"
      pie={<Boton variante="primario" onClick={onCerrar}>Entendido</Boton>}>
      <div className="space-y-5 text-[14.5px] leading-relaxed text-slate-600">
        {doc === 'terminos' && <Terminos negocio={negocio} onIr={onIr} />}
        {doc === 'privacidad' && <Privacidad negocio={negocio} marca={marca} contacto={contacto} />}
        {doc === 'acerca' && <Acerca marca={marca} version={version} contacto={contacto} onIr={onIr} />}
      </div>
    </Modal>
  );
}

const Sec = ({ n, t, children }: { n?: number; t: string; children: ReactNode }) => (
  <section>
    <h3 className="mb-1.5 font-semibold text-slate-900">{n ? `${n}. ` : ''}{t}</h3>
    {children}
  </section>
);
const Lista = ({ children }: { children: ReactNode }) => <ul className="list-disc space-y-1 pl-5 marker:text-slate-300">{children}</ul>;
const Enlace = ({ onClick, children }: { onClick: () => void; children: ReactNode }) =>
  <button type="button" onClick={onClick} className="font-medium text-blue-600 hover:underline">{children}</button>;

function Terminos({ negocio, onIr }: { negocio: string; onIr: (d: DocLegal) => void }) {
  return (
    <>
      <p>
        Estos términos regulan el uso del sistema de punto de venta <b className="text-slate-800">POS DGII</b>, desarrollado por NexTech360,
        en <b className="text-slate-800">{negocio}</b>. Al iniciar sesión aceptas estas condiciones.
      </p>
      <Sec n={1} t="Cuentas y acceso">
        <Lista>
          <li>Cada usuario y su contraseña o PIN son personales e intransferibles. No los compartas.</li>
          <li>Todo lo que se registre con tu cuenta (ventas, anulaciones, movimientos de caja) queda a tu nombre en la auditoría del sistema.</li>
          <li>Los nuevos integrantes solicitan acceso y el administrador decide si lo aprueba y con qué perfil.</li>
          <li>Tras varios intentos fallidos el acceso se bloquea unos minutos para proteger la cuenta.</li>
        </Lista>
      </Sec>
      <Sec n={2} t="Uso permitido">
        <Lista>
          <li>El sistema se usa para registrar operaciones reales del negocio: ventas, cobros, inventario y caja.</li>
          <li>Está prohibido registrar ventas ficticias, alterar comprobantes o intentar evadir los controles del sistema.</li>
          <li>Los descuentos, anulaciones y salidas de efectivo pueden requerir la autorización de un administrador.</li>
        </Lista>
      </Sec>
      <Sec n={3} t="Facturación electrónica (e-CF)">
        <Lista>
          <li>{negocio} es el emisor ante la Dirección General de Impuestos Internos (DGII) y responde por la veracidad de los comprobantes que emite.</li>
          <li>Los comprobantes se firman con el certificado digital del negocio. Una vez firmado, un e-CF no se modifica: se corrige con una nota de crédito.</li>
          <li>Si no hay conexión, el sistema guarda los comprobantes y los envía a la DGII al restablecerse, dentro de los plazos que fija la normativa.</li>
        </Lista>
      </Sec>
      <Sec n={4} t="Actualizaciones y respaldos">
        <Lista>
          <li>El sistema recibe mejoras desde Configuración → Actualizaciones. Antes de instalar una, hace un respaldo de la base de datos y, si algo falla, vuelve a la versión anterior.</li>
          <li>El negocio debe mantener además sus propios respaldos periódicos en un lugar seguro.</li>
        </Lista>
      </Sec>
      <Sec n={5} t="Responsabilidad">
        <p>
          El sistema se entrega tal como está. NexTech360 trabaja para que funcione de forma correcta y continua, pero no responde por pérdidas
          derivadas de un uso indebido, de fallas del equipo, de la conexión a internet o de servicios de terceros, como los de la DGII.
        </p>
      </Sec>
      <Sec n={6} t="Datos personales">
        <p>El manejo de la información de usuarios y clientes se describe en la <Enlace onClick={() => onIr('privacidad')}>Política de privacidad</Enlace>.</p>
      </Sec>
      <Sec n={7} t="Cambios">
        <p>Estos términos pueden actualizarse junto con el sistema. La fecha de la última actualización aparece arriba.</p>
      </Sec>
    </>
  );
}

function Privacidad({ negocio, marca, contacto }: { negocio: string; marca: Marca | null; contacto: string }) {
  return (
    <>
      <p>
        <b className="text-slate-800">{negocio}</b>{marca?.rnc ? <> (RNC {marca.rnc})</> : null} es responsable de los datos que se registran en este sistema.
        Esta política explica qué datos se guardan, para qué y cómo puedes ejercer tus derechos según la Ley No. 172-13 sobre Protección de Datos de Carácter Personal.
      </p>
      <Sec n={1} t="Qué datos guardamos">
        <Lista>
          <li><b className="text-slate-700">Usuarios del sistema:</b> nombre, usuario, correo o teléfono, perfil y la fecha de su último acceso. La contraseña o PIN nunca se guarda en texto: se almacena cifrada de forma irreversible.</li>
          <li><b className="text-slate-700">Solicitudes de acceso:</b> nombre, correo o teléfono, perfil solicitado, la nota opcional y la dirección de red desde donde se envió.</li>
          <li><b className="text-slate-700">Clientes:</b> nombre o razón social, RNC o cédula, contacto, límite de crédito y saldo pendiente.</li>
          <li><b className="text-slate-700">Operaciones:</b> ventas, pagos, movimientos de caja e inventario, con el usuario que las registró.</li>
        </Lista>
      </Sec>
      <Sec n={2} t="Para qué los usamos">
        <Lista>
          <li>Emitir facturas y comprobantes fiscales electrónicos y cumplir con la DGII.</li>
          <li>Controlar el acceso al sistema, la caja y las cuentas por cobrar.</li>
          <li>Generar los reportes que exige la normativa tributaria, como el formato 607.</li>
        </Lista>
      </Sec>
      <Sec n={3} t="Con quién se comparten">
        <p>
          Los datos se guardan en el equipo o servidor del propio negocio. Solo se envían a la DGII los datos que exige cada comprobante fiscal
          (por ejemplo, el RNC y el nombre del comprador en un crédito fiscal). No se venden ni se comparten con terceros para publicidad.
          Las actualizaciones del sistema solo descargan programa nuevo: no envían tus datos a nadie.
        </p>
      </Sec>
      <Sec n={4} t="Cómo los protegemos">
        <Lista>
          <li>Contraseñas y PIN cifrados, sesiones firmadas que vencen y bloqueo tras intentos fallidos.</li>
          <li>Cada perfil ve solo lo que necesita: un cajero no accede a reportes ni a la configuración.</li>
          <li>Los comprobantes firmados quedan protegidos contra cambios y toda acción sensible queda en la auditoría.</li>
        </Lista>
      </Sec>
      <Sec n={5} t="Cuánto tiempo los conservamos">
        <p>Los registros fiscales se conservan durante el plazo que exige la normativa tributaria. Las solicitudes de acceso rechazadas pueden eliminarse cuando ya no sean necesarias.</p>
      </Sec>
      <Sec n={6} t="Tus derechos">
        <p>
          Puedes pedir acceso a tus datos, su rectificación si son incorrectos o su supresión cuando ya no sean necesarios, salvo los que deban conservarse por ley.
          {contacto ? <> Escríbenos a <b className="text-slate-700">{contacto}</b>.</> : <> Solicítalo al administrador del negocio.</>}
        </p>
      </Sec>
    </>
  );
}

function Acerca({ marca, version, contacto, onIr }: { marca: Marca | null; version?: string; contacto: string; onIr: (d: DocLegal) => void }) {
  return (
    <>
      <div className="flex flex-col items-center py-2 text-center">
        <div className="codigo text-2xl font-bold text-slate-900">NexTech<span style={{ color: '#EAB308' }}>360</span></div>
        <div className="mt-1 text-slate-500">POS DGII{version ? ` · versión ${version}` : ''}</div>
      </div>
      <p>Punto de venta con facturación electrónica para la República Dominicana: ventas, caja, inventario, clientes y comprobantes fiscales electrónicos (e-CF) ante la DGII.</p>
      {marca?.razonSocial && (
        <Sec t="Este sistema pertenece a">
          <p className="text-slate-700">
            <b>{marca.razonSocial}</b>{marca.rnc ? ` · RNC ${marca.rnc}` : ''}
            {marca.direccion && <span className="block text-slate-500">{marca.direccion}</span>}
            {contacto && <span className="block text-slate-500">{contacto}</span>}
          </p>
        </Sec>
      )}
      <Sec t="Documentos">
        <p><Enlace onClick={() => onIr('terminos')}>Términos de uso</Enlace> · <Enlace onClick={() => onIr('privacidad')}>Política de privacidad</Enlace></p>
      </Sec>
      <p className="codigo text-center text-xs text-slate-400">POS DGII © {new Date().getFullYear()} · NexTech360</p>
    </>
  );
}
