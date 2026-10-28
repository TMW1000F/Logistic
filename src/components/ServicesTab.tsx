import { useState, useMemo } from 'react';
import { useStore } from '../store';
import { ServiceRecord, calcServiceHours, calcServiceCost, formatNumber, formatDate, generateId } from '../types';
import { Plus, Trash2 } from 'lucide-react';

export default function ServicesTab() {
  const { state, dispatch } = useStore();

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

  // Фильтры
  const [filterByType, setFilterByType] = useState(false);
  const [filterByCarrier, setFilterByCarrier] = useState(false);
  const [filterByDate, setFilterByDate] = useState(false);
  const [filterDateRange, setFilterDateRange] = useState(false);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Группировка
  const [groupBy, setGroupBy] = useState<'none' | 'type'>('none');

  // Получить уникальные значения из тарифов
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

    if (filterByType && serviceType) {
      records = records.filter(r => r.service_type === serviceType);
    }
    if (filterByCarrier && carrierInput) {
      records = records.filter(r => r.carrier === carrierInput);
    }
    if (filterByDate && date) {
      records = records.filter(r => r.date === date);
    }
    if (filterDateRange && startDate && endDate) {
      records = records.filter(r => r.date >= startDate && r.date <= endDate);
    }

    return records;
  }, [state.serviceRecords, filterByType, serviceType, filterByCarrier, carrierInput, filterByDate, date, filterDateRange, startDate, endDate]);

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
      alert('Заполните обязательные поля: тип услуги, компания');
      return;
    }

    const tariffInfo = getTariff(serviceType, carrierInput);
    if (!tariffInfo) {
      alert(`Тариф для "${serviceType}" и "${carrierInput}" не найден. Добавьте тариф во вкладке "Тарифы".`);
      return;
    }

    if (tariffInfo.payment_type !== paymentType) {
      alert(`Для этого тарифа ожидается ${tariffInfo.payment_type === 'hourly' ? 'почасовая' : 'фиксированная'} оплата`);
      return;
    }

    if (quantity <= 0) {
      alert('Количество должно быть больше 0');
      return;
    }

    const coef = useCoefficient ? parseFloat(coefficient.replace(',', '.')) : 1.0;
    if (isNaN(coef) || coef <= 0) {
      alert('Некорректный коэффициент');
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
  };

  // Удаление
  const handleDelete = (id: string) => {
    if (confirm('Удалить выбранную запись?')) {
      dispatch({ type: 'DELETE_SERVICE_RECORD', payload: id });
    }
  };

  // Сброс фильтров
  const resetFilters = () => {
    setFilterByType(false);
    setFilterByCarrier(false);
    setFilterByDate(false);
    setFilterDateRange(false);
    setServiceType('');
    setCarrierInput('');
  };

  return (
    <div className="space-y-4">
      {/* Верхняя панель */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Ввод услуги */}
        <div className="bg-white rounded-lg border p-4 space-y-3">
          <h3 className="font-bold text-sm text-gray-700 border-b pb-2">🔧 Добавление услуги</h3>
          
          {/* Тип оплаты */}
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-600">Тип оплаты:</span>
            <label className="flex items-center gap-1 text-sm">
              <input type="radio" checked={paymentType === 'hourly'} onChange={() => setPaymentType('hourly')} />
              Почасовая
            </label>
            <label className="flex items-center gap-1 text-sm">
              <input type="radio" checked={paymentType === 'fixed'} onChange={() => setPaymentType('fixed')} />
              Фиксированная
            </label>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-gray-600">Тип услуги:</label>
              <select value={serviceType} onChange={e => setServiceType(e.target.value)} className="w-full border rounded px-2 py-1 text-sm">
                <option value="">-- Выберите --</option>
                {serviceCategories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-600">Компания:</label>
              <select value={carrierInput} onChange={e => setCarrierInput(e.target.value)} className="w-full border rounded px-2 py-1 text-sm">
                <option value="">-- Выберите --</option>
                {serviceCarriers.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-600">Количество (ед.):</label>
              <input
                type="number"
                min={1}
                max={1000}
                value={quantity}
                onChange={e => setQuantity(parseInt(e.target.value) || 1)}
                className="w-full border rounded px-2 py-1 text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-gray-600">Дата:</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-full border rounded px-2 py-1 text-sm" />
            </div>
          </div>

          {/* Время (только для почасовой) */}
          {paymentType === 'hourly' && (
            <div className="bg-gray-50 rounded p-2">
              <label className="text-xs text-gray-600 font-medium">Время:</label>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs">Начало:</span>
                <input type="time" value={arrival} onChange={e => setArrival(e.target.value)} step="1800" className="border rounded px-2 py-0.5 text-sm" />
                <span className="text-xs">Окончание:</span>
                <input type="time" value={departure} onChange={e => setDeparture(e.target.value)} step="1800" className="border rounded px-2 py-0.5 text-sm" />
              </div>
            </div>
          )}

          {/* Коэффициент */}
          <div className="flex items-center gap-2">
            <input type="checkbox" checked={useCoefficient} onChange={e => setUseCoefficient(e.target.checked)} id="svc_coef" />
            <label htmlFor="svc_coef" className="text-xs text-gray-600">Коэффициент:</label>
            <input
              type="text"
              value={coefficient}
              onChange={e => setCoefficient(e.target.value)}
              disabled={!useCoefficient}
              className="w-16 border rounded px-2 py-1 text-sm"
            />
          </div>

          <button
            onClick={handleSave}
            className="flex items-center gap-1 bg-green-600 text-white px-3 py-1.5 rounded text-sm hover:bg-green-700"
          >
            <Plus size={14} /> Добавить услугу
          </button>

          {/* Тариф информация */}
          {serviceType && carrierInput && (
            <div className="text-xs text-gray-500 bg-gray-50 p-2 rounded">
              {getTariff(serviceType, carrierInput) 
                ? `Тариф: ${formatNumber(getTariff(serviceType, carrierInput)!.price)} ₽/${paymentType === 'hourly' ? 'час' : 'ед.'}` 
                : '⚠️ Тариф не найден'}
            </div>
          )}
        </div>

        {/* Фильтры */}
        <div className="bg-white rounded-lg border p-4 space-y-3">
          <h3 className="font-bold text-sm text-gray-700 border-b pb-2">🔍 Фильтры</h3>
          
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <input type="checkbox" checked={filterByType} onChange={e => setFilterByType(e.target.checked)} id="sf_type" />
              <label htmlFor="sf_type" className="text-xs">По типу:</label>
              <select value={serviceType} onChange={e => setServiceType(e.target.value)} className="flex-1 border rounded px-2 py-0.5 text-sm">
                <option value="">Все</option>
                {serviceCategories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" checked={filterByCarrier} onChange={e => setFilterByCarrier(e.target.checked)} id="sf_carr" />
              <label htmlFor="sf_carr" className="text-xs">По компании:</label>
              <select value={carrierInput} onChange={e => setCarrierInput(e.target.value)} className="flex-1 border rounded px-2 py-0.5 text-sm">
                <option value="">Все</option>
                {serviceCarriers.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" checked={filterByDate} onChange={e => setFilterByDate(e.target.checked)} id="sf_date" />
              <label htmlFor="sf_date" className="text-xs">По дате:</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} className="border rounded px-2 py-0.5 text-sm" />
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" checked={filterDateRange} onChange={e => setFilterDateRange(e.target.checked)} id="sf_range" />
              <label htmlFor="sf_range" className="text-xs">Интервал:</label>
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="border rounded px-2 py-0.5 text-sm" />
              <span className="text-xs">—</span>
              <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="border rounded px-2 py-0.5 text-sm" />
            </div>
          </div>

          <button onClick={resetFilters} className="w-full bg-gray-200 text-gray-700 px-3 py-1.5 rounded text-sm hover:bg-gray-300">
            Сбросить все фильтры
          </button>
        </div>

        {/* Быстрая информация */}
        <div className="bg-white rounded-lg border p-4 space-y-3">
          <h3 className="font-bold text-sm text-gray-700 border-b pb-2">ℹ️ Информация</h3>
          <div className="text-sm space-y-2">
            <p>Всего услуг в базе: <b>{state.serviceRecords.length}</b></p>
            <p>Отображается: <b>{filteredRecords.length}</b></p>
            <p>Уникальных типов: <b>{new Set(filteredRecords.map(r => r.service_type)).size}</b></p>
          </div>
        </div>
      </div>

      {/* Таблица */}
      <div className="bg-white rounded-lg border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-100">
              <tr>
                <th className="px-2 py-2 text-left text-xs font-medium text-gray-600">Тип услуги</th>
                <th className="px-2 py-2 text-left text-xs font-medium text-gray-600">Компания</th>
                <th className="px-2 py-2 text-center text-xs font-medium text-gray-600">Кол-во</th>
                <th className="px-2 py-2 text-center text-xs font-medium text-gray-600">Тип оплаты</th>
                <th className="px-2 py-2 text-center text-xs font-medium text-gray-600">Время</th>
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
                <tr key={idx} className={`border-t hover:bg-gray-50 ${row.has_high_tariff ? 'bg-red-50' : ''} ${row.is_group ? 'bg-blue-50 font-semibold' : ''}`}>
                  <td className="px-2 py-1.5">{row.service_type}</td>
                  <td className="px-2 py-1.5">{row.carrier}</td>
                  <td className="px-2 py-1.5 text-center">{row.is_group ? formatNumber(row.quantity) : row.quantity}</td>
                  <td className="px-2 py-1.5 text-center">{row.payment_type === 'hourly' ? 'Почасовая' : row.payment_type === 'fixed' ? 'Фиксированная' : '-'}</td>
                  <td className="px-2 py-1.5 text-center">{row.time}</td>
                  <td className="px-2 py-1.5 text-right">{row.hours > 0 ? formatNumber(row.hours) : '-'}</td>
                  <td className="px-2 py-1.5 text-right font-medium">{formatNumber(row.cost)}</td>
                  <td className="px-2 py-1.5 text-right">{row.tariff ? formatNumber(row.tariff) : '-'}</td>
                  <td className="px-2 py-1.5 text-center">{row.date ? formatDate(row.date) : (row.is_group ? `${(row as any).group_count} заказов` : '-')}</td>
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
                  <td colSpan={11} className="px-4 py-8 text-center text-gray-400">Нет данных</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Итоги */}
        <div className="border-t bg-gray-50 px-4 py-2 flex flex-wrap items-center gap-4">
          <span className="text-sm">Услуг: <b>{totals.count}</b></span>
          <span className="text-sm text-red-600 font-bold">Сумма: {formatNumber(totals.totalCost)} ₽</span>
          
          <div className="ml-auto flex gap-2">
            <button onClick={() => setGroupBy('none')} className={`px-2 py-1 text-xs rounded ${groupBy === 'none' ? 'bg-green-600 text-white' : 'bg-gray-200'}`}>Без группировки</button>
            <button onClick={() => setGroupBy('type')} className={`px-2 py-1 text-xs rounded ${groupBy === 'type' ? 'bg-green-600 text-white' : 'bg-gray-200'}`}>По типу</button>
          </div>
        </div>
      </div>
    </div>
  );
}
