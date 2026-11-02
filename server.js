import express from 'express';
import cors from 'cors';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Middleware для обработки sendBeacon (отправляет text/plain)
app.use((req, res, next) => {
  if (req.method === 'POST' && !req.body && req.headers['content-type']?.includes('text/plain')) {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      try {
        req.body = JSON.parse(data);
      } catch (e) {
        req.body = {};
      }
      next();
    });
  } else {
    next();
  }
});

// Путь к файлу данных
const DATA_FILE = path.join(__dirname, 'data.json');
const LOCK_FILE = path.join(__dirname, 'lock.json');
const USERS_FILE = path.join(__dirname, 'users.json');

console.log('📁 Путь к файлу данных:', DATA_FILE);
console.log('📁 Путь к файлу блокировки:', LOCK_FILE);
console.log('📁 Путь к файлу пользователей:', USERS_FILE);

// Простое хеширование пароля (для продакшена использовать bcrypt)
function hashPassword(password) {
  let hash = 0;
  for (let i = 0; i < password.length; i++) {
    const char = password.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString(36);
}

// Инициализация файла пользователей
async function initUsersFile() {
  try {
    await fs.access(USERS_FILE);
    console.log('✅ Файл users.json найден');
  } catch {
    console.log('📝 Создаю новый файл users.json...');
    await fs.writeFile(USERS_FILE, JSON.stringify([], null, 2));
    console.log('✅ Файл users.json создан');
  }
}

// Чтение пользователей
async function readUsers() {
  try {
    const data = await fs.readFile(USERS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error('❌ Ошибка чтения пользователей:', error);
    return [];
  }
}

// Запись пользователей
async function writeUsers(users) {
  try {
    await fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2));
    console.log('✅ Пользователи сохранены');
  } catch (error) {
    console.error('❌ Ошибка записи пользователей:', error);
    throw error;
  }
}

// Инициализация файла данных
async function initDataFile() {
  try {
    await fs.access(DATA_FILE);
    console.log('✅ Файл data.json найден');
  } catch {
    console.log('📝 Создаю новый файл data.json...');
    const initialData = {
      autoRecords: [],
      serviceRecords: [],
      tariffs: [],
      cars: []
    };
    await fs.writeFile(DATA_FILE, JSON.stringify(initialData, null, 2));
    console.log('✅ Файл data.json создан');
  }
}

// Чтение данных
async function readData() {
  try {
    const data = await fs.readFile(DATA_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error('❌ Ошибка чтения данных:', error);
    return { autoRecords: [], serviceRecords: [], tariffs: [], cars: [] };
  }
}

// Запись данных
async function writeData(data) {
  try {
    await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2));
    console.log('✅ Данные сохранены');
  } catch (error) {
    console.error('❌ Ошибка записи данных:', error);
    throw error;
  }
}

// Простейшая очередь, чтобы операции «проверить и записать» выполнялись атомарно
// (иначе два параллельных запроса могут перезаписать блокировку друг друга).
let lockQueue = Promise.resolve();
function withLockQueue(fn) {
  const result = lockQueue.then(fn, fn);
  lockQueue = result.then(() => undefined, () => undefined);
  return result;
}

const LOCK_TTL_MS = 5 * 60 * 1000; // блокировка живёт 5 минут без продления

// Низкоуровневое чтение файла блокировки.
// ВАЖНО: пустой/битый файл НЕ считается свободной блокировкой — такие случаи
// раньше приводили к тому, что lock.json «исчезал», и любой пользователь мог
// захватить чужую блокировку. Теперь битый файл сохраняем как *.corrupt-...
// и считаем блокировку отсутствующей только осознанно, с логом в консоль.
async function readLockFileRaw() {
  let raw;
  try {
    raw = await fs.readFile(LOCK_FILE, 'utf-8');
  } catch (error) {
    if (error.code === 'ENOENT') return { status: 'missing' };
    throw error;
  }

  if (!raw.trim()) {
    console.warn('⚠️ Файл lock.json пуст — сохраняю копию и считаю блокировку отсутствующей');
    try {
      await fs.rename(LOCK_FILE, `${LOCK_FILE}.empty-${Date.now()}`);
    } catch (e) { /* best effort */ }
    return { status: 'corrupt', reason: 'empty' };
  }

  let lock;
  try {
    lock = JSON.parse(raw);
  } catch {
    console.error('❌ Файл lock.json повреждён (невалидный JSON) — сохраняю копию');
    try {
      await fs.rename(LOCK_FILE, `${LOCK_FILE}.corrupt-${Date.now()}`);
    } catch (e) { /* best effort */ }
    return { status: 'corrupt', reason: 'invalid-json' };
  }

  if (!lock || typeof lock.userId !== 'string') {
    console.error('❌ В lock.json нет поля userId — файл повреждён, сохраняю копию');
    try {
      await fs.rename(LOCK_FILE, `${LOCK_FILE}.corrupt-${Date.now()}`);
    } catch (e) { /* best effort */ }
    return { status: 'corrupt', reason: 'no-user-id' };
  }

  return { status: 'ok', lock };
}

