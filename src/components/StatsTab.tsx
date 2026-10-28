import { useState, useMemo } from 'react';
import { useStore } from '../store';
import { calcDurationHours, calcAutoCost, calcServiceHours, calcServiceCost, formatNumber } from '../types';

interface Props {
  onStatus?: (msg: string) => void;
}

export default function StatsTab({ onStatus }: Props) {
  const { state } = useStore();

  const defaultEnd = new Date().toISOString().split('T')[0];
  const defaultStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const [startDate, setStartDate] = useState(defaultStart);
  const [endDate, setEndDate] = useState(defaultEnd);
  const [selectedCarrier, setSelectedCarrier] = useState('Все');

  // Все перевозчики за период
  const availableCarriers = useMemo(() => {
    const carriers = new Set<string>();
    state.autoRecords
      .filter(r => r.date >= startDate && r.date <= endDate)
      .forEach(r => carriers.add(r.carrier));
    state.serviceRecords
      .filter(r => r.date >= startDate && r.date <= endDate)
      .forEach(r => carriers.add(r.carrier));
    return ['Все'].concat([...carriers].sort());
  }, [state, startDate, endDate]);

  // Фильтрованные записи
  const filteredAuto = useMemo(() => {
    let records = state.autoRecords.filter(r => r.date >= startDate && r.date <= endDate);
    if (selectedCarrier !== 'Все') records = records.filter(r => r.carrier === selectedCarrier);
    return records;
  }, [state.autoRecords, startDate, endDate, selectedCarrier]);

  const filteredServices = useMemo(() => {
    let records = state.serviceRecords.filter(r => r.date >= startDate && r.date <= endDate);
    if (selectedCarrier !== 'Все') records = records.filter(r => r.carrier === selectedCarrier);
    return records;
  }, [state.serviceRecords, startDate, endDate, selectedCarrier]);

  // Общая статистика
  const stats = useMemo(() => {
    const totalHours = filteredAuto.reduce((sum, r) => sum + calcDurationHours(r.arrival, r.departure), 0)
      + filteredServices.reduce((sum, r) => sum + calcServiceHours(r), 0);
    const totalCost = filteredAuto.reduce((sum, r) => sum + calcAutoCost(r), 0)
      + filteredServices.reduce((sum, r) => sum + calcServiceCost(r), 0);
    const autoCost = filteredAuto.reduce((sum, r) => sum + calcAutoCost(r), 0);
    const serviceCost = filteredServices.reduce((sum, r) => sum + calcServiceCost(r), 0);

    return {
      totalCount: filteredAuto.length + filteredServices.length,
      autoCount: filteredAuto.length,
      serviceCount: filteredServices.length,
      totalHours,
      totalCost,
      autoCost,
      serviceCost,
    };
  }, [filteredAuto, filteredServices]);

  // Статистика по типам автомобилей
  const autoStats = useMemo(() => {
    const grouped: Record<string, { count: number; hours: number; cost: number }> = {};
    for (const r of filteredAuto) {
      if (!grouped[r.car_type]) grouped[r.car_type] = { count: 0, hours: 0, cost: 0 };
      grouped[r.car_type].count++;
      grouped[r.car_type].hours += calcDurationHours(r.arrival, r.departure);
      grouped[r.car_type].cost += calcAutoCost(r);
    }
    return Object.entries(grouped).map(([type, data]) => ({
      type,
      ...data,
      avgCost: data.count > 0 ? data.cost / data.count : 0,
    })).sort((a, b) => a.type.localeCompare(b.type));
  }, [filteredAuto]);

  // Статистика по типам услуг
  const serviceStats = useMemo(() => {
    const grouped: Record<string, { count: number; totalQuantity: number; totalHours: number; totalCost: number }> = {};
    for (const r of filteredServices) {
      if (!grouped[r.service_type]) grouped[r.service_type] = { count: 0, totalQuantity: 0, totalHours: 0, totalCost: 0 };
      grouped[r.service_type].count++;
      grouped[r.service_type].totalQuantity += r.quantity;
      grouped[r.service_type].totalCost += calcServiceCost(r);
      if (r.payment_type === 'hourly') grouped[r.service_type].totalHours += calcServiceHours(r);
    }
    return Object.entries(grouped).map(([type, data]) => ({ type, ...data })).sort((a, b) => a.type.localeCompare(b.type));
  }, [filteredServices]);

  return (
    <div className="space-y-4">
      {/* Фильтры */}
      <div className="bg-white rounded-lg border p-4">
        <h3 className="font-bold text-sm text-gray-700 mb-3">📅 Период статистики</h3>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-600">Начальная дата:</label>
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="border rounded px-2 py-1 text-sm" />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-600">Конечная дата:</label>
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="border rounded px-2 py-1 text-sm" />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-600">Перевозчик:</label>
            <select value={selectedCarrier} onChange={e => setSelectedCarrier(e.target.value)} className="border rounded px-2 py-1 text-sm">
              {availableCarriers.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Карточки статистики */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard title="Всего записей" value={stats.totalCount.toString()} color="blue" />
        <StatCard title="Автомобили" value={stats.autoCount.toString()} color="green" />
        <StatCard title="Услуги" value={stats.serviceCount.toString()} color="purple" />
        <StatCard title="Общее время (ч)" value={formatNumber(stats.totalHours)} color="orange" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <StatCard title="Общая стоимость" value={`${formatNumber(stats.totalCost)} ₽`} color="red" />
        <StatCard title="Стоимость авто" value={`${formatNumber(stats.autoCost)} ₽`} color="green" />
        <StatCard title="Стоимость услуг" value={`${formatNumber(stats.serviceCost)} ₽`} color="purple" />
      </div>

      {/* Таблица по типам автомобилей */}
      <div className="bg-white rounded-lg border p-4">
        <h3 className="font-bold text-sm text-gray-700 mb-3">🚗 Статистика по типам автомобилей</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-100">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">Тип ТС</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-gray-600">Кол-во рейсов</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-gray-600">Часы</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-gray-600">Стоимость</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-gray-600">Средняя стоимость</th>
              </tr>
            </thead>
            <tbody>
              {autoStats.map((s, idx) => (
                <tr key={idx} className="border-t hover:bg-gray-50">
                  <td className="px-3 py-1.5">{s.type}</td>
                  <td className="px-3 py-1.5 text-right">{s.count}</td>
                  <td className="px-3 py-1.5 text-right">{formatNumber(s.hours)}</td>
                  <td className="px-3 py-1.5 text-right font-medium">{formatNumber(s.cost)}</td>
                  <td className="px-3 py-1.5 text-right">{formatNumber(s.avgCost)}</td>
                </tr>
              ))}
              {autoStats.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-4 text-center text-gray-400">Нет данных</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Таблица по типам услуг */}
      <div className="bg-white rounded-lg border p-4">
        <h3 className="font-bold text-sm text-gray-700 mb-3">🔧 Статистика по типам услуг</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-100">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">Тип услуги</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-gray-600">Кол-во заказов</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-gray-600">Всего единиц</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-gray-600">Всего часов</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-gray-600">Общая стоимость</th>
              </tr>
            </thead>
            <tbody>
              {serviceStats.map((s, idx) => (
                <tr key={idx} className="border-t hover:bg-gray-50">
                  <td className="px-3 py-1.5">{s.type}</td>
                  <td className="px-3 py-1.5 text-right">{s.count}</td>
                  <td className="px-3 py-1.5 text-right">{formatNumber(s.totalQuantity)}</td>
                  <td className="px-3 py-1.5 text-right">{formatNumber(s.totalHours)}</td>
                  <td className="px-3 py-1.5 text-right font-medium">{formatNumber(s.totalCost)}</td>
                </tr>
              ))}
              {serviceStats.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-4 text-center text-gray-400">Нет данных</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StatCard({ title, value, color }: { title: string; value: string; color: string }) {
  const colorClasses: Record<string, string> = {
    blue: 'border-blue-200 bg-blue-50',
    green: 'border-green-200 bg-green-50',
    purple: 'border-purple-200 bg-purple-50',
    orange: 'border-orange-200 bg-orange-50',
    red: 'border-red-200 bg-red-50',
  };

  const textColors: Record<string, string> = {
    blue: 'text-blue-700',
    green: 'text-green-700',
    purple: 'text-purple-700',
    orange: 'text-orange-700',
    red: 'text-red-700',
  };

  return (
    <div className={`rounded-lg border p-3 ${colorClasses[color] || colorClasses.blue}`}>
      <p className="text-xs text-gray-600">{title}</p>
      <p className={`text-lg font-bold ${textColors[color] || textColors.blue}`}>{value}</p>
    </div>
  );
}
