import express from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Путь к файлу данных
const DATA_FILE = path.join(__dirname, 'data.json');
const LOCK_FILE = path.join(__dirname, 'lock.json');

// Типы данных
interface CarRecord {
  id: string;
  car_number: string;
  car_type: string;
  carrier: string;
  arrival: string;
  departure: string;
  date: string;
  tariff: number;
  coefficient: number;
}

interface ServiceRecord {
  id: string;
  service_type: string;
  carrier: string;
  quantity: number;
  payment_type: 'hourly' | 'fixed';
  arrival: string | null;
  departure: string | null;
  date: string;
  tariff: number;
  coefficient: number;
}

interface Tariff {
  id: string;
  type: 'auto' | 'service';
  category: string;
  carrier: string;
  price: number;
  payment_type: 'hourly' | 'fixed';
}

interface AppData {
  autoRecords: CarRecord[];
  serviceRecords: ServiceRecord[];
  tariffs: Tariff[];
}

interface LockInfo {
  userId: string;
  computerName: string;
  lockedAt: string;
  expiresAt: string;
}

// Инициализация файла данных
async function initDataFile() {
  try {
    await fs.access(DATA_FILE);
  } catch {
    const initialData: AppData = {
      autoRecords: [],
      serviceRecords: [],
      tariffs: []
    };
    await fs.writeFile(DATA_FILE, JSON.stringify(initialData, null, 2));
  }
}

// Чтение данных
async function readData(): Promise<AppData> {
  try {
    const data = await fs.readFile(DATA_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Ошибка чтения данных:', error);
    return { autoRecords: [], serviceRecords: [], tariffs: [] };
  }
}

// Запись данных
async function writeData(data: AppData) {
  await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2));
}

// Проверка блокировки
async function checkLock(): Promise<LockInfo | null> {
  try {
    await fs.access(LOCK_FILE);
    const lockData = await fs.readFile(LOCK_FILE, 'utf-8');
    const lock: LockInfo = JSON.parse(lockData);
    
    // Проверяем, не истекла ли блокировка
    if (new Date(lock.expiresAt) < new Date()) {
      await fs.unlink(LOCK_FILE);
      return null;
    }
    
    return lock;
  } catch {
    return null;
  }
}

// Установка блокировки
async function setLock(userId: string, computerName: string): Promise<boolean> {
  const existingLock = await checkLock();
  
  if (existingLock && existingLock.userId !== userId) {
    return false; // Уже заблокировано другим пользователем
  }
  
  const lock: LockInfo = {
    userId,
    computerName,
    lockedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString() // 30 минут
  };
  
  await fs.writeFile(LOCK_FILE, JSON.stringify(lock, null, 2));
  return true;
}

// Освобождение блокировки
async function releaseLock(userId: string) {
  const lock = await checkLock();
  if (lock && lock.userId === userId) {
    await fs.unlink(LOCK_FILE);
  }
}

// ==================== API Endpoints ====================

// Получить все данные
app.get('/api/data', async (req, res) => {
  const data = await readData();
  res.json(data);
});

// Обновить все данные
app.post('/api/data', async (req, res) => {
  const { userId, computerName, data } = req.body;
  
  if (!userId || !computerName) {
    return res.status(400).json({ error: 'userId и computerName обязательны' });
  }
  
  // Пытаемся установить блокировку
  const locked = await setLock(userId, computerName);
  if (!locked) {
    const existingLock = await checkLock();
    return res.status(403).json({ 
      error: 'Данные заблокированы другим пользователем',
      lockInfo: existingLock
    });
  }
  
  try {
    await writeData(data);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка сохранения данных' });
  }
});

// Получить информацию о блокировке
app.get('/api/lock', async (req, res) => {
  const lock = await checkLock();
  res.json({ locked: !!lock, lockInfo: lock });
});

// Освободить блокировку
app.post('/api/lock/release', async (req, res) => {
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
    res.json({ success: true });
  } else {
    res.status(403).json({ error: 'Блокировка не найдена или принадлежит другому пользователю' });
  }
});

// Раздать статические файлы (собранный фронтенд)
app.use(express.static(path.join(__dirname, 'dist')));

// Все остальные запросы -> index.html (для SPA)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// Запуск сервера
initDataFile().then(() => {
  app.listen(PORT, () => {
    console.log(`Сервер запущен на http://localhost:${PORT}`);
  });
});