// Проверка блокировки (не трогает файлов, кроме удаления явно просроченных)
async function checkLock() {
  const res = await readLockFileRaw();
  if (res.status !== 'ok') return null;

  const expiresAt = new Date(res.lock.expiresAt);
  // Если expiresAt повреждён — считаем блокировку бессрочной, чтобы случайно
  // не отдать чужие данные первому подключившемуся.
  if (!isNaN(expiresAt.getTime()) && expiresAt < new Date()) {
    console.log('⏰ Блокировка истекла, удаляю...');
    await fs.unlink(LOCK_FILE).catch(() => {});
    return null;
  }

  return res.lock;
}

// Установка блокировки. Возвращает true/false либо строку 'conflict',
// если за время проверки блокировку успел занять другой пользователь.
// allowTakeover=true — это stale-запрос (продление/освобождение «своей»
// блокировки): создавать блокировку заново в этом случае нельзя.
async function acquireLock(userId, computerName, { allowTakeover = false } = {}) {
  return withLockQueue(async () => {
    const res = await readLockFileRaw();

    if (res.status === 'ok') {
      const existing = res.lock;
      const expiresAt = new Date(existing.expiresAt);
      const expired = !isNaN(expiresAt.getTime()) && expiresAt < new Date();

      // Чужая НЕпросроченная блокировка — отказ (или 'conflict', если это
      // устаревший запрос, пришедший после того, как файл занял другой).
      if (!expired && existing.userId !== userId) {
        console.log('🔒 Попытка блокировки отклонена - уже заблокировано другим пользователем');
        return allowTakeover ? 'conflict' : false;
      }
    } else if (allowTakeover) {
      // Это stale-запрос продления/освобождения: на момент проверки блокировка
      // принадлежала нам, а сейчас файла нет или он повреждён. Не создаём её заново.
      return 'conflict';
    }

    const lock = {
      userId,
      computerName,
      lockedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + LOCK_TTL_MS).toISOString()
    };

    // wx = создать только если файла нет. Если гонка всё же случилась —
    // перечитаем и честно откажем вместо перезаписи чужой блокировки.
    try {
      await fs.writeFile(LOCK_FILE, JSON.stringify(lock, null, 2), { flag: 'wx' });
    } catch (error) {
      if (error.code === 'EEXIST') {
        const current = await readLockFileRaw();
        if (current.status === 'ok' && current.lock.userId !== userId) {
          console.log('🔒 Гонка при установке блокировки - победил другой пользователь');
          return 'conflict';
        }
        await fs.writeFile(LOCK_FILE, JSON.stringify(lock, null, 2));
      } else {
        throw error;
      }
    }

    console.log(`🔒 Блокировка установлена: ${computerName} (${userId})`);
    return true;
  });
}

// Освобождение блокировки (только своим владельцем)
async function releaseLock(userId) {
  return withLockQueue(async () => {
    const lock = await checkLock();
    if (lock && lock.userId === userId) {
      await fs.unlink(LOCK_FILE).catch(() => {});
      console.log('🔓 Блокировка освобождена');
      return true;
    }
    if (lock) {
      console.log('🚫 Попытка освободить чужую блокировку отклонена');
    }
    return false;
  });
}

// ==================== API Endpoints ====================

// ==================== Авторизация ====================

// Регистрация нового пользователя
app.post('/api/auth/register', async (req, res) => {
  console.log('📝 POST /api/auth/register');
  const { username, password, displayName } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: 'Имя пользователя и пароль обязательны' });
  }
  
  const users = await readUsers();
  
  // Проверяем, существует ли пользователь
  if (users.find(u => u.username === username)) {
    return res.status(400).json({ error: 'Пользователь с таким именем уже существует' });
  }
  
  // Создаём нового пользователя
  const newUser = {
    id: Date.now().toString(36),
    username,
    passwordHash: hashPassword(password),
    displayName: displayName || username,
    createdAt: new Date().toISOString()
  };
  
  users.push(newUser);
  await writeUsers(users);
  
  console.log(`✅ Пользователь зарегистрирован: ${username}`);
  
  // Возвращаем токен (простой - на основе id)
  const token = newUser.id;
  res.json({ 
    success: true, 
    token,
    user: { 
      id: newUser.id, 
      username: newUser.username, 
      displayName: newUser.displayName 
    }
  });
});

// Вход пользователя
app.post('/api/auth/login', async (req, res) => {
  console.log('🔐 POST /api/auth/login');
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: 'Имя пользователя и пароль обязательны' });
  }
  
  const users = await readUsers();
  const user = users.find(u => u.username === username);
  
  if (!user) {
    return res.status(401).json({ error: 'Пользователь не найден' });
  }
  
  if (user.passwordHash !== hashPassword(password)) {
    return res.status(401).json({ error: 'Неверный пароль' });
  }
  
  console.log(`✅ Пользователь вошёл: ${username}`);
  
  const token = user.id;
  res.json({ 
    success: true, 
    token,
    user: { 
      id: user.id, 
      username: user.username, 
      displayName: user.displayName 
    }
  });
});

