import { useState, useMemo } from 'react';
import { useStore } from '../store';
import { CarRecord, calcDurationHours, calcAutoCost, formatNumber, formatDate, generateId } from '../types';
import { Plus, Trash2, CheckSquare, Square } from 'lucide-react';
import SearchAndTags, { FilterTag } from './SearchAndTags';

interface Props {
  onStatus?: (msg: string) => void;
}

export default function AutoTab({ onStatus }: Props) {
  const { state, dispatch } = useStore();

  // Форма ввода
  const [carNumber, setCarNumber] = useState('');
  const [carType, setCarType] = useState('');
  const [carrier, setCarrier] = useState('');
  const [arrival, setArrival] = useState('08:00');
  const [departure, setDeparture] = useState('17:00');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [useCoefficient, setUseCoefficient] = useState(false);
  const [coefficient, setCoefficient] = useState('1.5');

  // Поиск и теги-фильтры
  const [searchQuery, setSearchQuery] = useState('');
  const [filterTags, setFilterTags] = useState<FilterTag[]>([]);

  // Множественный выбор
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Группировка
  const [groupBy, setGroupBy] = useState<'none' | 'number' | 'type'>('none');

  // Получить уникальные значения из тарифов
  const autoCategories = useMemo(() => {
    return [...new Set(state.tariffs.filter(t => t.type === 'auto').map(t => t.category))].sort();
  }, [state.tariffs]);

  const autoCarriers = useMemo(() => {
    return [...new Set(state.tariffs.filter(t => t.type === 'auto').map(t => t.carrier))].sort();
  }, [state.tariffs]);

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

    return records;
  }, [state.autoRecords, filterTags, searchQuery]);

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
    if (!carNumber.trim() || !carType || !carrier) {
      alert('Заполните обязательные поля: номер ТС, тип ТС, перевозчик');
      return;
    }

    const tariff = getTariff(carType, carrier);
    if (tariff === null) {
      alert(`Тариф для "${carType}" и "${carrier}" не найден. Добавьте тариф во вкладке "Тарифы".`);
      return;
    }

    const coef = useCoefficient ? parseFloat(coefficient.replace(',', '.')) : 1.0;
    if (isNaN(coef) || coef <= 0) {
      alert('Некорректный коэффициент');
      return;
    }

    const record: CarRecord = {
      id: generateId(),
      car_number: carNumber.trim(),
      car_type: carType,
      carrier: carrier,
      arrival,
      departure,
      date,
      tariff,
      coefficient: coef,
    };

    dispatch({ type: 'ADD_AUTO_RECORD', payload: record });
    setCarNumber('');
    setUseCoefficient(false);
    onStatus?.(`✅ Автомобиль ${record.car_number} добавлен`);
  };

  // Удаление одной записи
  const handleDelete = (id: string) => {
    if (confirm('Удалить выбранную запись?')) {
      dispatch({ type: 'DELETE_AUTO_RECORD', payload: id });
      setSelectedIds(prev => { const n = new Set(prev); n.delete(id); return n; });
      onStatus?.('🗑️ Запись удалена');
    }
  };

  // Удаление выбранных
  const handleDeleteSelected = () => {
    if (selectedIds.size === 0) {
      alert('Выберите записи для удаления');
      return;
    }
    if (!confirm(`Удалить ${selectedIds.size} записей?`)) return;
    
    for (const id of selectedIds) {
      dispatch({ type: 'DELETE_AUTO_RECORD', payload: id });
    }
    setSelectedIds(new Set());
    onStatus?.(`🗑️ Удалено записей: ${selectedIds.size}`);
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

  // Обработка Enter
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSave();
    }
  };

  return (
    <div className="space-y-4">
      {/* Sticky форма ввода */}
      <div className="sticky top-0 z-30 bg-gray-100 pb-2">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Левая часть - ввод */}
          <div className="bg-white rounded-lg border p-4 shadow-sm">
            <h3 className="font-bold text-sm text-gray-700 mb-3">🚗 Ввод данных автомобиля</h3>
            
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              <div>
                <label className="text-xs text-gray-600">Номер ТС:</label>
                <input
                  type="text"
                  value={carNumber}
                  onChange={e => setCarNumber(e.target.value)}
                  onKeyDown={handleKeyDown}
                  className="w-full border rounded px-2 py-1 text-sm"
                  placeholder="А123БВ777"
                />
              </div>
              <div>
                <label className="text-xs text-gray-600">Тип ТС:</label>
                <select
                  value={carType}
                  onChange={e => setCarType(e.target.value)}
                  className="w-full border rounded px-2 py-1 text-sm"
                >
                  <option value="">-- Выберите --</option>
                  {autoCategories.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-600">Перевозчик:</label>
                <select
                  value={carrier}
                  onChange={e => setCarrier(e.target.value)}
                  className="w-full border rounded px-2 py-1 text-sm"
                >
                  <option value="">-- Выберите --</option>
                  {autoCarriers.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-600">Дата:</label>
                <input
                  type="date"
                  value={date}
                  onChange={e => setDate(e.target.value)}
                  className="w-full border rounded px-2 py-1 text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-gray-600">Прибытие:</label>
                <input
                  type="time"
                  value={arrival}
                  onChange={e => setArrival(e.target.value)}
                  step="1800"
                  className="w-full border rounded px-2 py-1 text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-gray-600">Убытие:</label>
                <input
                  type="time"
                  value={departure}
                  onChange={e => setDeparture(e.target.value)}
                  step="1800"
                  className="w-full border rounded px-2 py-1 text-sm"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 mt-3">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={useCoefficient}
                  onChange={e => setUseCoefficient(e.target.checked)}
                  id="auto_coef"
                />
                <label htmlFor="auto_coef" className="text-xs text-gray-600">Коэффициент:</label>
                <input
                  type="text"
                  value={coefficient}
                  onChange={e => setCoefficient(e.target.value)}
                  disabled={!useCoefficient}
                  className="w-16 border rounded px-2 py-0.5 text-sm"
                />
              </div>

              <button
                onClick={handleSave}
                className="flex items-center gap-1 bg-blue-600 text-white px-3 py-1.5 rounded text-sm hover:bg-blue-700"
              >
                <Plus size={14} /> Добавить
              </button>

              {carType && carrier && (
                <span className="text-xs text-gray-500">
                  Тариф: {getTariff(carType, carrier) !== null ? `${formatNumber(getTariff(carType, carrier)!)} ₽/ч` : '⚠️ Не найден'}
                </span>
              )}
            </div>
          </div>

          {/* Правая часть - группировка и управление */}
          <div className="bg-white rounded-lg border p-4 shadow-sm">
            <h3 className="font-bold text-sm text-gray-700 mb-3">⚙️ Управление</h3>
            
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-gray-600">Группировка:</span>
              <button onClick={() => setGroupBy('none')} className={`px-2 py-1 text-xs rounded ${groupBy === 'none' ? 'bg-blue-600 text-white' : 'bg-gray-200'}`}>Без группировки</button>
              <button onClick={() => setGroupBy('number')} className={`px-2 py-1 text-xs rounded ${groupBy === 'number' ? 'bg-blue-600 text-white' : 'bg-gray-200'}`}>По номеру</button>
              <button onClick={() => setGroupBy('type')} className={`px-2 py-1 text-xs rounded ${groupBy === 'type' ? 'bg-blue-600 text-white' : 'bg-gray-200'}`}>По типу</button>
            </div>

            {selectedIds.size > 0 && (
              <div className="mt-3 flex items-center gap-2">
                <span className="text-xs text-gray-600">Выбрано: {selectedIds.size}</span>
                <button
                  onClick={handleDeleteSelected}
                  className="flex items-center gap-1 bg-red-600 text-white px-3 py-1 rounded text-xs hover:bg-red-700"
                >
                  <Trash2 size={12} /> Удалить выбранные
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Поиск и теги */}
      <SearchAndTags
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        tags={filterTags}
        onRemoveTag={removeTag}
        onClearAll={clearAllTags}
        placeholder="🔍 Поиск по номеру, типу, перевозчику, дате..."
      />

      {/* Таблица */}
      <div className="bg-white rounded-lg border overflow-hidden">
        <div className="overflow-x-auto max-h-[60vh]">
          <table className="w-full text-sm">
            <thead className="bg-gray-100 sticky top-0 z-10">
              <tr>
                <th className="px-2 py-2 text-center w-8">
                  <button onClick={toggleSelectAll} title="Выбрать все">
                    {filteredRecords.length > 0 && selectedIds.size === filteredRecords.length ? (
                      <CheckSquare size={16} className="text-blue-600" />
                    ) : (
                      <Square size={16} className="text-gray-400" />
                    )}
                  </button>
                </th>
                <th className="px-2 py-2 text-left text-xs font-medium text-gray-600">№ ТС</th>
                <th className="px-2 py-2 text-left text-xs font-medium text-gray-600">Тип ТС</th>
                <th className="px-2 py-2 text-left text-xs font-medium text-gray-600">Перевозчик</th>
                <th className="px-2 py-2 text-center text-xs font-medium text-gray-600">Прибыл</th>
                <th className="px-2 py-2 text-center text-xs font-medium text-gray-600">Убыл</th>
                <th className="px-2 py-2 text-right text-xs font-medium text-gray-600">Часы</th>
                <th className="px-2 py-2 text-right text-xs font-medium text-gray-600">Стоимость</th>
                <th className="px-2 py-2 text-right text-xs font-medium text-gray-600">Тариф</th>
                <th className="px-2 py-2 text-center text-xs font-medium text-gray-600">Дата</th>
                <th className="px-2 py-2 text-center text-xs font-medium text-gray-600">Коэф.</th>
                <th className="px-2 py-2 text-center text-xs font-medium text-gray-600">⚙️</th>
              </tr>
            </thead>
            <tbody>
              {displayData.map((row, idx) => (
                <tr
                  key={idx}
                  className={`border-t hover:bg-gray-50 ${row.has_high_tariff ? 'bg-red-50' : ''} ${row.is_group ? 'bg-blue-50 font-semibold' : ''} ${selectedIds.has(row.id) ? 'bg-blue-100' : ''}`}
                >
                  <td className="px-2 py-1.5 text-center">
                    {!row.is_group && (
                      <input
                        type="checkbox"
                        checked={selectedIds.has(row.id)}
                        onChange={() => toggleSelect(row.id)}
                      />
                    )}
                  </td>
                  <td
                    className="px-2 py-1.5 cursor-pointer hover:bg-blue-100 hover:underline"
                    onClick={() => !row.is_group && addFilterTag('car_number', row.car_number)}
                    title="Клик — добавить фильтр"
                  >
                    {row.car_number}
                  </td>
                  <td
                    className="px-2 py-1.5 cursor-pointer hover:bg-blue-100 hover:underline"
                    onClick={() => !row.is_group && addFilterTag('car_type', row.car_type)}
                    title="Клик — добавить фильтр"
                  >
                    {row.car_type}
                  </td>
                  <td
                    className="px-2 py-1.5 cursor-pointer hover:bg-blue-100 hover:underline"
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
                    className="px-2 py-1.5 text-center cursor-pointer hover:bg-blue-100 hover:underline"
                    onClick={() => !row.is_group && addFilterTag('date', row.date)}
                    title="Клик — добавить фильтр"
                  >
                    {row.date ? formatDate(row.date) : (row.is_group ? `${(row as any).group_count} рейсов` : '-')}
                  </td>
                  <td className="px-2 py-1.5 text-center">{row.has_high_tariff ? `×${row.coefficient}` : '-'}</td>
                  <td className="px-2 py-1.5 text-center">
                    {!row.is_group && (
                      <button onClick={() => handleDelete(row.id)} className="text-red-500 hover:text-red-700">
                        <Trash2 size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {displayData.length === 0 && (
                <tr>
                  <td colSpan={12} className="px-4 py-8 text-center text-gray-400">Нет данных</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Итоги */}
        <div className="border-t bg-gray-50 px-4 py-2 flex flex-wrap items-center gap-4">
          <span className="text-sm">Строк: <b>{totals.count}</b></span>
          <span className="text-sm">Часы: <b>{formatNumber(totals.totalHours)}</b></span>
          <span className="text-sm text-red-600 font-bold">Сумма: {formatNumber(totals.totalCost)} ₽</span>
        </div>
      </div>
    </div>
  );
}
