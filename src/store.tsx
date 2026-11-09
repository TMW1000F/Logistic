import { Dispatch, createContext, useContext, useReducer, useEffect, useRef, ReactNode, useState, useMemo } from 'react';
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
  | { type: 'UPDATE_TARIFF'; payload: Tariff }
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
      // Дубликаты (та же связка type+category+carrier) не добавляем:
      // обновляем цену/тип оплаты существующего тарифа.
      const existing = state.tariffs.find(
        t => t.type === action.payload.type && t.category === action.payload.category && t.carrier === action.payload.carrier
      );
      if (existing) {
        return {
          ...state,
          tariffs: state.tariffs.map(t =>
            t.id === existing.id ? { ...t, price: action.payload.price, payment_type: action.payload.payment_type } : t
          ),
        };
      }
      return { ...state, tariffs: [...state.tariffs, action.payload] };
    }
    case 'UPDATE_TARIFF': {
      // Обновление строго по id — только этот тариф меняется,
      // никакие другие строки не удаляются и не дублируются.
      return {
        ...state,
        tariffs: state.tariffs.map(t => (t.id === action.payload.id ? action.payload : t)),
      };
    }
    case 'DELETE_TARIFF':
      // Удаление строго по id — удаляется ровно один выбранный тариф.
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
  refreshFromServer: () => Promise<void>;
  isLocked: boolean;
  lockInfo: { userId: string; computerName: string } | null;
  isLoading: boolean;
  error: string | null;
}

