// Fechas como strings ISO 'YYYY-MM-DD' en UTC, para no depender del huso horario.

export function parse(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function iso(date) {
  return date.toISOString().slice(0, 10);
}

export function sumarDias(fecha, n) {
  const d = parse(fecha);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
}

export function rangoDias(desde, hasta) {
  const dias = [];
  for (let f = desde; f <= hasta; f = sumarDias(f, 1)) dias.push(f);
  return dias;
}

export function esHabil(fecha, feriados = []) {
  const dow = parse(fecha).getUTCDay();
  return dow !== 0 && dow !== 6 && !feriados.includes(fecha);
}

// Fecha que cae `n` días hábiles después de `fecha` (sin contar `fecha`).
export function sumarDiasHabiles(fecha, n, feriados = []) {
  let f = fecha;
  for (let k = 0; k < n; ) {
    f = sumarDias(f, 1);
    if (esHabil(f, feriados)) k++;
  }
  return f;
}
