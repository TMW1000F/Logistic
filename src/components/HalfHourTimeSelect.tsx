// Выбор времени с фиксированным шагом 30 минут: минуты только :00 или :30.
// Заменяет нативный <input type="time">, где браузер допускал произвольные минуты.
interface Props {
  value: string;                     // 'HH:MM'
  onChange: (v: string) => void;
  darkMode?: boolean;
  className?: string;
  title?: string;
}

const OPTIONS: string[] = Array.from({ length: 48 }, (_, i) => {
  const h = String(Math.floor(i / 2)).padStart(2, '0');
  const m = i % 2 ? '30' : '00';
  return `${h}:${m}`;
});

export default function HalfHourTimeSelect({ value, onChange, darkMode = false, className = '', title }: Props) {
  // Если в данных вдруг оказалась «нестандартная» минута — показываем её отдельным пунктом,
  // чтобы значение не терялось до явного выбора пользователем.
  const extraOption = !!value && !OPTIONS.includes(value);

  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      title={title ?? 'Время указывается с точностью до 30 минут (:00 или :30)'}
      className={`border rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 ${className} ${darkMode ? 'bg-gray-700 border-gray-600 text-white' : ''}`}
    >
      {extraOption && <option value={value}>{value}</option>}
      {OPTIONS.map(o => (
        <option key={o} value={o}>{o}</option>
      ))}
    </select>
  );
}
