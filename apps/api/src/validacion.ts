/** Dígito verificador del RNC (9 dígitos), pesos 7-9-8-6-5-4-3-2 módulo 11. */
export function rncValido(rnc: string): boolean {
  if (!/^\d{9}$/.test(rnc)) return false;
  const pesos = [7, 9, 8, 6, 5, 4, 3, 2];
  const suma = pesos.reduce((s, p, i) => s + p * Number(rnc[i]), 0);
  const r = suma % 11;
  const dv = r === 0 ? 2 : r === 1 ? 1 : 11 - r;
  return dv === Number(rnc[8]);
}

/** Dígito verificador de la cédula (11 dígitos), algoritmo de Luhn. */
export function cedulaValida(ced: string): boolean {
  if (!/^\d{11}$/.test(ced)) return false;
  let suma = 0;
  for (let i = 0; i < 10; i++) {
    let x = Number(ced[i]) * (i % 2 === 0 ? 1 : 2);
    if (x > 9) x -= 9;
    suma += x;
  }
  return (10 - (suma % 10)) % 10 === Number(ced[10]);
}
