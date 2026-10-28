import { useState } from 'react';

export default function App() {
  const [count, setCount] = useState(0);

  return (
    <div style={{ padding: '20px', fontFamily: 'Arial, sans-serif' }}>
      <h1>Учёт автомобилей v2.0</h1>
      <p>Если вы видите это сообщение, React работает корректно!</p>
      <button 
        onClick={() => setCount(count + 1)}
        style={{
          padding: '10px 20px',
          fontSize: '16px',
          backgroundColor: '#3b82f6',
          color: 'white',
          border: 'none',
          borderRadius: '5px',
          cursor: 'pointer'
        }}
      >
        Счётчик: {count}
      </button>
      <p style={{ marginTop: '20px', color: '#666' }}>
        Если кнопка работает, проблема в компонентах вкладок.
      </p>
    </div>
  );
}
