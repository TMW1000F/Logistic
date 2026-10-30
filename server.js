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

// Инициализация файла пользователей (allow-list для доступа на редактирование)
async function initUsersFile() {
  try {
    await fs.access(USERS_FILE);
    console.log('✅ Файл users.json найден');
  } catch {
    console.log('📝 Создаю новый файл users.json...');
    // Пример: username — SAM-логин или userPrincipalName из Active Directory.
    // allowed:false — запретить редактирование; adGroups — разрешённые группы AD
    // (пустой массив = группа не важна).
    const initialUsers = [
      {
        id: 'u1',
        username: 'ivanov@corp.local',
        displayName: 'Иванов И.И.',
        allowed: true,
        adGroups: []
      }
    ];
    await fs.writeFile(USERS_FILE, JSON.stringify(initialUsers, null, 2));
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
      tariffs: []
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
    return { autoRecords: [], serviceRecords: [], tariffs: [] };
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
//
// Приложение работает в корпоративной сети с Active Directory.
// Регистрации и паролей нет: reverse-proxy (IIS с Windows Authentication,
// Apache mod_auth_gssapi или Nginx+kerberos) проверяет Windows-идентификацию
// пользователя (Kerberos/NTLM) и передаёт его сюда в HTTP-заголовке. Имя заголовка задаётся
// переменной окружения AD_USER_HEADER (по умолчанию X-Forwarded-User),
// имя для отображения — AD_DISPLAY_NAME_HEADER (по умолчанию X-Forwarded-Name),
// список групп — AD_GROUPS_HEADER (по умолчанию X-Forwarded-Groups, через запятую).
//
// Пускать или не пускать человека решает файл users.json:
//   - если AD-логина там нет — доступ на редактирование запрещён;
//   - allowed:false — запрещён (например, уволился/перевёлся);
//   - adGroups:[...] — пустой массив означает «любая группа не требуется»,
//     непустой — хотя бы одна группа должна присутствовать в заголовке групп.

const AD_USER_HEADER = (process.env.AD_USER_HEADER || 'x-forwarded-user').toLowerCase();
const AD_DISPLAY_NAME_HEADER = (process.env.AD_DISPLAY_NAME_HEADER || 'x-forwarded-name').toLowerCase();
const AD_GROUPS_HEADER = (process.env.AD_GROUPS_HEADER || 'x-forwarded-groups').toLowerCase();

// Отладочный вывод для диагностики проблем с AD-аутентификацией.
// Включается переменной окружения DEBUG_AD=1 (например: DEBUG_AD=1 node server.js).
// Логирует все входящие заголовки запроса whoami и содержимое allow-list,
// а также добавляет эти данные в ответ 401/403, чтобы причину отказа
// было видно прямо в браузере, не залезая на сервер.
const DEBUG_AD = process.env.DEBUG_AD === '1' || process.env.DEBUG_AD === 'true';

function maskHeaderValue(name, value) {
  // Маскируем чувствительные заголовки даже в отладочном режиме
  const sensitive = ['authorization', 'cookie', 'password', 'token'];
  if (sensitive.some(s => name.toLowerCase().includes(s))) return '[скрыто]';
  return value;
}

function logAdHeaders(req, context) {
  if (!DEBUG_AD) return;
  console.log(`\n🔎 [DEBUG_AD] ${context}`);
  console.log('   Заголовок пользователя AD:', AD_USER_HEADER, '=', req.headers[AD_USER_HEADER] ?? '(нет)');
  console.log('   Заголовок отображаемого имени:', AD_DISPLAY_NAME_HEADER, '=', req.headers[AD_DISPLAY_NAME_HEADER] ?? '(нет)');
  console.log('   Заголовок групп AD:', AD_GROUPS_HEADER, '=', req.headers[AD_GROUPS_HEADER] ?? '(нет)');
  console.log('   Все заголовки запроса:');
  for (const [name, value] of Object.entries(req.headers)) {
    console.log(`     - ${name}: ${maskHeaderValue(name, String(value))}`);
  }
  console.log('   🔧 Подсказка: имя заголовка можно поменять через переменную окружения AD_USER_HEADER');
  console.log('      (частые варианты: x-remote-user, remote_user, x-forwarded-user, authorization-user)');
}

// Для ответов об ошибке: какие заголовки прокси реально передал (без значений секретов)
function buildAdDebugInfo(req, users) {
  if (!DEBUG_AD) return undefined;
  return {
    checkedHeader: AD_USER_HEADER,
    headerValue: req.headers[AD_USER_HEADER] ?? null,
    presentAuthHeaders: Object.keys(req.headers).filter(n =>
      /user|auth|remote|login|kerberos|ntlm|forwarded/i.test(n)
    ),
    allHeaderNames: Object.keys(req.headers),
    allowedUsernames: Array.isArray(users) ? users.map(u => u.username) : [],
    hint: 'Если headerValue=null — прокси не передаёт заголовок AD. Проверьте настройки Windows-аутентификации на прокси и задайте AD_USER_HEADER именем того заголовка, который он реально шлёт (см. presentAuthHeaders).'
  };
}

function normalizeAdUsername(raw) {
  if (!raw) return null;
  let name = String(raw).trim();
  if (!name) return null;
  // DOMAIN\user -> user@domain (приводим к единому виду UPN)
  if (name.includes('\\')) {
    const idx = name.lastIndexOf('\\');
    const domain = name.slice(0, idx);
    const user = name.slice(idx + 1);
    if (user && domain) name = `${user}@${domain}`;
  }
  return name.toLowerCase();
}

// Сравнение AD-логинов: допускаем совпадение по samAccountName
// (последний сегмент до @ или после \), чтобы не зависеть от написания домена.
function adLoginMatches(storedUsername, headerLogin) {
  const a = normalizeAdUsername(storedUsername);
  if (!a || !headerLogin) return false;
  if (a === headerLogin) return true;
  const sam = s => s.split('@')[0];
  return sam(a) === sam(headerLogin) && sam(a).length > 0;
}

function parseAdGroups(headerValue) {
  if (!headerValue) return [];
  return String(headerValue)
    .split(/[,;]/)
    .map(g => g.trim().toLowerCase())
    .filter(Boolean);
}

// Основной вход в систему: браузер сам прикладывает Windows-аутентификацию
// (через reverse-proxy), пользователю не нужно ничего вводить.
app.get('/api/auth/whoami', async (req, res) => {
  console.log('🪪 GET /api/auth/whoami');
  logAdHeaders(req, 'whoami: входящие данные от прокси');

  const adLoginRaw = req.headers[AD_USER_HEADER];
  if (!adLoginRaw) {
    console.log('🚫 whoami: нет заголовка', AD_USER_HEADER, '- прокси не передал данные AD');
    const debugInfo = buildAdDebugInfo(req, []);
    return res.status(401).json({
      error: 'Не удалось определить пользователя из Active Directory. Проверьте, что сайт открыт через корпоративный прокси с Windows-аутентификацией.',
      ...(debugInfo ? { debug: debugInfo } : {})
    });
  }

  const adLogin = normalizeAdUsername(adLoginRaw);
  const users = await readUsers();
  const user = users.find(u => adLoginMatches(u.username, adLogin));

  if (!user) {
    console.log(`🚫 whoami: пользователь ${adLogin} отсутствует в allow-list (users.json)`);
    if (DEBUG_AD) {
      console.log('   Разрешённые логины в users.json:', users.map(u => u.username).join(', ') || '(список пуст)');
      console.log('   Искомый логин после нормализации:', adLogin, '(из', String(adLoginRaw) + ')');
    }
    const debugInfo = buildAdDebugInfo(req, users);
    return res.status(403).json({
      error: 'Доступ к редактированию запрещён. Вас нет в списке разрешённых пользователей — обратитесь к администратору.',
      adLogin,
      ...(debugInfo ? { debug: debugInfo } : {})
    });
  }

  if (user.allowed === false) {
    console.log(`🚫 whoami: пользователь ${adLogin} заблокирован в users.json (allowed:false)`);
    return res.status(403).json({
      error: 'Доступ к редактированию запрещён. Ваша учётная запись отключена администратором.',
      adLogin
    });
  }

  // Фильтрация по группам AD, если они заданы для пользователя
  if (Array.isArray(user.adGroups) && user.adGroups.length > 0) {
    const groups = parseAdGroups(req.headers[AD_GROUPS_HEADER]);
    const required = user.adGroups.map(g => String(g).toLowerCase());
    const hasGroup = required.some(g => groups.includes(g));
    if (!hasGroup) {
      console.log(`🚫 whoami: у ${adLogin} нет ни одной требуемой группы (${required.join(', ')})`);
      if (DEBUG_AD) {
        console.log('   Группы, переданные прокси:', groups.length ? groups.join(', ') : '(заголовок групп не передан или пуст)');
      }
      return res.status(403).json({
        error: `Доступ разрешён только участникам групп: ${user.adGroups.join(', ')}.`,
        adLogin,
        ...(DEBUG_AD ? { debug: { headerGroups: req.headers[AD_GROUPS_HEADER] ?? null, parsedGroups: groups, requiredGroups: required } } : {})
      });
    }
  }

  const displayName = req.headers[AD_DISPLAY_NAME_HEADER] || user.displayName || adLoginRaw;

  console.log(`✅ whoami: допущен к редактированию ${adLogin}`);
  res.json({
    success: true,
    token: user.id,
    user: {
      id: user.id,
      username: user.username,
      displayName
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

// Раздать статические файлы (собранный фронтенд)
app.use(express.static(path.join(__dirname, 'dist')));

// Все остальные запросы -> index.html (для SPA)
app.get('/{*splat}', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// Запуск сервера
Promise.all([initDataFile(), initUsersFile()]).then(() => {
  app.listen(PORT, () => {
    console.log(`\n🚀 Сервер запущен на http://localhost:${PORT}`);
    console.log(`📊 API доступен на http://localhost:${PORT}/api`);
    console.log(`💾 Данные хранятся в: ${DATA_FILE}`);
    console.log(`👥 Пользователи хранятся в: ${USERS_FILE}\n`);
    console.log(`🪪 AD-логин читается из заголовка: ${AD_USER_HEADER} (переменная окружения AD_USER_HEADER)`);
    console.log(`   Отображаемое имя: ${AD_DISPLAY_NAME_HEADER}, группы: ${AD_GROUPS_HEADER}`);
    console.log(`   Отладочный вывод заголовков AD: ${DEBUG_AD ? '✅ ВКЛЮЧЁН (DEBUG_AD)' : 'выключен (включите: DEBUG_AD=1 node server.js)'}`);
  });
}).catch(error => {
  console.error('❌ Ошибка инициализации:', error);
  process.exit(1);
});
