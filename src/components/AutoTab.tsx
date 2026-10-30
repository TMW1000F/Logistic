import { useState, useMemo, useRef, useEffect, type KeyboardEvent } from 'react';
import { useStore } from '../store';
import { useToast } from './Toast';
import { CarRecord, CarInBase, formatPlateDisplay as formatPlateDisplaySafe, calcDurationHours, calcAutoCost, formatNumber, formatDate, generateId, normalizePlate, isValidPlateFormat, plateFormatHint } from '../types';
import { Plus, Trash2, CheckSquare, Square } from 'lucide-react';
import SearchAndTags, { FilterTag } from './SearchAndTags';
import { playClick } from '../sound';

// Список значений времени с шагом 30 минут: минуты только 0 и 30
const TIME_OPTIONS: string[] = Array.from({ length: 48 }, (_, i) => {
  const h = String(Math.floor(i / 2)).padStart(2, '0');
  const m = i % 2 === 0 ? '00' : '30';
  return `${h}:${m}`;
});

interface Props {
  darkMode?: boolean;
  readOnly?: boolean;
}

export default function AutoTab({ darkMode = false, readOnly = false }: Props) {
  const { state, dispatch } = useStore();
  const toast = useToast();

  // Форма ввода
  const [selectedCarId, setSelectedCarId] = useState('');
  const [plateQuery, setPlateQuery] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [highlightedIdx, setHighlightedIdx] = useState(0);
  const [carType, setCarType] = useState('');
  const [carrier, setCarrier] = useState('');
  const [arrival, setArrival] = useState('08:00');
  const [departure, setDeparture] = useState('16:00');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [useCoefficient, setUseCoefficient] = useState(false);
  const [coefficient, setCoefficient] = useState('1.5');

  // Поиск и теги-фильтры
  const [searchQuery, setSearchQuery] = useState('');
  const [filterTags, setFilterTags] = useState<FilterTag[]>([]);

  // Фильтр по интервалу дат
  const [dateRangeEnabled, setDateRangeEnabled] = useState(false);
  const [dateRangeStart, setDateRangeStart] = useState(new Date().toISOString().split('T')[0]);
  const [dateRangeEnd, setDateRangeEnd] = useState(new Date().toISOString().split('T')[0]);

  // Множественный выбор
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Группировка
  const [groupBy, setGroupBy] = useState<'none' | 'number' | 'type'>('none');

  // База автомобилей: выбранный автомобиль и отфильтрованный список для подсказок
  const selectedCar = useMemo(
    () => state.cars.find(c => c.id === selectedCarId) || null,
    [state.cars, selectedCarId]
  );

  const plateSuggestions = useMemo(() => {
    const q = plateQuery.trim();
    if (!q) return state.cars.slice().sort((a, b) => a.display.localeCompare(b.display, 'ru'));
    // Ищем по нормализованному вводу (без пробелов) — допускаем часть номера
    const nq = normalizePlate(q);
    const lq = q.toLowerCase();
    return state.cars
      .filter(c =>
        c.plate.includes(nq) ||
        c.display.toLowerCase().includes(lq) ||
        c.car_type.toLowerCase().includes(lq) ||
        c.carrier.toLowerCase().includes(lq)
      )
      .sort((a, b) => a.display.localeCompare(b.display, 'ru'));
  }, [state.cars, plateQuery]);

  // Выбор автомобиля из базы: тип ТС и перевозчик подтягиваются автоматически
  const selectCar = (car: CarInBase | null) => {
    if (!car) {
      setSelectedCarId('');
      setPlateQuery('');
      setCarType('');
      setCarrier('');
      return;
    }
    setSelectedCarId(car.id);
    setPlateQuery(car.display);
    setCarType(car.car_type);
    setCarrier(car.carrier);
    setShowDropdown(false);
  };

  const handlePlateInput = (value: string) => {
    // Если пользователь начал печатать заново — сбрасываем выбор, но запоминаем ввод
    if (selectedCarId && value !== (selectedCar?.display ?? '')) {
      setSelectedCarId('');
      setCarType('');
      setCarrier('');
    }
    setPlateQuery(value);
    setShowDropdown(true);
    setHighlightedIdx(0);
  };

  // Получить тариф
  const getTariff = (type: string, carr: string): number | null => {
    const t = state.tariffs.find(tar => tar.type === 'auto' && tar.category === type && tar.carrier === carr);
    return t ? t.price : null;
  };

  // Фильтрация записей
  const filteredRecords = useMemo(() => {
    let records = [...state.autoRecords];

    // Фильтр по тегам
    for (const tag of filterTags) {
      if (tag.field === 'car_number') {
        records = records.filter(r => r.car_number === tag.value);
      } else if (tag.field === 'car_type') {
        records = records.filter(r => r.car_type === tag.value);
      } else if (tag.field === 'carrier') {
        records = records.filter(r => r.carrier === tag.value);
      } else if (tag.field === 'date') {
        records = records.filter(r => r.date === tag.value);
      }
    }

    // Строковой поиск
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      records = records.filter(r =>
        r.car_number.toLowerCase().includes(q) ||
        r.car_type.toLowerCase().includes(q) ||
        r.carrier.toLowerCase().includes(q) ||
        r.date.includes(q) ||
        formatDate(r.date).includes(q)
      );
    }

    // Фильтр по интервалу дат
    if (dateRangeEnabled && dateRangeStart && dateRangeEnd) {
      records = records.filter(r => r.date >= dateRangeStart && r.date <= dateRangeEnd);
    }

    return records;
  }, [state.autoRecords, filterTags, searchQuery, dateRangeEnabled, dateRangeStart, dateRangeEnd]);

  // Ссылка на прокручиваемый контейнер таблицы и автоскролл вниз при добавлении записей
  const tableScrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = tableScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [state.autoRecords.length]);

  // Добавление тега-фильтра
  const addFilterTag = (field: string, value: string) => {
    if (!value) return;
    // Не добавляем дубликат
    if (filterTags.some(t => t.field === field && t.value === value)) return;
    
    const labels: Record<string, string> = {
      car_number: 'Номер ТС',
      car_type: 'Тип ТС',
      carrier: 'Перевозчик',
      date: 'Дата',
    };
    
    setFilterTags([...filterTags, { field, value, label: labels[field] || field }]);
  };

  const removeTag = (index: number) => {
    setFilterTags(filterTags.filter((_, i) => i !== index));
  };

  const clearAllTags = () => {
    setFilterTags([]);
    setSearchQuery('');
  };

  // Группировка
  const displayData = useMemo(() => {
    if (groupBy === 'none') {
      return filteredRecords.map(r => ({
        car_number: r.car_number,
        car_type: r.car_type,
        carrier: r.carrier,
        arrival: r.arrival,
        departure: r.departure,
        hours: calcDurationHours(r.arrival, r.departure),
        cost: calcAutoCost(r),
        tariff: r.tariff,
        date: r.date,
        coefficient: r.coefficient,
        has_high_tariff: r.coefficient !== 1.0,
        id: r.id,
        is_group: false,
      }));
    }

    const groups: Record<string, { count: number; total_hours: number; total_cost: number; car_type?: string; carrier?: string }> = {};
    
    for (const r of filteredRecords) {
      const key = groupBy === 'number' ? r.car_number : r.car_type;
      if (!groups[key]) {
        groups[key] = { count: 0, total_hours: 0, total_cost: 0, car_type: r.car_type, carrier: r.carrier };
      }
      groups[key].count++;
      groups[key].total_hours += calcDurationHours(r.arrival, r.departure);
      groups[key].total_cost += calcAutoCost(r);
    }

    return Object.entries(groups).map(([key, data]) => ({
      car_number: groupBy === 'number' ? key : '',
      car_type: groupBy === 'type' ? key : (data.car_type || ''),
      carrier: groupBy === 'number' ? (data.carrier || '') : '',
      arrival: '',
      departure: '',
      hours: data.total_hours,
      cost: data.total_cost,
      tariff: 0,
      date: '',
      coefficient: 1,
      has_high_tariff: false,
      id: key,
      is_group: true,
      group_count: data.count,
    }));
  }, [filteredRecords, groupBy]);

  // Итоги
  const totals = useMemo(() => {
    let totalHours = 0;
    let totalCost = 0;
    for (const r of filteredRecords) {
      totalHours += calcDurationHours(r.arrival, r.departure);
      totalCost += calcAutoCost(r);
    }
    return { count: filteredRecords.length, totalHours, totalCost };
  }, [filteredRecords]);

  // Сохранение
  const handleSave = () => {
    let plate = '';
    if (selectedCar) {
      plate = selectedCar.plate;
    } else {
      const q = plateQuery.trim();
      if (!q) {
        toast.warning('Выберите автомобиль из базы — начните вводить номер и выберите из подсказок');
        return;
      }
      if (!isValidPlateFormat(q)) {
        toast.error(`Неверный формат номера. ${plateFormatHint()}`);
        return;
      }
      const norm = normalizePlate(q);
      const inBase = state.cars.find(c => c.plate === norm);
      if (inBase) {
        selectCar(inBase);
        plate = inBase.plate;
      } else {
        toast.warning(`Автомобиль «${formatPlateDisplaySafe(norm)}» не найден в базе. Добавьте его во вкладку «База автомобилей» или выберите из подсказок.`);
        setShowDropdown(true);
        return;
      }
    }
    if (!carType || !carrier) {
      toast.warning('Для выбранного автомобиля не заданы тип ТС и перевозчик. Проверьте запись в базе «База автомобилей».');
      return;
    }

    const tariff = getTariff(carType, carrier);
    if (tariff === null) {
      toast.error(`Тариф для "${carType}" и "${carrier}" не найден. Добавьте тариф во вкладке "Тарифы".`);
      return;
    }

    const coef = useCoefficient ? parseFloat(coefficient.replace(',', '.')) : 1.0;
    if (isNaN(coef) || coef <= 0) {
      toast.error('Некорректный коэффициент');
      return;
    }

    const record: CarRecord = {
      id: generateId(),
      car_number: plate,
      car_type: carType,
      carrier: carrier,
      arrival,
      departure,
      date,
      tariff,
      coefficient: coef,
    };

    // Запоминаем отображаемый номер до очистки формы (для сообщения)
    const displayForMsg = selectedCar?.display ?? formatPlateDisplaySafe(record.car_number);

    dispatch({ type: 'ADD_AUTO_RECORD', payload: record });
    playClick(); // ненавязчивый отклик об успешном добавлении
    // Очищаем форму ввода после успешного добавления (по кнопке или Enter)
    selectCar(null);
    setArrival('08:00');
    setDeparture('16:00');
    setDate(new Date().toISOString().split('T')[0]);
    setCoefficient('1.5');
    setUseCoefficient(false);
    toast.success(`Автомобиль ${displayForMsg} добавлен`);
    toast.success(`✅ Автомобиль ${displayForMsg} добавлен`);

  };

  // Удаление одной записи
  const handleDelete = (id: string) => {
    if (confirm('Удалить выбранную запись?')) {
      dispatch({ type: 'DELETE_AUTO_RECORD', payload: id });
      setSelectedIds(prev => { const n = new Set(prev); n.delete(id); return n; });
      toast.success('Запись удалена');
      toast.error('🗑️ Запись удалена');

    }
  };

  // Удаление выбранных
  const handleDeleteSelected = () => {
    if (selectedIds.size === 0) {
      toast.warning('Выберите записи для удаления');
      return;
    }
    if (!confirm(`Удалить ${selectedIds.size} записей?`)) return;
    
    for (const id of selectedIds) {
      dispatch({ type: 'DELETE_AUTO_RECORD', payload: id });
    }
    const count = selectedIds.size;
    setSelectedIds(new Set());
    toast.success(`Удалено записей: ${count}`);
    toast.error(`🗑️ Удалено записей: ${count}`);

  };

  // Выбор всех / снять все
  const toggleSelectAll = () => {
    if (selectedIds.size === filteredRecords.length && filteredRecords.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredRecords.map(r => r.id)));
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  // Обработка клавиш в поле номера: стрелки — навигация по подсказкам, Enter — выбор/добавление
  const handleKeyDown = (e: KeyboardEvent, source: 'plate' | 'other' = 'other') => {
    if (source === 'plate') {
      if (showDropdown && plateSuggestions.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setHighlightedIdx(i => Math.min(i + 1, plateSuggestions.length - 1));
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setHighlightedIdx(i => Math.max(i - 1, 0));
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          // Если набран точный номер из базы и он отфильтрован в одну строку — выбираем его
          const exact = plateSuggestions.find(c => c.plate === normalizePlate(plateQuery));
          selectCar(exact ?? plateSuggestions[highlightedIdx] ?? null);
          return;
        }
        if (e.key === 'Escape') {
          setShowDropdown(false);
          return;
        }
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSave();
      }
      return;
    }
    if (e.key === 'Enter') {
      handleSave();
    }
  };

  const idxInList = (id: string) => plateSuggestions.findIndex(c => c.id === id);

  return (
    <div className="flex flex-col h-full">
      {/* Sticky форма ввода */}
      {!readOnly && (
      <div className={`flex-shrink-0 rounded-lg p-3 mb-2 ${darkMode ? 'bg-gray-800' : 'bg-white border border-gray-200'}`}>
        {/* Одна строка: все поля и кнопки */}
        <div className="flex flex-wrap items-end gap-2">
          <div className="relative min-w-[220px] flex-1 max-w-xs">
            <label className={`text-xs ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>Автомобиль (из базы):</label>
            <div className="flex gap-1">
              <input
                type="text"
                value={plateQuery}
                onChange={e => handlePlateInput(e.target.value)}
                onFocus={() => setShowDropdown(true)}
                onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
                onKeyDown={e => handleKeyDown(e, 'plate')}
                placeholder="Начните вводить номер..."
                className={`w-full border rounded px-2 py-1 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-400 ${
                  selectedCar
                    ? (darkMode ? 'bg-gray-700 border-green-500 text-white' : 'border-green-500')
                    : (darkMode ? 'bg-gray-700 border-gray-600 text-white' : '')
                }`}
              />
              {selectedCarId && (
                <button
                  type="button"
                  onMouseDown={e => { e.preventDefault(); selectCar(null); }}
                  title="Сбросить выбор"
                  className={`px-2 rounded text-xs ${darkMode ? 'bg-gray-700 text-gray-300 hover:bg-gray-600' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
                >
                  ✕
                </button>
              )}
            </div>
            {showDropdown && (
              <div className={`absolute z-30 left-0 right-0 top-full mt-1 max-h-60 overflow-auto rounded-md border shadow-lg ${darkMode ? 'bg-gray-700 border-gray-600' : 'bg-white border-gray-200'}`}>
                {plateSuggestions.length === 0 ? (
                  <div className={`px-3 py-2 text-xs ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                    Ничего не найдено. Добавьте автомобиль во вкладке «База автомобилей».
                  </div>
                ) : (
                  <>
                    {plateSuggestions.map(c => (
                      <button
                        key={c.id}
                        type="button"
                        onMouseDown={e => { e.preventDefault(); selectCar(c); }}
                        onMouseEnter={() => setHighlightedIdx(plateSuggestions.findIndex(x => x.id === c.id))}
                        className={`w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 ${
                          idxInList(c.id) === highlightedIdx && showDropdown
                            ? (darkMode ? 'bg-blue-800 text-white' : 'bg-blue-600 text-white')
                            : c.id === selectedCarId
                              ? (darkMode ? 'bg-blue-900/50 text-blue-200' : 'bg-blue-100 text-blue-800')
                              : (darkMode ? 'text-gray-100' : '')
                        }`}
                      >
                        <span className="font-mono font-semibold">{c.display}</span>
                        <span className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{c.car_type} · {c.carrier}</span>
                      </button>
                    ))}
                    {plateQuery.trim() && !isValidPlateFormat(plateQuery) && (
                      <div className={`px-3 py-1.5 text-xs ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{plateFormatHint()}</div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
          <div>
            <label className={`text-xs ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>Дата:</label>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className={`border rounded px-2 py-1 text-sm w-36 ${darkMode ? 'bg-gray-700 border-gray-600 text-white' : ''}`}
            />
          </div>
          <div>
            <label className={`text-xs ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>Прибытие:</label>
            <select
              value={arrival}
              onChange={e => setArrival(e.target.value)}
              className={`border rounded px-2 py-1 text-sm w-28 ${darkMode ? 'bg-gray-700 border-gray-600 text-white' : ''}`}
            >
              {TIME_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className={`text-xs ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>Убытие:</label>
            <select
              value={departure}
              onChange={e => setDeparture(e.target.value)}
              className={`border rounded px-2 py-1 text-sm w-28 ${darkMode ? 'bg-gray-700 border-gray-600 text-white' : ''}`}
            >
              {TIME_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={useCoefficient}
              onChange={e => setUseCoefficient(e.target.checked)}
              id="auto_coef"
            />
            <label htmlFor="auto_coef" className={`text-xs ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>Коэф.:</label>
            <input
              type="text"
              value={coefficient}
              onChange={e => setCoefficient(e.target.value)}
              disabled={!useCoefficient}
              className={`w-14 border rounded px-2 py-1 text-sm ${darkMode ? 'bg-gray-700 border-gray-600 text-white' : ''}`}
            />
          </div>
          <div className="flex items-center gap-1 border-l pl-2 ml-1">
            <input
              type="checkbox"
              checked={dateRangeEnabled}
              onChange={e => setDateRangeEnabled(e.target.checked)}
              id="date_range"
            />
            <label htmlFor="date_range" className={`text-xs ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>Интервал:</label>
            <input
              type="date"
              value={dateRangeStart}
              onChange={e => setDateRangeStart(e.target.value)}
              disabled={!dateRangeEnabled}
              className={`border rounded px-1 py-1 text-xs w-32 ${darkMode ? 'bg-gray-700 border-gray-600 text-white' : ''}`}
            />
            <span className="text-xs">—</span>
            <input
              type="date"
              value={dateRangeEnd}
              onChange={e => setDateRangeEnd(e.target.value)}
              disabled={!dateRangeEnabled}
              className={`border rounded px-1 py-1 text-xs w-32 ${darkMode ? 'bg-gray-700 border-gray-600 text-white' : ''}`}
            />
          </div>
          {carType && carrier && (
            <span className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
              Тариф: {getTariff(carType, carrier) !== null ? `${formatNumber(getTariff(carType, carrier)!)} ₽/ч` : '⚠️ Не найден'}
            </span>
          )}
          {selectedIds.size > 0 && (
            <button
              onClick={handleDeleteSelected}
              className="flex items-center gap-1 bg-red-600 text-white px-3 py-1.5 rounded text-sm hover:bg-red-700"
            >
              <Trash2 size={14} /> Удалить ({selectedIds.size})
            </button>
          )}
          <button
            onClick={handleSave}
            className="ml-auto flex items-center gap-1 bg-blue-600 text-white px-3 py-1.5 rounded text-sm hover:bg-blue-700"
          >
            <Plus size={14} /> Добавить
          </button>
        </div>
      </div>
      )}

      {/* Контейнер: поиск + таблица + итоги (занимает всё оставшееся место) */}
      <div className={`flex flex-col flex-1 min-h-0 rounded-lg overflow-hidden ${darkMode ? 'bg-gray-800' : 'bg-white border border-gray-200'}`}>
        {/* Поиск и теги — закреплено сверху, не прокручивается */}
        <div className={`flex-shrink-0 border-b p-3 ${darkMode ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-white'}`}>
          <SearchAndTags
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            tags={filterTags}
            onRemoveTag={removeTag}
            onClearAll={clearAllTags}
            placeholder="🔍 Поиск по номеру, типу, перевозчику, дате..."
            darkMode={darkMode}
          />
        </div>

        {/* Таблица — прокручивается только она */}
        <div ref={tableScrollRef} className="flex-1 overflow-auto">
          <table className="w-full text-sm">
            <thead className={`sticky top-0 z-10 ${darkMode ? 'bg-gray-700' : 'bg-gray-100'}`}>
              <tr>
                {/* Колонка чекбоксов: в режиме только чтения скрываем сам чекбокс
                    «выбрать все», но колонку оставляем — иначе ячейки tbody
                    съезжают относительно заголовков. */}
                <th className={`px-2 py-2 text-center w-8 sticky left-0 z-20 ${darkMode ? 'bg-gray-700' : 'bg-gray-100'}`}>
                  {!readOnly && (
                    <button onClick={toggleSelectAll} title="Выбрать все">
                      {filteredRecords.length > 0 && selectedIds.size === filteredRecords.length ? (
                        <CheckSquare size={16} className="text-blue-600" />
                      ) : (
                        <Square size={16} className={darkMode ? 'text-gray-500' : 'text-gray-400'} />
                      )}
                    </button>
                  )}
                </th>
                <th className={`px-2 py-2 text-left text-xs font-medium ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>№ ТС</th>
                <th className={`px-2 py-2 text-left text-xs font-medium ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>Тип ТС</th>
                <th className={`px-2 py-2 text-left text-xs font-medium ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>Перевозчик</th>
                <th className={`px-2 py-2 text-center text-xs font-medium ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>Прибыл</th>
                <th className={`px-2 py-2 text-center text-xs font-medium ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>Убыл</th>
                <th className={`px-2 py-2 text-right text-xs font-medium ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>Часы</th>
                <th className={`px-2 py-2 text-right text-xs font-medium ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>Стоимость</th>
                <th className={`px-2 py-2 text-right text-xs font-medium ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>Тариф</th>
                <th className={`px-2 py-2 text-center text-xs font-medium ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>Дата</th>
                <th className={`px-2 py-2 text-center text-xs font-medium ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>Коэф.</th>
                {/* Колонка действий: в режиме только чтения скрываем кнопки, но саму
                    колонку оставляем (пустым <th/>), чтобы ячейки tbody не съезжали
                    влево относительно заголовков. */}
                <th className={`px-2 py-2 text-center text-xs font-medium ${darkMode ? 'text-gray-300' : 'text-gray-600'} ${readOnly ? 'w-8' : ''}`}>
                  {!readOnly && '⚙️'}
                </th>
              </tr>
            </thead>
            <tbody>
              {displayData.map((row, idx) => (
                <tr
                  key={idx}
                  className={`border-t ${darkMode ? 'border-gray-700 hover:bg-gray-700' : 'hover:bg-gray-50'} ${row.has_high_tariff ? (darkMode ? 'bg-red-900/30' : 'bg-red-50') : ''} ${row.is_group ? (darkMode ? 'bg-blue-900/30 font-semibold' : 'bg-blue-50 font-semibold') : ''} ${selectedIds.has(row.id) ? (darkMode ? 'bg-blue-900/50' : 'bg-blue-100') : ''}`}
                >
                  <td className="px-2 py-1.5 text-center sticky left-0 bg-inherit">
                    {!row.is_group && !readOnly && (
                      <input
                        type="checkbox"
                        checked={selectedIds.has(row.id)}
                        onChange={() => toggleSelect(row.id)}
                      />
                    )}
                  </td>
                  <td
                    className={`px-2 py-1.5 cursor-pointer ${darkMode ? 'hover:bg-blue-800' : 'hover:bg-blue-100'} hover:underline`}
                    onClick={() => !row.is_group && addFilterTag('car_number', row.car_number)}
                    title="Клик — добавить фильтр"
                  >
                    {row.car_number}
                  </td>
                  <td
                    className={`px-2 py-1.5 cursor-pointer ${darkMode ? 'hover:bg-blue-800' : 'hover:bg-blue-100'} hover:underline`}
                    onClick={() => !row.is_group && addFilterTag('car_type', row.car_type)}
                    title="Клик — добавить фильтр"
                  >
                    {row.car_type}
                  </td>
                  <td
                    className={`px-2 py-1.5 cursor-pointer ${darkMode ? 'hover:bg-blue-800' : 'hover:bg-blue-100'} hover:underline`}
                    onClick={() => !row.is_group && addFilterTag('carrier', row.carrier)}
                    title="Клик — добавить фильтр"
                  >
                    {row.carrier}
                  </td>
                  <td className="px-2 py-1.5 text-center">{row.arrival}</td>
                  <td className="px-2 py-1.5 text-center">{row.departure}</td>
                  <td className="px-2 py-1.5 text-right">{formatNumber(row.hours)}</td>
                  <td className="px-2 py-1.5 text-right font-medium">{formatNumber(row.cost)}</td>
                  <td className="px-2 py-1.5 text-right">{row.tariff ? formatNumber(row.tariff) : '-'}</td>
                  <td
                    className={`px-2 py-1.5 text-center cursor-pointer ${darkMode ? 'hover:bg-blue-800' : 'hover:bg-blue-100'} hover:underline`}
                    onClick={() => !row.is_group && addFilterTag('date', row.date)}
                    title="Клик — добавить фильтр"
                  >
                    {row.date ? formatDate(row.date) : (row.is_group ? `${(row as any).group_count} рейсов` : '-')}
                  </td>
                  <td className="px-2 py-1.5 text-center">{row.has_high_tariff ? `×${row.coefficient}` : '-'}</td>
                  <td className="px-2 py-1.5 text-center">
                    {!row.is_group && !readOnly && (
                      <button onClick={() => handleDelete(row.id)} className="text-red-500 hover:text-red-700">
                        <Trash2 size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {displayData.length === 0 && (
                <tr>
                  <td colSpan={12} className={`px-4 py-8 text-center ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>Нет данных</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Итоги — закреплено снизу, с группировкой */}
        <div className={`flex-shrink-0 border-t px-4 py-2 flex flex-wrap items-center gap-4 shadow-[0_-2px_4px_rgba(0,0,0,0.05)] ${darkMode ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-gray-50'}`}>
          <span className={`text-sm ${darkMode ? 'text-gray-300' : ''}`}>Строк: <b>{totals.count}</b></span>
          <span className={`text-sm ${darkMode ? 'text-gray-300' : ''}`}>Часы: <b>{formatNumber(totals.totalHours)}</b></span>
          <span className={`text-sm font-bold ${darkMode ? 'text-red-400' : 'text-red-600'}`}>Сумма: {formatNumber(totals.totalCost)} ₽</span>
          
          <div className="ml-auto flex items-center gap-2">
            <span className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Группировка:</span>
            <button onClick={() => setGroupBy('none')} className={`px-2 py-1 text-xs rounded ${groupBy === 'none' ? 'bg-blue-600 text-white' : (darkMode ? 'bg-gray-700 text-gray-300' : 'bg-gray-200')}`}>Без группировки</button>
            <button onClick={() => setGroupBy('number')} className={`px-2 py-1 text-xs rounded ${groupBy === 'number' ? 'bg-blue-600 text-white' : (darkMode ? 'bg-gray-700 text-gray-300' : 'bg-gray-200')}`}>По номеру</button>
            <button onClick={() => setGroupBy('type')} className={`px-2 py-1 text-xs rounded ${groupBy === 'type' ? 'bg-blue-600 text-white' : (darkMode ? 'bg-gray-700 text-gray-300' : 'bg-gray-200')}`}>По типу</button>
          </div>
        </div>
      </div>
    </div>
  );
}
