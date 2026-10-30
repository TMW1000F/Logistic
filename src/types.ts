// ==================== Типы данных ====================

export interface CarRecord {
  id: string;
  car_number: string;
  car_type: string;
  carrier: string;
  arrival: string; // HH:MM
  departure: string; // HH:MM
  date: string; // YYYY-MM-DD
  tariff: number;
  coefficient: number;
}

export interface ServiceRecord {
  id: string;
  service_type: string;
  carrier: string;
  quantity: number;
  payment_type: 'hourly' | 'fixed';
  arrival: string | null; // HH:MM
  departure: string | null; // HH:MM
  date: string; // YYYY-MM-DD
  tariff: number;
  coefficient: number;
}

export interface Tariff {
  id: string;
  type: 'auto' | 'service';
  category: string;
  carrier: string;
  price: number;
  payment_type: 'hourly' | 'fixed';
}

export interface AppState {
  autoRecords: CarRecord[];
  serviceRecords: ServiceRecord[];
  tariffs: Tariff[];
}

// ==================== Валидация госномера ====================
// Допустимые форматы (РФ):
//   1) буква + 3 цифры + 2 буквы + код региона 1-3 цифры:  А 123 АА 123
//   2) 4 цифры + 2 буквы + код региона 1-3 цифры:          1234 АА 123
// Буквы — только кириллица (наборы букв российских номеров).
// Разделители (пробелы/дефисы) необязательны: «А123АА123» тоже принимается.

const PLATE_LETTERS = 'АВЕКМНОРСТУХ'; // кириллические буквы, используемые в номерах РФ

const PLATE_PATTERN_MAIN = new RegExp(
  `^[${PLATE_LETTERS}][0-9]{3}[${PLATE_LETTERS}]{2}[0-9]{2,3}$`
);
const PLATE_PATTERN_LEGACY = new RegExp(
  `^[0-9]{4}[${PLATE_LETTERS}]{2}[0-9]{2,3}$`
);

// Нормализация: убрать пробелы/дефисы, перевести латиницу-омографы в кириллицу, верхний регистр
export function normalizePlate(input: string): string {
  const map: Record<string, string> = {
    A: 'А', B: 'В', C: 'С', E: 'Е', H: 'Н', K: 'К', M: 'М',
    N: 'Н', P: 'Р', T: 'Т', X: 'Х', Y: 'У',
  };
  return input
    .toUpperCase()
    .replace(/[\s\-–—]/g, '')
    .replace(/[A-Z]/g, (ch) => map[ch] ?? ch);
}

export function isValidPlate(input: string): boolean {
  const n = normalizePlate(input);
  return PLATE_PATTERN_MAIN.test(n) || PLATE_PATTERN_LEGACY.test(n);
}

// Красивое представление: «А 123 АА 123» / «1234 АА 123»
export function formatPlate(input: string): string {
  const n = normalizePlate(input);
  const m1 = n.match(new RegExp(`^([${PLATE_LETTERS}])([0-9]{3})([${PLATE_LETTERS}]{2})([0-9]{2,3})$`));
  if (m1) return `${m1[1]} ${m1[2]} ${m1[3]} ${m1[4]}`;
  const m2 = n.match(new RegExp(`^([0-9]{4})([${PLATE_LETTERS}]{2})([0-9]{2,3})$`));
  if (m2) return `${m2[1]} ${m2[2]} ${m2[3]}`;
  return n;
}

// ==================== Утилиты расчёта ====================

export function calcDurationHours(arrival: string, departure: string): number {
  const [ah, am] = arrival.split(':').map(Number);
  const [dh, dm] = departure.split(':').map(Number);
  const startMinutes = ah * 60 + am;
  const endMinutes = dh * 60 + dm;
  let diff = endMinutes - startMinutes;
  if (diff < 0) diff += 24 * 60; // переход через полночь
  return Math.round((diff / 60) * 100) / 100;
}

export function calcAutoCost(record: CarRecord): number {
  const hours = calcDurationHours(record.arrival, record.departure);
  return Math.round(hours * record.tariff * record.coefficient * 100) / 100;
}

export function calcServiceHours(record: ServiceRecord): number {
  if (record.payment_type === 'hourly' && record.arrival && record.departure) {
    return calcDurationHours(record.arrival, record.departure);
  }
  return 0;
}

export function calcServiceCost(record: ServiceRecord): number {
  if (record.payment_type === 'hourly') {
    const hours = calcServiceHours(record);
    return Math.round(hours * record.tariff * record.quantity * record.coefficient * 100) / 100;
  } else {
    return Math.round(record.tariff * record.quantity * record.coefficient * 100) / 100;
  }
}

export function formatNumber(num: number): string {
  return num.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatDate(dateStr: string): string {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-');
  return `${d}.${m}.${y}`;
}

export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}
