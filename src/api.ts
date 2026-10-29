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
//  - блокировка продлевается (heartbeat) при РЕАЛЬНЫХ действиях пользователя
//    (клики, клавиши, скролл — движения мыши НЕ считаются);
//  - пока пользователь авторизован и держит замок, heartbeat отправляется
//    также фоновым таймером каждые HEARTBEAT_INTERVAL_MS. Это исключает
//    «мигание» блокировки: раньше замок держался несколько секунд и слетал,
//    потому что сервер считал его протухшим, а клиент продлевал редко;
//  - если пользователь молчит INACTIVITY_RELEASE_TIME (5 минут), приложение
//    само снимает блокировку и переходит в режим «только чтение»;
//  - сервер независимо чистит протухший lock.json (нет активности > 5 минут);
//  - сетевые сбои НЕ считаются потерей блокировки: ошибка fetch не приводит
//    к read-only, решение принимает только реальный статус с сервера (403).

let releaseTimeout: ReturnType<typeof setTimeout> | null = null;
let lastActivitySeenAt = Date.now();
let onReleaseCallback: (() => void) | null = null;
let isHoldingLock = false;
let lastHeartbeatSentAt = 0;
let heartbeatIntervalId: ReturnType<typeof setInterval> | null = null;

const HEARTBEAT_MIN_INTERVAL = 15 * 1000; // не чаще раза в 15 секунд
const HEARTBEAT_INTERVAL_MS = 60 * 1000;  // фоновый heartbeat: раз в минуту
const INACTIVITY_RELEASE_TIME = 5 * 60 * 1000; // 5 минут без действий — снимаем блокировку
const LOCK_STALE_MS = 7 * 60 * 1000; // столько же, сколько даёт сервер (5 мин + запас на часы/сети)

function getCurrentAuthUserId(): string | null {
  const currentUser = getCurrentUser();
  return currentUser?.id || null;
}

// Отправить heartbeat: обновить таймер блокировки на сервере.
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
    } else if (response.status === 403) {
      // Сервер явно сказал: замок не наш (снят или занят другим) — выходим из режима записи
      isHoldingLock = false;
      let lockInfo: any = null;
      try { lockInfo = (await response.json()).lockInfo ?? null; } catch {}
      if (lockLostCallback) lockLostCallback(lockInfo);
      if (onReleaseCallback) onReleaseCallback();
    }
    // Другие статусы (5xx и т.п.) — временная проблема сервера, блокировку НЕ рвём
  } catch (error) {
    // Сеть недоступна — это НЕ мгновенная потеря блокировки: кратковременные сбои
    // не должны ронять режим записи (раньше из-за этого замок «мигал»).
    // Но если продлить замок не удаётся дольше LOCK_STALE_MS, считаем, что сервер
    // уже очистил наш протухший файл, и отпускаем режим записи.
    console.error('Ошибка extendLock:', error);
    if (Date.now() - lastHeartbeatSentAt > LOCK_STALE_MS) {
      isHoldingLock = false;
      if (lockLostCallback) lockLostCallback(null);
      if (onReleaseCallback) onReleaseCallback();
    }
  }
}

// Обновление времени последней активности (клик/клавиша/скролл)
export function updateActivity() {
  lastActivitySeenAt = Date.now();
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
    if (lockLostCallback) lockLostCallback(null);
    if (onReleaseCallback) {
      onReleaseCallback();
    }
  }, INACTIVITY_RELEASE_TIME);
}

// Фоновый heartbeat: держит замок живым, пока открыто приложение и пользователь
// авторизован. Останавливается при выходе/размонтировании экрана.
function startHeartbeatInterval() {
  stopHeartbeatInterval();
  heartbeatIntervalId = setInterval(() => {
    if (!getCurrentAuthUserId()) return;
    lastHeartbeatSentAt = Date.now();
    sendHeartbeat();
  }, HEARTBEAT_INTERVAL_MS);
}

function stopHeartbeatInterval() {
  if (heartbeatIntervalId) {
    clearInterval(heartbeatIntervalId);
    heartbeatIntervalId = null;
  }
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
  startHeartbeatInterval();
}

// Остановка отслеживания активности
export function stopActivityTracking() {
  if (releaseTimeout) {
    clearTimeout(releaseTimeout);
    releaseTimeout = null;
  }
  stopHeartbeatInterval();
  window.removeEventListener('mousedown', updateActivity);
  window.removeEventListener('keydown', updateActivity);
  window.removeEventListener('scroll', updateActivity);
  window.removeEventListener('touchstart', updateActivity);
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
    if (!isHoldingLock) {
      // Первая попытка могла сорваться из-за кратковременного сетевого сбоя —
      // повторяем один раз, чтобы старт не уходил ложно в read-only.
      await new Promise(r => setTimeout(r, 500));
      await sendHeartbeat();
    }
    if (isHoldingLock) {
      if (lockAcquiredCallback) lockAcquiredCallback();
    } else if (result.locked && result.lockInfo && lockLostCallback) {
      lockLostCallback(result.lockInfo);
    }
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
    return { locked: false, lockInfo: null }
  }
}

