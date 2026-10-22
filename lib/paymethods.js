// Реквизиты для приёма денег берутся из переменной Vercel PAYMENT_METHODS (JSON),
// чтобы номера карт не попадали в публичный репозиторий на GitHub.
// Пример значения:
// [{"id":"alif-card","bank":"Alif","type":"card","number":"0000 0000 0000 0000","holder":"Имя Ф."},
//  {"id":"alif-phone","bank":"Alif","type":"phone","number":"+992 00 000 0000","holder":"Имя Ф."}]
export function getMethods() {
  try {
    const arr = JSON.parse(process.env.PAYMENT_METHODS || '[]');
    if (!Array.isArray(arr)) return [];
    const seen = new Set();
    return arr.filter(m => m && typeof m.id === 'string' && m.id && !seen.has(m.id) && seen.add(m.id)
      && typeof m.bank === 'string' && (m.type === 'card' || m.type === 'phone')
      && typeof m.number === 'string' && m.number).map(m => ({
        id: m.id.slice(0, 40), bank: m.bank.slice(0, 40), type: m.type,
        number: m.number.slice(0, 40), holder: String(m.holder || '').slice(0, 80)
      }));
  } catch (e) {
    return [];
  }
}
export const getMethod = id => getMethods().find(m => m.id === id) || null;
export const publicMethods = () => getMethods().map(({ id, bank, type }) => ({ id, bank, type }));
