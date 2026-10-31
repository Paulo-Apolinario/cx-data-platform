export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function text(value, label, max = 200, optional = false) {
  if (optional && (value === undefined || value === null || value === '')) return '';
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    throw new HttpError(400, `${label}: informe um texto de até ${max} caracteres.`);
  }
  return value.trim();
}
export function date(value, label, optional = false) {
  if (optional && !value) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) {
    throw new HttpError(400, `${label}: data inválida.`);
  }
  return value;
}
export function dates(start, end) {
  if (start && end && start > end) throw new HttpError(400, 'A data final deve ser igual ou posterior à inicial.');
}
export function choice(value, choices, label) {
  if (!choices.includes(value)) throw new HttpError(400, `${label}: opção inválida.`);
  return value;
}
export function number(value, label, min = 0, max = 1e9) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new HttpError(400, `${label}: valor inválido.`);
  }
  return value;
}
export function cents(value, label, min = 0) {
  const n = number(value, label, min);
  if (Math.abs(n * 100 - Math.round(n * 100)) > 0.00001) throw new HttpError(400, `${label}: use até duas casas decimais.`);
  return Math.round(n * 100);
}
export function email(value) {
  const result = text(value, 'E-mail', 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) throw new HttpError(400, 'E-mail inválido.');
  return result;
}
export function password(value) {
  if (typeof value !== 'string' || value.length < 12 || value.length > 128) throw new HttpError(400, 'A senha deve ter entre 12 e 128 caracteres.');
  return value;
}
export function boolean(value) {
  if (typeof value !== 'boolean') throw new HttpError(400, 'Visibilidade inválida.');
  return Number(value);
}
