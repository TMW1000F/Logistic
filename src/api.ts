import { AppState } from './types';

const API_BASE = 'http://localhost:3001/api';

interface LockInfo {
  userId: string;
  computerName: string;
  lockedAt: string;
  expiresAt: string;
}

// Генерация уникального ID пользователя (на основе браузера)
function generateUserId(): string {
  const stored = localStorage.getItem('userId');
  if (stored) return stored;
  
  const id = 'user_' + Math.random().toString(36).substr(2, 9);
  localStorage.setItem('userId', id);
  return id;
}

// Получение имени компьютера (из User Agent)
function getComputerName(): string {
  const ua = navigator.userAgent;
  if (ua.includes('Windows')) return 'Windows PC';
  if (ua.includes('Mac')) return 'Mac';
  if (ua.includes('Linux')) return 'Linux';
  return 'Unknown';
}

export const userId = generateUserId();
export const computerName = getComputerName();

// ==================== API функции ====================

// Получить все данные
export async function fetchData(): Promise<AppState> {
  try {
    const response = await fetch(`${API_BASE}/data`);
    if (!response.ok) throw new Error('Ошибка загрузки данных');
    return await response.json();
  } catch (error) {
    console.error('Ошибка fetchData:', error);
    throw error;
  }
}

// Обновить все данные
export async function updateData(data: AppState): Promise<{ success: boolean; lockInfo?: LockInfo }> {
  try {
    const response = await fetch(`${API_BASE}/data`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, computerName, data })
    });
    
    const result = await response.json();
    
    if (!response.ok) {
      return { success: false, lockInfo: result.lockInfo };
    }
    
    return { success: true };
  } catch (error) {
    console.error('Ошибка updateData:', error);
    throw error;
  }
}

// Получить информацию о блокировке
export async function getLockInfo(): Promise<{ locked: boolean; lockInfo: LockInfo | null }> {
  try {
    const response = await fetch(`${API_BASE}/lock`);
    if (!response.ok) throw new Error('Ошибка получения блокировки');
    return await response.json();
  } catch (error) {
    console.error('Ошибка getLockInfo:', error);
    throw error;
  }
}

// Освободить блокировку
export async function releaseLock(): Promise<void> {
  try {
    await fetch(`${API_BASE}/lock/release`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId })
    });
  } catch (error) {
    console.error('Ошибка releaseLock:', error);
  }
}

// Продлить блокировку
export async function extendLock(): Promise<void> {
  try {
    await fetch(`${API_BASE}/lock/extend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId })
    });
  } catch (error) {
    console.error('Ошибка extendLock:', error);
  }
}

// Автоматическое продление блокировки каждые 10 минут
let lockInterval: ReturnType<typeof setInterval> | null = null;

export function startLockExtension() {
  if (lockInterval) return;
  
  lockInterval = setInterval(() => {
    extendLock();
  }, 10 * 60 * 1000); // Каждые 10 минут
}

export function stopLockExtension() {
  if (lockInterval) {
    clearInterval(lockInterval);
    lockInterval = null;
  }
}

// Освобождение блокировки при закрытии страницы
export function setupLockRelease() {
  window.addEventListener('beforeunload', () => {
    releaseLock();
  });
}
