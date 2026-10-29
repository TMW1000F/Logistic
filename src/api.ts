import { AppState } from './types';

// Используем относительный URL — работает на любом хосте
const API_BASE = '/api';

interface LockInfo {
  userId: string;
  computerName: string;
  lockedAt: string;
  expiresAt: string;
}

interface UserInfo {
  id: string;
  username: string;
  displayName: string;
}

interface AuthResponse {
  success: boolean;
  token?: string;
  user?: UserInfo;
  error?: string;
}

// Генерация уникального ID пользователя (на основе браузера)
function generateUserId(): string {
  const stored = localStorage.getItem('userId');
  if (stored) return stored;
  
  const id = 'user_' + Math.random().toString(36).substr(2, 9);
  localStorage.setItem('userId', id);
  return id;
}

// Получение имени компьютера
export function getComputerName(): string {
  // Сначала проверяем, ввёл ли пользователь своё имя
  const stored = localStorage.getItem('computerName');
  if (stored) return stored;
  
  // Если нет — определяем по ОС (fallback)
  const ua = navigator.userAgent;
  if (ua.includes('Windows')) return 'Windows PC';
  if (ua.includes('Mac')) return 'Mac';
  if (ua.includes('Linux')) return 'Linux';
  return 'Неизвестный';
}

// Установка имени компьютера (вызывается из диалога)
export function setComputerName(name: string): void {
  localStorage.setItem('computerName', name);
}

// Проверка, задано ли имя компьютера
export function hasComputerName(): boolean {
  return !!localStorage.getItem('computerName');
}

export const userId = generateUserId();
export let computerName = getComputerName();

// ==================== Авторизация ====================

// Получить текущего пользователя из localStorage
export function getCurrentUser(): UserInfo | null {
  const token = localStorage.getItem('authToken');
  const userStr = localStorage.getItem('currentUser');
  if (token && userStr) {
    try {
      return JSON.parse(userStr);
    } catch {
      return null;
    }
  }
  return null;
}

// Проверить, авторизован ли пользователь
export function isAuthenticated(): boolean {
  return !!localStorage.getItem('authToken');
}

// Регистрация
export async function register(username: string, password: string, displayName: string): Promise<AuthResponse> {
  try {
    const response = await fetch(`${API_BASE}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, displayName })
    });
    
    const result = await response.json();
    
    if (result.success && result.token && result.user) {
      localStorage.setItem('authToken', result.token);
      localStorage.setItem('currentUser', JSON.stringify(result.user));
    }
    
    return result;
  } catch (error) {
    console.error('Ошибка register:', error);
    return { success: false, error: 'Ошибка соединения с сервером' };
  }
}

// Вход
export async function login(username: string, password: string): Promise<AuthResponse> {
  try {
    const response = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    
    const result = await response.json();
    
    if (result.success && result.token && result.user) {
      localStorage.setItem('authToken', result.token);
      localStorage.setItem('currentUser', JSON.stringify(result.user));
    }
    
    return result;
  } catch (error) {
    console.error('Ошибка login:', error);
    return { success: false, error: 'Ошибка соединения с сервером' };
  }
}

// Выход
export async function logout(): Promise<void> {
  const token = localStorage.getItem('authToken');
  
  try {
    if (token) {
      await fetch(`${API_BASE}/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token })
      });
    }
  } catch (error) {
    console.error('Ошибка logout:', error);
  }
  
  localStorage.removeItem('authToken');
  localStorage.removeItem('currentUser');
}

// Проверка токена
export async function verifyToken(): Promise<UserInfo | null> {
  const token = localStorage.getItem('authToken');
  
  if (!token) return null;
  
  try {
    const response = await fetch(`${API_BASE}/auth/verify?token=${token}`);
    const result = await response.json();
    
    if (result.valid && result.user) {
      localStorage.setItem('currentUser', JSON.stringify(result.user));
      return result.user;
    } else {
      localStorage.removeItem('authToken');
      localStorage.removeItem('currentUser');
      return null;
    }
  } catch (error) {
    console.error('Ошибка verifyToken:', error);
    return null;
  }
}

// ==================== API функции ====================

// Получить все данные
export async function fetchData(): Promise<AppState> {
  try {
    const url = `${API_BASE}/data`;
    console.log('Запрос к серверу:', url);
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`Сервер вернул статус ${response.status}: ${response.statusText}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('Ошибка fetchData:', error);
    if (error instanceof TypeError && error.message.includes('fetch')) {
      throw new Error('Сервер недоступен. Убедитесь, что запущен `npm run server`');
    }
    throw error;
  }
}

// Обновить все данные
export async function updateData(data: AppState, userIdParam?: string, computerNameParam?: string): Promise<{ success: boolean; lockInfo?: LockInfo }> {
  try {
    const currentUser = getCurrentUser();
    const response = await fetch(`${API_BASE}/data`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        userId: userIdParam || currentUser?.id || userId, 
        computerName: computerNameParam || currentUser?.displayName || getComputerName(), 
        data 
      })
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
