import { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY);

const DAYS = ["Poniedziałek", "Wtorek", "Środa", "Czwartek", "Piątek", "Sobota", "Niedziela"];
const MEALS = [
  { name: "Śniadanie", icon: "🍳", color: "#FFF9C4" },
  { name: "Lunch", icon: "🥗", color: "#E8F5E9" },
  { name: "Obiad", icon: "🍲", color: "#FFECB3" },
  { name: "Przekąska", icon: "🍎", color: "#F3E5F5" },
  { name: "Kolacja", icon: "🌙", color: "#E3F2FD" }
];

export default function App() {
  const [products, setProducts] = useState([]);
  const [showAdd, setShowAdd] = useState(false);

  return (
    <div style={{ backgroundColor: '#f8fafc', minHeight: '100vh', padding: '20px', fontFamily: '"Segoe UI", Tahoma, Geneva, Verdana, sans-serif' }}>
      
      {/* Header */}
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px' }}>
        <h1 style={{ color: '#1e293b', fontSize: '24px', margin: 0 }}>📅 Nasz Planer</h1>
        <button 
          onClick={() => setShowAdd(!showAdd)}
          style={{ backgroundColor: '#10b981', color: 'white', border: 'none', padding: '10px 20px', borderRadius: '12px', fontWeight: 'bold', cursor: 'pointer', transition: '0.3s' }}
        >
          {showAdd ? '✖ Zamknij' : '➕ Dodaj Produkt'}
        </button>
      </header>

      {/* Formularz dodawania (wyświetlany warunkowo) */}
      {showAdd && (
        <div style={{ background: 'white', padding: '20px', borderRadius: '15px', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)', marginBottom: '30px' }}>
          <h3 style={{ marginTop: 0 }}>Nowy produkt w bazie</h3>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <input style={inputStyle} placeholder="Nazwa (np. Kurczak)" />
            <input style={inputStyle} type="number" placeholder="Cena (zł)" />
            <button style={{ background: '#3b82f6', color: 'white', border: 'none', padding: '10px 25px', borderRadius: '8px', cursor: 'pointer' }}>Zapisz</button>
          </div>
        </div>
      )}

      {/* Grid z Planerem */}
      <div style={{ display: 'grid', gridTemplateColumns: '120px repeat(5, 1fr)', gap: '10px', minWidth: '900px' }}>
        {/* Nagłówki posiłków */}
        <div style={{ background: 'transparent' }}></div>
        {MEALS.map(m => (
          <div key={m.name} style={{ textAlign: 'center', fontWeight: 'bold', color: '#64748b', paddingBottom: '10px' }}>
            {m.icon} {m.name}
          </div>
        ))}

        {/* Wiersze dni */}
        {DAYS.map(day => (
          <>
            <div style={{ display: 'flex', alignItems: 'center', fontWeight: 'bold', color: '#1e293b', padding: '15px', background: '#f1f5f9', borderRadius: '8px' }}>
              {day}
            </div>
            {MEALS.map(meal => (
              <div 
                key={`${day}-${meal.name}`} 
                style={{ 
                  backgroundColor: meal.color, 
                  height: '100px', 
                  borderRadius: '12px', 
                  border: '2px dashed #cbd5e1',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  fontSize: '24px',
                  color: '#94a3b8',
                  transition: 'all 0.2s'
                }}
                onMouseEnter={(e) => e.target.style.transform = 'scale(1.02)'}
                onMouseLeave={(e) => e.target.style.transform = 'scale(1)'}
              >
                +
              </div>
            ))}
          </>
        ))}
      </div>
    </div>
  );
}

const inputStyle = {
  padding: '12px',
  borderRadius: '8px',
  border: '1px solid #e2e8f0',
  flex: '1',
  minWidth: '150px'
};