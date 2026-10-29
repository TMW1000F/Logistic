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

// Проверка блокировки
async function checkLock() {
  try {
    await fs.access(LOCK_FILE);
    const lockData = await fs.readFile(LOCK_FILE, 'utf-8');
    const lock = JSON.parse(lockData);
    
    // Проверяем, не истекла ли блокировка
    if (new Date(lock.expiresAt) < new Date()) {
      console.log('⏰ Блокировка истекла, удаляю...');
      await fs.unlink(LOCK_FILE);
      return null;
    }
    
    return lock;
  } catch {
    return null;
  }
}

// Установка блокировки
async function setLock(userId, computerName) {
  const existingLock = await checkLock();
  
  if (existingLock && existingLock.userId !== userId) {
    console.log('🔒 Попытка блокировки отклонена - уже заблокировано');
    return false;
  }
  
  const lock = {
    userId,
    computerName,
    lockedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString()
  };
  
  await fs.writeFile(LOCK_FILE, JSON.stringify(lock, null, 2));
  console.log(`🔒 Блокировка установлена: ${computerName} (${userId})`);
  return true;
}

// Освобождение блокировки
async function releaseLock(userId) {
  const lock = await checkLock();
  if (lock && lock.userId === userId) {
    await fs.unlink(LOCK_FILE);
    console.log('🔓 Блокировка освобождена');
  }
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
  
  // Пытаемся установить блокировку
  const locked = await setLock(userId, computerName);
  if (!locked) {
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
  console.log('🔓 POST /api/lock/release');
  const { userId } = req.body;
  
  if (!userId) {
    return res.status(400).json({ error: 'userId обязателен' });
  }
  
  await releaseLock(userId);
  res.json({ success: true });
});

// Продлить блокировку
app.post('/api/lock/extend', async (req, res) => {
  const { userId } = req.body;
  
  if (!userId) {
    return res.status(400).json({ error: 'userId обязателен' });
  }
  
  const lock = await checkLock();
  if (lock && lock.userId === userId) {
    lock.expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    await fs.writeFile(LOCK_FILE, JSON.stringify(lock, null, 2));
    console.log('⏰ Блокировка продлена');
    res.json({ success: true });
  } else {
    res.status(403).json({ error: 'Блокировка не найдена или принадлежит другому пользователю' });
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
