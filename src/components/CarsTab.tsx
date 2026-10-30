import { useState, useMemo, useRef } from 'react';
import { useStore } from '../store';
import { useToast } from './Toast';
import { CarInBase, normalizePlate, formatPlateDisplay, isValidPlateFormat, plateFormatHint, generateId } from '../types';
import { Plus, Edit, Trash2, X, Car, Search } from 'lucide-react';

interface Props {
  onStatus?: (msg: string) => void;
  darkMode?: boolean;
  readOnly?: boolean;
}

export default function CarsTab({ onStatus, darkMode = false, readOnly = false }: Props) {
  const { state, dispatch } = useStore();
  const toast = useToast();

  // Форма добавления/редактирования
  const [editingId, setEditingId] = useState<string | null>(null);
  const [plateInput, setPlateInput] = useState('');
  const [carType, setCarType] = useState('');
  const [carrier, setCarrier] = useState('');

  // Поиск по базе
  const [searchQuery, setSearchQuery] = useState('');

  // Типы ТС и перевозчики берутся из тарифов (тип auto)
  const autoCategories = useMemo(() => {
    return [...new Set(state.tariffs.filter(t => t.type === 'auto').map(t => t.category))].sort();
  }, [state.tariffs]);

  const autoCarriers = useMemo(() => {
    return [...new Set(state.tariffs.filter(t => t.type === 'auto').map(t => t.carrier))].sort();
  }, [state.tariffs]);

  // Перевозчики доступны только в привязке к выбранному типу ТС (сочетание должно быть в тарифах)
  const availableCarriers = useMemo(() => {
    if (!carType) return autoCarriers;
    return [...new Set(
      state.tariffs
        .filter(t => t.type === 'auto' && t.category === carType)
        .map(t => t.carrier)
    )].sort();
  }, [state.tariffs, carType, autoCarriers]);

  // Отсортированная и отфильтрованная база
  const filteredCars = useMemo(() => {
    const cars = [...state.cars].sort((a, b) => a.display.localeCompare(b.display, 'ru'));
    if (!searchQuery.trim()) return cars;
    const q = normalizePlate(searchQuery);
    const raw = searchQuery.trim().toLowerCase();
    return cars.filter(c =>
      c.plate.includes(q) ||
      c.display.toLowerCase().includes(raw) ||
      c.car_type.toLowerCase().includes(raw) ||
      c.carrier.toLowerCase().includes(raw)
    );
  }, [state.cars, searchQuery]);

  // Подсказка формата в реальном времени
  const plateValid = plateInput.trim() === '' || isValidPlateFormat(plateInput);

  const formRef = useRef<HTMLFormElement>(null);

  const resetForm = () => {
    setEditingId(null);
    setPlateInput('');
    setCarType('');
    setCarrier('');
  };

  const openEditForm = (car: CarInBase) => {
    setEditingId(car.id);
    setPlateInput(car.display);
    setCarType(car.car_type);
    setCarrier(car.carrier);
    // Прокручиваем к форме и выделяем поле номера
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    setTimeout(() => formRef.current?.querySelector<HTMLInputElement>('input[type=text]')?.focus(), 100);
  };

  const handleSave = () => {
    const trimmed = plateInput.trim();
    if (!trimmed) {
      toast.warning(`Введите госномер. ${plateFormatHint()}`);
      return;
    }
    if (!isValidPlateFormat(trimmed)) {
      toast.error(`Неверный формат номера. ${plateFormatHint()}`);
      return;
    }
    if (!carType) {
      toast.warning('Выберите тип ТС (из тарифов)');
      return;
    }
    if (!carrier) {
      toast.warning('Выберите перевозчика (из тарифов)');
      return;
    }
    // Обязательно: сочетание «Тип ТС + Перевозчик» должно существовать в тарифах (тип auto)
    const hasTariffCombo = state.tariffs.some(
      t => t.type === 'auto' && t.category === carType && t.carrier === carrier
    );
    if (!hasTariffCombo) {
      toast.error(`В тарифах нет сочетания «${carType}» + «${carrier}». Добавьте такой тариф или выберите другую пару.`);
      return;
    }

    const plate = normalizePlate(trimmed);
    const display = formatPlateDisplay(plate);

    // Проверка на дубликат (при редактировании — не считаем саму себя)
    if (state.cars.some(c => c.plate === plate && c.id !== editingId)) {
      toast.error(`Автомобиль ${display} уже есть в базе`);
      return;
    }

    const car: CarInBase = {
      id: editingId || generateId(),
      plate,
      display,
      car_type: carType,
      carrier,
    };

    dispatch({ type: 'SAVE_CAR', payload: car });
    toast.success(editingId ? `Автомобиль ${display} обновлён` : `Автомобиль ${display} добавлен в базу`);
    onStatus?.(editingId ? `✏️ Автомобиль ${display} обновлён` : `🚗 Автомобиль ${display} добавлен в базу`);
    resetForm();
  };

  const handleDelete = (car: CarInBase) => {
    const trips = state.autoRecords.filter(r => r.car_number === car.plate).length;
    const msg = trips > 0
      ? `Удалить ${car.display} из базы?\nВнимание: к этому номеру привязано записей рейсов: ${trips}. Записи рейсов останутся, но автомобиль перестанет быть доступен для выбора.`
      : `Удалить ${car.display} из базы?`;
    if (confirm(msg)) {
      dispatch({ type: 'DELETE_CAR', payload: car.id });
      toast.success(`Автомобиль ${car.display} удалён из базы`);
      onStatus?.(`🗑️ Автомобиль ${car.display} удалён из базы`);
    }
  };

  const inputCls = `border rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 ${darkMode ? 'bg-gray-700 border-gray-600 text-white' : ''}`;

  return (
    <div className="flex flex-col h-full">
      {/* Форма добавления/редактирования — всегда видна, всё в одну строку */}
      {!readOnly && (
        <div className={`flex-shrink-0 rounded-lg p-3 mb-2 ${darkMode ? 'bg-gray-800' : 'bg-white border border-gray-200'}`}>
          <form
            ref={formRef}
            onSubmit={e => { e.preventDefault(); handleSave(); }}
            className="flex flex-wrap items-center gap-2"
          >
            <span className={`text-sm font-semibold whitespace-nowrap ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
              {editingId ? '✏️ Редактирование' : '🚗 Новый автомобиль'}
            </span>
            <input
              type="text"
              value={plateInput}
              onChange={e => setPlateInput(e.target.value)}
              placeholder="Госномер *"
              title={`Госномер. ${plateFormatHint()}`}
              className={`${inputCls} font-mono w-44`}
            />
            <select
              value={carType}
              onChange={e => {
                setCarType(e.target.value);
                // Если выбранный перевозчик не сочетается с новым типом ТС в тарифах — сбрасываем его
                if (carrier && !state.tariffs.some(t => t.type === 'auto' && t.category === e.target.value && t.carrier === carrier)) {
                  setCarrier('');
                }
              }}
              title="Тип ТС (из тарифов)"
              className={`${inputCls} min-w-[140px]`}
            >
              <option value="">Тип ТС *</option>
              {autoCategories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <select
              value={carrier}
              onChange={e => setCarrier(e.target.value)}
              title={carType ? `Перевозчики для типа «${carType}» (из тарифов)` : 'Перевозчик (из тарифов)'}
              className={`${inputCls} min-w-[140px]`}
            >
              <option value="">Перевозчик *</option>
              {availableCarriers.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <button
              type="submit"
              className="flex items-center gap-1 bg-blue-600 text-white px-3 py-1.5 rounded text-sm hover:bg-blue-700 whitespace-nowrap"
            >
              <Plus size={14} /> {editingId ? 'Сохранить' : 'Добавить'}
            </button>
            {editingId && (
              <button
                type="button"
                onClick={resetForm}
                className={`flex items-center gap-1 px-3 py-1.5 rounded text-sm ${darkMode ? 'bg-gray-700 text-gray-300 hover:bg-gray-600' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}
              >
                <X size={14} /> Отмена
              </button>
            )}
            <span className={`text-xs ${plateValid ? (darkMode ? 'text-gray-500' : 'text-gray-400') : 'text-red-500'}`}>
              {!plateValid
                ? `⚠️ ${plateFormatHint()}`
                : plateInput.trim() && isValidPlateFormat(plateInput)
                  ? `→ ${formatPlateDisplay(normalizePlate(plateInput))}`
                  : `Формат: А 123 АА 123 или 1234 АА 123 · В базе: ${state.cars.length} шт.`}
            </span>
          </form>
          {autoCategories.length === 0 && (
            <p className="text-xs text-amber-600 mt-1">⚠️ В тарифах нет автомобильных категорий/перевозчиков — сначала добавьте тарифы во вкладке «Тарифы».</p>
          )}
        </div>
      )}

      {/* Список базы */}
      <div className={`flex flex-col flex-1 min-h-0 rounded-lg overflow-hidden ${darkMode ? 'bg-gray-800' : 'bg-white border border-gray-200'}`}>
        <div className={`flex-shrink-0 border-b p-3 ${darkMode ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-white'}`}>
          <div className="relative">
            <Search size={16} className={`absolute left-3 top-1/2 -translate-y-1/2 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`} />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="🔍 Поиск по номеру, типу, перевозчику..."
              className={`w-full border rounded pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 ${darkMode ? 'bg-gray-700 border-gray-600 text-white' : ''}`}
            />
          </div>
        </div>

        <div className="flex-1 overflow-auto">
          <table className="w-full text-sm">
            <thead className={`sticky top-0 z-10 ${darkMode ? 'bg-gray-700' : 'bg-gray-100'}`}>
              <tr>
                <th className={`px-2 py-2 text-left w-8 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}></th>
                <th className={`px-2 py-2 text-left text-xs font-medium ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>Госномер</th>
                <th className={`px-2 py-2 text-left text-xs font-medium ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>Тип ТС</th>
                <th className={`px-2 py-2 text-left text-xs font-medium ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>Перевозчик</th>
                <th className={`px-2 py-2 text-center text-xs font-medium ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>Записей рейсов</th>
                {!readOnly && <th className={`px-2 py-2 text-center text-xs font-medium ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>Действия</th>}
              </tr>
            </thead>
            <tbody>
              {filteredCars.map(car => {
                const trips = state.autoRecords.filter(r => r.car_number === car.plate).length;
                return (
                  <tr key={car.id} className={`border-t ${darkMode ? 'border-gray-700 hover:bg-gray-700' : 'hover:bg-gray-50'}`}>
                    <td className="px-2 py-1.5 text-center">
                      <Car size={14} className={darkMode ? 'text-gray-400' : 'text-gray-500'} />
                    </td>
                    <td className={`px-2 py-1.5 font-mono font-semibold ${darkMode ? 'text-gray-100' : 'text-gray-800'}`}>{car.display}</td>
                    <td className="px-2 py-1.5">{car.car_type}</td>
                    <td className="px-2 py-1.5">{car.carrier}</td>
                    <td className="px-2 py-1.5 text-center">{trips}</td>
                    {!readOnly && (
                      <td className="px-2 py-1.5 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => openEditForm(car)}
                            className={`p-1 rounded ${darkMode ? 'text-blue-400 hover:bg-gray-600' : 'text-blue-600 hover:bg-blue-100'}`}
                            title="Редактировать"
                          >
                            <Edit size={14} />
                          </button>
                          <button
                            onClick={() => handleDelete(car)}
                            className="p-1 rounded text-red-500 hover:bg-red-100 dark:hover:bg-red-900/30"
                            title="Удалить"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
              {filteredCars.length === 0 && (
                <tr>
                  <td colSpan={readOnly ? 5 : 6} className={`px-4 py-8 text-center ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                    {state.cars.length === 0 ? 'База автомобилей пуста — добавьте первый автомобиль' : 'Ничего не найдено'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className={`flex-shrink-0 border-t px-4 py-2 text-sm ${darkMode ? 'border-gray-700 bg-gray-800 text-gray-300' : 'border-gray-200 bg-gray-50 text-gray-600'}`}>
          Всего в базе: <b>{state.cars.length}</b>{searchQuery && <> · показано: <b>{filteredCars.length}</b></>}
        </div>
      </div>
    </div>
  );
}