// Выход пользователя
app.post('/api/auth/logout', async (req, res) => {
  const { token } = req.body;
  console.log(`🚪 POST /api/auth/logout: ${token}`);
  
  // Освобождаем блокировку если она есть (и она принадлежит этому же пользователю)
  if (token) {
    await releaseLock(token);
  }
  
  res.json({ success: true });
});

// Проверка токена по заголовку Authorization: Bearer <token>.
// Используется защищёнными эндпоинтами блокировки и данных.
async function verifyUserByToken(headerValue) {
  if (!headerValue) return null;
  const token = headerValue.startsWith('Bearer ') ? headerValue.slice(7).trim() : headerValue.trim();
  if (!token) return null;
  const users = await readUsers();
  return users.find(u => u.id === token) || null;
}

// Получить список пользователей (для отображения)
app.get('/api/auth/users', async (req, res) => {
  const users = await readUsers();
  const userList = users.map(u => ({
    id: u.id,
    username: u.username,
    displayName: u.displayName
  }));
  res.json(userList);
});

// Проверка токена
app.get('/api/auth/verify', async (req, res) => {
  const { token } = req.query;
  
  if (!token) {
    return res.status(401).json({ valid: false });
  }
  
  const users = await readUsers();
  const user = users.find(u => u.id === token);
  
  if (!user) {
    return res.status(401).json({ valid: false });
  }
  
  res.json({ 
    valid: true,
    user: { 
      id: user.id, 
      username: user.username, 
      displayName: user.displayName 
    }
  });
});

// ==================== Данные ====================

// Получить все данные
app.get('/api/data', async (req, res) => {
  console.log('📥 GET /api/data');
  const data = await readData();
  res.json(data);
});

// Обновить все данные
app.post('/api/data', async (req, res) => {
  console.log('📤 POST /api/data');
  const { userId, computerName, data } = req.body;
  
  if (!userId || !computerName) {
    console.log('❌ Ошибка: userId и computerName обязательны');
    return res.status(400).json({ error: 'userId и computerName обязательны' });
  }

  // Сохранять данные может только авторизованный пользователь.
  // Это закрывает дыру, когда клиент присылал анонимный id из localStorage
  // и «перехватывал» чужую блокировку.
  const authUser = await verifyUserByToken(req.headers.authorization);
  if (!authUser) {
    console.log('🚫 POST /api/data без валидного токена — отклонено');
    return res.status(401).json({ error: 'Требуется авторизация' });
  }
  if (authUser.id !== userId) {
    console.log(`🚫 userId в запросе (${userId}) не совпадает с токеном (${authUser.id})`);
    return res.status(403).json({ error: 'Несовпадение пользователя и токена' });
  }
  
  // Пытаемся установить блокировку (атомарно: проверка + запись под очередью)
  const locked = await acquireLock(authUser.id, computerName);
  if (locked !== true) {
    const existingLock = await checkLock();
    console.log('🔒 Данные заблокированы другим пользователем');
    return res.status(403).json({ 
      error: 'Данные заблокированы другим пользователем',
      lockInfo: existingLock
    });
  }
  
  try {
    await writeData(data);
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Ошибка сохранения:', error);
    res.status(500).json({ error: 'Ошибка сохранения данных' });
  }
});

// Получить информацию о блокировке
app.get('/api/lock', async (req, res) => {
  console.log('🔍 GET /api/lock');
  const lock = await checkLock();
  res.json({ locked: !!lock, lockInfo: lock });
});

// Освободить блокировку
app.post('/api/lock/release', async (req, res) => {
  console.log('🔓 POST /api/lock/release', { body: req.body, headers: req.headers['content-type'] });
  const { userId } = req.body;
  
  if (!userId) {
    console.log('❌ userId не указан в запросе');
    return res.status(400).json({ error: 'userId обязателен' });
  }

  // Сверяем с токеном: без него освобождение возможно только если userId
  // действительно является id зарегистрированного пользователя (см. releaseLock —
  // чужую блокировка всё равно не снимется).
  const authUser = await verifyUserByToken(req.headers.authorization);
  if (authUser && authUser.id !== userId) {
    console.log(`🚫 Попытка снять чужую блокировку: userId=${userId}, токен=${authUser.id}`);
    return res.status(403).json({ error: 'Несовпадение пользователя и токена' });
  }
  
  console.log(`🔓 Освобождаю блокировку для userId: ${userId}`);
  await releaseLock(userId);
  res.json({ success: true });
});

