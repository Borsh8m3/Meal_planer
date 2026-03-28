import React, { useState, useEffect, useCallback, useMemo } from 'react';
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
  const [isMobile, setIsMobile] = useState(window.innerWidth < 900);

  const [activeModal, setActiveModal] = useState(null); 
  const [selectedCell, setSelectedCell] = useState(null);
  const [viewingRecipe, setViewingRecipe] = useState(null);
  const [filterCategory, setFilterCategory] = useState(''); 
  const [recipeListCategory, setRecipeListCategory] = useState('Obiad');

  const [newProd, setNewProd] = useState({ id: null, name: '', price: '', amount: '', unit: 'kg' });
  const [newRecipe, setNewRecipe] = useState({ id: null, name: '', category: 'Obiad', instructions: '', ingredients: [] });
  const [searchQuery, setSearchQuery] = useState('');

  const handleLogout = useCallback(() => supabase.auth.signOut(), []);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 900);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

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

  const weekDates = useMemo(() => {
    const now = new Date();
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1) + (weekOffset * 7);
    return DAYS.map((name, i) => {
      const d = new Date(new Date().setDate(diff + i));
      return { name, fullDate: d.toISOString().split('T')[0], displayDate: d.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit' }) };
    });
  }, [weekOffset]);

  // --- ANALITYKA I PODSUMOWANIA ---
  const stats = useMemo(() => {
    const shopping = {};
    const daily = {};
    let totalWeekly = 0;

    weekDates.forEach(d => {
      const dayMeals = mealPlan.filter(m => m.date === d.fullDate);
      let dCost = 0;
      dayMeals.forEach(m => {
        const r = recipes.find(rec => rec.id === m.recipe_id);
        if (r) {
          dCost += parseFloat(r.total_cost || 0);
          r.recipe_ingredients?.forEach(ri => {
            const p = ri.products;
            if (p) {
              if (!shopping[p.id]) shopping[p.id] = { name: p.name, amount: 0, unit: p.unit, pricePerUnit: p.price_per_unit };
              shopping[p.id].amount += parseFloat(ri.amount || 0);
            }
          });
        }
      });
      daily[d.fullDate] = dCost.toFixed(2);
      totalWeekly += dCost;
    });

    const shoppingList = Object.values(shopping).map(item => {
        const cost = (item.unit === 'kg' || item.unit === 'l') ? (item.pricePerUnit * (item.amount / 1000)) : (item.pricePerUnit * item.amount);
        return { ...item, cost: cost.toFixed(2) };
    });

    return { shoppingList, daily, totalWeekly: totalWeekly.toFixed(2) };
  }, [weekDates, mealPlan, recipes]);

  // --- HANDLERS ---
  const handleSaveProduct = async () => {
    const pPerU = parseFloat(newProd.price) / parseFloat(newProd.amount);
    const d = { name: newProd.name, price_per_unit: pPerU, unit: newProd.unit, last_input_quantity: parseFloat(newProd.amount) };
    if (newProd.id) await supabase.from('products').update(d).eq('id', newProd.id);
    else await supabase.from('products').insert([d]);
    setNewProd({ id: null, name: '', price: '', amount: '', unit: 'kg' });
    fetchData();
  };

  const handleSaveRecipe = async () => {
    const calc = (ing) => {
      const p = parseFloat(ing.price_per_unit || ing.products?.price_per_unit || 0);
      const a = parseFloat(ing.amount || 0);
      const u = ing.unit || ing.products?.unit;
      return (u === 'kg' || u === 'l') ? (p * (a / 1000)) : (p * a);
    };
    const tCost = newRecipe.ingredients.reduce((s, i) => s + calc(i), 0).toFixed(2);
    const rData = { name: newRecipe.name, category: newRecipe.category, total_cost: tCost, instructions: newRecipe.instructions };
    
    let rId = newRecipe.id;
    if (newRecipe.id) {
      await supabase.from('recipes').update(rData).eq('id', newRecipe.id);
      await supabase.from('recipe_ingredients').delete().eq('recipe_id', newRecipe.id);
    } else {
      const { data } = await supabase.from('recipes').insert([rData]).select().single();
      rId = data.id;
    }
    const ings = newRecipe.ingredients.map(ing => ({ recipe_id: rId, product_id: ing.id || ing.product_id, amount: ing.amount }));
    await supabase.from('recipe_ingredients').insert(ings);
    setNewRecipe({ id: null, name: '', category: 'Obiad', instructions: '', ingredients: [] });
    setActiveModal(null);
    fetchData();
  };

  const recipeCurrentCost = useMemo(() => {
    const calc = (ing) => {
        const p = parseFloat(ing.price_per_unit || ing.products?.price_per_unit || 0);
        const a = parseFloat(ing.amount || 0);
        const u = ing.unit || ing.products?.unit;
        return (u === 'kg' || u === 'l') ? (p * (a / 1000)) : (p * a);
    };
    return newRecipe.ingredients.reduce((s, i) => s + calc(i), 0).toFixed(2);
  }, [newRecipe.ingredients]);

  if (loading) return <div style={loadingStyle}>Ładowanie danych...</div>;
  if (!session) return <LoginView />;

  return (
    <div style={appContainer}>
      <header style={isMobile ? headerMobile : headerStyle}>
        <div><h1 style={{margin:0, color:'#059669'}}>🍴 Smart Planer</h1><small style={{color:'#64748b'}}>{weekDates[0].displayDate} - {weekDates[6].displayDate}</small></div>
        <div style={navButtons}>
          <button onClick={() => setWeekOffset(prev => prev - 1)} style={btnSec}>⬅</button>
          <button onClick={() => setWeekOffset(0)} style={btnSec}>Dziś</button>
          <button onClick={() => setWeekOffset(prev => prev + 1)} style={btnSec}>➡</button>
          <button onClick={() => setActiveModal('product')} style={btnSec}>📦 Produkty</button>
          <button onClick={() => setActiveModal('recipe')} style={btnPrim}>👨‍🍳 Przepisy</button>
          <button onClick={handleLogout} style={btnDanger}>Wyloguj</button>
        </div>
      </header>

      <div style={layoutGrid}>
        <div style={isMobile ? mobileStack : gridStyle}>
          {!isMobile && <div />}
          {!isMobile && MEAL_TYPES.map(m => <div key={m} style={mealHeader}>{m}</div>)}
          {weekDates.map(day => (
            <React.Fragment key={day.fullDate}>
              <div style={isMobile ? mobileDayLabel : dayCell}>
                <b>{day.name}</b><br/><small>{day.displayDate}</small>
                {isMobile && <div style={{color:'#059669'}}>{stats.daily[day.fullDate]} zł</div>}
              </div>
              {MEAL_TYPES.map(type => {
                const m = mealPlan.find(p => p.date === day.fullDate && p.meal_type === type);
                return (
                  <div key={`${day.fullDate}-${type}`} style={m ? cellStyleActive : cellStyle} onClick={() => { if(!m){setSelectedCell({date:day.fullDate, type}); setFilterCategory(type); setActiveModal('cell');} }}>
                    {isMobile && <span style={mobileMealTag}>{type}</span>}
                    {m ? (
                      <div style={mealContent}>
                        <div style={mealNameS}>{m.recipes.name}</div>
                        <div style={mealPriceS}>{m.recipes.total_cost} zł</div>
                        <button style={btnViewS} onClick={(e)=>{e.stopPropagation(); setViewingRecipe(m.recipes); setActiveModal('view-recipe');}}>Pokaż</button>
                        <button style={btnDeleteSmall} onClick={async(e)=>{e.stopPropagation(); if(confirm("Usunąć?")){await supabase.from('meal_plan').delete().eq('id', m.id); fetchData();}}}>✕</button>
                      </div>
                    ) : <span style={{opacity:0.2, fontSize:'24px'}}>+</span>}
                  </div>
                );
              })}
            </React.Fragment>
          ))}
        </div>

        {!isMobile && (
          <div style={sidePanel}>
            <h3 style={{marginTop:0, color:'#059669'}}>💰 Koszty dniowe</h3>
            {weekDates.map(d => <div key={d.fullDate} style={sideRow}><span>{d.name}</span><b>{stats.daily[d.fullDate]} zł</b></div>)}
            <div style={{...sideRow, border:'none', marginTop:'15px', fontSize:'18px'}}><span>Suma tyg.:</span><b style={{color:'#059669'}}>{stats.totalWeekly} zł</b></div>
          </div>
        )}
      </div>

      {/* PODSUMOWANIE ZAKUPÓW Z KOSZTAMI */}
      <div style={shoppingPanel}>
        <h3 style={{color:'#059669', marginBottom: '15px'}}>🛒 Podsumowanie produktów i kosztów</h3>
        <div style={shoppingGrid}>
          {stats.shoppingList.length > 0 ? stats.shoppingList.map(i => (
            <div key={i.name} style={shoppingItem}>
              <div style={{fontWeight:'bold'}}>{i.name}</div>
              <div style={{fontSize:'13px', color:'#475569'}}>
                {i.unit === 'szt' ? `${i.amount} szt` : i.amount >= 1000 ? `${(i.amount/1000).toFixed(2)} ${i.unit}` : `${i.amount} ${i.unit === 'kg' ? 'g' : 'ml'}`}
              </div>
              <div style={{fontWeight:'bold', color:'#059669', marginTop:'5px'}}>{i.cost} zł</div>
            </div>
          )) : <p style={{color:'#94a3b8'}}>Dodaj posiłki do kalendarza.</p>}
        </div>
        {stats.shoppingList.length > 0 && <div style={{textAlign:'right', marginTop:'20px', fontSize:'20px'}}><b>RAZEM: {stats.totalWeekly} zł</b></div>}
      </div>

      {/* --- MODALE (NAPRAWIONE) --- */}
      {activeModal === 'product' && (
        <Modal title="📦 Spiżarnia" onClose={() => {setActiveModal(null); setNewProd({id:null, name:'', price:'', amount:'', unit:'kg'})}} isMobile={isMobile}>
          <div style={formBoxS}>
            <input style={inputS} placeholder="Nazwa produktu" value={newProd.name} onChange={e => setNewProd({...newProd, name: e.target.value})} />
            <div style={{display:'flex', gap:'5px'}}><input style={inputS} type="number" placeholder="Cena" value={newProd.price} onChange={e => setNewProd({...newProd, price: e.target.value})} /><input style={inputS} type="number" placeholder="Ilość" value={newProd.amount} onChange={e => setNewProd({...newProd, amount: e.target.value})} /><select style={inputS} value={newProd.unit} onChange={e => setNewProd({...newProd, unit: e.target.value})}><option value="kg">kg</option><option value="l">l</option><option value="szt">szt</option></select></div>
            <button style={btnSuccessFull} onClick={handleSaveProduct}>{newProd.id ? 'Zaktualizuj' : 'Zapisz produkt'}</button>
          </div>
          <div style={{maxHeight:'250px', overflowY:'auto'}}>
            {products.map(p => <div key={p.id} style={productRowS}><span><b>{p.name}</b> ({p.price_per_unit.toFixed(2)}/{p.unit})</span><div style={{display:'flex', gap:'10px'}}><button onClick={()=>setNewProd({id:p.id, name:p.name, price:(p.price_per_unit*(p.last_input_quantity||1)).toFixed(2), amount:p.last_input_quantity||1, unit:p.unit})} style={iconBtn}>✏️</button><button onClick={async()=>{if(confirm("Usunąć?")){await supabase.from('products').delete().eq('id',p.id); fetchData();}}} style={iconBtn}>🗑️</button></div></div>)}
          </div>
        </Modal>
      )}

      {activeModal === 'recipe' && (
        <Modal title="👨‍🍳 Przepisy" onClose={() => {setActiveModal(null); setNewRecipe({id:null, name:'', category:'Obiad', instructions:'', ingredients:[]})}} isMobile={isMobile}>
          <div style={{maxHeight:'75vh', overflowY:'auto'}}>
            <div style={formBoxS}>
              <input style={inputS} placeholder="Nazwa dania" value={newRecipe.name} onChange={e => setNewRecipe({...newRecipe, name: e.target.value})} />
              <select style={inputS} value={newRecipe.category} onChange={e => setNewRecipe({...newRecipe, category: e.target.value})}>{MEAL_TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select>
              <textarea style={{...inputS, height:'60px'}} placeholder="Instrukcja..." value={newRecipe.instructions} onChange={e => setNewRecipe({...newRecipe, instructions: e.target.value})} />
              <input style={inputS} placeholder="🔍 Dodaj składnik..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
              {searchQuery && <div style={searchResultsS}>{products.filter(p => p.name.toLowerCase().includes(searchQuery.toLowerCase())).map(p => <div key={p.id} style={searchItemS} onClick={() => { setNewRecipe({...newRecipe, ingredients: [...newRecipe.ingredients, {...p, amount: p.unit==='szt'?1:100}]}); setSearchQuery(''); }}>{p.name}</div>)}</div>}
              {newRecipe.ingredients.map((ing, idx) => <div key={idx} style={ingRowS}><small>{ing.name}</small><div><input type="number" style={{width:'60px'}} value={ing.amount} onChange={e => {const c = [...newRecipe.ingredients]; c[idx].amount = e.target.value; setNewRecipe({...newRecipe, ingredients: c});}} /> {ing.unit === 'kg' ? 'g' : ing.unit === 'l' ? 'ml' : 'szt'} <button onClick={() => setNewRecipe({...newRecipe, ingredients: newRecipe.ingredients.filter((_, i) => i !== idx)})} style={{color:'red', border:'none', background:'none'}}>✕</button></div></div>)}
              <div style={{textAlign:'right', fontWeight:'bold', margin:'10px 0'}}>Koszt przepisu: {recipeCurrentCost} zł</div>
              <button style={btnSuccessFull} onClick={handleSaveRecipe}>Zapisz przepis</button>
            </div>
            <div style={filterBar}>{MEAL_TYPES.map(cat => <button key={cat} onClick={() => setRecipeListCategory(cat)} style={recipeListCategory === cat ? btnFilterActive : btnFilter}>{cat}</button>)}</div>
            {recipes.filter(r => r.category === recipeListCategory).map(r => <div key={r.id} style={productRowS}><span><b>{r.name}</b> ({r.total_cost} zł)</span><div style={{display:'flex', gap:'10px'}}><button onClick={() => {setNewRecipe({id:r.id, name:r.name, category:r.category, instructions:r.instructions, ingredients: r.recipe_ingredients.map(ri => ({...ri.products, amount: ri.amount, product_id: ri.product_id}))})}} style={iconBtn}>✏️</button><button onClick={async()=>{if(confirm("Usunąć?")){await supabase.from('recipes').delete().eq('id',r.id); fetchData();}}} style={iconBtn}>🗑️</button></div></div>)}
          </div>
        </Modal>
      )}

      {activeModal === 'cell' && (
        <Modal title="Wybierz posiłek" onClose={() => setActiveModal(null)} isMobile={isMobile}>
          <div style={filterBar}>{["Wszystkie", ...MEAL_TYPES].map(cat => <button key={cat} onClick={() => setFilterCategory(cat === "Wszystkie" ? "" : cat)} style={filterCategory === (cat === "Wszystkie" ? "" : cat) ? btnFilterActive : btnFilter}>{cat}</button>)}</div>
          <div style={{maxHeight:'300px', overflowY:'auto'}}>{recipes.filter(r => !filterCategory || r.category === filterCategory).map(r => <div key={r.id} style={recipeListItem} onClick={async () => { await supabase.from('meal_plan').insert([{ date: selectedCell.date, meal_type: selectedCell.type, recipe_id: r.id }]); setActiveModal(null); fetchData(); }}><span>{r.name}</span> <b>{r.total_cost} zł</b></div>)}</div>
        </Modal>
      )}

      {activeModal === 'view-recipe' && viewingRecipe && (
        <Modal title={viewingRecipe.name} onClose={() => setActiveModal(null)} isMobile={isMobile}>
          <p style={{whiteSpace:'pre-wrap', background:'#f8fafc', padding:'15px', borderRadius:'10px'}}>{viewingRecipe.instructions || "Brak instrukcji."}</p>
        </Modal>
      )}
    </div>
  );
}

