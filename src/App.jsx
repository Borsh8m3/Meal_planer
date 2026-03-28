import { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';

// PODSTAW SWOJE DANE Z SUPABASE TUTAJ
const supabase = createClient('TWOJ_URL', 'TWOJ_ANON_KEY');

const DAYS = ["Poniedziałek", "Wtorek", "Środa", "Czwartek", "Piątek", "Sobota", "Niedziela"];
const MEALS = ["Śniadanie (8:00-9:00)", "Lunch (11:00-12:00)", "Obiad (15:00-17:00)", "Podwieczorek (18:00-19:00)", "Kolacja (20:00-22:00)"];

export default function App() {
  const [products, setProducts] = useState([]);
  const [newProduct, setNewProduct] = useState({ name: '', price: '', unit: 'szt' });

  useEffect(() => { fetchProducts(); }, []);

  async function fetchProducts() {
    const { data } = await supabase.from('products').select('*');
    setProducts(data || []);
  }

  async function handleAddProduct() {
    await supabase.from('products').insert([{ 
      name: newProduct.name, 
      price_per_unit: parseFloat(newProduct.price), 
      unit: newProduct.unit 
    }]);
    setNewProduct({ name: '', price: '', unit: 'szt' });
    fetchProducts();
  }

  return (
    <div style={{ padding: '20px', backgroundColor: '#f5f5f5', minHeight: '100vh', fontFamily: 'sans-serif' }}>
      <h2>🍎 Dodaj Produkt (Dla Dziewczyny)</h2>
      <div style={{ display: 'flex', gap: '10px', marginBottom: '30px', background: 'white', padding: '15px', borderRadius: '8px' }}>
        <input placeholder="Nazwa" value={newProduct.name} onChange={e => setNewProduct({...newProduct, name: e.target.value})} />
        <input placeholder="Cena" type="number" value={newProduct.price} onChange={e => setNewProduct({...newProduct, price: e.target.value})} />
        <button onClick={handleAddProduct} style={{ backgroundColor: '#4CAF50', color: 'white', border: 'none', padding: '10px 20px', borderRadius: '4px', cursor: 'pointer' }}>Dodaj</button>
      </div>

      <h2>📅 Planer Posiłków</h2>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', backgroundColor: 'white' }}>
          <thead>
            <tr>
              <th style={{ border: '1px solid #ddd', padding: '10px', backgroundColor: '#eee' }}>Dzień</th>
              {MEALS.map(m => (
                <th key={m} style={{ border: '1px solid #ddd', padding: '10px', backgroundColor: '#dcfce7', fontSize: '12px' }}>{m}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {DAYS.map(day => (
              <tr key={day}>
                <td style={{ border: '1px solid #ddd', padding: '10px', fontWeight: 'bold' }}>{day}</td>
                {MEALS.map(meal => (
                  <td key={meal} onClick={() => alert(`Dodaj posiłek dla: ${day} - ${meal}`)} style={{ border: '1px solid #ddd', padding: '20px', cursor: 'pointer', textAlign: 'center' }}>
                    +
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}