import { useState } from 'react';
import { whoami } from '../api';
import { useToast } from './Toast';

interface Props {
  onAuthSuccess: () => void;
  onReadOnlyMode: () => void;
  darkMode: boolean;
}

// Экран входа. Регистрации и паролей нет: в корпоративной сети браузер
// автоматически передаёт учётные данные Windows (Kerberos/NTLM) через
// reverse-proxy, а сервер сверяет AD-логин со списком разрешённых (users.json).
// «Вход для редактирования» — одна кнопка, ничего вводить не нужно.
// «Только просмотр» — пускает кого угодно, без блокировок и редактирования.
export default function AuthScreen({ onAuthSuccess, onReadOnlyMode, darkMode }: Props) {
  const [isLoading, setIsLoading] = useState(false);
  const [adError, setAdError] = useState<string | null>(null);
  const toast = useToast();

  const handleEditLogin = async () => {
    setIsLoading(true);
    setAdError(null);

    try {
      const result = await whoami();

      if (result.success) {
        toast.success(`Добро пожаловать, ${result.user?.displayName || ''}!`);
        onAuthSuccess();
      } else {
        // Отказ сервера (нет в allow-list / отключён / нет групп) или прокси
        // не передал данные AD — показываем причину, остаёмся на экране входа.
        setAdError(result.error || 'Вход по Active Directory не выполнен');
      }
    } catch (error) {
      setAdError('Ошибка соединения с сервером');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={`min-h-screen flex items-center justify-center p-4 ${darkMode ? 'bg-gray-900' : 'bg-gradient-to-br from-blue-50 to-indigo-100'}`}>
      <div className={`w-full max-w-md rounded-xl shadow-2xl p-8 ${darkMode ? 'bg-gray-800' : 'bg-white'}`}>
        {/* Заголовок */}
        <div className="text-center mb-8">
          <div className={`inline-flex items-center justify-center w-16 h-16 rounded-full mb-4 ${darkMode ? 'bg-blue-900' : 'bg-blue-100'}`}>
            <svg className={`w-8 h-8 ${darkMode ? 'text-blue-400' : 'text-blue-600'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          </div>
          <h1 className={`text-2xl font-bold mb-2 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
            Учёт автомобилей
          </h1>
          <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
            АО «Логистик-Центр»
          </p>
        </div>

        {/* Вход для редактирования по Active Directory */}
        <button
          type="button"
          onClick={handleEditLogin}
          disabled={isLoading}
          className={`w-full py-3 px-4 rounded-lg font-medium text-white transition-all flex items-center justify-center gap-2 ${
            isLoading
              ? 'bg-gray-400 cursor-not-allowed'
              : 'bg-blue-600 hover:bg-blue-700 active:bg-blue-800'
          }`}
        >
          {isLoading ? (
            <>
              <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></span>
              Проверка Active Directory...
            </>
          ) : (
            <>✏️ Вход для редактирования</>
          )}
        </button>
        <p className={`text-xs text-center mt-2 ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>
          Автоматически по учётной записи Windows (Active Directory). Логин и пароль вводить не нужно.
        </p>

        {/* Причина отказа доступа */}
        {adError && (
          <div className={`mt-4 rounded-lg p-3 text-sm whitespace-pre-line ${darkMode ? 'bg-red-900/40 text-red-200' : 'bg-red-50 text-red-700'}`}>
            🔒 {adError}
          </div>
        )}

        {/* Режим только просмотра — доступен всем */}
        <div className="mt-6 pt-6 border-t border-gray-200 dark:border-gray-700">
          <button
            type="button"
            onClick={onReadOnlyMode}
            className={`w-full py-2 px-4 rounded-lg font-medium transition-all ${
              darkMode
                ? 'bg-gray-700 hover:bg-gray-600 text-gray-300'
                : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
            }`}
          >
            🔍 Только просмотр
          </button>
          <p className={`text-xs text-center mt-2 ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>
            Просмотр данных без возможности редактирования и без блокировки файла. Доступен всем.
          </p>
        </div>
      </div>
    </div>
  );
}