// Продлить блокировку
app.post('/api/lock/extend', async (req, res) => {
  const { userId } = req.body;
  
  if (!userId) {
    return res.status(400).json({ error: 'userId обязателен' });
  }

  const authUser = await verifyUserByToken(req.headers.authorization);
  if (authUser && authUser.id !== userId) {
    return res.status(403).json({ error: 'Несовпадение пользователя и токена' });
  }
  
  const result = await withLockQueue(async () => {
    const lock = await checkLock();
    if (lock && lock.userId === userId) {
      // Перезаписываем ТОЛЬКО expiresAt, остальное берём из файла,
      // чтобы нельзя было «продлением» подменить владельца блокировки.
      lock.expiresAt = new Date(Date.now() + LOCK_TTL_MS).toISOString();
      await fs.writeFile(LOCK_FILE, JSON.stringify(lock, null, 2));
      console.log('⏰ Блокировка продлена');
      return { ok: true };
    }
    if (!lock) {
      // Файл уже удалили (истёк/закрыли вкладку) или он повреждён.
      // НЕ создаём блокировку заново — иначе можно перехватить её у того,
      // кто успел занять файл между проверками.
      return { ok: false, reason: 'lost' };
    }
    return { ok: false, reason: 'other', lock };
  });

  if (result.ok) {
    res.json({ success: true });
  } else if (result.reason === 'lost') {
    res.status(410).json({ error: 'Блокировка больше не активна' });
  } else {
    res.status(403).json({ 
      error: 'Блокировка принадлежит другому пользователю',
      lockInfo: result.lock
    });
  }
});

// ==================== Сервис: бэкапы данных (/service) ====================
// Резервные копии data.json хранятся в папке backups/ рядом с файлом данных.
// Страница доступна по адресу http://<ip-сервера>/service из локальной сети.

const BACKUP_DIR = path.join(__dirname, 'backups');

// Приватная сеть не имеет стандартного определения; под «локальной сетью» здесь
// понимаются частные диапазоны RFC1918 + loopback. При необходимости список можно
// расширить переменной окружения BACKUP_ALLOWED_SUBNETS, перечислив сети в формате
// "база/маска" через запятую, например: 192.168.77.0/255.255.255.0,10.10.0.0/255.0.0.0
const LAN_RANGES = [
  { mask: '255.0.0.0', base: '10.0.0.0' },        // 10.0.0.0/8
  { mask: '255.240.0.0', base: '172.16.0.0' },    // 172.16.0.0/12
  { mask: '255.255.0.0', base: '192.168.0.0' },   // 192.168.0.0/16
];
for (const entry of (process.env.BACKUP_ALLOWED_SUBNETS || '').split(',')) {
  const [base, mask] = entry.trim().split('/');
  if (base && mask) LAN_RANGES.push({ base, mask });
}

