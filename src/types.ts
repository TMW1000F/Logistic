// ==================== Типы данных ====================

// Автомобиль в базе (справочнике)
export interface CarInBase {
  id: string;
  plate: string;      // нормализованный госномер, напр. "А123АА123"
  display: string;    // номер для отображения, напр. "А 123 АА 123"
  car_type: string;   // тип ТС (из тарифов)
  carrier: string;    // перевозчик (из тарифов)
}

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

// ==================== Работа с госномерами ====================

// Русские буквы, допустимые в госномерах
const PLATE_LETTERS = 'АВЕКМНОРСТУХ';
// Латинские буквы, визуально совпадающие с буквами госномера: B→В, E→Е, K→К, M→М, H→Н, C→С, T→Т, Y→У, X→Х
const LATIN_TO_CYR: Record<string, string> = { 'A': 'А', 'B': 'В', 'E': 'Е', 'K': 'К', 'M': 'М', 'H': 'Н', 'C': 'С', 'T': 'Т', 'Y': 'У', 'X': 'Х' };

// Нормализация: убираем пробелы/дефисы, латиницу → кириллица, верхний регистр
export function normalizePlate(input: string): string {
  let s = input.toUpperCase().replace(/[\s\-]/g, '');
  // Заменяем только те латинские буквы, которые имеют визуальные аналоги в госномере;
  // прочие (D, F, Z и т.п.) оставляем как есть — они сделают номер невалидным
  s = s.replace(/[A-Z]/g, ch => LATIN_TO_CYR[ch] ?? ch);
  return s;
}

// Формат отображения: "А 123 АА 123" или "1234 АА 123"
export function formatPlateDisplay(plate: string): string {
  const p = normalizePlate(plate);
  const m1 = p.match(/^([АВЕКМНОРСТУХ])(\d{3})([АВЕКМНОРСТУХ]{2})(\d{2,3})$/);
  if (m1) return `${m1[1]} ${m1[2]} ${m1[3]} ${m1[4]}`;
  const m2 = p.match(/^(\d{4})([АВЕКМНОРСТУХ]{2})(\d{2,3})$/);
  if (m2) return `${m2[1]} ${m2[2]} ${m2[3]}`;
  return p;
}

// Проверка формата: А 123 АА 123 / Х123ХХ123 или 1234 АА 123 / 1234АА123
export function isValidPlateFormat(input: string): boolean {
  const p = normalizePlate(input);
  return new RegExp(`^([${PLATE_LETTERS}]\\d{3}[${PLATE_LETTERS}]{2}\\d{2,3}|\\d{4}[${PLATE_LETTERS}]{2}\\d{2,3})$`).test(p);
}

// Человекочитаемая подсказка по формату
export function plateFormatHint(): string {
  return 'Формат номера: А 123 АА 123 или 1234 АА 123';
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
  cars: CarInBase[]; // база автомобилей
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

// Единый генератор ID для всего приложения (crypto.randomUUID с fallback).
// Использовать ТОЛЬКО эту функцию — инлайн-генерации через Math.random()
// давали коллизии при импорте больших файлов.
export function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}
