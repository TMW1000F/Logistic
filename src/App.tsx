import { useState, useEffect } from 'react';
import { StoreProvider, useStore } from './store';
import AutoTab from './components/AutoTab';
import ServicesTab from './components/ServicesTab';
import ResultsTab from './components/ResultsTab';
import TariffsTab from './components/TariffsTab';
import StatsTab from './components/StatsTab';
import { Car, Wrench, BarChart3, DollarSign, TrendingUp, HelpCircle } from 'lucide-react';

const APP_NAME = 'Учёт автомобилей';
const VERSION = '1.9.6';
const COMPANY_NAME = "АО «Логистик-Центр»";

function AppContent() {
  const { state } = useStore();
  const [activeTab, setActiveTab] = useState(0);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [showHelp, setShowHelp] = useState(false);

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
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const tabs = [
    { name: 'Данные автомобиля', icon: Car, component: AutoTab },
    { name: 'Другие услуги', icon: Wrench, component: ServicesTab },
    { name: 'Итоги', icon: BarChart3, component: ResultsTab },
    { name: 'Тарифы', icon: DollarSign, component: TariffsTab },
    { name: 'Статистика', icon: TrendingUp, component: StatsTab },
  ];

  const ActiveComponent = tabs[activeTab].component;
  const totalRecords = state.autoRecords.length + state.serviceRecords.length;

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      {/* Шапка */}
      <header className="bg-gradient-to-r from-blue-800 to-blue-600 text-white shadow-lg">
        <div className="max-w-full mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-white/20 rounded-lg flex items-center justify-center">
              <Car size={24} />
            </div>
            <div>
              <h1 className="text-lg font-bold">{APP_NAME} v{VERSION}</h1>
              <p className="text-xs text-blue-200">{COMPANY_NAME}</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right text-xs">
              <div className="text-blue-200">Записей: {totalRecords}</div>
              <div>{currentTime.toLocaleString('ru-RU')}</div>
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
      <nav className="bg-white border-b shadow-sm">
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
                      ? 'border-blue-600 text-blue-600 bg-blue-50'
                      : 'border-transparent text-gray-600 hover:text-gray-800 hover:bg-gray-50'
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

      {/* Содержимое */}
      <main className="flex-1 max-w-full mx-auto px-4 py-4 w-full">
        <ActiveComponent />
      </main>

      {/* Строка состояния */}
      <footer className="bg-white border-t px-4 py-2 flex items-center justify-between text-xs text-gray-500">
        <span>Готов к работе | Данные хранятся в браузере (localStorage)</span>
        <span>{currentTime.toLocaleDateString('ru-RU')} {currentTime.toLocaleTimeString('ru-RU')}</span>
      </footer>

      {/* Модальное окно справки */}
      {showHelp && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowHelp(false)}>
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-4">📖 Справка</h2>
            <div className="space-y-3 text-sm">
              <p className="font-bold">{APP_NAME} v{VERSION}</p>
              <p className="text-gray-600">{COMPANY_NAME}</p>
              
              <div className="bg-gray-50 rounded p-3">
                <p className="font-medium mb-2">Горячие клавиши:</p>
                <ul className="space-y-1 text-xs">
                  <li><kbd className="bg-gray-200 px-1 rounded">F1</kbd> — эта справка</li>
                  <li><kbd className="bg-gray-200 px-1 rounded">Enter</kbd> — добавить запись (на вкладках авто/услуги)</li>
                </ul>
              </div>

              <div className="bg-blue-50 rounded p-3">
                <p className="font-medium mb-2">Как начать работу:</p>
                <ol className="space-y-1 text-xs list-decimal list-inside">
                  <li>Перейдите во вкладку «Тарифы»</li>
                  <li>Добавьте тарифы для автомобилей и/или услуг</li>
                  <li>Перейдите на вкладку «Данные автомобиля» или «Другие услуги»</li>
                  <li>Заполните форму и нажмите «Добавить»</li>
                </ol>
              </div>

              <div className="bg-green-50 rounded p-3">
                <p className="font-medium mb-2">Хранение данных:</p>
                <p className="text-xs">Все данные сохраняются в localStorage вашего браузера. Для переноса данных между устройствами используйте экспорт/импорт тарифов (JSON).</p>
              </div>

              <p className="text-xs text-gray-400 mt-4">
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
    </div>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <AppContent />
    </StoreProvider>
  );
}
