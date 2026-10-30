import { useState, useMemo, useRef } from 'react';
import * as XLSX from 'xlsx';
import { useStore } from '../store';
import { useToast } from './Toast';
import { CarInBase, normalizePlate, formatPlateDisplay, isValidPlateFormat, plateFormatHint, generateId } from '../types';
import { Plus, Edit, Trash2, X, Car, Search, Download, Upload } from 'lucide-react';

interface Props {
  darkMode?: boolean;
  readOnly?: boolean;
}

// Разделители полей в текстовых файлах импорта: табуляция или точка с запятой
const FIELD_SPLIT = /[\t;]/;

// Разбор строки вида «Госномер [ТипТС] [Перевозчик]» → { plate, carType, carrier }
// Госномер ищется по формату: до него — лишнее игнорируется, после — первое слово тип ТС, второе — перевозчик.
function parseCarLine(line: string): { plate: string; carType: string; carrier: string } | null {
  const parts = line.split(FIELD_SPLIT).map(s => s.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  let idx = -1;
  for (let i = 0; i < parts.length; i++) {
    if (isValidPlateFormat(parts[i])) { idx = i; break; }
  }
  if (idx === -1) return null; // строка без номера (заголовок и пр.) — пропускаем
  return {
    plate: normalizePlate(parts[idx]),
    carType: parts[idx + 1] ?? '',
    carrier: parts[idx + 2] ?? '',
  };
}

// Извлечение записей из книги Excel (первый лист): госномер ищем по формату,
// следующие две ячейки строки — тип ТС и перевозчик.
function extractCarsFromWorkbook(wb: XLSX.WorkBook): { plate: string; carType: string; carrier: string }[] {
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return [];
  const rows: string[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
  const result: { plate: string; carType: string; carrier: string }[] = [];
  for (const row of rows) {
    const cells = row.map(c => String(c ?? '').trim());
    const idx = cells.findIndex(c => c && isValidPlateFormat(c));
    if (idx === -1) continue;
    result.push({ plate: normalizePlate(cells[idx]), carType: cells[idx + 1] ?? '', carrier: cells[idx + 2] ?? '' });
  }
  return result;
}

export default function CarsTab({ darkMode = false, readOnly = false }: Props) {
  const { state, dispatch, syncToServer } = useStore();
  const toast = useToast();
  const importInputRef = useRef<HTMLInputElement>(null);

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
    toast.success(editingId ? `✏️ Автомобиль ${display} обновлён` : `🚗 Автомобиль ${display} добавлен в базу`);
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
      toast.error(`🗑️ Автомобиль ${car.display} удалён из базы`);

    }
  };

  // ==================== Экспорт / импорт базы автомобилей ====================

  // Экспорт — простой текстовый файл с табуляцией в качестве разделителя:
  // Госномер\tТипТС\tПеревозчик
  // В990РС124\tКМУ\tАТП
  const handleExportCars = () => {
    if (state.cars.length === 0) {
      toast.warning('База автомобилей пуста — экспортировать нечего');
      return;
    }
    const rows = [...state.cars]
      .sort((a, b) => a.display.localeCompare(b.display, 'ru'))
      .map(c => [c.display, c.car_type, c.carrier].join('\t'));
    const content = ['Госномер\tТипТС\tПеревозчик', ...rows].join('\r\n') + '\r\n';
    const blob = new Blob(['\uFEFF' + content], { type: 'text/tab-separated-values;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const today = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `cars_base_${today}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Экспортировано автомобилей: ${state.cars.length}`);
    toast.info(`📤 База автомобилей экспортирована (${state.cars.length} шт.)`);

  };

  const handleImportFile = async (file: File) => {
    try {
      // Разбор файла: Excel (.xlsx/.xls) или текст с разделителями (табуляция / «;»)
      let parsed: { plate: string; carType: string; carrier: string }[];
      if (/\.(xlsx|xls)$/i.test(file.name)) {
        const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
        parsed = extractCarsFromWorkbook(wb);
      } else {
        let text = await file.text();
        if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1); // отрезаем BOM
        parsed = text.split(/\r\n|\r|\n/).map(parseCarLine).filter(Boolean) as NonNullable<ReturnType<typeof parseCarLine>>[];
      }
      if (parsed.length === 0) {
        toast.error('В файле не найдено ни одной строки с госномером. Ожидается формат: Госномер → ТипТС → Перевозчик (табуляция, «;» или Excel)');
        return;
      }

      // Дубликаты внутри файла
      const seen = new Set<string>();
      const unique = parsed.filter(p => {
        if (seen.has(p.plate)) return false;
        seen.add(p.plate);
        return true;
      });
      const dupInFileCount = parsed.length - unique.length;

      // Совпадения с текущей базой — при импорте обновляем тип/перевозчик существующего авто
      const existingByPlate = new Map(state.cars.map(c => [c.plate, c] as const));
      const toUpdate = unique.filter(p => existingByPlate.has(p.plate));
      const toAdd = unique.filter(p => !existingByPlate.has(p.plate));

      // Проверка сочетаний «Тип ТС + Перевозчик» по тарифам (как при ручном добавлении)
      const comboOk = (p: { plate: string; carType: string; carrier: string }) =>
        !!p.carType && !!p.carrier && state.tariffs.some(
          t => t.type === 'auto' && t.category === p.carType && t.carrier === p.carrier
        );
      const badCombo = unique.filter(p => !comboOk(p));
      if (badCombo.length > 0) {
        const examples = badCombo.slice(0, 5).map(p => {
          const d = formatPlateDisplay(p.plate);
          return !p.carType || !p.carrier
            ? `${d} (не указан тип ТС или перевозчик)`
            : `${d} (${p.carType} + ${p.carrier})`;
        }).join(', ');
        const more = badCombo.length > 5 ? ` … и ещё ${badCombo.length - 5}` : '';
        toast.error(`Импорт отменён: в тарифах нет сочетания «Тип ТС + Перевозчик» для ${badCombo.length} авто: ${examples}${more}. Добавьте нужные тарифы или исправьте файл.`);
        return;
      }

      const mode = state.cars.length > 0
        ? (confirm(
            `Найдено строк с номерами: ${unique.length}\n` +
            `Новых: ${toAdd.length}, совпадающих с базой (будут обновлены): ${toUpdate.length}` +
            (dupInFileCount ? `, дублей в файле (пропущены): ${dupInFileCount}` : '') +
            `\n\nOK — добавить новые и обновить совпадения\nОтмена — полностью ЗАМЕНИТЬ базу импортированными данными`
          ) ? 'merge' : 'replace')
        : 'add';

      const carsToAdd: CarInBase[] = toAdd.map(p => ({
        id: generateId(),
        plate: p.plate,
        display: formatPlateDisplay(p.plate),
        car_type: p.carType,
        carrier: p.carrier,
      }));
      const carsUpdated: CarInBase[] = toUpdate.map(p => {
        const old = existingByPlate.get(p.plate)!;
        return { ...old, car_type: p.carType, carrier: p.carrier };
      });

      if (mode === 'replace') {
        if (!confirm(`Заменить всю базу автомобилей (${state.cars.length} шт.) на ${unique.length} из файла? Остальные данные (рейсы, тарифы) НЕ затрагиваются.`)) return;
        dispatch({ type: 'MERGE_CARS', payload: [...carsUpdated, ...carsToAdd] });
        // Удаляем тех, кого нет в файле
        const importedPlates = new Set(unique.map(p => p.plate));
        for (const c of state.cars) {
          if (!importedPlates.has(c.plate)) dispatch({ type: 'DELETE_CAR', payload: c.id });
        }
      } else {
        dispatch({ type: 'MERGE_CARS', payload: [...carsUpdated, ...carsToAdd] });
      }

      syncToServer();
      const summary = mode === 'replace'
        ? `база заменена: ${unique.length} авто`
        : `новых: ${carsToAdd.length}, обновлено: ${carsUpdated.length}` + (dupInFileCount ? `, дублей пропущено: ${dupInFileCount}` : '');
      toast.success(`Импорт завершён (${summary})`);
      toast.success(`📥 Импорт базы автомобилей: ${summary}`);

    } catch (e) {
      console.error('Ошибка импорта:', e);
      toast.error('Не удалось прочитать файл. Используйте текстовый файл (.txt/.tsv/.csv) в кодировке UTF-8 или Windows-1251');
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
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search size={16} className={`absolute left-3 top-1/2 -translate-y-1/2 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`} />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="🔍 Поиск по номеру, типу, перевозчику..."
                className={`w-full border rounded pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 ${darkMode ? 'bg-gray-700 border-gray-600 text-white' : ''}`}
              />
            </div>
            <button
              type="button"
              onClick={handleExportCars}
              title="Экспорт базы автомобилей в текстовый файл (Госномер → ТипТС → Перевозчик)"
              className={`flex items-center gap-1 px-3 py-2 rounded text-sm whitespace-nowrap ${darkMode ? 'bg-gray-700 text-gray-200 hover:bg-gray-600' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}
            >
              <Download size={14} /> Экспорт
            </button>
            {!readOnly && (
              <>
                <button
                  type="button"
                  onClick={() => importInputRef.current?.click()}
                  title="Импорт базы автомобилей из текстового файла (формат: Госномер → ТипТС → Перевозчик)"
                  className={`flex items-center gap-1 px-3 py-2 rounded text-sm whitespace-nowrap ${darkMode ? 'bg-gray-700 text-gray-200 hover:bg-gray-600' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}
                >
                  <Upload size={14} /> Импорт
                </button>
                {/* Скрытый input для выбора файла импорта */}
                <input
                  ref={importInputRef}
                  type="file"
                  accept=".txt,.tsv,.csv,.xlsx,.xls,text/plain"
                  className="hidden"
                  onChange={e => {
                    const f = e.target.files?.[0];
                    if (f) handleImportFile(f);
                    e.target.value = ''; // чтобы повторный выбор того же файла тоже срабатывал
                  }}
                />
              </>
            )}
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
