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

// Время приводится к шагу 30 минут: минуты допускаются только 0 или 30
export function snapToHalfHour(time: string): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(time || '');
  if (!m) return time;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (min >= 45) h += 1; // округляем к ближайшему полчаса
  h = ((h % 24) + 24) % 24;
  return `${String(h).padStart(2, '0')}:${min >= 30 ? '30' : '00'}`;
}

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

// ==================== Ненавязчивый звук подтверждения ====================
// Короткий мягкий «клик» через Web Audio API (без внешних файлов).
let audioCtx: AudioContext | null = null;
export function playAddClick() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    audioCtx = audioCtx ?? new Ctx();
    if (audioCtx.state === 'suspended') void audioCtx.resume();
    const t0 = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(880, t0);
    osc.frequency.exponentialRampToValueAtTime(1320, t0 + 0.045);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.12, t0 + 0.008); // негромко
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.09); // коротко
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t0);
    osc.stop(t0 + 0.1);
  } catch {
    /* звук не критичен — молча пропускаем */
  }
}