const StoreContext = createContext<StoreContextType | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  // Флаг «в состоянии есть несохранённые локальные изменения». Ставится в
  // reducer-обёртке при любом изменяющем действии и сбрасывается после
  // успешной записи на сервер / загрузки с сервера. Нужен, чтобы фоновые
  // операции (первичная загрузка, refreshFromServer) не могли перезаписать
  // экран устаревшим серверным снимком, пока пользователь уже внёс правки —
  // отсюда эффекты «старый тариф вернулся», «удалился не тот».
  const dirtyRef = useRef(false);

  // === Мгновенная запись изменений тарифов на сервер ====================
  // Проблема: автосохранение имеет debounce 2 секунды и НЕ пишет на сервер,
  // если пользователь не авторизован (только в localStorage). Если в течение
  // этих секунд обновить страницу (F5), изменение существует лишь в памяти
  // браузера и теряется («новый тариф исчез после обновления страницы»).
  // Поэтому действия с тарифами помечаются как «ждут немедленной записи», а
  // эффект ниже сразу после dispatch запускает сохранение, не дожидаясь
  // debounce-таймера.
  const pendingTariffSyncRef = useRef(false);

  // Обёртка над reducer: любое изменяющее действие помечает состояние как
  // «грязное» (кроме LOAD_STATE/CLEAR_ALL — они сами приходят с сервера),
  // а действия с тарифами дополнительно просят немедленную запись на сервер.
  // useMemo([]) — стабильная ссылка, чтобы useReducer не пересоздавался.
  const reducerWithDirty = useMemo(() => {
    return (s: AppState, a: Action): AppState => {
      if (a.type !== 'LOAD_STATE' && a.type !== 'CLEAR_ALL') {
        dirtyRef.current = true;
      }
      if (a.type === 'ADD_TARIFF' || a.type === 'UPDATE_TARIFF' || a.type === 'DELETE_TARIFF' || a.type === 'SET_TARIFFS') {
        pendingTariffSyncRef.current = true;
      }
      return reducer(s, a);
    };
  }, []);

  const [state, dispatch] = useReducer(reducerWithDirty, initialState);
  const [isLocked, setIsLocked] = useState(false);
  const [lockInfo, setLockInfo] = useState<{ userId: string; computerName: string } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Таймер debounce — в useRef, чтобы не вызывать лишний ре-рендер на каждое изменение
  const syncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false); // Флаг первой загрузки
  // Актуальное состояние для асинхронных колбэков (syncToServer)
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);
  // Флаг «идёт принудительная загрузка с сервера» (refreshFromServer).
  // Пока он установлен, debounce-автосохранение приостанавливается: иначе
  // только что скачанный с сервера снимок вызвал бы эффект автосохранения
  // и лишним POSTом перезаписал data.json (или столкнулся с блокировкой).
  const refreshingRef = useRef(false);


  // Единственная точка применения статуса блокировки к состоянию стора
  // (раньше этот код дословно повторялся в полинг-эффекте, автосохранении
  // и syncToServer).
  const applyLock = (locked: boolean, info: { userId: string; computerName: string } | null) => {
    setIsLocked(locked);
    setLockInfo(info);
  };

  // Эффект-исполнитель немедленного сохранения тарифов: срабатывает на
  // каждое изменение состояния, но реально пишет только если редьюсер
  // оставил флаг pendingTariffSyncRef. Отменяем debounce-таймер, чтобы не
  // отправить второй идентичный POST через 2 секунды.
  useEffect(() => {
    if (!pendingTariffSyncRef.current) return;
    pendingTariffSyncRef.current = false;
    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current);
      syncTimeoutRef.current = null;
    }
    // Мгновенно пишем резервную копию в localStorage — она не зависит от
    // авторизации/блокировки и переживёт обновление страницы даже если
    // сервер недоступен или запись отклонена блокировкой.
    try { localStorage.setItem('car_accounting_data', JSON.stringify(state)); } catch { /* noop */ }
    // Сохраняем актуальный stateRef.current (эффект вызван после рендера
    // с новым состоянием, поэтому ref уже обновлён).
    syncToServer().catch(() => {
      /* ошибка уже обработана внутри syncToServer */
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // Загрузка данных с сервера при старте
  useEffect(() => {
    async function loadFromServer() {
      try {
        setIsLoading(true);
        const data = await fetchData();
        // Если между отправкой запроса и ответом пользователь уже успел
        // что-то изменить локально (например, сохранил тариф до того, как
        // ответил медленный сервер), НЕ перезаписываем экран устаревшим
        // снимком — вместо этого сразу отправляем локальное состояние на
        // сервер (см. syncToServer ниже).
        if (dirtyRef.current) {
          syncToServer().catch(() => {});
          return;
        }
        dispatch({ type: 'LOAD_STATE', payload: data });
        localStorage.setItem('car_accounting_data', JSON.stringify(data));
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

  // Загрузка данных с сервера выполняется ТОЛЬКО при первом запуске
  // (см. эффект loadFromServer выше). Периодическое автообновление при
  // фокусе/видимости окна намеренно удалено: оно конфликтовало с
  // локальными действиями пользователя (в частности, с удалением записей)
  // и возвращало в таблицу уже удалённые строки, если серверный снимок
  // на момент ответа ещё содержал их.

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
        // Если идёт принудительная загрузка с сервера (refreshFromServer),
        // не сохраняем: иначе скачанный снимок сразу же уйдёт обратно на
        // сервер лишним POSTом.
        if (refreshingRef.current) return;

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
          // Сервер подтвердил запись — локальных несохранённых изменений больше нет
          dirtyRef.current = false;
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

  // Функция для принудительной синхронизации. Сохраняет на сервер актуальное
  // состояние (через stateRef, чтобы не зависеть от замыкания момента рендера).
  const syncToServer = async (): Promise<boolean> => {
    try {
      const currentUser = getCurrentUser();
      // Без авторизации на сервер не пишем: анонимный клиент не должен
      // иметь возможности создать/перезаписать блокировку.
      if (!currentUser) return false;
      const snapshot = stateRef.current;
      const result = await updateData(snapshot, currentUser.id, currentUser.displayName);
      if (result.success) {
        dirtyRef.current = false; // запись подтверждена сервером
        applyLock(false, null);
        setError(null);
        localStorage.setItem('car_accounting_data', JSON.stringify(snapshot));
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

  // Принудительная загрузка актуальных данных с сервера (свежий data.json).
  // Вызывается при открытии вкладки «Данные автомобиля», чтобы после
  // архивирования/восстановления из бэкапа на экране не оставались
  // устаревшие (закешенные) строки.
  // ВАЖНО про порядок операций: локальные изменения (например, удаление
  // строки) сначала записываются на сервер (syncToServer awaited), и только
  // потом таблица обновляется этим refreshFromServer. Если бы обновление
  // произошло до записи, сервер вернул бы ещё не удалённую запись и она
  // «воскресла» бы в таблице — удалить её стало бы невозможно.
  const refreshFromServer = async (): Promise<void> => {
    // Не перезагружаем, пока идёт первая загрузка или данные заблокированы
    if (isLoading || isLocked) return;
    try {
      refreshingRef.current = true;
      // Отменяем отложенное автосохранение — оно не должно выстрелить
      // по воле dispatch(LOAD_STATE) ниже.
      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current);
        syncTimeoutRef.current = null;
      }
      const data = await fetchData();
      // Если за время запроса пользователь успел что-то изменить локально,
      // не затираем его изменения серверным снимком.
      if (dirtyRef.current) return;
      dispatch({ type: 'LOAD_STATE', payload: data });
      localStorage.setItem('car_accounting_data', JSON.stringify(data));
      setError(null);
    } catch (err) {
      // Сервер недоступен — оставляем текущие данные как есть
      console.error('Ошибка обновления данных с сервера:', err);
    } finally {
      refreshingRef.current = false;
    }
  };

  return (
    <StoreContext.Provider value={{ 
      state, 
      dispatch, 
      syncToServer,
      refreshFromServer,
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
