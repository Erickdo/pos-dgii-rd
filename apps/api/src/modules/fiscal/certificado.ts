import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cargarP12, type Firmante } from './firma.js';
import { asegurarCertificadoPrueba } from './certificado-prueba.js';

/**
 * Gestión del certificado de firma. Prioridad:
 *   1. Variable CERT_P12_PATH (+ CERT_P12_PASSWORD)
 *   2. Certificado subido desde Configuración (.datos/certificado.p12)
 *   3. Certificado de PRUEBA autogenerado (la DGII no lo acepta)
 */
export type OrigenCert = 'variable' | 'subido' | 'prueba';

export class GestorCertificado {
  private firmante!: Firmante;
  private origen!: OrigenCert;
  private listeners: (() => void)[] = [];

  constructor(private dirDatos: string) { this.cargar(); }

  private rutas() {
    return {
      p12: join(this.dirDatos, 'certificado.p12'),
      meta: join(this.dirDatos, 'certificado.json'),
      prueba: join(this.dirDatos, 'certificado-prueba.p12'),
    };
  }

  cargar() {
    const r = this.rutas();
    if (process.env.CERT_P12_PATH && existsSync(process.env.CERT_P12_PATH)) {
      this.firmante = cargarP12(process.env.CERT_P12_PATH, process.env.CERT_P12_PASSWORD ?? '');
      this.origen = 'variable';
    } else if (existsSync(r.p12) && existsSync(r.meta)) {
      const { clave } = JSON.parse(readFileSync(r.meta, 'utf8'));
      this.firmante = cargarP12(r.p12, clave);
      this.origen = 'subido';
    } else {
      asegurarCertificadoPrueba(r.prueba, 'prueba');
      this.firmante = cargarP12(r.prueba, 'prueba');
      this.origen = 'prueba';
    }
    this.listeners.forEach((l) => l());
  }

  obtener(): Firmante {
    if (this.firmante.vence.getTime() - Date.now() < 86_400_000) this.cargar();
    return this.firmante;
  }

  info() {
    return {
      origen: this.origen,
      esPrueba: this.origen === 'prueba',
      titular: this.firmante.titular,
      vence: this.firmante.vence.toISOString().slice(0, 10),
      diasRestantes: Math.floor((this.firmante.vence.getTime() - Date.now()) / 86_400_000),
    };
  }

  /** Valida el .p12 con su clave ANTES de reemplazar el actual. La clave queda solo en este equipo. */
  instalar(contenido: Buffer, clave: string) {
    const r = this.rutas();
    mkdirSync(this.dirDatos, { recursive: true });
    const tmp = r.p12 + '.nuevo';
    writeFileSync(tmp, contenido);
    cargarP12(tmp, clave); // lanza si la clave es incorrecta o está vencido
    writeFileSync(r.p12, contenido);
    writeFileSync(r.meta, JSON.stringify({ clave, instalado: new Date().toISOString() }), { mode: 0o600 });
    this.cargar();
  }

  alCambiar(fn: () => void) { this.listeners.push(fn); }
}
