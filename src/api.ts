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
    const currentUser = getCurrentUser();
    const authUserId = currentUser?.id || userId;
    await fetch(`${API_BASE}/lock/release`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: authUserId }),
      keepalive: true // Важно! Позволяет запросу завершиться даже при закрытии страницы
    });
  } catch (error) {
    console.error('Ошибка releaseLock:', error);
  }
}

// ==================== Отслеживание активности ====================
//
// Логика:
//  - блокировка продлевается (heartbeat) только при РЕАЛЬНЫХ действиях пользователя
//    (клики, клавиши, скролл — движения мыши НЕ считаются);
//  - heartbeat отправляется не чаще одного раза в HEARTBEAT_MIN_INTERVAL;
//  - если пользователь молчит INACTIVITY_RELEASE_TIME (5 минут), приложение само
//    снимает блокировку и переходит в режим «только чтение»;
//  - сервер независимо чистит протухший lock.json (нет активности > 5 минут).

let lastActivityTime = Date.now();
let releaseTimeout: ReturnType<typeof setTimeout> | null = null;
let onReleaseCallback: (() => void) | null = null;
let isHoldingLock = false;
let lastHeartbeatSentAt = 0;

const HEARTBEAT_MIN_INTERVAL = 60 * 1000; // не чаще раза в минуту
const INACTIVITY_RELEASE_TIME = 5 * 60 * 1000; // 5 минут без действий — снимаем блокировку

function getCurrentAuthUserId(): string | null {
  const currentUser = getCurrentUser();
  return currentUser?.id || null;
}

// Отправить heartbeat: обновить таймер блокировки на сервере
async function sendHeartbeat() {
  const authUserId = getCurrentAuthUserId();
  if (!authUserId) return;

  try {
    const response = await fetch(`${API_BASE}/lock/extend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: authUserId })
    });
    if (response.ok) {
      isHoldingLock = true;
    } else {
      // Блокировка больше наша (сервер снял её или занял другой) — выходим из режима записи
      isHoldingLock = false;
      if (onReleaseCallback) onReleaseCallback();
    }
  } catch (error) {
    console.error('Ошибка extendLock:', error);
  }
}

// Обновление времени последней активности (клик/клавиша/скролл)
export function updateActivity() {
  lastActivityTime = Date.now();

  // Сбрасываем таймер снятия блокировки
  if (releaseTimeout) {
    clearTimeout(releaseTimeout);
    releaseTimeout = null;
  }

  // Продлеваем блокировку (с троттлингом)
  if (Date.now() - lastHeartbeatSentAt >= HEARTBEAT_MIN_INTERVAL) {
    lastHeartbeatSentAt = Date.now();
    sendHeartbeat();
  }

  startInactivityTimer();
}

// Запуск таймера неактивности: через 5 минут без ДЕЙСТВИЙ снимаем блокировку
function startInactivityTimer() {
  releaseTimeout = setTimeout(async () => {
    await releaseLock();
    isHoldingLock = false;
    if (onReleaseCallback) {
      onReleaseCallback();
    }
  }, INACTIVITY_RELEASE_TIME);
}

// Установка callback для снятия блокировки из-за неактивности
export function setReleaseCallback(callback: () => void) {
  onReleaseCallback = callback;
}

// Начало отслеживания активности.
// events — список событий, которые считаются «действием пользователя».
// По умолчанию: клики, клавиши, скролл, тач. ДВИЖЕНИЯ МЫШИ НЕ СЧИТАЮТСЯ.
export function startActivityTracking(events: string[] = ['mousedown', 'keydown', 'scroll', 'touchstart']) {
  events.forEach(event => {
    window.addEventListener(event, updateActivity, { passive: true });
  });

  // Инициализация таймеров
  updateActivity();
}

// Остановка отслеживания активности
export function stopActivityTracking() {
  if (releaseTimeout) {
    clearTimeout(releaseTimeout);
    releaseTimeout = null;
  }
}

// Явно занять блокировку при старте приложения (сразу БЛОКИРУЕМ, если свободно).
// Возвращает true, если блокировка наша (режим записи),
// false — если её держит другой пользователь (режим только чтение).
export async function acquireLockOnStart(): Promise<boolean> {
  const currentUser = getCurrentUser();
  if (!currentUser) return false;

  try {
    const result = await checkLockStatus();
    if (result.locked && result.lockInfo && result.lockInfo.userId !== currentUser.id) {
      return false; // чужая активная блокировка
    }
    // Свободно или наша — занимаем/продлеваем
    lastHeartbeatSentAt = Date.now();
    await sendHeartbeat();
    return isHoldingLock;
  } catch (error) {
    console.error('Ошибка acquireLockOnStart:', error);
    return false;
  }
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

// ==================== Освобождение блокировки при выходе ====================
//
// ВАЖНО: блокировка снимается ТОЛЬКО при осознанном «Выходе» из приложения
// (кнопка «Выход»). Никаких release по beforeunload/pagehide/visibilitychange:
// раньше именно из-за таких обработчиков файл блокировки очищался при каждом
// перерисовывании/размонтировании экрана авторизации, хотя пользователь ничего
// не завершал. Если приложение закрылось или упало без выхода — замок просто
// протухнет на сервере через 5 минут без активности (см. server.js).

// Явно освободить блокировку (только по кнопке «Выход») и остановить трекинг.
// Флаг: держим ли мы блокировку прямо сейчас (для store/App)
export function isHoldingLockFlag(): boolean {
  return isHoldingLock;
}

export async function releaseLockOnLogout(): Promise<void> {
  stopActivityTracking();
  await releaseLock();
}

// Инициализация сессии после успешного входа (вызывается из AppContent,
// когда StoreProvider уже смонтирован). Занимает блокировку по схеме:
//  - нет записи в lock.json -> сразу БЛОКИРУЕМ (создаём запись), режим записи;
//  - запись есть и наша    -> обновляем таймер блокировки, режим записи;
//  - запись чужая          -> НЕ ТРОГАЕМ файл блокировки, режим только чтение.
// Возвращает true, если блокировка наша.
export async function initSessionAfterLogin(): Promise<boolean> {
  installServerDownWatchdog();

  const acquired = await acquireLockOnStart();
  if (acquired) {
    // перезапускаем таймер неактивности для новой сессии
    updateActivity();
  }
  return acquired;
}

// Страховой watchdog: если во время работы приложения сервер недоступен
// (например, его перезапускают), heartbeat-продления падают и сервер, очнувшись,
// очистит наш замок как протухший. Как только сервер снова начнёт отвечать,
// мы автоматически заново занимаем блокировку (сервер к тому моменту сам
// очистит протухший файл — просить его об этом отдельно не нужно).
let serverWasDown = false;
let watchdogInstalled = false;

function installServerDownWatchdog() {
  if (watchdogInstalled) return;
  watchdogInstalled = true;

  setInterval(async () => {
    try {
      const response = await fetch(`${API_BASE}/lock`);
      if (!response.ok) return;

      if (serverWasDown) {
        serverWasDown = false;
        const currentUser = getCurrentUser();
        if (currentUser) {
          const status = await checkLockStatus();
          const ours = status.locked && status.lockInfo?.userId === currentUser.id;
          if (!ours) {
            lastHeartbeatSentAt = Date.now();
            await sendHeartbeat();
          }
        }
      }
    } catch {
      serverWasDown = true;
    }
  }, 10 * 1000);
}