// --- LOGIN & MODAL HELPERS ---
function LoginView() {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const handleLogin = async (e) => { e.preventDefault(); const { error } = await supabase.auth.signInWithPassword({ email, password }); if (error) alert(error.message); };
  return (<div style={loginOverlay}><form onSubmit={handleLogin} style={loginForm}><h2>Jedzonko Planer</h2><input style={inputS} type="email" placeholder="Email" onChange={e => setEmail(e.target.value)} /><input style={inputS} type="password" placeholder="Hasło" onChange={e => setPassword(e.target.value)} /><button style={btnSuccessFull}>Zaloguj się</button></form></div>);
}

function Modal({ title, children, onClose, isMobile }) {
  const mS = { background: 'white', padding: isMobile ? '15px' : '25px', borderRadius: '20px', width: isMobile ? '90%' : '550px', boxShadow: '0 20px 50px rgba(0,0,0,0.15)', zIndex: 1100, position: 'relative' };
  return (<div style={overlayS}><div style={mS}><div style={{display:'flex', justifyContent:'space-between', marginBottom:'15px', alignItems:'center'}}><h3 style={{margin:0}}>{title}</h3><button onClick={onClose} style={{border:'none', background:'none', fontSize:'28px', cursor:'pointer'}}>✕</button></div>{children}</div></div>);
}

