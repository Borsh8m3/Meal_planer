import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY);

const MEAL_TYPES = ["Śniadanie", "Lunch", "Obiad", "Podwieczorek", "Kolacja"];
const DAYS = ["Poniedziałek", "Wtorek", "Środa", "Czwartek", "Piątek", "Sobota", "Niedziela"];

export default function App() {
  const [session, setSession] = useState(null);
  const [products, setProducts] = useState([]);
  const [recipes, setRecipes] = useState([]);
  const [mealPlan, setMealPlan] = useState([]);
  const [weekOffset, setWeekOffset] = useState(0); // 0 = ten tydzień, 1 = następny

  // Stan Modali
  const [activeModal, setActiveModal] = useState(null); // 'product', 'recipe', 'cell'
  const [selectedCell, setSelectedCell] = useState(null);

  // --- LOGIKA SESJI I AUTOWYLOGOWANIA ---
  const handleLogout = useCallback(() => supabase.auth.signOut(), []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => setSession(session));

    // Timer 30 minut bez akcji
    let logoutTimer;
    const resetTimer = () => {
      clearTimeout(logoutTimer);
      logoutTimer = setTimeout(handleLogout, 30 * 60 * 1000);
    };

    window.addEventListener('mousemove', resetTimer);
    window.addEventListener('keydown', resetTimer);
    resetTimer();

    return () => {
      subscription.unsubscribe();
      window.removeEventListener('mousemove', resetTimer);
      window.removeEventListener('keydown', resetTimer);
    };
  }, [handleLogout]);

  // --- POBIERANIE DANYCH ---
  useEffect(() => {
    if (session) {
      fetchData();
    }
  }, [session, weekOffset]);

  async function fetchData() {
    const { data: prods } = await supabase.from('products').select('*');
    const { data: recs } = await supabase.from('recipes').select('*');
    const { data: plan } = await supabase.from('meal_plan').select('*, recipes(*)');
    setProducts(prods || []);
    setRecipes(recs || []);
    setMealPlan(plan || []);
  }

  // --- GENEROWANIE DAT TYGODNIA ---
  const getWeekDates = () => {
    const now = new Date();
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1) + (weekOffset * 7);
    return DAYS.map((name, i) => {
      const d = new Date(new Date().setDate(diff + i));
      return { name, fullDate: d.toISOString().split('T')[0], displayDate: d.toLocaleDateString('pl-PL') };
    });
  };

  const weekDates = getWeekDates();

  // --- LOGIKA KREATORA PRZEPISÓW (CENY) ---
  const [newRecipe, setNewRecipe] = useState({ name: '', category: 'Obiad', ingredients: [] });
  const [searchProd, setSearchProd] = useState('');

  const calculateIngPrice = (ing) => {
    const p = parseFloat(ing.price_per_unit);
    return ing.unit === 'kg' ? (p * (ing.amount / 1000)) : (p * ing.amount);
  };

  const recipeTotal = newRecipe.ingredients.reduce((sum, i) => sum + calculateIngPrice(i), 0).toFixed(2);

  // --- RENDEROWANIE ---
  if (!session) return <LoginView onLogin={(e) => {/* obsługa logowania */}} />;

  return (
    <div style={appContainer}>
      {/* HEADER */}
      <header style={headerStyle}>
        <div>
          <h1>🍴 Smart Planer {weekOffset !== 0 && `(Tydzień +${weekOffset})`}</h1>
          <p>{weekDates[0].displayDate} - {weekDates[6].displayDate}</p>
        </div>
        <div style={navButtons}>
          <button onClick={() => setWeekOffset(prev => prev - 1)}>⬅ Poprzedni</button>
          <button onClick={() => setWeekOffset(0)}>Dziś</button>
          <button onClick={() => setWeekOffset(prev => prev + 1)}>Następny ➡</button>
          <button onClick={() => setActiveModal('product')} style={btnSec}>📦 Spiżarnia</button>
          <button onClick={() => setActiveModal('recipe')} style={btnPrim}>👨‍🍳 Kreator Przepisów</button>
          <button onClick={handleLogout} style={btnDanger}>Wyloguj</button>
        </div>
      </header>

      {/* KALENDARZ */}
      <div style={gridStyle}>
        <div />
        {MEAL_TYPES.map(m => <div key={m} style={mealHeader}>{m}</div>)}
        
        {weekDates.map(day => (
          <>
            <div style={dayCell}><b>{day.name}</b><br/><small>{day.displayDate}</small></div>
            {MEAL_TYPES.map(type => {
              const meal = mealPlan.find(p => p.date === day.fullDate && p.meal_type === type);
              return (
                <div 
                  key={`${day.fullDate}-${type}`} 
                  style={cellStyle(type)} 
                  onClick={() => { setSelectedCell({ date: day.fullDate, type }); setActiveModal('cell'); }}
                >
                  {meal ? (
                    <div style={mealTag}>
                      {meal.recipes.name}
                      <br/><small>{meal.recipes.total_cost} zł</small>
                    </div>
                  ) : <span style={{opacity: 0.3}}>+</span>}
                </div>
              );
            })}
          </>
        ))}
      </div>

      {/* MODAL: WYBÓR PRZEPISU DO KAFELKA */}
      {activeModal === 'cell' && (
        <Modal title={`Dodaj posiłek: ${selectedCell?.type}`} onClose={() => setActiveModal(null)}>
          <div style={{maxHeight: '400px', overflowY: 'auto'}}>
            {recipes.filter(r => r.category === selectedCell?.type).map(r => (
              <div key={r.id} style={recipeListItem} onClick={async () => {
                await supabase.from('meal_plan').insert([{ date: selectedCell.date, meal_type: selectedCell.type, recipe_id: r.id }]);
                setActiveModal(null);
                fetchData();
              }}>
                <b>{r.name}</b> <span>{r.total_cost} zł</span>
              </div>
            ))}
          </div>
        </Modal>
      )}

      {/* MODAL: KREATOR PRZEPISÓW */}
      {activeModal === 'recipe' && (
        <Modal title="Nowy Przepis" onClose={() => setActiveModal(null)}>
          <input placeholder="Nazwa dania" style={inputS} onChange={e => setNewRecipe({...newRecipe, name: e.target.value})} />
          <select style={inputS} onChange={e => setNewRecipe({...newRecipe, category: e.target.value})}>
            {MEAL_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          
          <div style={searchBox}>
            <input placeholder="Szukaj składnika..." style={inputS} onChange={e => setSearchProd(e.target.value)} />
            {searchProd && (
              <div style={resultsS}>
                {products.filter(p => p.name.toLowerCase().includes(searchProd.toLowerCase())).map(p => (
                  <div key={p.id} style={resItem} onClick={() => {
                    setNewRecipe({...newRecipe, ingredients: [...newRecipe.ingredients, {...p, amount: 100}]});
                    setSearchProd('');
                  }}>{p.name} ({p.price_per_unit}zł/{p.unit})</div>
                ))}
              </div>
            )}
          </div>

          <div style={ingList}>
            {newRecipe.ingredients.map((ing, idx) => (
              <div key={idx} style={ingRow}>
                <span>{ing.name}</span>
                <input type="number" style={{width: '60px'}} value={ing.amount} onChange={e => {
                  const copy = [...newRecipe.ingredients];
                  copy[idx].amount = e.target.value;
                  setNewRecipe({...newRecipe, ingredients: copy});
                }} />
                <span>{calculateIngPrice(ing).toFixed(2)} zł</span>
              </div>
            ))}
          </div>
          <div style={totalBar}>Suma: {recipeTotal} zł</div>
          <button style={btnSuccess} onClick={async () => {
             const { data } = await supabase.from('recipes').insert([{ name: newRecipe.name, category: newRecipe.category, total_cost: recipeTotal }]).select().single();
             // Tu należy dodać zapisywanie składników do recipe_ingredients
             setActiveModal(null);
             fetchData();
          }}>Zapisz przepis</button>
        </Modal>
      )}
    </div>
  );
}

