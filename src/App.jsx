import React, { useState, useEffect, useCallback } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY);

const MEAL_TYPES = ["Śniadanie", "Lunch", "Obiad", "Podwieczorek", "Kolacja"];
const DAYS = ["Poniedziałek", "Wtorek", "Środa", "Czwartek", "Piątek", "Sobota", "Niedziela"];

export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [products, setProducts] = useState([]);
  const [recipes, setRecipes] = useState([]);
  const [mealPlan, setMealPlan] = useState([]);
  const [weekOffset, setWeekOffset] = useState(0);

  // Modale i stany formularzy
  const [activeModal, setActiveModal] = useState(null); 
  const [selectedCell, setSelectedCell] = useState(null);
  const [newProd, setNewProd] = useState({ name: '', price: '', unit: 'kg' });
  const [newRecipe, setNewRecipe] = useState({ name: '', category: 'Obiad', ingredients: [] });
  const [searchQuery, setSearchQuery] = useState('');

  const handleLogout = useCallback(() => supabase.auth.signOut(), []);

  useEffect(() => {
    // Inicjalizacja sesji
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setLoading(false);
    });

    // Auto-wylogowanie po 30 min bezczynności
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

  useEffect(() => {
    if (session) fetchData();
  }, [session, weekOffset]);

  async function fetchData() {
    const { data: prods } = await supabase.from('products').select('*');
    const { data: recs } = await supabase.from('recipes').select('*');
    const { data: plan } = await supabase.from('meal_plan').select('*, recipes(*)');
    setProducts(prods || []);
    setRecipes(recs || []);
    setMealPlan(plan || []);
  }

  const getWeekDates = () => {
    const now = new Date();
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1) + (weekOffset * 7);
    return DAYS.map((name, i) => {
      const d = new Date(new Date().setDate(diff + i));
      return { 
        name, 
        fullDate: d.toISOString().split('T')[0], 
        displayDate: d.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit' }) 
      };
    });
  };

  const weekDates = getWeekDates();

  // Logika liczenia ceny w kreatorze
  const calculateIngPrice = (ing) => {
    const p = parseFloat(ing.price_per_unit);
    const a = parseFloat(ing.amount);
    if (ing.unit === 'kg') return (p * (a / 1000)).toFixed(2);
    return (p * a).toFixed(2);
  };

  const recipeTotal = newRecipe.ingredients.reduce((sum, i) => sum + parseFloat(calculateIngPrice(i)), 0).toFixed(2);

  if (loading) return <div style={loadingStyle}>Ładowanie danych...</div>;
  if (!session) return <LoginView />;

  return (
    <div style={appContainer}>
      <header style={headerStyle}>
        <div>
          <h1 style={{margin: 0}}>🍴 Smart Planer</h1>
          <p style={{color: '#64748b', margin: '5px 0'}}>Tydzień: {weekDates[0].displayDate} - {weekDates[6].displayDate}</p>
        </div>
        <div style={navButtons}>
          <button onClick={() => setWeekOffset(prev => prev - 1)} style={btnSec}>⬅</button>
          <button onClick={() => setWeekOffset(0)} style={btnSec}>Dziś</button>
          <button onClick={() => setWeekOffset(prev => prev + 1)} style={btnSec}>➡</button>
          <button onClick={() => setActiveModal('product')} style={btnSec}>📦 Spiżarnia</button>
          <button onClick={() => setActiveModal('recipe')} style={btnPrim}>👨‍🍳 Nowy Przepis</button>
          <button onClick={handleLogout} style={btnDanger}>Wyloguj</button>
        </div>
      </header>

      <div style={gridStyle}>
        <div />
        {MEAL_TYPES.map(m => <div key={m} style={mealHeader}>{m}</div>)}
        {weekDates.map(day => (
          <React.Fragment key={day.fullDate}>
            <div style={dayCell}><b>{day.name}</b><br/><small>{day.displayDate}</small></div>
            {MEAL_TYPES.map(type => {
              const meal = mealPlan.find(p => p.date === day.fullDate && p.meal_type === type);
              return (
                <div key={`${day.fullDate}-${type}`} style={cellStyle} onClick={() => { setSelectedCell({ date: day.fullDate, type }); setActiveModal('cell'); }}>
                  {meal ? (
                    <div style={mealTag}>
                      <b>{meal.recipes.name}</b><br/>
                      <small>{meal.recipes.total_cost} zł</small>
                    </div>
                  ) : <span style={{opacity: 0.2, fontSize: '24px'}}>+</span>}
                </div>
              );
            })}
          </React.Fragment>
        ))}
      </div>

      {/* MODAL: WYBÓR POSIŁKU DO KALENDARZA */}
      {activeModal === 'cell' && (
        <Modal title={`Dodaj: ${selectedCell?.type}`} onClose={() => setActiveModal(null)}>
          <div style={{maxHeight: '300px', overflowY: 'auto'}}>
            {recipes.filter(r => r.category === selectedCell?.type).length > 0 ? (
              recipes.filter(r => r.category === selectedCell?.type).map(r => (
                <div key={r.id} style={recipeListItem} onClick={async () => {
                  await supabase.from('meal_plan').insert([{ date: selectedCell.date, meal_type: selectedCell.type, recipe_id: r.id }]);
                  setActiveModal(null);
                  fetchData();
                }}>
                  <span>{r.name}</span> <b>{r.total_cost} zł</b>
                </div>
              ))
            ) : <p style={{textAlign: 'center', color: '#666'}}>Brak przepisów w tej kategorii.</p>}
          </div>
        </Modal>
      )}

      {/* MODAL: DODAWANIE PRODUKTU */}
      {activeModal === 'product' && (
        <Modal title="Dodaj do Spiżarni" onClose={() => setActiveModal(null)}>
          <input style={inputS} placeholder="Nazwa produktu" onChange={e => setNewProd({...newProd, name: e.target.value})} />
          <div style={{display: 'flex', gap: '10px'}}>
            <input style={inputS} type="number" placeholder="Cena (zł)" onChange={e => setNewProd({...newProd, price: e.target.value})} />
            <select style={inputS} onChange={e => setNewProd({...newProd, unit: e.target.value})}>
              <option value="kg">za 1 kg</option>
              <option value="g">za 1 g</option>
              <option value="szt">za 1 szt</option>
            </select>
          </div>
          <button style={btnSuccessFull} onClick={async () => {
            await supabase.from('products').insert([{ name: newProd.name, price_per_unit: parseFloat(newProd.price), unit: newProd.unit }]);
            setActiveModal(null);
            fetchData();
          }}>Zapisz produkt</button>
        </Modal>
      )}

      {/* MODAL: KREATOR PRZEPISÓW */}
      {activeModal === 'recipe' && (
        <Modal title="Nowy Przepis" onClose={() => setActiveModal(null)}>
          <input style={inputS} placeholder="Nazwa dania" onChange={e => setNewRecipe({...newRecipe, name: e.target.value})} />
          <select style={inputS} onChange={e => setNewRecipe({...newRecipe, category: e.target.value})}>
            {MEAL_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <input style={inputS} placeholder="🔍 Szukaj składnika..." onChange={e => setSearchQuery(e.target.value)} />
          
          {searchQuery && (
            <div style={searchResultsS}>
              {products.filter(p => p.name.toLowerCase().includes(searchQuery.toLowerCase())).map(p => (
                <div key={p.id} style={searchItemS} onClick={() => {
                  setNewRecipe({...newRecipe, ingredients: [...newRecipe.ingredients, {...p, amount: p.unit === 'kg' ? 500 : 1}]});
                  setSearchQuery('');
                }}>{p.name} ({p.price_per_unit}zł/{p.unit})</div>
              ))}
            </div>
          )}

          <div style={{margin: '15px 0', borderTop: '1px solid #eee'}}>
            {newRecipe.ingredients.map((ing, idx) => (
              <div key={idx} style={ingRowS}>
                <span style={{flex: 2}}>{ing.name}</span>
                <input type="number" style={{width: '60px'}} value={ing.amount} onChange={e => {
                  const copy = [...newRecipe.ingredients];
                  copy[idx].amount = e.target.value;
                  setNewRecipe({...newRecipe, ingredients: copy});
                }} />
                <span style={{flex: 1, textAlign: 'right'}}>{calculateIngPrice(ing)} zł</span>
              </div>
            ))}
          </div>
          <div style={{textAlign: 'right', fontWeight: 'bold', fontSize: '18px', marginBottom: '15px'}}>Suma: {recipeTotal} zł</div>
          <button style={btnSuccessFull} onClick={async () => {
            const { data } = await supabase.from('recipes').insert([{ name: newRecipe.name, category: newRecipe.category, total_cost: recipeTotal }]).select().single();
            setActiveModal(null);
            fetchData();
          }}>Zapisz Przepis</button>
        </Modal>
      )}
    </div>
  );
}