function toInt(ip) {
  const p = ip.split('.').map(Number);
  return ((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0;
}

function inLan(ip) {
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return false;
  const n = toInt(ip);
  return LAN_RANGES.some(r => (n & toInt(r.mask)) === toInt(r.base));
}

// Доступ к сервису бэкапов: только из локальной сети (loopback + частные диапазоны)
function isLanRequest(req) {
  let raw = (req.ip || req.socket?.remoteAddress || '').replace('::ffff:', '');
  if (raw === '::1' || raw === '127.0.0.1') return true; // loopback по любому IP
  if (raw === '::' || raw.startsWith(':')) return false; // прочие IPv6 считаем внешними
  return inLan(raw);
}

// Промежуточный обработчик: закрывает сервисные маршруты для внешних хостов
// (сравнение по префиксу — чтобы /service.html тоже попадал под проверку)
app.use((req, res, next) => {
  const isBackupApi = req.path === '/api/backup' || req.path.startsWith('/api/backup/');
  const isServicePage = req.path === '/service' || req.path.startsWith('/service.');
  if ((isBackupApi || isServicePage) && !isLanRequest(req)) {
    return res.status(403).json({ error: 'Доступ к сервису бэкапов возможен только из локальной сети' });
  }
  next();
});

async function ensureBackupDir() {
  await fs.mkdir(BACKUP_DIR, { recursive: true });
}

// Имя файла бэкапа формируется ТОЛЬКО сервером при создании; id от клиента
// сверяется по строгому шаблону с записями индекса (защита от path traversal).
const BACKUP_ID_RE = /^[A-Za-z0-9_-]+$/;

async function readBackupIndex() {
  try {
    const raw = await fs.readFile(path.join(BACKUP_DIR, 'index.json'), 'utf-8');
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

async function writeBackupIndex(list) {
  await fs.writeFile(path.join(BACKUP_DIR, 'index.json'), JSON.stringify(list, null, 2));
}

// ---------- Настройки автоматического бэкапа ----------
// Хранятся в backups/settings.json. autoTime — время «HH:MM» (локальное),
// autoKeepCount — сколько бэкапов хранить (старые удаляются автоматически).
const BACKUP_SETTINGS_FILE = path.join(BACKUP_DIR, 'settings.json');
const DEFAULT_BACKUP_SETTINGS = {
  autoEnabled: true,   // ежедневный автобэкап по умолчанию включён
  autoTime: '03:00',   // время создания (ЧЧ:ММ, локальный часовой пояс сервера)
  keepCount: 7,        // количество хранимых бэкапов (автоудаление сверх этого числа)
};

function normalizeBackupSettings(raw) {
  const s = { ...DEFAULT_BACKUP_SETTINGS, ...(raw && typeof raw === 'object' ? raw : {}) };
  if (typeof s.autoEnabled !== 'boolean') s.autoEnabled = !!s.autoEnabled;
  if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(String(s.autoTime || ''))) s.autoTime = DEFAULT_BACKUP_SETTINGS.autoTime;
  let k = parseInt(s.keepCount, 10);
  if (!Number.isFinite(k)) k = DEFAULT_BACKUP_SETTINGS.keepCount;
  s.keepCount = Math.min(Math.max(k, 1), 1000);
  return s;
}

async function readBackupSettings() {
  try {
    const raw = await fs.readFile(BACKUP_SETTINGS_FILE, 'utf-8');
    return normalizeBackupSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_BACKUP_SETTINGS };
  }
}

async function writeBackupSettings(settings) {
  await ensureBackupDir();
  const s = normalizeBackupSettings(settings);
  await fs.writeFile(BACKUP_SETTINGS_FILE, JSON.stringify(s, null, 2));
  return s;
}

let backupSettingsCache = { ...DEFAULT_BACKUP_SETTINGS };

// Автоудаление старых бэкапов на основе настройки keepCount.
// Удаляются самые старые записи индекса (сортировка по createdAt),
// при этом бэкапы с пометкой «перед восстановлением» считаются страховочными,
// но под правило хранения тоже попадают — иначе папка разрасталась бы бесконечно.
async function enforceBackupRetention() {
  const settings = backupSettingsCache;
  const list = await readBackupIndex();
  if (list.length <= settings.keepCount) return [];
  const sorted = [...list].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  const toRemove = sorted.slice(0, list.length - settings.keepCount);
  const removeIds = new Set(toRemove.map(e => e.id));
  for (const e of toRemove) {
    await fs.unlink(path.join(BACKUP_DIR, e.filename)).catch(() => {});
    console.log(`🗑 Автоудаление старого бэкапа: ${e.filename}`);
  }
  const kept = list.filter(e => !removeIds.has(e.id));
  await writeBackupIndex(kept);
  return toRemove;
}

// Создать бэкап текущего data.json. Возвращает запись индекса или null,
// если файла данных нет.
async function createBackupInternal(note) {
  let stat;
  try {
    stat = await fs.stat(DATA_FILE);
  } catch {
    return null;
  }
  await ensureBackupDir();
  const id = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  const filename = `data-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  await fs.copyFile(DATA_FILE, path.join(BACKUP_DIR, filename));

  let records = null;
  try {
    const data = await readData();
    records = ['autoRecords', 'serviceRecords', 'tariffs', 'cars']
      .reduce((s, k) => s + (Array.isArray(data[k]) ? data[k].length : 0), 0);
  } catch { /* не критично */ }

  const entry = {
    id,
    filename,
    note: typeof note === 'string' ? note.slice(0, 120) : '',
    createdAt: new Date().toISOString(),
    sizeBytes: stat.size,
    records,
  };
  const list = await readBackupIndex();
  list.unshift(entry);
  await writeBackupIndex(list);
  console.log(`💾 Бэкап создан: ${filename}${entry.note ? ` (${entry.note})` : ''}`);
  // Автоудаление старых бэкапов в соответствии с настройкой количества хранимых копий
  await enforceBackupRetention().catch(e => console.error('❌ Ошибка автоочистки бэкапов:', e));
  return entry;
}

// Список бэкапов (+ актуальные размеры файлов на диске)
async function listBackups() {
  const list = await readBackupIndex();
  const out = [];
  for (const item of list) {
    try {
      const st = await fs.stat(path.join(BACKUP_DIR, item.filename));
      out.push({ ...item, sizeBytes: st.size });
    } catch {
      // файл удалён вручную — пропускаем запись и чистим индекс
    }
  }
  return out;
}

// ---------- Планировщик ежедневного автобэкапа ----------
// Проверка каждые 30 секунд: если включён автобэкап, локальное время достигло
// настроенной отметки ЧЧ:ММ и в этом «окне срабатывания» автобэкапа ещё не было —
// создаём его. В одни сутки создаётся ровно один бэкап — таково условие задачи
// («бэкап создается каждый день в определенное время»). Окно срабатывания
// привязано к конкретной дате и времени (ключ вида 2026-11-02T03:00), поэтому:
//  - перенос времени на более раннее в тот же день НЕ вызывает второй бэкап
//    (это защита от случайного/злонамеренного флуда — иначе каждое изменение
//    времени сразу плодило бы копию);
//  - следующий бэкап — в следующее срабатывание расписания (на следующий день
//    либо позже в тот же день, если время ещё не наступило).
// Ключ последнего срабатывания хранится в памяти и на диске (lastAuto.json),
// чтобы сервер после перезапуска не создавал повторную копию за те же сутки.
let autoBackupTimer = null;
let lastAutoTriggerKey = null; // ключ окна срабатывания: YYYY-MM-DDTHH:MM (локальное время)
let lastAutoBackupAt = null;   // ISO-время последнего автобэкапа (для отображения в UI)

const AUTO_TRIGGER_FILE = 'lastAuto.json';

async function readLastAutoState() {
  let triggerKey = null;
  let at = null;
  try {
    const raw = await fs.readFile(path.join(BACKUP_DIR, AUTO_TRIGGER_FILE), 'utf-8');
    const j = JSON.parse(raw);
    if (typeof j?.triggerKey === 'string') triggerKey = j.triggerKey;
    if (typeof j?.at === 'string') at = j.at;
  } catch { /* первый запуск */ }
  // Совместимость со старым форматом файла ({ at }) — восстановим ключ из времени
  if (!triggerKey && at) {
    const d = new Date(at);
    if (!isNaN(d)) triggerKey = `${localDayKey(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  return { triggerKey, at };
}

async function writeLastAutoState(triggerKey, iso) {
  await ensureBackupDir();
  await fs.writeFile(path.join(BACKUP_DIR, AUTO_TRIGGER_FILE), JSON.stringify({ triggerKey, at: iso }));
}

function localDayKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getNextAutoBackupTime() {
  if (!backupSettingsCache.autoEnabled) return null;
  const [h, m] = backupSettingsCache.autoTime.split(':').map(Number);
  const now = new Date();
  const next = new Date(now);
  next.setHours(h, m, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.toISOString();
}

async function checkAutoBackup() {
  if (!backupSettingsCache.autoEnabled) return;
  const now = new Date();
  const [h, m] = backupSettingsCache.autoTime.split(':').map(Number);
  if (now.getHours() !== h || now.getMinutes() !== m) return;

  // Срабатывание привязано к окну «сутки + запланированное время»: одно окно —
  // одна копия. За сутки, соответственно, ровно один автобэкап.
  const triggerKey = `${localDayKey(now)}T${backupSettingsCache.autoTime}`;
  if (triggerKey === lastAutoTriggerKey) return; // это окно уже отработано

  const entry = await createBackupInternal(`авто: ежедневный бэкап ${backupSettingsCache.autoTime}`);
  // Даже если файла данных нет — отмечаем попытку, чтобы не долбить лог каждую минуту
  lastAutoTriggerKey = triggerKey;
  lastAutoBackupAt = new Date().toISOString();
  await writeLastAutoState(triggerKey, lastAutoBackupAt);
  if (entry) console.log(`⏰ Выполнен ежедневный автобэкап (запланировано на ${backupSettingsCache.autoTime})`);
}

function restartAutoBackupScheduler() {
  if (autoBackupTimer) clearInterval(autoBackupTimer);
  autoBackupTimer = setInterval(() => {
    checkAutoBackup().catch(e => console.error('❌ Ошибка автобэкапа:', e));
  }, 30 * 1000);
  // не блокируем завершение процесса таймером
  if (autoBackupTimer.unref) autoBackupTimer.unref();
}

async function initAutoBackup() {
  backupSettingsCache = await readBackupSettings();
  const st = await readLastAutoState();
  lastAutoTriggerKey = st.triggerKey;
  lastAutoBackupAt = st.at;
  restartAutoBackupScheduler();
  // Страховая очистка при старте (например, настройки уменьшили задним числом)
  await enforceBackupRetention().catch(e => console.error('❌ Ошибка автоочистки бэкапов при старте:', e));
  console.log(
    `⏰ Автобэкап: ${backupSettingsCache.autoEnabled ? `каждый день в ${backupSettingsCache.autoTime}, хранение ${backupSettingsCache.keepCount} шт.` : 'выключен'}`
  );
}

// POST /api/backup — создать бэкап
app.post('/api/backup', async (req, res) => {
  try {
    const entry = await createBackupInternal(req.body?.note);
    if (!entry) return res.status(404).json({ error: 'Файл data.json не найден — бэкапить нечего' });
    res.json({ success: true, filename: entry.filename, id: entry.id });
  } catch (error) {
    console.error('❌ Ошибка создания бэкапа:', error);
    res.status(500).json({ error: 'Ошибка создания бэкапа' });
  }
});

// GET /api/backup/list — список бэкапов + сводка по текущим данным
app.get('/api/backup/list', async (req, res) => {
  try {
    const backups = await listBackups();
    let currentSizeBytes = null;
    let currentRecords = null;
    try {
      const st = await fs.stat(DATA_FILE);
      currentSizeBytes = st.size;
      const data = await readData();
      currentRecords = ['autoRecords', 'serviceRecords', 'tariffs', 'cars']
        .reduce((s, k) => s + (Array.isArray(data[k]) ? data[k].length : 0), 0);
    } catch { /* файла ещё нет */ }
    const lock = await checkLock();
    res.json({
      backups,
      currentSizeBytes,
      currentRecords,
      locked: !!lock,
      lockedBy: lock ? lock.computerName : null,
      settings: backupSettingsCache,
      lastAutoBackupAt,
      nextAutoBackupAt: getNextAutoBackupTime(),
    });
  } catch (error) {
    console.error('❌ Ошибка списка бэкапов:', error);
    res.status(500).json({ error: 'Ошибка получения списка бэкапов' });
  }
});

// GET /api/backup/settings — настройки автобэкапа
app.get('/api/backup/settings', async (req, res) => {
  try {
    res.json({
      settings: backupSettingsCache,
      lastAutoBackupAt,
      nextAutoBackupAt: getNextAutoBackupTime(),
    });
  } catch (error) {
    console.error('❌ Ошибка чтения настроек бэкапа:', error);
    res.status(500).json({ error: 'Ошибка чтения настроек' });
  }
});

// PUT /api/backup/settings — сохранить настройки автобэкапа
// Тело: { autoEnabled: bool, autoTime: "HH:MM", keepCount: number }
app.put('/api/backup/settings', async (req, res) => {
  try {
    const body = (req.body && typeof req.body === 'object') ? req.body : {};
    const errors = [];
    if (body.autoTime !== undefined && !/^([01]?\d|2[0-3]):[0-5]\d$/.test(String(body.autoTime))) {
      errors.push('Некорректное время (ожидается ЧЧ:ММ)');
    }
    if (body.keepCount !== undefined) {
      const k = parseInt(body.keepCount, 10);
      if (!Number.isFinite(k) || k < 1 || k > 1000) errors.push('Количество хранимых бэкапов должно быть от 1 до 1000');
    }
    if (errors.length) return res.status(400).json({ error: errors.join('; ') });

    const merged = normalizeBackupSettings({ ...backupSettingsCache, ...body });
    await writeBackupSettings(merged);
    backupSettingsCache = merged;
    restartAutoBackupScheduler(); // пересчитать расписание с новым временем
    // Если уменьшили количество хранимых копий — сразу чистим старые
    const removed = await enforceBackupRetention();
    console.log(`⚙️ Настройки автобэкапа обновлены: ${JSON.stringify(merged)}${removed.length ? ` (автоудалено старых: ${removed.length})` : ''}`);
    res.json({ success: true, settings: backupSettingsCache, removed: removed.length });
  } catch (error) {
    console.error('❌ Ошибка сохранения настроек бэкапа:', error);
    res.status(500).json({ error: 'Ошибка сохранения настроек' });
  }
});

// GET /api/backup/download/:id — скачать один бэкап
app.get('/api/backup/download/:id', async (req, res) => {
  try {
    const list = await readBackupIndex();
    const item = list.find(b => b.id === req.params.id);
    if (!item || !BACKUP_ID_RE.test(item.id)) {
      return res.status(404).json({ error: 'Бэкап не найден' });
    }
    const filePath = path.join(BACKUP_DIR, item.filename);
    if (!filePath.startsWith(BACKUP_DIR + path.sep)) return res.status(400).json({ error: 'Некорректное имя файла' });
    res.download(filePath, item.filename);
  } catch (error) {
    console.error('❌ Ошибка скачивания бэкапа:', error);
    res.status(500).json({ error: 'Ошибка скачивания' });
  }
});

// GET /api/backup/archive.zip — все бэкапы одним архивом
// (простой STORE-метод zip, без внешних зависимостей)
function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xFF];
  return (crc ^ -1) >>> 0;
}

function buildZip(entries) {
  // entries: [{name:string, data:Buffer}]
  const chunks = [];
  const central = [];
  let offset = 0;
  const now = new Date();
  const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xFFFF;
  const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xFFFF;

  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf-8');
    const crc = crc32(e.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);           // version needed
    local.writeUInt16LE(0x0800, 6);       // UTF-8 flag
    local.writeUInt16LE(0, 8);            // method: store
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(e.data.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuf, e.data);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0x0800, 8);
    cen.writeUInt16LE(0, 10);
    cen.writeUInt16LE(dosTime, 12);
    cen.writeUInt16LE(dosDate, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(e.data.length, 20);
    cen.writeUInt32LE(e.data.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([cen, nameBuf]));

    offset += local.length + nameBuf.length + e.data.length;
  }

  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, centralBuf, end]);
}

