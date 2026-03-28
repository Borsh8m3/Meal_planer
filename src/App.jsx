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

  // Modale i stany pomocnicze
  const [activeModal, setActiveModal] = useState(null); 
  const [selectedCell, setSelectedCell] = useState(null);
  const [viewingRecipe, setViewingRecipe] = useState(null);
  const [filterCategory, setFilterCategory] = useState(''); 
  const [recipeListCategory, setRecipeListCategory] = useState('Obiad');

  // Stany formularzy
  const [newProd, setNewProd] = useState({ id: null, name: '', price: '', amount: '', unit: 'kg' });
  const [newRecipe, setNewRecipe] = useState({ id: null, name: '', category: 'Obiad', instructions: '', ingredients: [] });
  const [searchQuery, setSearchQuery] = useState('');

  const handleLogout = useCallback(() => supabase.auth.signOut(), []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => { setSession(session); setLoading(false); });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => { setSession(session); setLoading(false); });
    return () => subscription.unsubscribe();
  }, [handleLogout]);

  useEffect(() => { if (session) fetchData(); }, [session, weekOffset]);

  async function fetchData() {
    const { data: prods } = await supabase.from('products').select('*').order('name');
    const { data: recs } = await supabase.from('recipes').select('*, recipe_ingredients(*, products(*))').order('name');
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
      return { name, fullDate: d.toISOString().split('T')[0], displayDate: d.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit' }) };
    });
  };

  // --- LOGIKA PRODUKTÓW ---
  const handleSaveProduct = async () => {
    const pricePerBaseUnit = parseFloat(newProd.price) / parseFloat(newProd.amount);
    const prodData = { name: newProd.name, price_per_unit: pricePerBaseUnit, unit: newProd.unit, last_input_quantity: parseFloat(newProd.amount) };
    if (newProd.id) await supabase.from('products').update(prodData).eq('id', newProd.id);
    else await supabase.from('products').insert([prodData]);
    setNewProd({ id: null, name: '', price: '', amount: '', unit: 'kg' });
    fetchData();
  };

  const handleDeleteProduct = async (id) => {
    if (confirm("Czy na pewno chcesz usunąć ten produkt? Może to wpłynąć na istniejące przepisy.")) {
      await supabase.from('products').delete().eq('id', id);
      fetchData();
    }
  };

  // --- LOGIKA PRZEPISÓW ---
  const calculateIngPrice = (ing) => {
    const p = parseFloat(ing.price_per_unit || ing.products?.price_per_unit || 0);
    const a = parseFloat(ing.amount || 0);
    const unit = ing.unit || ing.products?.unit;
    if (unit === 'kg' || unit === 'l') return (p * (a / 1000)).toFixed(2);
    return (p * a).toFixed(2);
  };

  const recipeTotal = newRecipe.ingredients.reduce((sum, i) => sum + parseFloat(calculateIngPrice(i)), 0).toFixed(2);

  const handleSaveRecipe = async () => {
    const recipeData = { name: newRecipe.name, category: newRecipe.category, total_cost: recipeTotal, instructions: newRecipe.instructions };
    
    let recipeId = newRecipe.id;
    if (newRecipe.id) {
      await supabase.from('recipes').update(recipeData).eq('id', newRecipe.id);
      await supabase.from('recipe_ingredients').delete().eq('recipe_id', newRecipe.id);
    } else {
      const { data } = await supabase.from('recipes').insert([recipeData]).select().single();
      recipeId = data.id;
    }

    const ingredientsToInsert = newRecipe.ingredients.map(ing => ({
      recipe_id: recipeId, product_id: ing.id || ing.product_id, amount: ing.amount
    }));

    await supabase.from('recipe_ingredients').insert(ingredientsToInsert);
    setNewRecipe({ id: null, name: '', category: 'Obiad', instructions: '', ingredients: [] });
    setActiveModal(null);
    fetchData();
  };

  const handleDeleteRecipe = async (id) => {
    if (confirm("Usunąć ten przepis?")) {
      await supabase.from('recipes').delete().eq('id', id);
      fetchData();
    }
  };

  const loadRecipeToEdit = (r) => {
    setNewRecipe({
      id: r.id,
      name: r.name,
      category: r.category,
      instructions: r.instructions,
      ingredients: r.recipe_ingredients.map(ri => ({
        ...ri.products,
        amount: ri.amount,
        product_id: ri.product_id
      }))
    });
  };

  if (loading) return <div style={loadingStyle}>Ładowanie danych...</div>;
  if (!session) return <LoginView />;

  return (
    <div style={appContainer}>
      <header style={headerStyle}>
        <div><h1>🍴 Smart Planer</h1><p>Tydzień: {getWeekDates()[0].displayDate} - {getWeekDates()[6].displayDate}</p></div>
        <div style={navButtons}>
          <button onClick={() => setWeekOffset(prev => prev - 1)} style={btnSec}>⬅</button>
          <button onClick={() => setWeekOffset(0)} style={btnSec}>Dziś</button>
          <button onClick={() => setWeekOffset(prev => prev + 1)} style={btnSec}>➡</button>
          <button onClick={() => setActiveModal('product')} style={btnSec}>📦 Spiżarnia</button>
          <button onClick={() => setActiveModal('recipe')} style={btnPrim}>👨‍🍳 Przepisy</button>
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
                <div key={`${day.fullDate}-${type}`} style={meal ? cellStyleActive : cellStyle} onClick={() => { 
                  if(!meal) { setSelectedCell({ date: day.fullDate, type }); setFilterCategory(type); setActiveModal('cell'); }
                }}>
                  {meal ? (
                    <div style={mealContent}>
                      <div style={mealNameS}>{meal.recipes.name}</div>
                      <div style={mealPriceS}>{meal.recipes.total_cost} zł</div>
                      <button style={btnViewS} onClick={(e) => { e.stopPropagation(); setViewingRecipe(meal.recipes); setActiveModal('view-recipe'); }}>Pokaż</button>
                      <button style={btnDeleteSmall} onClick={async (e) => { e.stopPropagation(); await supabase.from('meal_plan').delete().eq('id', meal.id); fetchData(); }}>✕</button>
                    </div>
                  ) : <span style={{opacity: 0.2, fontSize: '24px'}}>+</span>}
                </div>
              );
            })}
          </React.Fragment>
        ))}
      </div>

      {/* MODAL: SPIŻARNIA */}
      {activeModal === 'product' && (
        <Modal title="📦 Twoja Spiżarnia" onClose={() => setActiveModal(null)}>
           <div style={formBoxS}>
              <h4>{newProd.id ? '✏️ Edytuj' : '➕ Dodaj'}</h4>
              <input style={inputS} placeholder="Nazwa" value={newProd.name} onChange={e => setNewProd({...newProd, name: e.target.value})} />
              <div style={{display:'flex', gap:'5px'}}>
                <input style={inputS} type="number" placeholder="Cena" value={newProd.price} onChange={e => setNewProd({...newProd, price: e.target.value})} />
                <input style={inputS} type="number" placeholder="Ilość" value={newProd.amount} onChange={e => setNewProd({...newProd, amount: e.target.value})} />
                <select style={inputS} value={newProd.unit} onChange={e => setNewProd({...newProd, unit: e.target.value})}><option value="kg">kg</option><option value="l">l</option><option value="szt">szt</option></select>
              </div>
              <button style={btnSuccessFull} onClick={handleSaveProduct}>{newProd.id ? 'Zaktualizuj' : 'Zapisz'}</button>
              {newProd.id && <button style={{...btnSec, width:'100%', marginTop:'5px'}} onClick={() => setNewProd({id:null, name:'', price:'', amount:'', unit:'kg'})}>Anuluj edycję</button>}
           </div>
           <div style={{maxHeight: '250px', overflowY: 'auto'}}>
              {products.map(p => (
                <div key={p.id} style={productRowS}>
                  <span>{p.name} ({p.price_per_unit.toFixed(2)}zł/{p.unit})</span>
                  <div style={{display:'flex', gap:'10px'}}>
                    <button onClick={() => setNewProd({id:p.id, name:p.name, price:(p.price_per_unit*(p.last_input_quantity||1)).toFixed(2), amount:p.last_input_quantity||1, unit:p.unit})} style={iconBtn}>✏️</button>
                    <button onClick={() => handleDeleteProduct(p.id)} style={iconBtn}>🗑️</button>
                  </div>
                </div>
              ))}
           </div>
        </Modal>
      )}

      {/* MODAL: KREATOR I ZARZĄDZANIE PRZEPISAMI */}
      {activeModal === 'recipe' && (
        <Modal title="👨‍🍳 Zarządzanie Przepisami" onClose={() => setActiveModal(null)}>
          <div style={{maxHeight: '75vh', overflowY: 'auto'}}>
            <div style={formBoxS}>
              <h4>{newRecipe.id ? '✏️ Edytuj Przepis' : '➕ Nowy Przepis'}</h4>
              <input style={inputS} placeholder="Nazwa dania..." value={newRecipe.name} onChange={e => setNewRecipe({...newRecipe, name: e.target.value})} />
              <select style={inputS} value={newRecipe.category} onChange={e => setNewRecipe({...newRecipe, category: e.target.value})}>{MEAL_TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select>
              <textarea style={{...inputS, height:'60px'}} placeholder="Opis przygotowania..." value={newRecipe.instructions} onChange={e => setNewRecipe({...newRecipe, instructions: e.target.value})} />
              <input style={inputS} placeholder="🔍 Dodaj składnik..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
              {searchQuery && (
                <div style={searchResultsS}>
                  {products.filter(p => p.name.toLowerCase().includes(searchQuery.toLowerCase())).map(p => (
                    <div key={p.id} style={searchItemS} onClick={() => { setNewRecipe({...newRecipe, ingredients: [...newRecipe.ingredients, {...p, amount: p.unit==='szt'?1:100}]}); setSearchQuery(''); }}>{p.name}</div>
                  ))}
                </div>
              )}
              {newRecipe.ingredients.map((ing, idx) => (
                <div key={idx} style={ingRowS}>
                  <small>{ing.name}</small>
                  <input type="number" style={{width:'50px'}} value={ing.amount} onChange={e => {
                    const copy = [...newRecipe.ingredients];
                    copy[idx].amount = e.target.value;
                    setNewRecipe({...newRecipe, ingredients: copy});
                  }} />
                  <button onClick={() => setNewRecipe({...newRecipe, ingredients: newRecipe.ingredients.filter((_, i) => i !== idx)})} style={{border:'none', background:'none', color:'red'}}>✕</button>
                </div>
              ))}
              <div style={{textAlign:'right', fontWeight:'bold', margin:'10px 0'}}>Suma: {recipeTotal} zł</div>
              <button style={btnSuccessFull} onClick={handleSaveRecipe}>{newRecipe.id ? 'Zaktualizuj Przepis' : 'Zapisz Przepis'}</button>
              {newRecipe.id && <button style={{...btnSec, width:'100%', marginTop:'5px'}} onClick={() => setNewRecipe({id:null, name:'', category:'Obiad', instructions:'', ingredients:[]})}>Anuluj edycję</button>}
            </div>

            <h4>📋 Twoje zapisane przepisy</h4>
            <div style={filterBar}>
              {MEAL_TYPES.map(cat => (
                <button key={cat} onClick={() => setRecipeListCategory(cat)} style={recipeListCategory === cat ? btnFilterActive : btnFilter}>{cat}</button>
              ))}
            </div>
            {recipes.filter(r => r.category === recipeListCategory).map(r => (
              <div key={r.id} style={productRowS}>
                <span>{r.name} ({r.total_cost} zł)</span>
                <div style={{display:'flex', gap:'10px'}}>
                  <button onClick={() => loadRecipeToEdit(r)} style={iconBtn}>✏️</button>
                  <button onClick={() => handleDeleteRecipe(r.id)} style={iconBtn}>🗑️</button>
                </div>
              </div>
            ))}
          </div>
        </Modal>
      )}

      {/* MODAL: DODAWANIE DO KALENDARZA */}
      {activeModal === 'cell' && (
        <Modal title="Wybierz posiłek" onClose={() => setActiveModal(null)}>
          <div style={filterBar}>
            {["Wszystkie", ...MEAL_TYPES].map(cat => (
              <button key={cat} onClick={() => setFilterCategory(cat === "Wszystkie" ? "" : cat)} 
                style={filterCategory === (cat === "Wszystkie" ? "" : cat) ? btnFilterActive : btnFilter}>{cat}</button>
            ))}
          </div>
          <div style={{maxHeight: '300px', overflowY: 'auto'}}>
            {recipes.filter(r => !filterCategory || r.category === filterCategory).map(r => (
              <div key={r.id} style={recipeListItem} onClick={async () => {
                await supabase.from('meal_plan').insert([{ date: selectedCell.date, meal_type: selectedCell.type, recipe_id: r.id }]);
                setActiveModal(null); fetchData();
              }}>
                <span><b>[{r.category}]</b> {r.name}</span> <b>{r.total_cost} zł</b>
              </div>
            ))}
          </div>
        </Modal>
      )}

      {/* MODAL: PODGLĄD */}
      {activeModal === 'view-recipe' && viewingRecipe && (
        <Modal title={`📖 ${viewingRecipe.name}`} onClose={() => setActiveModal(null)}>
          <div style={{maxHeight: '70vh', overflowY: 'auto'}}>
            <p style={{whiteSpace: 'pre-wrap', background: '#f8fafc', padding: '15px', borderRadius: '10px'}}>{viewingRecipe.instructions || "Brak opisu."}</p>
          </div>
        </Modal>
      )}
    </div>
  );
}