// --- POMOCNICZE KOMPONENTY I STYLE ---
function Modal({ title, children, onClose }) {
  return (
    <div style={overlayS}>
      <div style={modalS}>
        <div style={{display: 'flex', justifyContent: 'space-between'}}>
          <h3>{title}</h3>
          <button onClick={onClose} style={{border: 'none', background: 'none', cursor: 'pointer', fontSize: '20px'}}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

const appContainer = { padding: '20px', backgroundColor: '#f0f2f5', minHeight: '100vh', fontFamily: 'sans-serif' };
const headerStyle = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', background: 'white', padding: '20px', borderRadius: '15px', boxShadow: '0 2px 10px rgba(0,0,0,0.05)' };
const navButtons = { display: 'flex', gap: '8px' };
const gridStyle = { display: 'grid', gridTemplateColumns: '120px repeat(5, 1fr)', gap: '10px' };
const mealHeader = { textAlign: 'center', fontWeight: 'bold', color: '#4a5568', padding: '10px' };
const dayCell = { background: '#edf2f7', padding: '15px', borderRadius: '10px', textAlign: 'center' };
const cellStyle = (type) => ({ height: '100px', borderRadius: '12px', border: '2px dashed #cbd5e0', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', backgroundColor: 'white', transition: '0.2s' });
const mealTag = { fontSize: '12px', textAlign: 'center', background: '#e2e8f0', padding: '5px', borderRadius: '5px' };
const overlayS = { position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.6)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 2000 };
const modalS = { background: 'white', padding: '25px', borderRadius: '20px', width: '450px', boxShadow: '0 20px 25px rgba(0,0,0,0.2)' };
const inputS = { width: '100%', padding: '12px', borderRadius: '10px', border: '1px solid #ddd', marginBottom: '10px', boxSizing: 'border-box' };
const searchBox = { position: 'relative' };
const resultsS = { position: 'absolute', width: '100%', background: 'white', border: '1px solid #ddd', zIndex: 10, borderRadius: '10px' };
const resItem = { padding: '10px', cursor: 'pointer', borderBottom: '1px solid #eee' };
const ingRow = { display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f7fafc' };
const totalBar = { margin: '20px 0', textAlign: 'right', fontWeight: 'bold', fontSize: '20px', color: '#2d3748' };
const recipeListItem = { padding: '15px', borderBottom: '1px solid #eee', cursor: 'pointer', display: 'flex', justifyContent: 'space-between' };

const btnPrim = { background: '#3182ce', color: 'white', border: 'none', padding: '10px 15px', borderRadius: '8px', cursor: 'pointer' };
const btnSec = { background: '#edf2f7', color: '#2d3748', border: 'none', padding: '10px 15px', borderRadius: '8px', cursor: 'pointer' };
const btnDanger = { background: '#e53e3e', color: 'white', border: 'none', padding: '10px 15px', borderRadius: '8px', cursor: 'pointer' };
const btnSuccess = { background: '#38a169', color: 'white', border: 'none', padding: '15px', borderRadius: '10px', cursor: 'pointer', width: '100%', fontWeight: 'bold' };