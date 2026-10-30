import React, { createContext, useContext, useReducer, useEffect, ReactNode, useState } from 'react';
import { AppState, CarRecord, ServiceRecord, Tariff } from './types';
import { fetchData, updateData, startLockExtension, stopLockExtension, getLockInfo, getCurrentUser } from './api';

// ==================== Начальное состояние ====================
const initialState: AppState = {
  autoRecords: [],
  serviceRecords: [],
  tariffs: [],
};

// ==================== Действия ====================
type Action =
  | { type: 'LOAD_STATE'; payload: AppState }
  | { type: 'ADD_AUTO_RECORD'; payload: CarRecord }
  | { type: 'DELETE_AUTO_RECORD'; payload: string }
  | { type: 'ADD_SERVICE_RECORD'; payload: ServiceRecord }
  | { type: 'DELETE_SERVICE_RECORD'; payload: string }
  | { type: 'ADD_TARIFF'; payload: Tariff }
  | { type: 'DELETE_TARIFF'; payload: string }
  | { type: 'SET_TARIFFS'; payload: Tariff[] }
  | { type: 'CLEAR_ALL' }
  | { type: 'IMPORT_DATA'; payload: AppState };

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'LOAD_STATE':
      return action.payload;
    case 'ADD_AUTO_RECORD':
      return { ...state, autoRecords: [...state.autoRecords, action.payload] };
    case 'DELETE_AUTO_RECORD':
      return { ...state, autoRecords: state.autoRecords.filter(r => r.id !== action.payload) };
    case 'ADD_SERVICE_RECORD':
      return { ...state, serviceRecords: [...state.serviceRecords, action.payload] };
    case 'DELETE_SERVICE_RECORD':
      return { ...state, serviceRecords: state.serviceRecords.filter(r => r.id !== action.payload) };
    case 'ADD_TARIFF': {
      const filtered = state.tariffs.filter(
        t => !(t.type === action.payload.type && t.category === action.payload.category && t.carrier === action.payload.carrier)
      );
      return { ...state, tariffs: [...filtered, action.payload] };
    }
    case 'DELETE_TARIFF':
      return { ...state, tariffs: state.tariffs.filter(t => t.id !== action.payload) };
    case 'SET_TARIFFS':
      return { ...state, tariffs: action.payload };
    case 'CLEAR_ALL':
      return { ...state, autoRecords: [], serviceRecords: [] };
    case 'IMPORT_DATA':
      return action.payload;
    default:
      return state;
  }
}

// ==================== Контекст ====================
interface StoreContextType {
  state: AppState;
  dispatch: React.Dispatch<Action>;
  syncToServer: () => Promise<boolean>;
  isLocked: boolean;
  lockInfo: { userId: string; computerName: string } | null;
  isLoading: boolean;
  error: string | null;
  // true — включён режим «только просмотр» (гость или заблокирован другими);
  // в этом режиме автосохранение на сервер полностью отключено.
  guestReadOnly: boolean;
  setGuestReadOnly: (value: boolean) => void;
}

