import { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';

// TAK WYWOŁUJESZ ZMIENNE Z GITHUB SECRETS (przez VITE)
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseAnonKey);

const DAYS = ["Poniedziałek", "Wtorek", "Środa", "Czwartek", "Piątek", "Sobota", "Niedziela"];
const MEALS = ["Śniadanie (8:00-9:00)", "Lunch (11:00-12:00)", "Obiad (15:00-17:00)", "Podwieczorek (18:00-19:00)", "Kolacja (20:00-22:00)"];

export default function App() {
  const [products, setProducts] = useState([]);

  useEffect(() => {
    const fetchProducts = async () => {
      const { data } = await supabase.from('products').select('*');
      setProducts(data || []);
    };
    fetchProducts();
  }, []);

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
      <h1>📅 Planer Posiłków (Supabase + GitHub Actions)</h1>
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead>
          <tr style={{ backgroundColor: '#f0f0f0' }}>
            <th style={{ border: '1px solid #ccc', padding: '10px' }}>Dzień</th>
            {MEALS.map(m => <th key={m} style={{ border: '1px solid #ccc', padding: '10px' }}>{m}</th>)}
          </tr>
        </thead>
        <tbody>
          {DAYS.map(day => (
            <tr key={day}>
              <td style={{ border: '1px solid #ccc', padding: '10px', fontWeight: 'bold' }}>{day}</td>
              {MEALS.map(meal => (
                <td key={meal} style={{ border: '1px solid #ccc', padding: '10px', textAlign: 'center' }}>+</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}