import React, { useState, useMemo } from 'react';
import { useStore } from '../store';
import { calcDurationHours, calcAutoCost, calcServiceHours, calcServiceCost, formatNumber, formatDate } from '../types';
import * as XLSX from 'xlsx';

interface Props {
  onStatus?: (msg: string) => void;
  darkMode?: boolean;
}

export default function ResultsTab({ onStatus, darkMode = false }: Props) {
  const { state } = useStore();

  const [mode, setMode] = useState<'auto_only' | 'all' | 'services_only'>('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedCarrier, setSelectedCarrier] = useState('');

  // Все перевозчики
  const allCarriers = useMemo(() => {
    const carriers = new Set<string>();
    state.autoRecords.forEach(r => carriers.add(r.carrier));
    state.serviceRecords.forEach(r => carriers.add(r.carrier));
    return [''].concat([...carriers].sort());
  }, [state]);

  // Сводная таблица
  const summaryData = useMemo(() => {
    if (!startDate || !endDate) return null;

    const includeAuto = mode === 'auto_only' || mode === 'all';
    const includeServices = mode === 'services_only' || mode === 'all';

    let autoRecords = state.autoRecords.filter(r => r.date >= startDate && r.date <= endDate);
    let serviceRecords = state.serviceRecords.filter(r => r.date >= startDate && r.date <= endDate);

    if (selectedCarrier) {
      autoRecords = autoRecords.filter(r => r.carrier === selectedCarrier);
      serviceRecords = serviceRecords.filter(r => r.carrier === selectedCarrier);
    }

    if (!includeAuto) autoRecords = [];
    if (!includeServices) serviceRecords = [];

    // Группировка по датам
    const dateSummary: Record<string, { autos: Record<string, { count: number; time: number; cost: number }>; services: Record<string, { count: number; time: number; cost: number }> }> = {};
    const allTypes = new Set<string>();

    for (const r of autoRecords) {
      if (!dateSummary[r.date]) dateSummary[r.date] = { autos: {}, services: {} };
      if (!dateSummary[r.date].autos[r.car_type]) dateSummary[r.date].autos[r.car_type] = { count: 0, time: 0, cost: 0 };
      dateSummary[r.date].autos[r.car_type].count++;
      dateSummary[r.date].autos[r.car_type].time += calcDurationHours(r.arrival, r.departure);
      dateSummary[r.date].autos[r.car_type].cost += calcAutoCost(r);
      allTypes.add(r.car_type);
    }

    for (const r of serviceRecords) {
      if (!dateSummary[r.date]) dateSummary[r.date] = { autos: {}, services: {} };
      if (!dateSummary[r.date].services[r.service_type]) dateSummary[r.date].services[r.service_type] = { count: 0, time: 0, cost: 0 };
      dateSummary[r.date].services[r.service_type].count++;
      dateSummary[r.date].services[r.service_type].cost += calcServiceCost(r);
      if (r.payment_type === 'hourly') dateSummary[r.date].services[r.service_type].time += calcServiceHours(r);
      allTypes.add(r.service_type + ' (услуга)');
    }

    const sortedDates = Object.keys(dateSummary).sort();
    const sortedTypes = [...allTypes].sort();

    let totalAllCount = 0;
    let totalAllCost = 0;
    let totalAllTime = 0;

    const rows = sortedDates.map(date => {
      const dayData = dateSummary[date];
      let dayCount = 0;
      let dayCost = 0;
      let dayTime = 0;

      const typeData: Record<string, { count: number; time: number; cost: number }> = {};
      
      for (const type of sortedTypes) {
        const isService = type.includes('(услуга)');
        const baseName = type.replace(' (услуга)', '');
        
        if (isService && dayData.services[baseName]) {
          typeData[type] = dayData.services[baseName];
        } else if (!isService && dayData.autos[baseName]) {
          typeData[type] = dayData.autos[baseName];
        } else {
          typeData[type] = { count: 0, time: 0, cost: 0 };
        }
        
        dayCount += typeData[type].count;
        dayCost += typeData[type].cost;
        dayTime += typeData[type].time;
      }

      totalAllCount += dayCount;
      totalAllCost += dayCost;
      totalAllTime += dayTime;

      return { date, typeData, dayCount, dayCost, dayTime };
    });

    return { rows, sortedTypes, totalAllCount, totalAllCost, totalAllTime };
  }, [state, mode, startDate, endDate, selectedCarrier]);

  // Статистика по типам услуг
  const serviceTypeStats = useMemo(() => {
    if (!startDate || !endDate) return [];

    let records = state.serviceRecords.filter(r => r.date >= startDate && r.date <= endDate);
    if (selectedCarrier) records = records.filter(r => r.carrier === selectedCarrier);

    const stats: Record<string, { orders: number; units: number; hours: number; cost: number }> = {};
    for (const r of records) {
      if (!stats[r.service_type]) stats[r.service_type] = { orders: 0, units: 0, hours: 0, cost: 0 };
      stats[r.service_type].orders++;
      stats[r.service_type].units += r.quantity;
      stats[r.service_type].cost += calcServiceCost(r);
      if (r.payment_type === 'hourly') stats[r.service_type].hours += calcServiceHours(r);
    }

    return Object.entries(stats).map(([type, data]) => ({ type, ...data })).sort((a, b) => a.type.localeCompare(b.type));
  }, [state, startDate, endDate, selectedCarrier]);

  // Экспорт в Excel
  const exportToExcel = () => {
    if (!summaryData || summaryData.rows.length === 0) {
      alert('Нет данных для сохранения');
      return;
    }

    const wb = XLSX.utils.book_new();
    
    // Заголовки
    const headers = ['Дата', ...summaryData.sortedTypes.flatMap(t => [t, 'Кол-во', 'Часы', 'Стоимость']), 'Всего ТС', 'Всего часов', 'Всего стоимость'];
    
    const data = summaryData.rows.map(row => {
      const rowData: any[] = [formatDate(row.date)];
      for (const type of summaryData.sortedTypes) {
        const td = row.typeData[type] || { count: 0, time: 0, cost: 0 };
        rowData.push(type, td.count, td.time, td.cost);
      }
      rowData.push(row.dayCount, row.dayTime, row.dayCost);
      return rowData;
    });

    const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
    XLSX.utils.book_append_sheet(wb, ws, 'Итоги');

    // Статистика по услугам
    if (serviceTypeStats.length > 0) {
      const svcHeaders = ['Тип услуги', 'Кол-во заказов', 'Единиц', 'Часы', 'Стоимость'];
      const svcData = serviceTypeStats.map(s => [s.type, s.orders, s.units, s.hours, s.cost]);
      const ws2 = XLSX.utils.aoa_to_sheet([svcHeaders, ...svcData]);
      XLSX.utils.book_append_sheet(wb, ws2, 'Услуги');
    }

    XLSX.writeFile(wb, 'итоги.xlsx');
  };

  return (
    <div className="space-y-4">
      {/* Режим отображения */}
      <div className={`rounded-lg border p-4 ${darkMode ? 'bg-gray-800 border-gray-600' : 'bg-white border-gray-200'}`}>
        <h3 className={`font-bold text-sm mb-3 ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>📊 Режим отображения</h3>
        <div className="flex flex-wrap gap-4">
          <label className={`flex items-center gap-1 text-sm ${darkMode ? 'text-gray-300' : ''}`}>
            <input type="radio" checked={mode === 'auto_only'} onChange={() => setMode('auto_only')} />
            Без доп. услуг
          </label>
          <label className={`flex items-center gap-1 text-sm ${darkMode ? 'text-gray-300' : ''}`}>
            <input type="radio" checked={mode === 'all'} onChange={() => setMode('all')} />
            С доп. услугами
          </label>
          <label className={`flex items-center gap-1 text-sm ${darkMode ? 'text-gray-300' : ''}`}>
            <input type="radio" checked={mode === 'services_only'} onChange={() => setMode('services_only')} />
            Только доп. услуги
          </label>
        </div>
      </div>

      {/* Фильтры */}
      <div className={`rounded-lg border p-4 ${darkMode ? 'bg-gray-800 border-gray-600' : 'bg-white border-gray-200'}`}>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <label className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Начальная дата:</label>
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className={`border rounded px-2 py-1 text-sm ${darkMode ? 'bg-gray-700 border-gray-600 text-white' : ''}`} />
          </div>
          <div className="flex items-center gap-2">
            <label className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Конечная дата:</label>
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className={`border rounded px-2 py-1 text-sm ${darkMode ? 'bg-gray-700 border-gray-600 text-white' : ''}`} />
          </div>
          <div className="flex items-center gap-2">
            <label className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Перевозчик:</label>
            <select value={selectedCarrier} onChange={e => setSelectedCarrier(e.target.value)} className={`border rounded px-2 py-1 text-sm ${darkMode ? 'bg-gray-700 border-gray-600 text-white' : ''}`}>
              <option value="">Все</option>
              {allCarriers.filter(c => c).map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <button onClick={exportToExcel} className="bg-green-600 text-white px-3 py-1.5 rounded text-sm hover:bg-green-700">
            💾 Сохранить в Excel
          </button>
        </div>
      </div>

      {/* Статистика по типам услуг */}
      {serviceTypeStats.length > 0 && (
        <div className={`rounded-lg border p-4 ${darkMode ? 'bg-gray-800 border-gray-600' : 'bg-white border-gray-200'}`}>
          <h3 className={`font-bold text-sm mb-3 ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>📈 Статистика по типам услуг</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className={darkMode ? 'bg-gray-700' : 'bg-gray-100'}>
                <tr>
                  <th className={`px-3 py-2 text-left text-xs font-medium ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>Тип услуги</th>
                  <th className={`px-3 py-2 text-right text-xs font-medium ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>Кол-во заказов</th>
                  <th className={`px-3 py-2 text-right text-xs font-medium ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>Единиц</th>
                  <th className={`px-3 py-2 text-right text-xs font-medium ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>Часы</th>
                  <th className={`px-3 py-2 text-right text-xs font-medium ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>Стоимость</th>
                </tr>
              </thead>
              <tbody>
                {serviceTypeStats.map((s, idx) => (
                  <tr key={idx} className={`border-t ${darkMode ? 'border-gray-700 hover:bg-gray-700' : 'hover:bg-gray-50'}`}>
                    <td className="px-3 py-1.5">{s.type}</td>
                    <td className="px-3 py-1.5 text-right">{s.orders}</td>
                    <td className="px-3 py-1.5 text-right">{formatNumber(s.units)}</td>
                    <td className="px-3 py-1.5 text-right">{formatNumber(s.hours)}</td>
                    <td className="px-3 py-1.5 text-right font-medium">{formatNumber(s.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Сводная таблица */}
      <div className={`rounded-lg border overflow-hidden ${darkMode ? 'bg-gray-800 border-gray-600' : 'bg-white border-gray-200'}`}>
        <div className="overflow-x-auto">
          {summaryData ? (
            <table className="w-full text-sm">
              <thead className={darkMode ? 'bg-gray-700' : 'bg-gray-100'}>
                <tr>
                  <th className={`px-2 py-2 text-left text-xs font-medium sticky left-0 z-10 ${darkMode ? 'text-gray-300 bg-gray-700' : 'text-gray-600 bg-gray-100'}`}>Дата</th>
                  {summaryData.sortedTypes.map((type, idx) => (
                    <th key={idx} colSpan={3} className={`px-2 py-1 text-center text-xs font-medium border-l ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>{type}</th>
                  ))}
                  <th className={`px-2 py-2 text-right text-xs font-medium border-l ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>Всего ТС</th>
                  <th className={`px-2 py-2 text-right text-xs font-medium ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>Всего часов</th>
                  <th className={`px-2 py-2 text-right text-xs font-medium ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>Всего стоимость</th>
                </tr>
                <tr className={darkMode ? 'bg-gray-700/50' : 'bg-gray-50'}>
                  <th className={`px-2 py-1 sticky left-0 z-10 ${darkMode ? 'bg-gray-700/50' : 'bg-gray-50'}`}></th>
                  {summaryData.sortedTypes.map((_, idx) => (
                    <React.Fragment key={idx}>
                      <th className={`px-1 py-1 text-xs border-l ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>Кол-во</th>
                      <th className={`px-1 py-1 text-xs ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>Часы</th>
                      <th className={`px-1 py-1 text-xs ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>Стоим.</th>
                    </React.Fragment>
                  ))}
                  <th className="px-2 py-1 border-l"></th>
                  <th className="px-2 py-1"></th>
                  <th className="px-2 py-1"></th>
                </tr>
              </thead>
              <tbody>
                {summaryData.rows.map((row, idx) => (
                  <tr key={idx} className={`border-t ${darkMode ? 'border-gray-700 hover:bg-gray-700' : 'hover:bg-gray-50'}`}>
                    <td className={`px-2 py-1.5 sticky left-0 z-10 ${darkMode ? 'bg-gray-800' : 'bg-white'}`}>{formatDate(row.date)}</td>
                    {summaryData.sortedTypes.map((type, tIdx) => {
                      const td = row.typeData[type] || { count: 0, time: 0, cost: 0 };
                      return (
                        <React.Fragment key={tIdx}>
                          <td className="px-1 py-1.5 text-center border-l">{td.count || ''}</td>
                          <td className="px-1 py-1.5 text-right">{td.time > 0 ? formatNumber(td.time) : ''}</td>
                          <td className="px-1 py-1.5 text-right">{td.cost > 0 ? formatNumber(td.cost) : ''}</td>
                        </React.Fragment>
                      );
                    })}
                    <td className="px-2 py-1.5 text-right border-l font-medium">{row.dayCount}</td>
                    <td className="px-2 py-1.5 text-right">{formatNumber(row.dayTime)}</td>
                    <td className={`px-2 py-1.5 text-right font-medium ${darkMode ? 'text-red-400' : 'text-red-600'}`}>{formatNumber(row.dayCost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className={`px-4 py-8 text-center ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>Выберите даты для отображения итогов</div>
          )}
        </div>

        {/* Общие итоги */}
        {summaryData && (
          <div className={`border-t px-4 py-3 ${darkMode ? 'border-gray-700 bg-gray-700/50' : 'border-gray-200 bg-gray-50'}`}>
            <p className={`text-sm font-bold ${darkMode ? 'text-red-400' : 'text-red-600'}`}>
              Всего за период: {summaryData.totalAllCount} записей, время {formatNumber(summaryData.totalAllTime)} ч, сумма {formatNumber(summaryData.totalAllCost)} ₽
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