const StoreContext = createContext<StoreContextType | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [isLocked, setIsLocked] = useState(false);
  const [lockInfo, setLockInfo] = useState<{ userId: string; computerName: string } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncTimeout, setSyncTimeout] = useState<ReturnType<typeof setTimeout> | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false); // Флаг первой загрузки
  const [guestReadOnly, setGuestReadOnly] = useState(false);

  // Загрузка данных с сервера при старте
  useEffect(() => {
    async function loadFromServer() {
      try {
        setIsLoading(true);
        const data = await fetchData();
        dispatch({ type: 'LOAD_STATE', payload: data });
        setError(null);
      } catch (err) {
        console.error('Ошибка загрузки с сервера:', err);
        setError('Не удалось загрузить данные с сервера. Используем локальное хранилище.');
        // Fallback на localStorage
        try {
          const saved = localStorage.getItem('car_accounting_data');
          if (saved) {
            const parsed = JSON.parse(saved) as AppState;
            dispatch({ type: 'LOAD_STATE', payload: parsed });
          }
        } catch (e) {
          console.error('Ошибка загрузки из localStorage:', e);
        }
      } finally {
        setIsLoading(false);
        setHasLoaded(true); // Устанавливаем флаг после загрузки
      }
    }
    
    loadFromServer();
  }, []);

  // Периодическая проверка статуса блокировки
  useEffect(() => {
    async function checkLockStatus() {
      try {
        const lockStatus = await getLockInfo();
        if (lockStatus.locked && lockStatus.lockInfo) {
          setIsLocked(true);
          setLockInfo({
            userId: lockStatus.lockInfo.userId,
            computerName: lockStatus.lockInfo.computerName
          });
        } else {
          setIsLocked(false);
          setLockInfo(null);
        }
      } catch (err) {
        console.error('Ошибка проверки статуса блокировки:', err);
      }
    }

    // Проверяем сразу при загрузке
    checkLockStatus();

    // Затем проверяем каждые 5 секунд
    const interval = setInterval(checkLockStatus, 5000);

    return () => clearInterval(interval);
  }, []);

  // Автосохранение на сервер при изменении состояния (с debounce).
  // ВАЖНО: в режиме «только просмотр» (guestReadOnly) на сервер не пишем вообще —
  // гость может только смотреть данные, блокировку он не создаёт и не трогает.
  useEffect(() => {
    if (isLoading || !hasLoaded) return; // Не сохраняем при первой загрузке
    if (guestReadOnly) return;

    // Очищаем предыдущий таймер
    if (syncTimeout) {
      clearTimeout(syncTimeout);
    }
    
    // Устанавливаем новый таймер (задержка 2 секунды)
    const timeout = setTimeout(async () => {
      try {
        const currentUser = getCurrentUser();
        
        // Если пользователь не авторизован, НЕ сохраняем на сервер и
        // НЕ устанавливаем блокировку. Раньше сюда мог попасть запрос с
        // анонимным userId — так появлялась возможность «перехватить»
        // чужую блокировку или перезаписать lock.json.
        if (!currentUser) {
          console.log('Пользователь не авторизован, пропускаем синхронизацию с сервером');
          // Сохраняем только в localStorage как backup
          localStorage.setItem('car_accounting_data', JSON.stringify(state));
          return;
        }
        
        const displayName = currentUser.displayName;
        const authUserId = currentUser.id;
        const result = await updateData(state, authUserId, displayName);
        if (result.success) {
          // Продлеваем блокировку чаще, чем истекает её TTL (5 мин):
          // иначе файл успевал удалиться и следующий пользователь видел «пустой» lock.json.
          startLockExtension();
          setIsLocked(false);
          setLockInfo(null);
          setError(null);
          // Также сохраняем в localStorage как backup
          localStorage.setItem('car_accounting_data', JSON.stringify(state));
        } else {
          // Данные заблокированы
          setIsLocked(true);
          setLockInfo(result.lockInfo ? { 
            userId: result.lockInfo.userId, 
            computerName: result.lockInfo.computerName 
          } : null);
          setError(`Данные заблокированы пользователем: ${result.lockInfo?.computerName || 'неизвестно'}`);
        }
      } catch (err) {
        console.error('Ошибка синхронизации с сервером:', err);
        setError('Не удалось синхронизировать с сервером. Данные сохранены локально.');
        // Fallback на localStorage
        localStorage.setItem('car_accounting_data', JSON.stringify(state));
      }
    }, 2000);
    
    setSyncTimeout(timeout);
    
    return () => {
      if (timeout) clearTimeout(timeout);
    };
  }, [state, isLoading, hasLoaded]);

  // Остановка продления блокировки при размонтировании
  useEffect(() => {
    return () => {
      stopLockExtension();
    };
  }, []);

  // Функция для принудительной синхронизации
  const syncToServer = async (): Promise<boolean> => {
    try {
      if (guestReadOnly) return false;
      const currentUser = getCurrentUser();
      // Без авторизации на сервер не пишем: анонимный клиент не должен
      // иметь возможности создать/перезаписать блокировку.
      if (!currentUser) return false;
      const result = await updateData(state, currentUser.id, currentUser.displayName);
      if (result.success) {
        setIsLocked(false);
        setLockInfo(null);
        setError(null);
        return true;
      } else {
        setIsLocked(true);
        setLockInfo(result.lockInfo ? { 
          userId: result.lockInfo.userId, 
          computerName: result.lockInfo.computerName 
        } : null);
        return false;
      }
    } catch (err) {
      console.error('Ошибка синхронизации:', err);
      return false;
    }
  };

  return (
    <StoreContext.Provider value={{ 
      state, 
      dispatch, 
      syncToServer,
      isLocked,
      lockInfo,
      isLoading,
      error,
      guestReadOnly,
      setGuestReadOnly
    }}>
      {children}
    </StoreContext.Provider>
  );
}

export function useStore() {
  const context = useContext(StoreContext);
  if (!context) {
    throw new Error('useStore must be used within StoreProvider');
  }
  return context;
}
