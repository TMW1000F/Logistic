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
