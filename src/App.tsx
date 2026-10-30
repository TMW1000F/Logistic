import { useState, useEffect, useRef } from 'react';
import { StoreProvider, useStore } from './store';
import { ToastProvider, useToast } from './components/Toast';
import AuthScreen from './components/AuthScreen';
import AutoTab from './components/AutoTab';
import ServicesTab from './components/ServicesTab';
import ResultsTab from './components/ResultsTab';
import TariffsTab from './components/TariffsTab';
import StatsTab from './components/StatsTab';
import { Car, Wrench, BarChart3, DollarSign, TrendingUp, HelpCircle, Save, FolderOpen, FilePlus, Sun, Moon, LogOut, Eye, Lock } from 'lucide-react';
import { calcDurationHours, calcAutoCost, calcServiceHours, calcServiceCost, formatDate } from './types';
import { 
  getCurrentUser, 
  logout, 
  verifyToken,
  getLockInfo,
  startActivityTracking,
  stopActivityTracking,
  setWarningCallback,
  setReleaseCallback,
  setLockLostCallback,
  checkLockStatus,
  updateActivity
} from './api';

const APP_NAME = 'Учёт автомобилей';
const VERSION = '2.0';
const COMPANY_NAME = "АО «Логистик-Центр»";

function AppContent() {
  const { state, dispatch, isLocked, lockInfo, isLoading, error } = useStore();
  const toast = useToast();
  const [activeTab, setActiveTab] = useState(0);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [showHelp, setShowHelp] = useState(false);
  const [statusMessage, setStatusMessage] = useState('Готов к работе');
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem('darkMode');
    return saved === 'true';
  });
  const [isAuthChecked, setIsAuthChecked] = useState(false);
  const [isAuthenticatedUser, setIsAuthenticatedUser] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const [showInactivityWarning, setShowInactivityWarning] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Проверка авторизации и блокировки при загрузке.
  // Алгоритм: читаем lock.json ДО показа основного экрана. Если там указан
  // другой пользователь — сразу режим только для чтения (без «своего» окна).
  useEffect(() => {
    const checkAuth = async () => {
      const user = await verifyToken();

      let lockStatus: { locked: boolean; lockInfo: any } = { locked: false, lockInfo: null };
      try {
        lockStatus = await getLockInfo();
      } catch (e) {
        console.error('Не удалось проверить блокировку при входе:', e);
      }
      const otherLock = lockStatus.locked && lockStatus.lockInfo;

      if (user) {
        setIsAuthenticatedUser(true);
        if (otherLock && lockStatus.lockInfo.userId !== user.id) {
          setReadOnly(true);
          toast.error(`🔒 Файл заблокирован пользователем: ${lockStatus.lockInfo.computerName}. Режим только для чтения.`);
        } else {
          setReadOnly(false);
        }
      } else if (otherLock) {
        // Гостя пускаем только в просмотр — без авторизации работать нельзя,
        // и уж тем более нельзя давать ему создавать/снимать блокировку.
        setReadOnly(true);
        setIsAuthenticatedUser(false);
      } else {
        setIsAuthenticatedUser(false);
        setReadOnly(false);
      }
      setIsAuthChecked(true);
    };
    checkAuth();
  }, []);

  // Проверка блокировки файла другим пользователем + реакция на потерю своей
  useEffect(() => {
    if (isLocked && lockInfo && isAuthenticatedUser && !readOnly) {
      const currentUser = getCurrentUser();
      // Если файл заблокирован ДРУГИМ пользователем
      if (currentUser && lockInfo.userId !== currentUser.id) {
        setReadOnly(true);
        toast.error(`🔒 Файл заблокирован пользователем: ${lockInfo.computerName}. Режим только для чтения.`);
      }
    }
  }, [isLocked, lockInfo, isAuthenticatedUser, readOnly]);

  // Если фоновое продление не смогло продлить нашу блокировку (она истекла
  // или её занял другой) — немедленно переходим в режим только для чтения,
  // чтобы не писать данные поверх чужой сессии.
  useEffect(() => {
    setLockLostCallback(async () => {
      const status = await checkLockStatus();
      const currentUser = getCurrentUser();
      if (status.locked && status.lockInfo && currentUser && status.lockInfo.userId !== currentUser.id) {
        setReadOnly(true);
        toast.error(`🔒 Ваша блокировка перехвачена пользователем: ${status.lockInfo.computerName}. Включён режим только для чтения.`);
      } else {
        setReadOnly(true);
        toast.warning('⚠️ Блокировка больше не активна — включён режим только для чтения. Сохраните изменения и войдите заново.');
      }
    });
  }, []);

  // Отслеживание активности пользователя
  useEffect(() => {
    if (!isAuthenticatedUser || readOnly) return;

    // Настраиваем callback для предупреждения
    setWarningCallback(() => {
      setShowInactivityWarning(true);
      toast.warning('⚠️ Блокировка будет снята через 1 минуту из-за неактивности');
    });

    // Настраиваем callback для снятия блокировки
    setReleaseCallback(() => {
      setShowInactivityWarning(false);
      toast.info('🔓 Блокировка снята из-за неактивности');
    });

    // Запускаем отслеживание активности
    startActivityTracking();

    // Очистка при размонтировании
    return () => {
      stopActivityTracking();
    };
  }, [isAuthenticatedUser, readOnly]);

  // При возврате активности проверяем статус блокировки
  useEffect(() => {
    if (!isAuthenticatedUser || readOnly) return;

    const handleActivity = async () => {
      // Обновляем активность
      updateActivity();
      
      // Если было показано предупреждение, значит была неактивность
      if (showInactivityWarning) {
        setShowInactivityWarning(false);
        
        // Проверяем, не заблокировал ли кто-то данные
        const lockStatus = await checkLockStatus();
        
        if (lockStatus.locked && lockStatus.lockInfo) {
          // Кто-то заблокировал данные
          toast.error(`🔒 Данные заблокированы пользователем: ${lockStatus.lockInfo.computerName}`);
        } else {
          // Блокировка свободна, можно продолжать работу
          toast.success('✅ Блокировка восстановлена, можно продолжать работу');
        }
      }
    };

    // Слушаем события активности
    const events = ['mousedown', 'keydown', 'scroll'];
    events.forEach(event => {
      window.addEventListener(event, handleActivity, { passive: true });
    });

    return () => {
      events.forEach(event => {
        window.removeEventListener(event, handleActivity);
      });
    };
  }, [showInactivityWarning, isAuthenticatedUser, readOnly]);

  // Показываем ошибку синхронизации
  useEffect(() => {
    if (error) {
      toast.error(error);
    }
  }, [error]);

  // Применение темы
  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('darkMode', String(darkMode));
  }, [darkMode]);

  // Обновление времени
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Горячие клавиши
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F1') {
        e.preventDefault();
        setShowHelp(true);
      }
      if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
      if (e.ctrlKey && e.key === 'o') {
        e.preventDefault();
        handleLoad();
      }
      if (e.ctrlKey && e.key === 'n') {
        e.preventDefault();
        handleNew();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [state]);

  const showStatus = (msg: string) => {
    setStatusMessage(msg);
    setTimeout(() => setStatusMessage('Готов к работе'), 3000);
  };

  // Выход из системы
  const handleLogout = async () => {
    if (!confirm('Выйти из системы?')) return;
    await logout();
    setIsAuthenticatedUser(false);
    setReadOnly(false);
    toast.info('Вы вышли из системы');
  };

  // Сохранение в файл (TSV формат)
  const handleSave = () => {
    const lines: string[] = [];
    
    // Заголовок
    lines.push('Тип\tНомер ТС\tКатегория\tКомпания\tКол-во\tТип оплаты\tВремя\tЧасы\tСтоимость\tТариф\tДата\tКоэффициент');
    
    // Автомобили
    for (const record of state.autoRecords) {
      const duration = calcDurationHours(record.arrival, record.departure);
      const cost = calcAutoCost(record);
      const coeff = record.coefficient !== 1.0 ? `да х${record.coefficient}` : '-';
      
      lines.push([
        'auto',
        record.car_number,
        record.car_type,
        record.carrier,
        '1',
        '-',
        `${record.arrival}-${record.departure}`,
        duration.toFixed(2),
        cost.toFixed(2),
        record.tariff.toFixed(2),
        formatDate(record.date),
        coeff
      ].join('\t'));
    }
    
    // Услуги
    for (const record of state.serviceRecords) {
      const hours = calcServiceHours(record);
      const cost = calcServiceCost(record);
      const coeff = record.coefficient !== 1.0 ? `да х${record.coefficient}` : '-';
      const time = record.payment_type === 'hourly' && record.arrival && record.departure 
        ? `${record.arrival}-${record.departure}` 
        : '-';
      
      lines.push([
        'service',
        '-',
        record.service_type,
        record.carrier,
        record.quantity.toString(),
        record.payment_type === 'hourly' ? 'Почасовая' : 'Фиксированная',
        time,
        hours.toFixed(2),
        cost.toFixed(2),
        record.tariff.toFixed(2),
        formatDate(record.date),
        coeff
      ].join('\t'));
    }
    
    const blob = new Blob([lines.join('\n')], { type: 'text/tab-separated-values;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const dateStr = new Date().toISOString().split('T')[0];
    a.download = `car_accounting_${dateStr}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Сохранено: авто — ${state.autoRecords.length}, услуг — ${state.serviceRecords.length}`);
    showStatus(`💾 Сохранено: авто — ${state.autoRecords.length}, услуг — ${state.serviceRecords.length}`);
  };

  // Загрузка из файла
  const handleLoad = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const content = ev.target?.result as string;
        const lines = content.split('\n').filter(line => line.trim());
        
        if (lines.length < 2) {
          toast.error('Файл пуст или содержит только заголовок');
          return;
        }
        
        // Пропускаем заголовок
        const dataLines = lines.slice(1);
        const autoRecords: any[] = [];
        const serviceRecords: any[] = [];
        
        for (const line of dataLines) {
          const cols = line.split('\t');
          if (cols.length < 12) continue;
          
          const type = cols[0];
          const dateStr = cols[10]; // DD-MM-YYYY
          
          // Парсим дату
          const [day, month, year] = dateStr.split('-');
          const date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
          
          // Парсим время
          const timeStr = cols[6];
          let arrival = '00:00';
          let departure = '00:00';
          if (timeStr && timeStr !== '-') {
            const [arr, dep] = timeStr.split('-');
            arrival = arr;
            departure = dep;
          }
          
          // Парсим коэффициент
          const coeffStr = cols[11];
          let coefficient = 1.0;
          if (coeffStr && coeffStr !== '-' && coeffStr.includes('х')) {
            coefficient = parseFloat(coeffStr.replace('да х', '')) || 1.0;
          }
          
          if (type === 'auto') {
            autoRecords.push({
              id: Math.random().toString(36).substr(2, 9),
              car_number: cols[1],
              car_type: cols[2],
              carrier: cols[3],
              arrival,
              departure,
              date,
              tariff: parseFloat(cols[9]) || 0,
              coefficient
            });
          } else if (type === 'service') {
            const paymentType = cols[5] === 'Почасовая' ? 'hourly' : 'fixed';
            serviceRecords.push({
              id: Math.random().toString(36).substr(2, 9),
              service_type: cols[2],
              carrier: cols[3],
              quantity: parseInt(cols[4]) || 1,
              payment_type: paymentType,
              arrival: paymentType === 'hourly' ? arrival : null,
              departure: paymentType === 'hourly' ? departure : null,
              date,
              tariff: parseFloat(cols[9]) || 0,
              coefficient
            });
          }
        }
        
        // Спрашиваем пользователя: добавить или заменить
        const hasExistingData = state.autoRecords.length > 0 || state.serviceRecords.length > 0;
        let mode: 'add' | 'replace' = 'replace';
        
        if (hasExistingData) {
          const choice = confirm(
            `В памяти есть данные (${state.autoRecords.length} авто, ${state.serviceRecords.length} услуг).\n\n` +
            `Нажмите "OK" чтобы ЗАМЕНИТЬ все данные\n` +
            `Нажмите "Отмена" чтобы ДОБАВИТЬ к существующим`
          );
          mode = choice ? 'replace' : 'add';
        }
        
        if (mode === 'replace') {
          dispatch({ 
            type: 'IMPORT_DATA', 
            payload: { 
              autoRecords, 
              serviceRecords, 
              tariffs: state.tariffs 
            } 
          });
        } else {
          // Добавляем к существующим
          const newAutoRecords = [...state.autoRecords, ...autoRecords];
          const newServiceRecords = [...state.serviceRecords, ...serviceRecords];
          dispatch({ 
            type: 'IMPORT_DATA', 
            payload: { 
              autoRecords: newAutoRecords, 
              serviceRecords: newServiceRecords, 
              tariffs: state.tariffs 
            } 
          });
        }
        
        toast.success(`Загружено: авто — ${autoRecords.length}, услуг — ${serviceRecords.length} (${mode === 'replace' ? 'замена' : 'добавление'})`);
        showStatus(`📂 Загружено: авто — ${autoRecords.length}, услуг — ${serviceRecords.length}`);
      } catch (err) {
        toast.error('Ошибка чтения файла: ' + (err as Error).message);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // Новый файл
  const handleNew = () => {
    if ((state.autoRecords.length > 0 || state.serviceRecords.length > 0) &&
        !confirm('Все несохранённые данные будут потеряны. Продолжить?')) {
      return;
    }
    dispatch({ type: 'CLEAR_ALL' });
    toast.info('Создан новый файл');
    showStatus('📄 Создан новый файл');
  };

  const tabs = [
    { name: 'Данные автомобиля', icon: Car, component: AutoTab },
    { name: 'Другие услуги', icon: Wrench, component: ServicesTab },
    { name: 'Итоги', icon: BarChart3, component: ResultsTab },
    { name: 'Тарифы', icon: DollarSign, component: TariffsTab },
    { name: 'Статистика', icon: TrendingUp, component: StatsTab },
  ];

  const ActiveComponent = tabs[activeTab].component;
  const totalRecords = state.autoRecords.length + state.serviceRecords.length;

  // Если авторизация ещё не проверена - показываем загрузку
  if (!isAuthChecked) {
    return (
      <div className={`min-h-screen flex items-center justify-center ${darkMode ? 'bg-gray-900' : 'bg-gray-100'}`}>
        <div className={`text-center ${darkMode ? 'text-white' : 'text-gray-900'}`}>
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p>Загрузка...</p>
        </div>
      </div>
    );
  }

  // Если пользователь не авторизован и не в режиме просмотра - показываем экран авторизации
  if (!isAuthenticatedUser && !readOnly) {
    return (
      <AuthScreen 
        onAuthSuccess={() => {
          setIsAuthenticatedUser(true);
          setReadOnly(false);
        }}
        onReadOnlyMode={() => {
          setReadOnly(true);
          setIsAuthenticatedUser(false);
        }}
        darkMode={darkMode}
      />
    );
  }

  const currentUser = getCurrentUser();

  return (
    <div className={`h-screen flex flex-col ${darkMode ? 'bg-gray-900' : 'bg-gray-100'}`}>
      {/* Скрытый input для загрузки файлов */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".txt,.tsv"
        onChange={handleFileSelected}
        className="hidden"
      />

      {/* Шапка */}
      <header className="bg-gradient-to-r from-blue-800 to-blue-600 text-white shadow-lg flex-shrink-0">
        <div className="max-w-full mx-auto px-4 py-3 flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-white/20 rounded-lg flex items-center justify-center">
              <Car size={24} />
            </div>
            <div>
              <h1 className="text-lg font-bold">{APP_NAME} v{VERSION}</h1>
              <p className="text-xs text-blue-200">{COMPANY_NAME}</p>
            </div>
          </div>

          {/* Кнопки управления файлами */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setDarkMode(!darkMode)}
              className="flex items-center gap-1 bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded text-sm transition"
              title={darkMode ? 'Светлая тема' : 'Тёмная тема'}
            >
              {darkMode ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            {!readOnly && (
              <>
                <button
                  onClick={handleLoad}
                  className="flex items-center gap-1 bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded text-sm transition"
                  title="Загрузить из файла (Ctrl+O)"
                >
                  <FolderOpen size={16} /> Загрузить
                </button>
                <button
                  onClick={handleSave}
                  className="flex items-center gap-1 bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded text-sm transition"
                  title="Сохранить в файл (Ctrl+S)"
                >
                  <Save size={16} /> Сохранить
                </button>
                <button
                  onClick={handleNew}
                  className="flex items-center gap-1 bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded text-sm transition"
                  title="Новый файл (Ctrl+N)"
                >
                  <FilePlus size={16} /> Новый
                </button>
              </>
            )}
            {readOnly && (
              <div className="flex items-center gap-1 px-3 py-1.5 rounded text-sm bg-yellow-500/30 text-yellow-200">
                <Eye size={16} />
                Только просмотр
              </div>
            )}
            <button
              onClick={handleLogout}
              className="flex items-center gap-1 bg-red-500/20 hover:bg-red-500/30 px-3 py-1.5 rounded text-sm transition"
              title="Выйти из системы"
            >
              <LogOut size={16} /> Выход
            </button>
          </div>

          <div className="flex items-center gap-4">
            <div className="text-right text-xs">
              <div className="text-blue-200">Записей: {totalRecords}</div>
              <div>{currentTime.toLocaleString('ru-RU')}</div>
              {currentUser && (
                <div className="text-blue-200">
                  👤 {currentUser.displayName}
                  {readOnly && <span className="ml-1 text-yellow-300">(только просмотр)</span>}
                </div>
              )}
              {isLoading && (
                <div className="text-yellow-300">⏳ Загрузка...</div>
              )}
              {isLocked && lockInfo && currentUser && (
                <div className={`flex items-center gap-1 justify-end ${lockInfo.userId === currentUser.id ? 'text-green-300' : 'text-red-300'}`}>
                  <Lock size={12} />
                  <span>
                    {lockInfo.userId === currentUser.id 
                      ? 'Заблокировано: Вами' 
                      : `Заблокировано: ${lockInfo.computerName}`
                    }
                  </span>
                </div>
              )}
            </div>
            <button
              onClick={() => setShowHelp(true)}
              className="p-2 bg-white/10 rounded-lg hover:bg-white/20 transition"
              title="Справка (F1)"
            >
              <HelpCircle size={20} />
            </button>
          </div>
        </div>
      </header>

      {/* Вкладки */}
      <nav className={`border-b shadow-sm flex-shrink-0 ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
        <div className="max-w-full mx-auto px-4">
          <div className="flex overflow-x-auto">
            {tabs.map((tab, idx) => {
              const Icon = tab.icon;
              return (
                <button
                  key={idx}
                  onClick={() => setActiveTab(idx)}
                  className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition whitespace-nowrap ${
                    activeTab === idx
                      ? (darkMode ? 'border-blue-400 text-blue-400 bg-gray-700' : 'border-blue-600 text-blue-600 bg-blue-50')
                      : (darkMode ? 'border-transparent text-gray-400 hover:text-gray-200 hover:bg-gray-700' : 'border-transparent text-gray-600 hover:text-gray-800 hover:bg-gray-50')
                  }`}
                >
                  <Icon size={16} />
                  {tab.name}
                </button>
              );
            })}
          </div>
        </div>
      </nav>

      {/* Содержимое — занимает всё оставшееся место */}
      <main className="flex-1 max-w-full mx-auto px-4 py-4 w-full flex flex-col min-h-0 overflow-hidden">
        <div className="flex-1 min-h-0">
          <ActiveComponent onStatus={showStatus} darkMode={darkMode} readOnly={readOnly} />
        </div>
      </main>

      {/* Строка состояния — всегда внизу */}
      <footer className={`border-t px-4 py-2 flex items-center justify-between text-xs flex-shrink-0 ${darkMode ? 'bg-gray-800 border-gray-700 text-gray-400' : 'bg-white border-gray-200 text-gray-500'}`}>
        <span>{statusMessage}</span>
        <span>{currentTime.toLocaleDateString('ru-RU')} {currentTime.toLocaleTimeString('ru-RU')}</span>
      </footer>

      {/* Модальное окно справки */}
      {showHelp && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowHelp(false)}>
          <div className={`rounded-lg shadow-xl max-w-md w-full mx-4 p-6 ${darkMode ? 'bg-gray-800 text-gray-100' : 'bg-white text-gray-900'}`} onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-4">📖 Справка</h2>
            <div className="space-y-3 text-sm">
              <p className="font-bold">{APP_NAME} v{VERSION}</p>
              <p className={darkMode ? 'text-gray-400' : 'text-gray-600'}>{COMPANY_NAME}</p>
              
              <div className={`rounded p-3 ${darkMode ? 'bg-gray-700' : 'bg-gray-50'}`}>
                <p className="font-medium mb-2">Горячие клавиши:</p>
                <ul className="space-y-1 text-xs">
                  <li><kbd className={`px-1 rounded ${darkMode ? 'bg-gray-600 text-gray-200' : 'bg-gray-200'}`}>F1</kbd> — эта справка</li>
                  <li><kbd className={`px-1 rounded ${darkMode ? 'bg-gray-600 text-gray-200' : 'bg-gray-200'}`}>Ctrl+S</kbd> — сохранить в файл</li>
                  <li><kbd className={`px-1 rounded ${darkMode ? 'bg-gray-600 text-gray-200' : 'bg-gray-200'}`}>Ctrl+O</kbd> — загрузить из файла</li>
                  <li><kbd className={`px-1 rounded ${darkMode ? 'bg-gray-600 text-gray-200' : 'bg-gray-200'}`}>Ctrl+N</kbd> — новый файл</li>
                  <li><kbd className={`px-1 rounded ${darkMode ? 'bg-gray-600 text-gray-200' : 'bg-gray-200'}`}>Enter</kbd> — добавить запись</li>
                </ul>
              </div>

              <div className={`rounded p-3 ${darkMode ? 'bg-blue-900/30' : 'bg-blue-50'}`}>
                <p className="font-medium mb-2">Как начать работу:</p>
                <ol className="space-y-1 text-xs list-decimal list-inside">
                  <li>Перейдите во вкладку «Тарифы»</li>
                  <li>Добавьте тарифы для автомобилей и/или услуг</li>
                  <li>Перейдите на вкладку «Данные автомобиля» или «Другие услуги»</li>
                  <li>Заполните форму и нажмите «Добавить»</li>
                </ol>
              </div>

              <p className={`text-xs mt-4 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                Разработчик: Шавлаков А.В.<br />
                Норильск, 2025
              </p>
            </div>
            <button
              onClick={() => setShowHelp(false)}
              className="mt-4 w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700"
            >
              Закрыть
            </button>
          </div>
        </div>
      )}

      {/* Предупреждение о неактивности */}
      {showInactivityWarning && (
        <div className="fixed top-20 left-1/2 transform -translate-x-1/2 z-50 animate-pulse">
          <div className="bg-orange-500 text-white px-6 py-4 rounded-lg shadow-2xl flex items-center gap-3">
            <span className="text-2xl">⚠️</span>
            <div>
              <p className="font-bold">Внимание!</p>
              <p className="text-sm">Блокировка будет снята через 1 минуту из-за неактивности</p>
              <p className="text-xs mt-1 opacity-90">Совершите любое действие для отмены</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <ToastProvider>
        <AppContent />
      </ToastProvider>
    </StoreProvider>
  );
}
