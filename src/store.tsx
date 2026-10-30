import { Dispatch, createContext, useContext, useReducer, useEffect, useRef, ReactNode, useState } from 'react';
import { AppState, CarInBase, CarRecord, ServiceRecord, Tariff } from './types';
import { fetchData, updateData, startLockExtension, stopLockExtension, getLockInfo, getCurrentUser } from './api';

// ==================== Начальное состояние ====================
const initialState: AppState = {
  autoRecords: [],
  serviceRecords: [],
  tariffs: [],
  cars: [],
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
  | { type: 'SAVE_CAR'; payload: CarInBase }
  | { type: 'DELETE_CAR'; payload: string }
  | { type: 'MERGE_CARS'; payload: CarInBase[] } // импорт базы автомобилей (без перезаписи остальных данных)
  | { type: 'CLEAR_ALL' }
  | { type: 'IMPORT_DATA'; payload: AppState };

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'LOAD_STATE':
      return { ...initialState, ...action.payload };
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
    case 'SAVE_CAR': {
      const exists = state.cars.some(c => c.id === action.payload.id);
      if (exists) {
        // При изменении номера обновляем и уже внесённые записи рейсов с этим номером
        const oldCar = state.cars.find(c => c.id === action.payload.id)!;
        const cars = state.cars.map(c => c.id === action.payload.id ? action.payload : c);
        const autoRecords = oldCar.plate !== action.payload.plate
          ? state.autoRecords.map(r => r.car_number === oldCar.plate ? { ...r, car_number: action.payload.plate } : r)
          : state.autoRecords;
        return { ...state, cars, autoRecords };
      }
      return { ...state, cars: [...state.cars, action.payload] };
    }
    case 'DELETE_CAR':
      return { ...state, cars: state.cars.filter(c => c.id !== action.payload) };
    case 'MERGE_CARS': {
      // Обновляем существующие авто по id, добавляем новые; записи рейсов не трогаем
      const byId = new Map(state.cars.map(c => [c.id, c] as const));
      for (const c of action.payload) byId.set(c.id, c);
      return { ...state, cars: [...byId.values()] };
    }
    case 'CLEAR_ALL':
      return { ...state, autoRecords: [], serviceRecords: [] };
    case 'IMPORT_DATA':
      return { ...initialState, ...action.payload };
    default:
      return state;
  }
}

// ==================== Контекст ====================
interface StoreContextType {
  state: AppState;
  dispatch: Dispatch<Action>;
  syncToServer: () => Promise<boolean>;
  isLocked: boolean;
  lockInfo: { userId: string; computerName: string } | null;
  isLoading: boolean;
  error: string | null;
}

const StoreContext = createContext<StoreContextType | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [isLocked, setIsLocked] = useState(false);
  const [lockInfo, setLockInfo] = useState<{ userId: string; computerName: string } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Таймер debounce — в useRef, чтобы не вызывать лишний ре-рендер на каждое изменение
  const syncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false); // Флаг первой загрузки

  // Единственная точка применения статуса блокировки к состоянию стора
  // (раньше этот код дословно повторялся в полинг-эффекте, автосохранении
  // и syncToServer).
  const applyLock = (locked: boolean, info: { userId: string; computerName: string } | null) => {
    setIsLocked(locked);
    setLockInfo(info);
  };

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
        applyLock(lockStatus.locked && !!lockStatus.lockInfo, lockStatus.lockInfo);
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

  // Автосохранение на сервер при изменении состояния (с debounce)
  useEffect(() => {
    if (isLoading || !hasLoaded) return; // Не сохраняем при первой загрузке
    
    // Очищаем предыдущий таймер
    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current);
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
          applyLock(false, null);
          setError(null);
          // Также сохраняем в localStorage как backup
          localStorage.setItem('car_accounting_data', JSON.stringify(state));
        } else {
          // Данные заблокированы
          applyLock(!!result.lockInfo, result.lockInfo ?? null);
          setError(`Данные заблокированы пользователем: ${result.lockInfo?.computerName || 'неизвестно'}`);
        }
      } catch (err) {
        console.error('Ошибка синхронизации с сервером:', err);
        setError('Не удалось синхронизировать с сервером. Данные сохранены локально.');
        // Fallback на localStorage
        localStorage.setItem('car_accounting_data', JSON.stringify(state));
      }
    }, 2000);
    
    syncTimeoutRef.current = timeout;
    
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
      const currentUser = getCurrentUser();
      // Без авторизации на сервер не пишем: анонимный клиент не должен
      // иметь возможности создать/перезаписать блокировку.
      if (!currentUser) return false;
      const result = await updateData(state, currentUser.id, currentUser.displayName);
      if (result.success) {
        applyLock(false, null);
        setError(null);
        return true;
      } else {
        applyLock(!!result.lockInfo, result.lockInfo ?? null);
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
      error
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
