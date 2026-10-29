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

// Таймаут неактивности блокировки: 5 минут.
// Если держатель блокировки не продлевает её (нет активности) дольше этого времени,
// сервер сам очищает файл блокировки.
const LOCK_TIMEOUT_MS = 5 * 60 * 1000;

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

// Проверка блокировки.
// Логика «живого» таймера: блокировка считается действующей, пока держатель
// регулярно продлевает её (heartbeats при активности). Если lastActivity старше
// LOCK_TIMEOUT_MS (5 минут бездействия) — сервер сам очищает файл блокировки.
async function checkLock() {
  try {
    const lockData = await fs.readFile(LOCK_FILE, 'utf-8');
    const lock = JSON.parse(lockData);

    // Приоритет у «живого» таймера lastActivity. Но если в файле осталась
    // легаси-запись от СТАРОЙ версии сервера (без lastActivity, зато с
    // expiresAt = lockedAt + 30 минут), уважаем её срок — иначе новый код
    // тут же удалил бы чужой активный замок и блокировка «мигала».
    let expired;
    if (lock.lastActivity) {
      const lastTouch = new Date(lock.lastActivity).getTime();
      // Небольшой grace (1 сек), чтобы не рвать блокировку из-за дребезга часов
      expired = Date.now() - lastTouch > LOCK_TIMEOUT_MS + 1000;
    } else if (lock.expiresAt) {
      expired = new Date(lock.expiresAt).getTime() < Date.now();
    } else {
      // Запись без обоих полей — считаем возраст от lockedAt с тем же таймаутом
      const lockedAt = new Date(lock.lockedAt || 0).getTime();
      expired = Date.now() - lockedAt > LOCK_TIMEOUT_MS + 1000;
    }

    if (expired) {
      console.log('⏰ Блокировка протухла (нет активности / истёк срок), сервер очищает файл...');
      await fs.unlink(LOCK_FILE).catch(() => {});
      return null;
    }

    return lock;
  } catch {
    // Файла нет или он повреждён — блокировки нет
    return null;
  }
}

// Занять блокировку. Возвращает:
//   { status: 'acquired' }  — записей не было, создали новую под этим пользователем
//   { status: 'renewed' }   — запись наша, обновили таймер активности
//   { status: 'locked', lock } — блокировка принадлежит другому активному пользователю
async function acquireLock(userId, computerName) {
  const existingLock = await checkLock();

  if (existingLock && existingLock.userId !== userId) {
    console.log('🔒 Блокировка занята другим пользователем');
    return { status: 'locked', lock: existingLock };
  }

  const now = new Date().toISOString();
  const lock = existingLock
    ? { ...existingLock, lastActivity: now } // свой замок — просто обновляем таймер
    : { userId, computerName, lockedAt: now, lastActivity: now };

  await fs.writeFile(LOCK_FILE, JSON.stringify(lock, null, 2));
  console.log(existingLock
    ? `🔄 Таймер блокировки обновлён: ${computerName} (${userId})`
    : `🔒 Блокировка установлена: ${computerName} (${userId})`);
  return { status: existingLock ? 'renewed' : 'acquired', lock };
}

// Освобождение блокировки (снимает только владелец)
async function releaseLock(userId) {
  try {
    const lockData = await fs.readFile(LOCK_FILE, 'utf-8');
    const lock = JSON.parse(lockData);
    if (lock.userId === userId) {
      await fs.unlink(LOCK_FILE);
      console.log('🔓 Блокировка освобождена');
    }
  } catch {
    // файла нет — освобождать нечего
  }
}

// Фоновый «уборщик»: если приложение упало и не очистило файл,
// сервер сам снимает блокировку после 5 минут без активности.
setInterval(async () => {
  try {
    await checkLock();
  } catch (e) {
    console.error('Ошибка фонового контроля блокировки:', e);
  }
}, 60 * 1000);

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
  
  // Освобождаем блокировку если она есть
  if (token) {
    await releaseLock(token);
  }
  
  res.json({ success: true });
});

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
  
  // Занимаем/продлеваем блокировку
  const lockResult = await acquireLock(userId, computerName);
  if (lockResult.status === 'locked') {
    console.log('🔒 Данные заблокированы другим пользователем');
    return res.status(403).json({ 
      error: 'Данные заблокированы другим пользователем',
      lockInfo: lockResult.lock
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
  
  console.log(`🔓 Освобождаю блокировку для userId: ${userId}`);
  await releaseLock(userId);
  res.json({ success: true });
});

// Продлить (обновить таймер) блокировки — heartbeat активности.
// Вызывается при каждом реальном действии пользователя (клик/клавиша/сохранение),
// а не по расписанию: молчащий клиент = неактивный клиент.
app.post('/api/lock/extend', async (req, res) => {
  const { userId } = req.body;
  
  if (!userId) {
    return res.status(400).json({ error: 'userId обязателен' });
  }
  
  const lockResult = await acquireLock(userId, null);
  if (lockResult.status === 'locked') {
    res.status(403).json({ error: 'Блокировка не найдена или принадлежит другому пользователю' });
  } else {
    res.json({ success: true });
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
  });
}).catch(error => {
  console.error('❌ Ошибка инициализации:', error);
  process.exit(1);
});