// --- LOGIN & MODAL HELPERS ---
function LoginView() {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const handleLogin = async (e) => { e.preventDefault(); const { error } = await supabase.auth.signInWithPassword({ email, password }); if (error) alert(error.message); };
  return (
    <div style={loginOverlay}><form onSubmit={handleLogin} style={loginForm}><h2>🔐 Smart Planer</h2><input style={inputS} type="email" placeholder="Email" onChange={e => setEmail(e.target.value)} /><input style={inputS} type="password" placeholder="Hasło" onChange={e => setPassword(e.target.value)} /><button style={btnSuccessFull}>Zaloguj</button></form></div>
  );
}
function Modal({ title, children, onClose }) {
  return (<div style={overlayS}><div style={modalS}><div style={{display:'flex', justifyContent:'space-between', marginBottom:'15px'}}><h3>{title}</h3><button onClick={onClose} style={{border:'none', background:'none', cursor:'pointer', fontSize:'20px'}}>✕</button></div>{children}</div></div>);
}

// --- STYLE ---
const appContainer = { padding: '20px', backgroundColor: '#f0f2f5', minHeight: '100vh', fontFamily: 'sans-serif' };
const headerStyle = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '25px', background: 'white', padding: '15px 25px', borderRadius: '15px' };
const navButtons = { display: 'flex', gap: '8px' };
const gridStyle = { display: 'grid', gridTemplateColumns: '120px repeat(5, 1fr)', gap: '10px', minWidth: '1100px' };
const mealHeader = { textAlign: 'center', fontWeight: 'bold', color: '#4a5568' };
const dayCell = { background: 'white', padding: '12px', borderRadius: '12px', textAlign: 'center', borderLeft: '5px solid #38a169' };
const cellStyle = { height: '120px', background: 'white', borderRadius: '12px', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' };
const cellStyleActive = { ...cellStyle, border: '2px solid #38a169', cursor: 'default' };
const mealContent = { padding: '10px', width: '100%', position: 'relative', textAlign: 'center' };
const mealNameS = { fontWeight: 'bold', fontSize: '13px', marginBottom: '5px', color: '#2d3748' };
const mealPriceS = { fontSize: '12px', color: '#38a169', fontWeight: 'bold', marginBottom: '8px' };
const btnViewS = { background: '#edf2f7', border: 'none', padding: '5px 10px', borderRadius: '5px', fontSize: '11px', cursor: 'pointer' };
const btnDeleteSmall = { position: 'absolute', top: '-5px', right: '-5px', background: '#feb2b2', border: 'none', borderRadius: '50%', width: '20px', height: '20px', cursor: 'pointer', fontSize: '10px' };
const filterBar = { display: 'flex', gap: '5px', marginBottom: '15px', overflowX: 'auto', paddingBottom: '5px' };
const btnFilter = { background: '#edf2f7', border: 'none', padding: '6px 12px', borderRadius: '20px', fontSize: '12px', cursor: 'pointer', whiteSpace: 'nowrap' };
const btnFilterActive = { ...btnFilter, background: '#3182ce', color: 'white' };
const recipeListItem = { padding: '12px', borderBottom: '1px solid #f0f0f0', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', fontSize: '14px' };
const loginOverlay = { height: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'center', background: '#f1f5f9' };
const loginForm = { background: 'white', padding: '40px', borderRadius: '25px', width: '320px', boxShadow: '0 10px 25px rgba(0,0,0,0.1)' };
const inputS = { width: '100%', padding: '10px', marginBottom: '10px', borderRadius: '8px', border: '1px solid #ddd', boxSizing: 'border-box' };
const btnPrim = { background: '#3182ce', color: 'white', border: 'none', padding: '10px 18px', borderRadius: '10px', cursor: 'pointer', fontWeight: 'bold' };
const btnSec = { background: '#edf2f7', color: '#2d3748', border: 'none', padding: '10px 15px', borderRadius: '10px', cursor: 'pointer' };
const btnDanger = { background: '#e53e3e', color: 'white', border: 'none', padding: '10px 18px', borderRadius: '10px', cursor: 'pointer' };
const btnSuccessFull = { background: '#38a169', color: 'white', border: 'none', padding: '12px', borderRadius: '10px', width: '100%', cursor: 'pointer', fontWeight: 'bold' };
const overlayS = { position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 };
const modalS = { background: 'white', padding: '25px', borderRadius: '20px', width: '500px', boxShadow: '0 15px 30px rgba(0,0,0,0.2)' };
const formBoxS = { background: '#f8fafc', padding: '15px', borderRadius: '12px', marginBottom: '15px', border:'1px solid #e2e8f0' };
const productRowS = { display: 'flex', justifyContent: 'space-between', padding: '8px 10px', borderBottom: '1px solid #eee', alignItems:'center' };
const iconBtn = { border: 'none', background: 'none', cursor: 'pointer', fontSize: '16px' };
const searchResultsS = { background: 'white', border: '1px solid #ddd', borderRadius: '8px', marginTop: '-5px', marginBottom: '10px' };
const searchItemS = { padding: '8px', cursor: 'pointer', borderBottom: '1px solid #eee' };
const ingRowS = { display: 'flex', justifyContent: 'space-between', padding: '5px 0' };
const loadingStyle = { display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', fontSize: '18px' };