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

// Получение имени компьютера (автоматически, по ОС)
export function getComputerName(): string {
  // Сначала проверяем, не задано ли имя ранее
  const stored = localStorage.getItem('computerName');
  if (stored) return stored;

  // Определяем по ОС (fallback)
  const ua = navigator.userAgent;
  if (ua.includes('Windows')) return 'Windows PC';
  if (ua.includes('Mac')) return 'Mac';
  if (ua.includes('Linux')) return 'Linux';
  return 'Неизвестный';
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
      // Очищаем старый userId из localStorage
      localStorage.removeItem('userId');
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
      // Очищаем старый userId из localStorage
      localStorage.removeItem('userId');
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

// Все запросы, меняющие состояние блокировки/данных, отправляются с токеном —
// сервер сверяет его с userId и не даёт анониму (или другому пользователю)
// захватить/снять чужую блокировку.
function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('authToken');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// Текущий пользователь для блокировки: только авторизованный (id из users.json).
// Анонимный id из localStorage больше не используется — именно он позволял
// «подключиться и прописать свою блокировку» поверх чужой.
function getAuthUserId(): string | null {
  return getCurrentUser()?.id ?? null;
}

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
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders()
      },
      body: JSON.stringify({ 
        userId: userIdParam || currentUser?.id || userId, 
        computerName: computerNameParam || currentUser?.displayName || getComputerName(), 
        data 
      })
    });
    
    const result = await response.json().catch(() => ({}));
    
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
    const authUserId = getAuthUserId();
    // Неавторизованный клиент не может снимать блокировку — иначе закрытие
    // вкладки гостем/другим браузером очищало чужой lock.json.
    if (!authUserId) return;
    await fetch(`${API_BASE}/lock/release`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders()
      },
      body: JSON.stringify({ userId: authUserId }),
      keepalive: true // Важно! Позволяет запросу завершиться даже при закрытии страницы
    });
  } catch (error) {
    console.error('Ошибка releaseLock:', error);
  }
}

// Продлить блокировку
// Возвращает true, если блокировка успешно продлена; false — если сервер
// ответил ошибкой (например, блокировка уже истекла или её занял другой).
export async function extendLock(): Promise<boolean> {
  try {
    const authUserId = getAuthUserId();
    if (!authUserId) return false;
    const response = await fetch(`${API_BASE}/lock/extend`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders()
      },
      body: JSON.stringify({ userId: authUserId })
    });
    return response.ok;
  } catch (error) {
    console.error('Ошибка extendLock:', error);
    return false;
  }
}

// ==================== Отслеживание активности ====================

let lastActivityTime = Date.now();
let warningTimeout: ReturnType<typeof setTimeout> | null = null;
let releaseTimeout: ReturnType<typeof setTimeout> | null = null;
let onWarningCallback: (() => void) | null = null;
let onReleaseCallback: (() => void) | null = null;

const WARNING_TIME = 5 * 60 * 1000; // 5 минут до предупреждения
const RELEASE_TIME = 60 * 1000; // 1 минута после предупреждения до снятия

// Обновление времени последней активности
export function updateActivity() {
  lastActivityTime = Date.now();
  
  // Сбрасываем таймеры если они были установлены
  if (warningTimeout) {
    clearTimeout(warningTimeout);
    warningTimeout = null;
  }
  if (releaseTimeout) {
    clearTimeout(releaseTimeout);
    releaseTimeout = null;
  }
  
  // Запускаем новые таймеры
  startInactivityTimers();
}

// Запуск таймеров неактивности
function startInactivityTimers() {
  // Таймер предупреждения (через 5 минут)
  warningTimeout = setTimeout(() => {
    if (onWarningCallback) {
      onWarningCallback();
    }
    
    // Таймер снятия блокировки (через 1 минуту после предупреждения)
    releaseTimeout = setTimeout(async () => {
      await releaseLock();
      if (onReleaseCallback) {
        onReleaseCallback();
      }
    }, RELEASE_TIME);
  }, WARNING_TIME);
}

// Установка callback для предупреждения
export function setWarningCallback(callback: () => void) {
  onWarningCallback = callback;
}

// Установка callback для снятия блокировки
export function setReleaseCallback(callback: () => void) {
  onReleaseCallback = callback;
}

// Проверка, есть ли активная блокировка от другого пользователя
export async function checkLockStatus(): Promise<{ locked: boolean; lockInfo: any }> {
  try {
    const response = await fetch(`${API_BASE}/lock`);
    const result = await response.json();
    return result;
  } catch (error) {
    console.error('Ошибка проверки блокировки:', error);
    return { locked: false, lockInfo: null };
  }
}

// Начало отслеживания активности
export function startActivityTracking() {
  // Слушатели событий активности
  const events = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart'];
  
  events.forEach(event => {
    window.addEventListener(event, updateActivity, { passive: true });
  });
  
  // Инициализация таймеров
  updateActivity();
}

// Остановка отслеживания активности
export function stopActivityTracking() {
  if (warningTimeout) {
    clearTimeout(warningTimeout);
    warningTimeout = null;
  }
  if (releaseTimeout) {
    clearTimeout(releaseTimeout);
    releaseTimeout = null;
  }
}

// Автоматическое продление блокировки каждые 2 минуты.
// Важно: интервал ДОЛЖЕН быть меньше TTL блокировки на сервере (5 минут),
// иначе блокировка будет истекать сама, lock.json удалится, и следующий
// пользователь получит «пустой файл» и сможет занять его.
let lockInterval: ReturnType<typeof setInterval> | null = null;
let onLockLostCallback: (() => void) | null = null;

// Вызывается, когда фоновое продление обнаружило, что наша блокировка
// исчезла/перехвачена — приложение может показать режим только для чтения.
export function setLockLostCallback(callback: () => void) {
  onLockLostCallback = callback;
}

export function startLockExtension() {
  if (lockInterval) return;
  
  lockInterval = setInterval(async () => {
    const ok = await extendLock();
    if (!ok && onLockLostCallback) {
      stopLockExtension();
      onLockLostCallback();
    }
  }, 2 * 60 * 1000); // Каждые 2 минуты (TTL на сервере — 5 минут)
}

export function stopLockExtension() {
  if (lockInterval) {
    clearInterval(lockInterval);
    lockInterval = null;
  }
}

// ВАЖНО: освобождение блокировки при закрытии страницы НЕ настраивается.
// Раньше сюда вешались beforeunload/pagehide/visibilitychange с sendBeacon,
// и любой клиент (включая гостя или вторую вкладку, которая просто «свернулась»)
// мог прислать запрос на снятие блокировки — так lock.json очищался,
// а следующий пользователь захватывал «пустую» блокировку.
// Блокировка снимается только явно: выход из системы (logout) или
// освобождение владельцем через POST /api/lock/release; иначе она сама
// истекает по TTL на сервере.
