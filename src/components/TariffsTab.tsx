import { useState, useMemo } from 'react';
import { useStore } from '../store';
import { useToast } from './Toast';
import { Tariff, formatNumber, generateId } from '../types';
import { Save, Edit, Trash2, Download, Upload } from 'lucide-react';

interface Props {
  onStatus?: (msg: string) => void;
  darkMode?: boolean;
}

export default function TariffsTab({ onStatus, darkMode = false }: Props) {
  const { state, dispatch } = useStore();
  const toast = useToast();

  const [tariffType, setTariffType] = useState<'auto' | 'service'>('auto');
  const [category, setCategory] = useState('');
  const [carrier, setCarrier] = useState('');
  const [price, setPrice] = useState('');
  const [paymentType, setPaymentType] = useState<'hourly' | 'fixed'>('hourly');
  const [editingId, setEditingId] = useState<string | null>(null);

  // Фильтрация тарифов
  const filteredTariffs = useMemo(() => {
    return state.tariffs
      .filter(t => t.type === tariffType)
      .sort((a, b) => (a.category + a.carrier).localeCompare(b.category + b.carrier));
  }, [state.tariffs, tariffType]);

  // Сохранение тарифа
  const handleSave = () => {
    if (!category.trim() || !carrier.trim() || !price.trim()) {
      toast.warning('Заполните все поля');
      return;
    }

    const priceNum = parseFloat(price.replace(',', '.'));
    if (isNaN(priceNum) || priceNum <= 0) {
      toast.error('Цена должна быть положительным числом');
      return;
    }

    const tariff: Tariff = {
      id: editingId || generateId(),
      type: tariffType,
      category: category.trim(),
      carrier: carrier.trim(),
      price: Math.round(priceNum * 100) / 100,
      payment_type: tariffType === 'service' ? paymentType : 'hourly',
    };

    dispatch({ type: 'ADD_TARIFF', payload: tariff });
    clearForm();
    toast.success('Тариф сохранён');
  };

  // Редактирование
  const handleEdit = (tariff: Tariff) => {
    setTariffType(tariff.type);
    setCategory(tariff.category);
    setCarrier(tariff.carrier);
    setPrice(tariff.price.toString());
    setPaymentType(tariff.payment_type);
    setEditingId(tariff.id);
  };

  // Удаление
  const handleDelete = (id: string) => {
    if (confirm('Удалить выбранный тариф?')) {
      dispatch({ type: 'DELETE_TARIFF', payload: id });
      toast.success('Тариф удалён');
    }
  };

  // Очистка формы
  const clearForm = () => {
    setCategory('');
    setCarrier('');
    setPrice('');
    setEditingId(null);
  };

  // Экспорт тарифов
  const handleExport = () => {
    const data = state.tariffs.map(t => ({
      type: t.type,
      category: t.category,
      carrier: t.carrier,
      price: t.price,
      payment_type: t.payment_type,
    }));
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'tariffs_export.json';
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Экспортировано ${state.tariffs.length} тарифов`);
  };

  // Импорт тарифов
  const handleImport = () => {
    if (!confirm('Импорт заменит существующие тарифы. Продолжить?')) return;

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const data = JSON.parse(ev.target?.result as string);
          if (!Array.isArray(data)) {
            toast.error('Неверный формат файла');
            return;
          }

          const tariffs: Tariff[] = data.map((item: any) => ({
            id: generateId(),
            type: item.type || 'auto',
            category: item.category || '',
            carrier: item.carrier || '',
            price: parseFloat(item.price) || 0,
            payment_type: item.payment_type || 'hourly',
          })).filter((t: Tariff) => t.category && t.carrier && t.price > 0);

          dispatch({ type: 'SET_TARIFFS', payload: tariffs });
          toast.success(`Импортировано ${tariffs.length} тарифов`);
        } catch (err) {
          toast.error('Ошибка чтения файла');
        }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  return (
    <div className="h-full overflow-auto space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Левая часть - форма */}
        <div className={`rounded-lg p-4 space-y-4 ${darkMode ? 'bg-gray-800' : 'bg-white border border-gray-200'}`}>
          <h3 className={`font-bold text-sm border-b pb-2 ${darkMode ? 'text-gray-200 border-gray-700' : 'text-gray-700 border-gray-200'}`}>💰 Редактирование тарифов</h3>

          {/* Переключатель типа */}
          <div className="flex gap-4">
            <label className={`flex items-center gap-1 text-sm ${darkMode ? 'text-gray-300' : ''}`}>
              <input type="radio" checked={tariffType === 'auto'} onChange={() => { setTariffType('auto'); clearForm(); }} />
              🚗 Автомобили
            </label>
            <label className={`flex items-center gap-1 text-sm ${darkMode ? 'text-gray-300' : ''}`}>
              <input type="radio" checked={tariffType === 'service'} onChange={() => { setTariffType('service'); clearForm(); }} />
              🔧 Услуги
            </label>
          </div>

          <div className="space-y-3">
            <div>
              <label className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>{tariffType === 'auto' ? 'Тип ТС:' : 'Тип услуги:'}</label>
              <input
                type="text"
                value={category}
                onChange={e => setCategory(e.target.value)}
                className={`w-full border rounded px-3 py-1.5 text-sm ${darkMode ? 'bg-gray-700 border-gray-600 text-white' : ''}`}
                placeholder={tariffType === 'auto' ? 'Например: Фура, Манипулятор...' : 'Например: Погрузка, Разгрузка...'}
              />
            </div>
            <div>
              <label className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Компания:</label>
              <input
                type="text"
                value={carrier}
                onChange={e => setCarrier(e.target.value)}
                className={`w-full border rounded px-3 py-1.5 text-sm ${darkMode ? 'bg-gray-700 border-gray-600 text-white' : ''}`}
                placeholder="Название компании-перевозчика"
              />
            </div>
            <div>
              <label className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Цена (₽):</label>
              <input
                type="text"
                value={price}
                onChange={e => setPrice(e.target.value)}
                className={`w-full border rounded px-3 py-1.5 text-sm ${darkMode ? 'bg-gray-700 border-gray-600 text-white' : ''}`}
                placeholder="0.00"
              />
            </div>

            {/* Тип оплаты (только для услуг) */}
            {tariffType === 'service' && (
              <div>
                <label className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Тип оплаты:</label>
                <select
                  value={paymentType}
                  onChange={e => setPaymentType(e.target.value as 'hourly' | 'fixed')}
                  className={`w-full border rounded px-3 py-1.5 text-sm ${darkMode ? 'bg-gray-700 border-gray-600 text-white' : ''}`}
                >
                  <option value="hourly">Почасовая</option>
                  <option value="fixed">Фиксированная</option>
                </select>
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <button onClick={handleSave} className="flex items-center gap-1 bg-blue-600 text-white px-3 py-1.5 rounded text-sm hover:bg-blue-700">
              <Save size={14} /> {editingId ? 'Обновить' : 'Сохранить'}
            </button>
            {editingId && (
              <button onClick={clearForm} className={`px-3 py-1.5 rounded text-sm ${darkMode ? 'bg-gray-700 text-gray-300 hover:bg-gray-600' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}>
                Отмена
              </button>
            )}
          </div>

          <hr className={`my-4 ${darkMode ? 'border-gray-700' : ''}`} />

          {/* Экспорт/Импорт */}
          <div className="flex gap-2">
            <button onClick={handleExport} className="flex items-center gap-1 bg-purple-600 text-white px-3 py-1.5 rounded text-sm hover:bg-purple-700">
              <Download size={14} /> Экспорт тарифов
            </button>
            <button onClick={handleImport} className="flex items-center gap-1 bg-orange-600 text-white px-3 py-1.5 rounded text-sm hover:bg-orange-700">
              <Upload size={14} /> Импорт тарифов
            </button>
          </div>

          {/* О программе */}
          <div className={`rounded p-3 text-xs ${darkMode ? 'bg-gray-700 text-gray-400' : 'bg-gray-50 text-gray-600'}`}>
            <p className="font-bold">Учёт автомобилей v2.0</p>
            <p>АО «Логистик-Центр»</p>
            <p>Шавлаков А.В., Норильск, 2025</p>
            <p className="mt-1">Записей: авто — {state.autoRecords.length}, услуг — {state.serviceRecords.length}</p>
          </div>
        </div>

        {/* Правая часть - таблица тарифов */}
        <div className={`rounded-lg p-4 ${darkMode ? 'bg-gray-800' : 'bg-white border border-gray-200'}`}>
          <h3 className={`font-bold text-sm mb-3 ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>📋 Список тарифов ({filteredTariffs.length})</h3>
          
          <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className={`sticky top-0 ${darkMode ? 'bg-gray-700' : 'bg-gray-100'}`}>
                <tr>
                  <th className={`px-2 py-2 text-left text-xs font-medium ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>Категория</th>
                  <th className={`px-2 py-2 text-left text-xs font-medium ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>Компания</th>
                  <th className={`px-2 py-2 text-right text-xs font-medium ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>Цена</th>
                  {tariffType === 'service' && <th className={`px-2 py-2 text-center text-xs font-medium ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>Тип оплаты</th>}
                  <th className={`px-2 py-2 text-center text-xs font-medium ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>⚙️</th>
                </tr>
              </thead>
              <tbody>
                {filteredTariffs.map(tariff => (
                  <tr key={tariff.id} className={`border-t ${darkMode ? 'border-gray-700 hover:bg-gray-700' : 'hover:bg-gray-50'}`}>
                    <td className="px-2 py-1.5">{tariff.category}</td>
                    <td className="px-2 py-1.5">{tariff.carrier}</td>
                    <td className="px-2 py-1.5 text-right font-medium">{formatNumber(tariff.price)}</td>
                    {tariffType === 'service' && (
                      <td className="px-2 py-1.5 text-center text-xs">
                        {tariff.payment_type === 'hourly' ? 'Почасовая' : 'Фиксированная'}
                      </td>
                    )}
                    <td className="px-2 py-1.5 text-center">
                      <div className="flex justify-center gap-1">
                        <button onClick={() => handleEdit(tariff)} className="text-blue-500 hover:text-blue-700">
                          <Edit size={14} />
                        </button>
                        <button onClick={() => handleDelete(tariff.id)} className="text-red-500 hover:text-red-700">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredTariffs.length === 0 && (
                  <tr>
                    <td colSpan={tariffType === 'service' ? 5 : 4} className={`px-4 py-8 text-center ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                      Нет тарифов. Добавьте первый тариф.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