app.get('/api/backup/archive.zip', async (req, res) => {
  try {
    const list = await listBackups();
    const entries = [];
    for (const b of list) {
      try {
        const data = await fs.readFile(path.join(BACKUP_DIR, b.filename));
        entries.push({ name: b.filename, data });
      } catch { /* пропустить отсутствующий файл */ }
    }
    if (!entries.length) return res.status(404).json({ error: 'Бэкапов нет' });
    const zip = buildZip(entries);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="backups-${new Date().toISOString().slice(0, 10)}.zip"`);
    res.send(zip);
  } catch (error) {
    console.error('❌ Ошибка формирования архива:', error);
    res.status(500).json({ error: 'Ошибка формирования архива' });
  }
});

// POST /api/backup/restore/:id — восстановить данные из бэкапа
app.post('/api/backup/restore/:id', async (req, res) => {
  try {
    const list = await readBackupIndex();
    const item = list.find(b => b.id === req.params.id);
    if (!item) return res.status(404).json({ error: 'Бэкап не найден' });

    // Не даём восстанавливать поверх активной чужой блокировки —
    // иначе изменения работающего пользователя перезапишутся.
    const lock = await checkLock();
    if (lock) {
      return res.status(423).json({
        error: `Сейчас данные заблокированы пользователем «${lock.computerName}». Дождитесь окончания работы или снимите блокировку в приложении.`,
      });
    }

    // Обязательный страховочный бэкап текущих данных перед заменой
    const pre = await createBackupInternal('авто: перед восстановлением из ' + item.filename);

    const src = path.join(BACKUP_DIR, item.filename);
    const tmp = DATA_FILE + '.restoring';
    await fs.copyFile(src, tmp);
    await fs.rename(tmp, DATA_FILE); // атомарная замена файла данных
    console.log(`♻️ Данные восстановлены из бэкапа ${item.filename}`);
    res.json({ success: true, restoredFrom: item.filename, preRestoreBackup: pre ? pre.filename : null });
  } catch (error) {
    console.error('❌ Ошибка восстановления:', error);
    res.status(500).json({ error: 'Ошибка восстановления данных' });
  }
});

// DELETE /api/backup/:id — удалить бэкап
app.delete('/api/backup/:id', async (req, res) => {
  try {
    const list = await readBackupIndex();
    const idx = list.findIndex(b => b.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Бэкап не найден' });
    const item = list[idx];
    await fs.unlink(path.join(BACKUP_DIR, item.filename)).catch(() => {});
    list.splice(idx, 1);
    await writeBackupIndex(list);
    console.log(`🗑 Бэкап удалён: ${item.filename}`);
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Ошибка удаления бэкапа:', error);
    res.status(500).json({ error: 'Ошибка удаления бэкапа' });
  }
});

// Страница сервиса бэкапов (оба адреса: /service и /service.html).
// service.html лежит в корне проекта; на всякий случай проверяем наличие файла
// и отдаём понятную ошибку вместо зависания/404 от SPA-роутера.
// Ищем service.html: сначала рядом с server.js, затем в стандартных местах
// запуска Node (текущая директория процесса, домашняя папка пользователя).
const SERVICE_PAGE_CANDIDATES = [
  path.join(__dirname, 'service.html'),
  path.resolve(process.cwd(), 'service.html'),
  path.join(process.env.USERPROFILE || process.env.HOME || '', 'service.html'),
];
let SERVICE_PAGE_FILE = null;
for (const p of SERVICE_PAGE_CANDIDATES) {
  try {
    await fs.access(p);
    SERVICE_PAGE_FILE = p;
    break;
  } catch {}
}

const sendServicePage = async (req, res) => {
  if (!SERVICE_PAGE_FILE) {
    res.status(500).type('html').send(
      '<h2>Сервис бэкапов недоступен</h2>' +
      `<p>На сервере не найден файл <code>service.html</code>. Искали в: ${SERVICE_PAGE_CANDIDATES.map(p => '<code>' + p + '</code>').join(', ')}. ` +
      'Скопируйте его в папку проекта рядом с <code>server.js</code> и перезапустите сервер.</p>'
    );
    return;
  }
  // Файл мог появиться/обновиться после запуска — перечитываем его при каждом запросе
  try {
    const html = await fs.readFile(SERVICE_PAGE_FILE, 'utf-8');
    res.type('html').send(html);
  } catch (e) {
    res.status(500).type('html').send('<h2>Не удалось прочитать service.html: ' + e.message + '</h2>');
  }
};
app.get('/service', sendServicePage);
app.get('/service.html', sendServicePage);

// Раздать статические файлы (собранный фронтенд)
app.use(express.static(path.join(__dirname, 'dist')));

// Все остальные запросы -> index.html (для SPA)
app.get('/{*splat}', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// Запуск сервера
Promise.all([initDataFile(), initUsersFile()]).then(async () => {
  await initAutoBackup().catch(e => console.error('❌ Ошибка инициализации автобэкапа:', e));
  app.listen(PORT, () => {
    console.log(`\n🚀 Сервер запущен на http://localhost:${PORT}`);
    console.log(`🔧 build: service-v3 (если этой строки нет в логе — запущен СТАРЫЙ server.js)`)
    console.log(`💾 Сервис бэкапов: http://localhost:${PORT}/service (${SERVICE_PAGE_FILE ? SERVICE_PAGE_FILE : 'service.html НЕ НАЙДЕН!'})`);
    console.log(`📊 API доступен на http://localhost:${PORT}/api`);
    console.log(`💾 Данные хранятся в: ${DATA_FILE}`);
    console.log(`👥 Пользователи хранятся в: ${USERS_FILE}\n`);
  });
}).catch(error => {
  console.error('❌ Ошибка инициализации:', error);
  process.exit(1);
});