// --- STYLE (WHITE THEME) ---
const appContainer = { padding:'20px', backgroundColor:'#f3f4f6', minHeight:'100vh', color:'#1f2937', fontFamily:'sans-serif' };
const headerStyle = { display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'20px', background:'white', padding:'20px', borderRadius:'15px', boxShadow:'0 2px 4px rgba(0,0,0,0.05)' };
const headerMobile = { display:'flex', flexDirection:'column', gap:'15px', marginBottom:'20px', background:'white', padding:'20px', borderRadius:'15px', textAlign:'center' };
const navButtons = { display:'flex', gap:'8px', flexWrap:'wrap', justifyContent:'center' };
const layoutGrid = { display: 'grid', gridTemplateColumns: window.innerWidth < 900 ? '1fr' : '1fr 280px', gap: '20px' };
const sidePanel = { background:'white', padding:'20px', borderRadius:'15px', height:'fit-content', boxShadow:'0 2px 4px rgba(0,0,0,0.05)' };
const sideRow = { display:'flex', justifyContent:'space-between', padding:'10px 0', borderBottom:'1px solid #f3f4f6' };
const gridStyle = { display:'grid', gridTemplateColumns:'110px repeat(5, 1fr)', gap:'10px' };
const mobileStack = { display:'flex', flexDirection:'column', gap:'12px' };
const dayCell = { background:'white', padding:'12px', borderRadius:'12px', textAlign:'center', borderLeft:'5px solid #059669', boxShadow:'0 2px 4px rgba(0,0,0,0.05)' };
const mobileDayLabel = { background:'#059669', color:'white', padding:'12px', borderRadius:'12px', textAlign:'center', fontWeight:'bold', display:'flex', justifyContent:'space-between' };
const mealHeader = { textAlign:'center', fontWeight:'bold', color:'#64748b' };
const cellStyle = { minHeight:'100px', background:'white', borderRadius:'12px', border:'1px solid #e5e7eb', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', position:'relative' };
const cellStyleActive = { ...cellStyle, border:'2px solid #059669' };
const mealContent = { width:'100%', textAlign:'center', padding:'10px' };
const mealNameS = { fontWeight:'bold', fontSize:'13px', color:'#111827' };
const mealPriceS = { fontSize:'12px', color:'#059669', fontWeight:'bold' };
const btnViewS = { background:'#f3f4f6', color:'#374151', border:'none', padding:'5px 12px', borderRadius:'6px', fontSize:'10px', cursor:'pointer', marginTop:'8px' };
const btnDeleteSmall = { position:'absolute', top:'5px', right:'5px', background:'#fee2e2', color:'#ef4444', border:'none', borderRadius:'50%', width:'22px', height:'22px' };
const shoppingPanel = { marginTop:'30px', background:'white', padding:'25px', borderRadius:'15px', boxShadow:'0 2px 4px rgba(0,0,0,0.05)' };
const shoppingGrid = { display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(160px, 1fr))', gap:'15px' };
const shoppingItem = { background:'#f9fafb', padding:'15px', borderRadius:'12px', border:'1px solid #f3f4f6' };
const inputS = { width:'100%', padding:'12px', marginBottom:'10px', borderRadius:'10px', border:'1px solid #d1d5db', boxSizing:'border-box' };
const btnPrim = { background:'#059669', color:'white', border:'none', padding:'10px 20px', borderRadius:'10px', fontWeight:'bold', cursor:'pointer' };
const btnSec = { background:'#f3f4f6', color:'#374151', border:'none', padding:'10px 20px', borderRadius:'10px', cursor:'pointer' };
const btnDanger = { background:'#ef4444', color:'white', border:'none', padding:'10px 20px', borderRadius:'10px' };
const btnSuccessFull = { background:'#059669', color:'white', border:'none', padding:'14px', borderRadius:'12px', width:'100%', cursor:'pointer', fontWeight:'bold' };
const btnFilter = { background:'#f3f4f6', color:'#6b7280', border:'none', padding:'8px 16px', borderRadius:'20px', cursor:'pointer' };
const btnFilterActive = { ...btnFilter, background:'#059669', color:'white' };
const filterBar = { display:'flex', gap:'5px', marginBottom:'15px', overflowX:'auto' };
const productRowS = { display:'flex', justifyContent:'space-between', padding:'12px', borderBottom:'1px solid #f3f4f6', alignItems:'center' };
const recipeListItem = { padding:'15px', borderBottom:'1px solid #f3f4f6', cursor:'pointer', display:'flex', justifyContent:'space-between' };
const searchResultsS = { background:'white', border:'1px solid #e5e7eb', borderRadius:'10px', marginBottom:'15px', boxShadow:'0 4px 6px rgba(0,0,0,0.05)' };
const searchItemS = { padding:'12px', cursor:'pointer', borderBottom:'1px solid #f3f4f6' };
const ingRowS = { display:'flex', justifyContent:'space-between', padding:'8px 0', alignItems:'center' };
const iconBtn = { border:'none', background:'none', cursor:'pointer', fontSize:'18px' };
const overlayS = { position:'fixed', top:0, left:0, width:'100%', height:'100%', background:'rgba(0,0,0,0.4)', display:'flex', justifyContent:'center', alignItems:'center', zIndex:1000 };
const loginOverlay = { height:'100vh', display:'flex', justifyContent:'center', alignItems:'center', background:'#f3f4f6' };
const loginForm = { background:'white', padding:'40px', borderRadius:'25px', width:'320px', boxShadow:'0 10px 25px rgba(0,0,0,0.1)' };
const loadingStyle = { display:'flex', justifyContent:'center', alignItems:'center', height:'100vh', color:'#059669', fontSize:'20px' };
const mobileMealTag = { position:'absolute', top:'5px', left:'8px', fontSize:'9px', color:'#94a3b8', fontWeight:'bold' };
const formBoxS = { background:'#f9fafb', padding:'15px', borderRadius:'15px', marginBottom:'20px', border:'1px solid #e5e7eb' };