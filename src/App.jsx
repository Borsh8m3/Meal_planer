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

  // Stany Modali
  const [activeModal, setActiveModal] = useState(null); 
  const [selectedCell, setSelectedCell] = useState(null);
  
  // Stan Spiżarni (Dodawanie/Edycja)
  const [newProd, setNewProd] = useState({ id: null, name: '', price: '', amount: '', unit: 'kg' });
  
  // Stan Kreatora Przepisu
  const [newRecipe, setNewRecipe] = useState({ name: '', category: 'Obiad', instructions: '', ingredients: [] });
  const [searchQuery, setSearchQuery] = useState('');

  const handleLogout = useCallback(() => supabase.auth.signOut(), []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setLoading(false);
    });
    return () => subscription.unsubscribe();
  }, [handleLogout]);

  useEffect(() => {
    if (session) fetchData();
  }, [session, weekOffset]);

  async function fetchData() {
    const { data: prods } = await supabase.from('products').select('*').order('name');
    const { data: recs } = await supabase.from('recipes').select('*').order('name');
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

  // --- LOGIKA PRODUKTÓW (SPIŻARNIA) ---
  const handleSaveProduct = async () => {
    const price = parseFloat(newProd.price);
    const amount = parseFloat(newProd.amount);
    if (!newProd.name || isNaN(price) || isNaN(amount)) return alert("Wypełnij poprawnie wszystkie pola!");

    // Przeliczanie na cenę za jednostkę bazową (1kg, 1l, 1szt)
    const pricePerBaseUnit = price / amount;

    const prodData = {
      name: newProd.name,
      price_per_unit: pricePerBaseUnit,
      unit: newProd.unit,
      last_input_quantity: amount
    };

    if (newProd.id) {
      await supabase.from('products').update(prodData).eq('id', newProd.id);
    } else {
      await supabase.from('products').insert([prodData]);
    }

    setNewProd({ id: null, name: '', price: '', amount: '', unit: 'kg' });
    fetchData();
  };

  // --- LOGIKA PRZEPISÓW ---
  const calculateIngPrice = (ing) => {
    const p = parseFloat(ing.price_per_unit);
    const a = parseFloat(ing.amount);
    if (ing.unit === 'kg' || ing.unit === 'l') return (p * (a / 1000)).toFixed(2);
    return (p * a).toFixed(2);
  };

  const recipeTotal = newRecipe.ingredients.reduce((sum, i) => sum + parseFloat(calculateIngPrice(i)), 0).toFixed(2);

  const handleSaveRecipe = async () => {
    if (!newRecipe.name || newRecipe.ingredients.length === 0) return alert("Podaj nazwę i składniki!");

    const { data: recipeData, error } = await supabase.from('recipes').insert([{ 
      name: newRecipe.name, 
      category: newRecipe.category, 
      total_cost: recipeTotal,
      instructions: newRecipe.instructions 
    }]).select().single();

    if (error) return alert(error.message);

    const ingredientsToInsert = newRecipe.ingredients.map(ing => ({
      recipe_id: recipeData.id,
      product_id: ing.id,
      amount: ing.amount
    }));

    await supabase.from('recipe_ingredients').insert(ingredientsToInsert);
    setActiveModal(null);
    setNewRecipe({ name: '', category: 'Obiad', instructions: '', ingredients: [] });
    fetchData();
  };

  if (loading) return <div style={loadingStyle}>Ładowanie danych...</div>;
  if (!session) return <LoginView />;

  return (
    <div style={appContainer}>
      <header style={headerStyle}>
        <div>
          <h1 style={{margin: 0}}>🍴 Smart Planer</h1>
          <p style={{color: '#64748b', margin: '5px 0'}}>Tydzień: {getWeekDates()[0].displayDate} - {getWeekDates()[6].displayDate}</p>
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
        {getWeekDates().map(day => (
          <React.Fragment key={day.fullDate}>
            <div style={dayCell}><b>{day.name}</b><br/><small>{day.displayDate}</small></div>
            {MEAL_TYPES.map(type => {
              const meal = mealPlan.find(p => p.date === day.fullDate && p.meal_type === type);
              return (
                <div key={`${day.fullDate}-${type}`} style={cellStyle} onClick={() => { setSelectedCell({ date: day.fullDate, type }); setActiveModal('cell'); }}>
                  {meal ? <div style={mealTag}><b>{meal.recipes.name}</b><br/><small>{meal.recipes.total_cost} zł</small></div> : <span style={{opacity: 0.2, fontSize: '24px'}}>+</span>}
                </div>
              );
            })}
          </React.Fragment>
        ))}
      </div>

      {/* MODAL: SPIŻARNIA (LISTA + DODAWANIE) */}
      {activeModal === 'product' && (
        <Modal title="📦 Twoja Spiżarnia" onClose={() => setActiveModal(null)}>
          <div style={{ maxHeight: '70vh', overflowY: 'auto', paddingRight: '5px' }}>
            <div style={formBoxS}>
              <h4 style={{marginTop: 0}}>{newProd.id ? '✏️ Edytuj' : '➕ Dodaj produkt'}</h4>
              <input style={inputS} placeholder="Nazwa produktu" value={newProd.name} onChange={e => setNewProd({...newProd, name: e.target.value})} />
              <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
                <input style={inputS} type="number" placeholder="Cena" value={newProd.price} onChange={e => setNewProd({...newProd, price: e.target.value})} />
                <input style={inputS} type="number" placeholder="Ilość" value={newProd.amount} onChange={e => setNewProd({...newProd, amount: e.target.value})} />
                <select style={inputS} value={newProd.unit} onChange={e => setNewProd({...newProd, unit: e.target.value})}>
                  <option value="kg">kg</option>
                  <option value="l">l</option>
                  <option value="szt">szt</option>
                </select>
              </div>
              <div style={{display:'flex', gap:'5px'}}>
                <button style={btnSuccessFull} onClick={handleSaveProduct}>{newProd.id ? 'Zaktualizuj' : 'Zapisz'}</button>
                {newProd.id && <button style={btnSec} onClick={() => setNewProd({id:null, name:'', price:'', amount:'', unit:'kg'})}>Anuluj</button>}
              </div>
            </div>
            <hr />
            {products.map(p => (
              <div key={p.id} style={productRowS}>
                <div><b>{p.name}</b><br/><small>{p.price_per_unit.toFixed(2)} zł / {p.unit}</small></div>
                <button style={btnEditS} onClick={() => setNewProd({
                  id: p.id, name: p.name, unit: p.unit, amount: p.last_input_quantity || 1,
                  price: (p.price_per_unit * (p.last_input_quantity || 1)).toFixed(2)
                })}>✏️</button>
              </div>
            ))}
          </div>
        </Modal>
      )}

      {/* MODAL: KREATOR PRZEPISÓW */}
      {activeModal === 'recipe' && (
        <Modal title="👨‍🍳 Kreator Przepisu" onClose={() => setActiveModal(null)}>
          <div style={{maxHeight: '75vh', overflowY: 'auto', paddingRight: '5px'}}>
            <input style={inputS} placeholder="Nazwa dania..." onChange={e => setNewRecipe({...newRecipe, name: e.target.value})} />
            <select style={inputS} onChange={e => setNewRecipe({...newRecipe, category: e.target.value})}>
              {MEAL_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <textarea style={{...inputS, height: '60px'}} placeholder="Sposób przygotowania..." onChange={e => setNewRecipe({...newRecipe, instructions: e.target.value})} />
            <input style={inputS} placeholder="🔍 Szukaj składnika..." onChange={e => setSearchQuery(e.target.value)} />
            
            {searchQuery && (
              <div style={searchResultsS}>
                {products.filter(p => p.name.toLowerCase().includes(searchQuery.toLowerCase())).map(p => (
                  <div key={p.id} style={searchItemS} onClick={() => {
                    setNewRecipe({...newRecipe, ingredients: [...newRecipe.ingredients, {...p, amount: p.unit==='szt'? 1 : 100}]});
                    setSearchQuery('');
                  }}>{p.name} ({p.price_per_unit.toFixed(2)}zł/{p.unit})</div>
                ))}
              </div>
            )}

            <div style={{margin: '15px 0'}}>
              {newRecipe.ingredients.map((ing, idx) => (
                <div key={idx} style={ingRowS}>
                  <span style={{flex: 2}}>{ing.name}</span>
                  <div style={{flex: 1.5, display: 'flex', alignItems: 'center', gap: '5px'}}>
                    <input type="number" style={{width: '60px', padding: '4px'}} value={ing.amount} onChange={e => {
                      const copy = [...newRecipe.ingredients];
                      copy[idx].amount = e.target.value;
                      setNewRecipe({...newRecipe, ingredients: copy});
                    }} />
                    <small>{(ing.unit === 'kg' ? 'g' : ing.unit === 'l' ? 'ml' : 'szt')}</small>
                  </div>
                  <span style={{flex: 1, textAlign: 'right'}}>{calculateIngPrice(ing)} zł</span>
                  <button onClick={() => setNewRecipe({...newRecipe, ingredients: newRecipe.ingredients.filter((_, i) => i !== idx)})} style={{border:'none', background:'none', color:'red', cursor:'pointer', marginLeft:'10px'}}>✕</button>
                </div>
              ))}
            </div>
            <div style={totalBar}>Suma: {recipeTotal} zł</div>
            <button style={btnSuccessFull} onClick={handleSaveRecipe}>Zapisz Przepis</button>
          </div>
        </Modal>
      )}

      {/* MODAL: DODAWANIE DO KALENDARZA */}
      {activeModal === 'cell' && (
        <Modal title={`Dodaj: ${selectedCell?.type}`} onClose={() => setActiveModal(null)}>
          <div style={{maxHeight: '300px', overflowY: 'auto'}}>
            {recipes.filter(r => r.category === selectedCell?.type).map(r => (
              <div key={r.id} style={recipeListItem} onClick={async () => {
                await supabase.from('meal_plan').insert([{ date: selectedCell.date, meal_type: selectedCell.type, recipe_id: r.id }]);
                setActiveModal(null);
                fetchData();
              }}>
                <span>{r.name}</span> <b>{r.total_cost} zł</b>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}

// --- HELPERY (LOGIN, MODAL, STYLE) ---
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
        <h2 style={{textAlign: 'center', marginBottom: '20px'}}>🔐 Smart Planer</h2>
        <input type="email" placeholder="Email" style={inputS} onChange={e => setEmail(e.target.value)} />
        <input type="password" placeholder="Hasło" style={inputS} onChange={e => setPassword(e.target.value)} />
        <button type="submit" style={btnSuccessFull}>Zaloguj się</button>
      </form>
    </div>
  );
}

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

const appContainer = { padding: '20px', backgroundColor: '#f0f2f5', minHeight: '100vh', fontFamily: 'sans-serif' };
const headerStyle = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '25px', background: 'white', padding: '15px 25px', borderRadius: '15px', boxShadow: '0 2px 5px rgba(0,0,0,0.05)' };
const navButtons = { display: 'flex', gap: '8px' };
const gridStyle = { display: 'grid', gridTemplateColumns: '120px repeat(5, 1fr)', gap: '10px', minWidth: '1000px' };
const mealHeader = { textAlign: 'center', fontWeight: 'bold', color: '#4a5568', paddingBottom: '10px' };
const dayCell = { background: 'white', padding: '12px', borderRadius: '12px', textAlign: 'center', borderLeft: '5px solid #38a169', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' };
const cellStyle = { height: '90px', background: 'white', borderRadius: '12px', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' };
const mealTag = { fontSize: '11px', textAlign: 'center', background: '#f0fff4', color: '#276749', padding: '6px', borderRadius: '6px', border: '1px solid #c6f6d5' };
const loginOverlay = { height: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'center', background: '#f1f5f9' };
const loginForm = { background: 'white', padding: '40px', borderRadius: '25px', width: '320px' };
const loadingStyle = { display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', fontSize: '20px' };
const inputS = { width: '100%', padding: '10px', marginBottom: '10px', borderRadius: '10px', border: '1px solid #ddd', boxSizing: 'border-box' };
const btnPrim = { background: '#3182ce', color: 'white', border: 'none', padding: '10px 18px', borderRadius: '10px', cursor: 'pointer', fontWeight: 'bold' };
const btnSec = { background: '#edf2f7', color: '#2d3748', border: 'none', padding: '10px 15px', borderRadius: '10px', cursor: 'pointer' };
const btnDanger = { background: '#e53e3e', color: 'white', border: 'none', padding: '10px 18px', borderRadius: '10px', cursor: 'pointer' };
const btnSuccessFull = { background: '#38a169', color: 'white', border: 'none', padding: '12px', borderRadius: '10px', width: '100%', cursor: 'pointer', fontWeight: 'bold' };
const overlayS = { position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 };
const modalS = { background: 'white', padding: '25px', borderRadius: '20px', width: '500px', boxShadow: '0 15px 30px rgba(0,0,0,0.2)' };
const formBoxS = { background: '#f8fafc', padding: '15px', borderRadius: '12px', marginBottom: '20px', border: '1px solid #e2e8f0' };
const productRowS = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px', borderBottom: '1px solid #eee' };
const btnEditS = { background: 'none', border: 'none', cursor: 'pointer', fontSize: '18px' };
const searchResultsS = { background: 'white', border: '1px solid #ddd', borderRadius: '10px', marginBottom: '15px' };
const searchItemS = { padding: '10px', cursor: 'pointer', borderBottom: '1px solid #eee' };
const ingRowS = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #f7fafc' };
const totalBar = { textAlign: 'right', fontWeight: 'bold', fontSize: '18px', margin: '15px 0' };
const recipeListItem = { padding: '12px', borderBottom: '1px solid #f0f0f0', cursor: 'pointer', display: 'flex', justifyContent: 'space-between' };
const loadingStyle2 = { display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', fontSize: '20px' };