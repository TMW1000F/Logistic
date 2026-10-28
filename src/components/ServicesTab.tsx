import { useState, useMemo } from 'react';
import { useStore } from '../store';
import { useToast } from './Toast';
import { ServiceRecord, calcServiceHours, calcServiceCost, formatNumber, formatDate, generateId } from '../types';
import { Plus, Trash2, CheckSquare, Square } from 'lucide-react';
import SearchAndTags, { FilterTag } from './SearchAndTags';

interface Props {
  onStatus?: (msg: string) => void;
  darkMode?: boolean;
}

export default function ServicesTab({ onStatus, darkMode = false }: Props) {
  const { state, dispatch } = useStore();
  const toast = useToast();

  // Форма ввода
  const [serviceType, setServiceType] = useState('');
  const [carrierInput, setCarrierInput] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [paymentType, setPaymentType] = useState<'hourly' | 'fixed'>('hourly');
  const [arrival, setArrival] = useState('08:00');
  const [departure, setDeparture] = useState('17:00');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [useCoefficient, setUseCoefficient] = useState(false);
  const [coefficient, setCoefficient] = useState('1.5');

  // Поиск и теги
  const [searchQuery, setSearchQuery] = useState('');
  const [filterTags, setFilterTags] = useState<FilterTag[]>([]);

  // Фильтр по интервалу дат
  const [dateRangeEnabled, setDateRangeEnabled] = useState(false);
  const [dateRangeStart, setDateRangeStart] = useState(new Date().toISOString().split('T')[0]);
  const [dateRangeEnd, setDateRangeEnd] = useState(new Date().toISOString().split('T')[0]);

  // Множественный выбор
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Группировка
  const [groupBy, setGroupBy] = useState<'none' | 'type'>('none');

  // Уникальные значения из тарифов
  const serviceCategories = useMemo(() => {
    return [...new Set(
      state.tariffs
        .filter(t => t.type === 'service' && t.payment_type === paymentType)
        .map(t => t.category)
    )].sort();
  }, [state.tariffs, paymentType]);

  const serviceCarriers = useMemo(() => {
    let tariffs = state.tariffs.filter(t => t.type === 'service' && t.payment_type === paymentType);
    if (serviceType) {
      tariffs = tariffs.filter(t => t.category === serviceType);
    }
    return [...new Set(tariffs.map(t => t.carrier))].sort();
  }, [state.tariffs, paymentType, serviceType]);

  // Получить тариф
  const getTariff = (type: string, carr: string): { price: number; payment_type: string } | null => {
    const t = state.tariffs.find(tar => tar.type === 'service' && tar.category === type && tar.carrier === carr);
    return t ? { price: t.price, payment_type: t.payment_type } : null;
  };

  // Фильтрация записей
  const filteredRecords = useMemo(() => {
    let records = [...state.serviceRecords];

    // Фильтр по тегам
    for (const tag of filterTags) {
      if (tag.field === 'service_type') {
        records = records.filter(r => r.service_type === tag.value);
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
        r.service_type.toLowerCase().includes(q) ||
        r.carrier.toLowerCase().includes(q) ||
        r.date.includes(q) ||
        formatDate(r.date).includes(q) ||
        r.payment_type.includes(q)
      );
    }

    // Фильтр по интервалу дат
    if (dateRangeEnabled && dateRangeStart && dateRangeEnd) {
      records = records.filter(r => r.date >= dateRangeStart && r.date <= dateRangeEnd);
    }

    return records;
  }, [state.serviceRecords, filterTags, searchQuery, dateRangeEnabled, dateRangeStart, dateRangeEnd]);

  // Добавление тега
  const addFilterTag = (field: string, value: string) => {
    if (!value) return;
    if (filterTags.some(t => t.field === field && t.value === value)) return;
    
    const labels: Record<string, string> = {
      service_type: 'Тип услуги',
      carrier: 'Компания',
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
        service_type: r.service_type,
        carrier: r.carrier,
        quantity: r.quantity,
        payment_type: r.payment_type,
        time: r.payment_type === 'hourly' && r.arrival && r.departure ? `${r.arrival}-${r.departure}` : '-',
        hours: calcServiceHours(r),
        cost: calcServiceCost(r),
        tariff: r.tariff,
        date: r.date,
        coefficient: r.coefficient,
        has_high_tariff: r.coefficient !== 1.0,
        id: r.id,
        is_group: false,
      }));
    }

    const groups: Record<string, { count: number; total_quantity: number; total_hours: number; total_cost: number }> = {};
    
    for (const r of filteredRecords) {
      const key = r.service_type;
      if (!groups[key]) {
        groups[key] = { count: 0, total_quantity: 0, total_hours: 0, total_cost: 0 };
      }
      groups[key].count++;
      groups[key].total_quantity += r.quantity;
      groups[key].total_hours += calcServiceHours(r);
      groups[key].total_cost += calcServiceCost(r);
    }

    return Object.entries(groups).map(([key, data]) => ({
      service_type: key,
      carrier: '',
      quantity: data.total_quantity,
      payment_type: '' as string,
      time: '-',
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
    let totalCost = 0;
    for (const r of filteredRecords) {
      totalCost += calcServiceCost(r);
    }
    return { count: filteredRecords.length, totalCost };
  }, [filteredRecords]);

  // Сохранение
  const handleSave = () => {
    if (!serviceType || !carrierInput) {
      toast.warning('Заполните обязательные поля: тип услуги, компания');
      return;
    }

    const tariffInfo = getTariff(serviceType, carrierInput);
    if (!tariffInfo) {
      toast.error(`Тариф для "${serviceType}" и "${carrierInput}" не найден.`);
      return;
    }

    if (tariffInfo.payment_type !== paymentType) {
      toast.error(`Для этого тарифа ожидается ${tariffInfo.payment_type === 'hourly' ? 'почасовая' : 'фиксированная'} оплата`);
      return;
    }

    if (quantity <= 0) {
      toast.error('Количество должно быть больше 0');
      return;
    }

    const coef = useCoefficient ? parseFloat(coefficient.replace(',', '.')) : 1.0;
    if (isNaN(coef) || coef <= 0) {
      toast.error('Некорректный коэффициент');
      return;
    }

    const record: ServiceRecord = {
      id: generateId(),
      service_type: serviceType,
      carrier: carrierInput,
      quantity,
      payment_type: paymentType,
      arrival: paymentType === 'hourly' ? arrival : null,
      departure: paymentType === 'hourly' ? departure : null,
      date,
      tariff: tariffInfo.price,
      coefficient: coef,
    };

    dispatch({ type: 'ADD_SERVICE_RECORD', payload: record });
    setQuantity(1);
    setUseCoefficient(false);
    toast.success(`Услуга "${serviceType}" добавлена`);
    onStatus?.(`✅ Услуга "${serviceType}" добавлена`);
  };

  // Удаление
  const handleDelete = (id: string) => {
    if (confirm('Удалить выбранную запись?')) {
      dispatch({ type: 'DELETE_SERVICE_RECORD', payload: id });
      setSelectedIds(prev => { const n = new Set(prev); n.delete(id); return n; });
      toast.success('Запись удалена');
      onStatus?.('🗑️ Запись удалена');
    }
  };

  const handleDeleteSelected = () => {
    if (selectedIds.size === 0) {
      toast.warning('Выберите записи для удаления');
      return;
    }
    if (!confirm(`Удалить ${selectedIds.size} записей?`)) return;
    
    for (const id of selectedIds) {
      dispatch({ type: 'DELETE_SERVICE_RECORD', payload: id });
    }
    const count = selectedIds.size;
    setSelectedIds(new Set());
    toast.success(`Удалено записей: ${count}`);
    onStatus?.(`🗑️ Удалено записей: ${count}`);
  };

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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSave();
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Sticky форма ввода */}
      <div className={`flex-shrink-0 rounded-lg p-3 mb-2 ${darkMode ? 'bg-gray-800' : 'bg-white border border-gray-200'}`}>
        {/* Строка 1: Тип услуги, Компания, Количество, Дата */}
        <div className="grid grid-cols-4 gap-2 mb-2">
          <div>
            <label className={`text-xs ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>Тип услуги:</label>
            <select value={serviceType} onChange={e => setServiceType(e.target.value)} className={`w-full border rounded px-2 py-1 text-sm ${darkMode ? 'bg-gray-700 border-gray-600 text-white' : ''}`}>
              <option value="">-- Выберите --</option>
              {serviceCategories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className={`text-xs ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>Компания:</label>
            <select value={carrierInput} onChange={e => setCarrierInput(e.target.value)} className={`w-full border rounded px-2 py-1 text-sm ${darkMode ? 'bg-gray-700 border-gray-600 text-white' : ''}`}>
              <option value="">-- Выберите --</option>
              {serviceCarriers.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className={`text-xs ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>Количество:</label>
            <input type="number" min={1} max={1000} value={quantity} onChange={e => setQuantity(parseInt(e.target.value) || 1)} className={`w-full border rounded px-2 py-1 text-sm ${darkMode ? 'bg-gray-700 border-gray-600 text-white' : ''}`} />
          </div>
          <div>
            <label className={`text-xs ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>Дата:</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} className={`w-full border rounded px-2 py-1 text-sm ${darkMode ? 'bg-gray-700 border-gray-600 text-white' : ''}`} />
          </div>
        </div>

        {/* Строка 2: Тип оплаты, Время, Коэффициент, Интервал, кнопки */}
        <div className="flex flex-wrap items-end gap-2">
          <div className={`flex items-center gap-2 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
            <span className="text-xs">Оплата:</span>
            <label className="flex items-center gap-1 text-xs">
              <input type="radio" checked={paymentType === 'hourly'} onChange={() => setPaymentType('hourly')} /> Почасовая
            </label>
            <label className="flex items-center gap-1 text-xs">
              <input type="radio" checked={paymentType === 'fixed'} onChange={() => setPaymentType('fixed')} /> Фикс.
            </label>
          </div>
          {paymentType === 'hourly' && (
            <>
              <div>
                <label className={`text-xs ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>Начало:</label>
                <input type="time" value={arrival} onChange={e => setArrival(e.target.value)} step="1800" className={`border rounded px-2 py-1 text-sm w-28 ${darkMode ? 'bg-gray-700 border-gray-600 text-white' : ''}`} />
              </div>
              <div>
                <label className={`text-xs ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>Окончание:</label>
                <input type="time" value={departure} onChange={e => setDeparture(e.target.value)} step="1800" className={`border rounded px-2 py-1 text-sm w-28 ${darkMode ? 'bg-gray-700 border-gray-600 text-white' : ''}`} />
              </div>
            </>
          )}
          <div className="flex items-center gap-1">
            <input type="checkbox" checked={useCoefficient} onChange={e => setUseCoefficient(e.target.checked)} id="svc_coef" />
            <label htmlFor="svc_coef" className={`text-xs ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>Коэф.:</label>
            <input type="text" value={coefficient} onChange={e => setCoefficient(e.target.value)} disabled={!useCoefficient} className={`w-14 border rounded px-2 py-1 text-sm ${darkMode ? 'bg-gray-700 border-gray-600 text-white' : ''}`} />
          </div>
          <div className="flex items-center gap-1 border-l pl-2 ml-1">
            <input type="checkbox" checked={dateRangeEnabled} onChange={e => setDateRangeEnabled(e.target.checked)} id="svc_date_range" />
            <label htmlFor="svc_date_range" className={`text-xs ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>Интервал:</label>
            <input type="date" value={dateRangeStart} onChange={e => setDateRangeStart(e.target.value)} disabled={!dateRangeEnabled} className={`border rounded px-1 py-1 text-xs w-32 ${darkMode ? 'bg-gray-700 border-gray-600 text-white' : ''}`} />
            <span className="text-xs">—</span>
            <input type="date" value={dateRangeEnd} onChange={e => setDateRangeEnd(e.target.value)} disabled={!dateRangeEnabled} className={`border rounded px-1 py-1 text-xs w-32 ${darkMode ? 'bg-gray-700 border-gray-600 text-white' : ''}`} />
          </div>
          {serviceType && carrierInput && (
            <span className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
              {getTariff(serviceType, carrierInput) ? `Тариф: ${formatNumber(getTariff(serviceType, carrierInput)!.price)} ₽/${paymentType === 'hourly' ? 'час' : 'ед.'}` : '⚠️ Не найден'}
            </span>
          )}
          {selectedIds.size > 0 && (
            <button onClick={handleDeleteSelected} className="flex items-center gap-1 bg-red-600 text-white px-3 py-1.5 rounded text-sm hover:bg-red-700">
              <Trash2 size={14} /> Удалить ({selectedIds.size})
            </button>
          )}
          <button onClick={handleSave} onKeyDown={handleKeyDown} className="ml-auto flex items-center gap-1 bg-green-600 text-white px-3 py-1.5 rounded text-sm hover:bg-green-700">
            <Plus size={14} /> Добавить
          </button>
        </div>
      </div>

      {/* Контейнер: поиск + таблица + итоги */}
      <div className={`flex flex-col flex-1 min-h-0 rounded-lg overflow-hidden ${darkMode ? 'bg-gray-800' : 'bg-white border border-gray-200'}`}>
        {/* Поиск и теги */}
        <div className={`flex-shrink-0 border-b p-3 ${darkMode ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-white'}`}>
          <SearchAndTags
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            tags={filterTags}
            onRemoveTag={removeTag}
            onClearAll={clearAllTags}
            placeholder="🔍 Поиск по типу услуги, компании, дате..."
            darkMode={darkMode}
          />
        </div>

        {/* Таблица — прокручивается только она */}
        <div className="flex-1 overflow-auto">
          <table className="w-full text-sm">
            <thead className={`sticky top-0 z-10 ${darkMode ? 'bg-gray-700' : 'bg-gray-100'}`}>
              <tr>
                <th className={`px-2 py-2 text-center w-8 sticky left-0 z-20 ${darkMode ? 'bg-gray-700' : 'bg-gray-100'}`}>
                  <button onClick={toggleSelectAll}>
                    {filteredRecords.length > 0 && selectedIds.size === filteredRecords.length ? (
                      <CheckSquare size={16} className="text-green-600" />
                    ) : (
                      <Square size={16} className={darkMode ? 'text-gray-500' : 'text-gray-400'} />
                    )}
                  </button>
                </th>
                <th className={`px-2 py-2 text-left text-xs font-medium ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>Тип услуги</th>
                <th className={`px-2 py-2 text-left text-xs font-medium ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>Компания</th>
                <th className={`px-2 py-2 text-center text-xs font-medium ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>Кол-во</th>
                <th className={`px-2 py-2 text-center text-xs font-medium ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>Тип оплаты</th>
                <th className={`px-2 py-2 text-center text-xs font-medium ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>Время</th>
                <th className={`px-2 py-2 text-right text-xs font-medium ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>Часы</th>
                <th className={`px-2 py-2 text-right text-xs font-medium ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>Стоимость</th>
                <th className={`px-2 py-2 text-right text-xs font-medium ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>Тариф</th>
                <th className={`px-2 py-2 text-center text-xs font-medium ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>Дата</th>
                <th className={`px-2 py-2 text-center text-xs font-medium ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>Коэф.</th>
                <th className={`px-2 py-2 text-center text-xs font-medium ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>⚙️</th>
              </tr>
            </thead>
            <tbody>
              {displayData.map((row, idx) => (
                <tr
                  key={idx}
                  className={`border-t ${darkMode ? 'border-gray-700 hover:bg-gray-700' : 'hover:bg-gray-50'} ${row.has_high_tariff ? (darkMode ? 'bg-red-900/30' : 'bg-red-50') : ''} ${row.is_group ? (darkMode ? 'bg-green-900/30 font-semibold' : 'bg-green-50 font-semibold') : ''} ${selectedIds.has(row.id) ? (darkMode ? 'bg-green-900/50' : 'bg-green-100') : ''}`}
                >
                  <td className="px-2 py-1.5 text-center sticky left-0 bg-inherit">
                    {!row.is_group && (
                      <input type="checkbox" checked={selectedIds.has(row.id)} onChange={() => toggleSelect(row.id)} />
                    )}
                  </td>
                  <td className={`px-2 py-1.5 cursor-pointer ${darkMode ? 'hover:bg-green-800' : 'hover:bg-green-100'} hover:underline`} onClick={() => !row.is_group && addFilterTag('service_type', row.service_type)} title="Клик — добавить фильтр">{row.service_type}</td>
                  <td className={`px-2 py-1.5 cursor-pointer ${darkMode ? 'hover:bg-green-800' : 'hover:bg-green-100'} hover:underline`} onClick={() => !row.is_group && addFilterTag('carrier', row.carrier)} title="Клик — добавить фильтр">{row.carrier}</td>
                  <td className="px-2 py-1.5 text-center">{row.is_group ? formatNumber(row.quantity) : row.quantity}</td>
                  <td className="px-2 py-1.5 text-center">{row.payment_type === 'hourly' ? 'Почасовая' : row.payment_type === 'fixed' ? 'Фиксированная' : '-'}</td>
                  <td className="px-2 py-1.5 text-center">{row.time}</td>
                  <td className="px-2 py-1.5 text-right">{row.hours > 0 ? formatNumber(row.hours) : '-'}</td>
                  <td className="px-2 py-1.5 text-right font-medium">{formatNumber(row.cost)}</td>
                  <td className="px-2 py-1.5 text-right">{row.tariff ? formatNumber(row.tariff) : '-'}</td>
                  <td className={`px-2 py-1.5 text-center cursor-pointer ${darkMode ? 'hover:bg-green-800' : 'hover:bg-green-100'} hover:underline`} onClick={() => !row.is_group && addFilterTag('date', row.date)} title="Клик — добавить фильтр">
                    {row.date ? formatDate(row.date) : (row.is_group ? `${(row as any).group_count} заказов` : '-')}
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
                  <td colSpan={12} className={`px-4 py-8 text-center ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>Нет данных</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Итоги — закреплено снизу, с группировкой */}
        <div className={`flex-shrink-0 border-t px-4 py-2 flex flex-wrap items-center gap-4 shadow-[0_-2px_4px_rgba(0,0,0,0.05)] ${darkMode ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-gray-50'}`}>
          <span className={`text-sm ${darkMode ? 'text-gray-300' : ''}`}>Услуг: <b>{totals.count}</b></span>
          <span className={`text-sm font-bold ${darkMode ? 'text-red-400' : 'text-red-600'}`}>Сумма: {formatNumber(totals.totalCost)} ₽</span>
          
          <div className="ml-auto flex items-center gap-2">
            <span className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Группировка:</span>
            <button onClick={() => setGroupBy('none')} className={`px-2 py-1 text-xs rounded ${groupBy === 'none' ? 'bg-green-600 text-white' : (darkMode ? 'bg-gray-700 text-gray-300' : 'bg-gray-200')}`}>Без группировки</button>
            <button onClick={() => setGroupBy('type')} className={`px-2 py-1 text-xs rounded ${groupBy === 'type' ? 'bg-green-600 text-white' : (darkMode ? 'bg-gray-700 text-gray-300' : 'bg-gray-200')}`}>По типу</button>
          </div>
        </div>
      </div>
    </div>
  );
}