// ==================== Централизованный статус блокировки ====================
//
// Единый источник правды для App/store о том, что происходит с замком.
// Раньше App сам решал «зайти/выйти из read-only» по 5-секундным опросам store,
// а api.ts — по heartbeat-ответам; эти два контура противоречили друг другу и
// блокировка «мигала» (несколько секунд держится — слетает). Теперь решение
// принимает только api.ts:
//  - onLockLost(инфо) -> чужой активный замок подтверждён: включаем read-only;
//  - onLockAcquired() -> замок наш (свободен был или протух и мы заняли): снимаем read-only.

let lockLostCallback: ((lockInfo: any) => void) | null = null;
let lockAcquiredCallback: (() => void) | null = null;

export function setLockLostCallback(cb: (lockInfo: any) => void) {
  lockLostCallback = cb;
}

export function setLockAcquiredCallback(cb: () => void) {
  lockAcquiredCallback = cb;
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
    // перезапускаем таймеры для новой сессии
    updateActivity();
    startHeartbeatInterval();
  }
  return acquired;
}

// Страховой watchdog (фоновая самозащита блокировки).
// Периодически спрашивает сервер о состоянии замка и действует по результату:
//  - замок свободен или протух (сервер сам очистил файл) -> просим сервер занять
//    его заново (это и есть «попросить сервер очистить/переписать файл»);
//  - замок наш -> ничего не делаем (его продлевает heartbeat);
//  - замок чужой и держится ПОДРЯД несколько проверок -> переходим в read-only.
// ВАЖНО: разовые сбои сети/сервера НЕ считаются потерей блокировки — иначе
// блокировка «мигает». Статус «чужой» должен подтвердиться CHECK_STRIKES
// проверками подряд, прежде чем приложение отпустит режим записи.
const LOCK_CHECK_INTERVAL_MS = 5 * 1000;   // проверка статуса каждые 5 секунд
const CHECK_STRIKES = 3;                    // чужой замок должен продержаться ~15 сек подряд

let watchdogInstalled = false;
let foreignStrikes = 0;

function installServerDownWatchdog() {
  if (watchdogInstalled) return;
  watchdogInstalled = true;

  setInterval(async () => {
    const currentUser = getCurrentUser();
    if (!currentUser) return;

    let status: { locked: boolean; lockInfo: any };
    try {
      const response = await fetch(`${API_BASE}/lock`);
      if (!response.ok) return; // временная проблема сервера — блокировку НЕ рвём
      status = await response.json();
    } catch {
      return; // сеть недоступна — ждём восстановления, статус не меняем
    }

    const ours = status.locked && status.lockInfo?.userId === currentUser.id;

    if (ours) {
      if (!isHoldingLock) {
        isHoldingLock = true;
        if (lockAcquiredCallback) lockAcquiredCallback();
      }
      foreignStrikes = 0;
      return;
    }

    if (!status.locked) {
      // Замок свободен (сервер снял наш протухший файл или держатель вышел).
      // Занимаем его заново, ТОЛЬКО если пользователь сейчас активен:
      // иначе мы бы бесконечно перезахватывали замок у спящего клиента,
      // который сам его отпустил по неактивности.
      foreignStrikes = 0;
      const recentlyActive = Date.now() - lastActivitySeenAt < INACTIVITY_RELEASE_TIME;
      if (recentlyActive && !isHoldingLock) {
        lastHeartbeatSentAt = Date.now();
        await sendHeartbeat();
        if (isHoldingLock && lockAcquiredCallback) lockAcquiredCallback();
      } else if (isHoldingLock) {
        // Файла нет, хотя мы думаем, что держим — сервер его снял; отпускаем режим записи
        isHoldingLock = false;
        if (lockLostCallback) lockLostCallback(null);
        if (onReleaseCallback) onReleaseCallback();
      }
      return;
    }

    // Чужой активный замок: считаем страйки, read-only только после подтверждения
    foreignStrikes++;
    if (foreignStrikes >= CHECK_STRIKES && isHoldingLock) {
      isHoldingLock = false;
      if (lockLostCallback) lockLostCallback(status.lockInfo);
      if (onReleaseCallback) onReleaseCallback();
    }
  }, LOCK_CHECK_INTERVAL_MS);
}