// --- KOMPONENT LOGOWANIA ---
function LoginView() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleLogin = async (e) => {
    e.preventDefault();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) alert("Błąd: " + error.message);
  };

  return (
    <div style={loginOverlay}>
      <form onSubmit={handleLogin} style={loginForm}>
        <h2 style={{textAlign: 'center', marginBottom: '20px'}}>🔐 Logowanie</h2>
        <input type="email" placeholder="Email" style={inputS} onChange={e => setEmail(e.target.value)} />
        <input type="password" placeholder="Hasło" style={inputS} onChange={e => setPassword(e.target.value)} />
        <button type="submit" style={btnSuccessFull}>Zaloguj się</button>
      </form>
    </div>
  );
}

// --- MODAL HELPER ---
function Modal({ title, children, onClose }) {
  return (
    <div style={overlayS}><div style={modalS}>
      <div style={{display: 'flex', justifyContent: 'space-between', marginBottom: '15px'}}>
        <h3 style={{margin: 0}}>{title}</h3><button onClick={onClose} style={{border: 'none', background: 'none', cursor: 'pointer', fontSize: '20px'}}>✕</button>
      </div>
      {children}
    </div></div>
  );
}

// --- STYLE ---
const appContainer = { padding: '20px', backgroundColor: '#f0f2f5', minHeight: '100vh', fontFamily: 'sans-serif' };
const headerStyle = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '25px', background: 'white', padding: '15px 25px', borderRadius: '15px', boxShadow: '0 2px 5px rgba(0,0,0,0.05)' };
const navButtons = { display: 'flex', gap: '8px' };
const gridStyle = { display: 'grid', gridTemplateColumns: '120px repeat(5, 1fr)', gap: '10px', minWidth: '1000px' };
const mealHeader = { textAlign: 'center', fontWeight: 'bold', color: '#4a5568', paddingBottom: '10px' };
const dayCell = { background: 'white', padding: '12px', borderRadius: '12px', textAlign: 'center', borderLeft: '5px solid #38a169', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' };
const cellStyle = { height: '90px', background: 'white', borderRadius: '12px', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', transition: '0.2s' };
const mealTag = { fontSize: '11px', textAlign: 'center', background: '#f0fff4', color: '#276749', padding: '6px', borderRadius: '6px', border: '1px solid #c6f6d5' };
const loadingStyle = { display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', fontSize: '20px', color: '#4a5568' };
const loginOverlay = { height: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'center', background: '#f1f5f9' };
const loginForm = { background: 'white', padding: '40px', borderRadius: '25px', width: '320px', boxShadow: '0 10px 25px rgba(0,0,0,0.1)' };
const inputS = { width: '100%', padding: '12px', marginBottom: '12px', borderRadius: '10px', border: '1px solid #ddd', boxSizing: 'border-box' };
const btnPrim = { background: '#3182ce', color: 'white', border: 'none', padding: '10px 18px', borderRadius: '10px', cursor: 'pointer', fontWeight: 'bold' };
const btnSec = { background: '#edf2f7', color: '#2d3748', border: 'none', padding: '10px 15px', borderRadius: '10px', cursor: 'pointer' };
const btnDanger = { background: '#e53e3e', color: 'white', border: 'none', padding: '10px 18px', borderRadius: '10px', cursor: 'pointer' };
const btnSuccessFull = { background: '#38a169', color: 'white', border: 'none', padding: '14px', borderRadius: '10px', width: '100%', cursor: 'pointer', fontWeight: 'bold' };
const overlayS = { position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 };
const modalS = { background: 'white', padding: '25px', borderRadius: '20px', width: '450px', boxShadow: '0 15px 30px rgba(0,0,0,0.2)' };
const searchResultsS = { background: 'white', border: '1px solid #ddd', borderRadius: '10px', marginTop: '-10px', marginBottom: '15px' };
const searchItemS = { padding: '10px', cursor: 'pointer', borderBottom: '1px solid #eee' };
const ingRowS = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #f7fafc' };
const recipeListItem = { padding: '12px', borderBottom: '1px solid #f0f0f0', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', borderRadius: '8px' };