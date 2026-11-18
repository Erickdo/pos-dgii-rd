import { useEffect, useRef } from 'react';

/**
 * Captura lecturas de escáneres USB/Bluetooth en modo teclado (HID).
 * Un escáner "teclea" muy rápido (< 30 ms entre teclas) y termina con Enter;
 * una persona no. Así se distingue sin necesidad de enfocar un input.
 */
export function useBarcodeScanner(onScan: (codigo: string) => void, opciones?: { maxIntervaloMs?: number; minLargo?: number }) {
  const { maxIntervaloMs = 30, minLargo = 6 } = opciones ?? {};
  const buffer = useRef('');
  const ultima = useRef(0);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const ahora = performance.now();
      if (ahora - ultima.current > maxIntervaloMs) buffer.current = '';
      ultima.current = ahora;

      if (e.key === 'Enter') {
        if (buffer.current.length >= minLargo) {
          e.preventDefault();          // que el Enter no envíe formularios
          onScan(buffer.current);
        }
        buffer.current = '';
        return;
      }
      if (e.key.length === 1) buffer.current += e.key;
    };
    window.addEventListener('keydown', handler, { capture: true });
    return () => window.removeEventListener('keydown', handler, { capture: true });
  }, [onScan, maxIntervaloMs, minLargo]);
}
