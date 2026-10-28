import React, { createContext, useContext, useReducer, useEffect, ReactNode } from 'react';
import { AppState, CarRecord, ServiceRecord, Tariff } from './types';

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
}

const StoreContext = createContext<StoreContextType | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  // Загрузка из localStorage при старте
  useEffect(() => {
    try {
      const saved = localStorage.getItem('car_accounting_data');
      if (saved) {
        const parsed = JSON.parse(saved) as AppState;
        dispatch({ type: 'LOAD_STATE', payload: parsed });
      }
    } catch (e) {
      console.error('Error loading data:', e);
    }
  }, []);

  // Сохранение в localStorage при изменении
  useEffect(() => {
    try {
      localStorage.setItem('car_accounting_data', JSON.stringify(state));
    } catch (e) {
      console.error('Error saving data:', e);
    }
  }, [state]);

  return (
    <StoreContext.Provider value={{ state, dispatch }}>
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
