import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY);

const MEAL_TYPES = ["Śniadanie", "Lunch", "Obiad", "Podwieczorek", "Kolacja"];
const DAYS = ["Poniedziałek", "Wtorek", "Środa", "Czwartek", "Piątek", "Sobota", "Niedziela"];

const MEAL_COLORS = {
  "Śniadanie": "#fef3c7", "Lunch": "#e0f2fe", "Obiad": "#dcfce7", "Podwieczorek": "#f3e8ff", "Kolacja": "#fee2e2"
};

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

  const [newProd, setNewProd] = useState({ id: null, name: '', price: '', amount: '', unit: 'g' });
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
    const shoppingList = Object.values(shopping).map(item => ({
      ...item, cost: (item.pricePerUnit * item.amount).toFixed(2)
    }));
    return { shoppingList, daily, totalWeekly: totalWeekly.toFixed(2) };
  }, [weekDates, mealPlan, recipes]);

  const handleSaveProduct = async () => {
    const pPerU = parseFloat(newProd.price) / parseFloat(newProd.amount);
    const d = { name: newProd.name, price_per_unit: pPerU, unit: newProd.unit, last_input_quantity: parseFloat(newProd.amount) };
    if (newProd.id) await supabase.from('products').update(d).eq('id', newProd.id);
    else await supabase.from('products').insert([d]);
    setNewProd({ id: null, name: '', price: '', amount: '', unit: 'g' });
    fetchData();
  };

  const handleSaveRecipe = async () => {
    const calc = (ing) => (parseFloat(ing.price_per_unit || ing.products?.price_per_unit || 0) * parseFloat(ing.amount || 0));
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

  if (loading) return <div style={loadingStyle}>🍳 Rozgrzewanie patelni...</div>;
  if (!session) return <LoginView />;

  return (
    <div style={appContainer}>
      {/* HEADER */}
      <header style={isMobile ? headerMobile : headerStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <div style={logoCircleS}><span style={{ fontSize: '28px' }}>🥑</span></div>
          <div>
            <h1 style={logoTitleS}>Jedzonko planer</h1>
            <div style={weekBadgeS}>📅 {weekDates[0].displayDate} — {weekDates[6].displayDate}</div>
          </div>
        </div>
        <div style={navButtons}>
          <div style={navGroupS}>
            <button onClick={() => setWeekOffset(prev => prev - 1)} style={btnIconS}>⬅</button>
            <button onClick={() => setWeekOffset(0)} style={btnTodayS}>Dziś</button>
            <button onClick={() => setWeekOffset(prev => prev + 1)} style={btnIconS}>➡</button>
          </div>
          <button onClick={() => setActiveModal('product')} style={btnSec}>📦 Produkty</button>
          <button onClick={() => setActiveModal('recipe')} style={btnPrim}>👨‍🍳 Przepisy</button>
          <button onClick={handleLogout} style={btnDanger}>Wyloguj</button>
        </div>
      </header>

      {/* KALENDARZ */}
      <div style={layoutGrid}>
        <div style={isMobile ? mobileStack : gridStyle}>
          {!isMobile && <div />}
          {!isMobile && MEAL_TYPES.map(m => <div key={m} style={mealHeader}>{m}</div>)}
          {weekDates.map(day => (
            <React.Fragment key={day.fullDate}>
              <div style={isMobile ? mobileDayLabel : dayCell}>
                <b style={{fontSize:'16px'}}>{day.name}</b><br/>
                <span style={{opacity:0.6}}>{day.displayDate}</span>
                {isMobile && <div style={dayCostBadgeS}>{stats.daily[day.fullDate]} zł</div>}
              </div>
              {MEAL_TYPES.map(type => {
                const m = mealPlan.find(p => p.date === day.fullDate && p.meal_type === type);
                return (
                  <div key={`${day.fullDate}-${type}`} 
                       style={m ? {...cellStyleActive, backgroundColor: MEAL_COLORS[type]} : cellStyle} 
                       onClick={() => { if(!m){setSelectedCell({date:day.fullDate, type}); setFilterCategory(type); setActiveModal('cell');} }}>
                    {isMobile && <span style={mobileMealTag}>{type}</span>}
                    {m ? (
                      <div style={mealContent}>
                        <div style={mealNameS}>{m.recipes.name}</div>
                        <div style={mealPriceS}>{m.recipes.total_cost} zł</div>
                        <div style={btnGroupS}>
                           <button style={btnViewS} onClick={(e)=>{e.stopPropagation(); setViewingRecipe(m.recipes); setActiveModal('view-recipe');}}>Przepis</button>
                           <button style={btnDelS} onClick={async(e)=>{e.stopPropagation(); if(confirm("Usunąć?")){await supabase.from('meal_plan').delete().eq('id', m.id); fetchData();}}}>✕</button>
                        </div>
                      </div>
                    ) : <span style={plusIconS}>+</span>}
                  </div>
                );
              })}
            </React.Fragment>
          ))}
        </div>
        {!isMobile && (
          <div style={sidePanel}>
            <h3 style={sideTitleS}>💰 Wydatki</h3>
            {weekDates.map(d => (
              <div key={d.fullDate} style={sideRow}><span>{d.name}</span><b>{stats.daily[d.fullDate]} zł</b></div>
            ))}
            <div style={grandTotalS}><span>Łącznie</span><b>{stats.totalWeekly} zł</b></div>
          </div>
        )}
      </div>

      {/* LISTA ZAKUPÓW */}
      <div style={shoppingPanel}>
        <h3 style={{color:'#059669', marginBottom:'20px'}}>🛒 Zakupy na ten tydzień</h3>
        <div style={shoppingGrid}>
          {stats.shoppingList.map(i => (
            <div key={i.name} style={shoppingItem}>
              <div style={shopIconS}>📍</div>
              <div><b>{i.name}</b><br/><small style={{color:'#64748b'}}>{i.amount} {i.unit} • {i.cost} zł</small></div>
            </div>
          ))}
        </div>
      </div>

      {/* MODAL: WYBÓR POSIŁKU */}
      {activeModal === 'cell' && (
        <Modal title="Dodaj posiłek" onClose={() => setActiveModal(null)} isMobile={isMobile}>
          <div style={filterBar}>
            {["Wszystkie", ...MEAL_TYPES].map(cat => (
              <button key={cat} onClick={() => setFilterCategory(cat === "Wszystkie" ? "" : cat)} 
                style={filterCategory === (cat === "Wszystkie" ? "" : cat) ? btnFilterActive : btnFilter}>{cat}</button>
            ))}
          </div>
          <div style={{maxHeight: '350px', overflowY: 'auto'}}>
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

      {/* MODAL: SPIŻARNIA / PRODUKTY */}
      {activeModal === 'product' && (
        <Modal title="📦 Produkty" onClose={() => setActiveModal(null)} isMobile={isMobile}>
           <div style={formBoxS}>
              <input style={inputS} placeholder="Nazwa" value={newProd.name} onChange={e => setNewProd({...newProd, name: e.target.value})} />
              <div style={{display:'flex', gap:'5px'}}>
                <input style={inputS} type="number" placeholder="Cena" value={newProd.price} onChange={e => setNewProd({...newProd, price: e.target.value})} />
                <input style={inputS} type="number" placeholder="Ilość" value={newProd.amount} onChange={e => setNewProd({...newProd, amount: e.target.value})} />
                <select style={inputS} value={newProd.unit} onChange={e => setNewProd({...newProd, unit: e.target.value})}><option value="g">g</option><option value="ml">ml</option><option value="szt">szt</option></select>
              </div>
              <button style={btnSuccessFull} onClick={handleSaveProduct}>{newProd.id ? 'Zaktualizuj' : 'Zapisz produkt'}</button>
           </div>
           <div style={{maxHeight: '300px', overflowY: 'auto'}}>
              {products.map(p => (
                <div key={p.id} style={productRowS}>
                  <span><b>{p.name}</b> ({p.price_per_unit.toFixed(4)}/{p.unit})</span>
                  <div style={{display:'flex', gap:'10px'}}>
                    <button onClick={() => setNewProd({id:p.id, name:p.name, price:(p.price_per_unit*(p.last_input_quantity||1)).toFixed(2), amount:p.last_input_quantity||1, unit:p.unit})} style={iconBtn}>✏️</button>
                    <button onClick={async () => { if(confirm("Usunąć?")) { await supabase.from('products').delete().eq('id', p.id); fetchData(); } }} style={iconBtn}>🗑️</button>
                  </div>
                </div>
              ))}
           </div>
        </Modal>
      )}

      {/* MODAL: PRZEPISY */}
      {activeModal === 'recipe' && (
        <Modal title="👨‍🍳 Przepisy" onClose={() => setActiveModal(null)} isMobile={isMobile}>
          <div style={{maxHeight: '75vh', overflowY: 'auto'}}>
            <div style={formBoxS}>
              <input style={inputS} placeholder="Nazwa dania..." value={newRecipe.name} onChange={e => setNewRecipe({...newRecipe, name: e.target.value})} />
              <select style={inputS} value={newRecipe.category} onChange={e => setNewRecipe({...newRecipe, category: e.target.value})}>{MEAL_TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select>
              <textarea style={{...inputS, height:'60px'}} placeholder="Opis przygotowania..." value={newRecipe.instructions} onChange={e => setNewRecipe({...newRecipe, instructions: e.target.value})} />
              <input style={inputS} placeholder="🔍 Dodaj składnik..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
              {searchQuery && (
                <div style={searchResultsS}>
                  {products.filter(p => p.name.toLowerCase().includes(searchQuery.toLowerCase())).map(p => (
                    <div key={p.id} style={searchItemS} onClick={() => { setNewRecipe({...newRecipe, ingredients: [...newRecipe.ingredients, {...p, amount: 100}]}); setSearchQuery(''); }}>{p.name}</div>
                  ))}
                </div>
              )}
              {newRecipe.ingredients.map((ing, idx) => (
                <div key={idx} style={ingRowS}>
                  <small>{ing.name}</small>
                  <input type="number" style={{width:'60px', padding:'4px', borderRadius:'8px', border:'1px solid #ddd'}} value={ing.amount} onChange={e => {
                    const copy = [...newRecipe.ingredients];
                    copy[idx].amount = e.target.value;
                    setNewRecipe({...newRecipe, ingredients: copy});
                  }} />
                  <button onClick={() => setNewRecipe({...newRecipe, ingredients: newRecipe.ingredients.filter((_, i) => i !== idx)})} style={{border:'none', background:'none', color:'red'}}>✕</button>
                </div>
              ))}
              <button style={{...btnSuccessFull, marginTop:'10px'}} onClick={handleSaveRecipe}>{newRecipe.id ? 'Zaktualizuj' : 'Zapisz przepis'}</button>
            </div>
            <div style={filterBar}>{MEAL_TYPES.map(cat => <button key={cat} onClick={() => setRecipeListCategory(cat)} style={recipeListCategory === cat ? btnFilterActive : btnFilter}>{cat}</button>)}</div>
            {recipes.filter(r => r.category === recipeListCategory).map(r => (
              <div key={r.id} style={productRowS}>
                <span style={{fontSize:'13px'}}>{r.name}</span>
                <div style={{display:'flex', gap:'10px'}}>
                  <button onClick={() => setNewRecipe({ id: r.id, name: r.name, category: r.category, instructions: r.instructions, ingredients: r.recipe_ingredients.map(ri => ({ ...ri.products, amount: ri.amount, product_id: ri.product_id })) })} style={iconBtn}>✏️</button>
                  <button onClick={async () => { if(confirm("Usunąć?")) { await supabase.from('recipes').delete().eq('id', r.id); fetchData(); } }} style={iconBtn}>🗑️</button>
                </div>
              </div>
            ))}
          </div>
        </Modal>
      )}

      {/* MODAL: PODGLĄD */}
      {activeModal === 'view-recipe' && viewingRecipe && (
        <Modal title={viewingRecipe.name} onClose={() => setActiveModal(null)} isMobile={isMobile}>
          <div style={{maxHeight:'70vh', overflowY:'auto'}}><p style={{whiteSpace:'pre-wrap', background:'#f8fafc', padding:'20px', borderRadius:'15px', lineHeight:'1.6'}}>{viewingRecipe.instructions || "Brak opisu."}</p></div>
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
    <div style={loginOverlay}><form onSubmit={handleLogin} style={loginForm}><h2 style={{color:'#059669', textAlign:'center'}}>Jedzonko planer</h2><input style={inputS} type="email" placeholder="Email" onChange={e => setEmail(e.target.value)} /><input style={inputS} type="password" placeholder="Hasło" onChange={e => setPassword(e.target.value)} /><button style={btnSuccessFull}>Zaloguj</button></form></div>
  );
}

function Modal({ title, children, onClose, isMobile }) {
  return (
    <div style={overlayS}>
      <div style={{...modalS, width: isMobile ? '95%' : '580px'}}>
        <div style={modalHeaderS}><h3>{title}</h3><button onClick={onClose} style={{border:'none', background:'none', fontSize:'28px', cursor:'pointer', color:'#94a3b8'}}>✕</button></div>
        <div style={{padding:'25px'}}>{children}</div>
      </div>
    </div>
  );
}

// --- STYLE ---
const appContainer = { padding:'20px', backgroundColor:'#f8fafc', minHeight:'100vh', fontFamily:'sans-serif' };
const headerStyle = { display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'30px', background:'white', padding:'20px 30px', borderRadius:'24px', boxShadow:'0 10px 15px -3px rgba(0,0,0,0.05)' };
const headerMobile = { display:'flex', flexDirection:'column', gap:'20px', marginBottom:'25px', background:'white', padding:'20px', borderRadius:'24px', textAlign:'center' };
const logoTitleS = { margin:0, color:'#059669', fontWeight:'800' };
const logoCircleS = { width: '60px', height: '60px', backgroundColor: '#f0fdf4', borderRadius: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid #059669' };
const weekBadgeS = { display:'inline-block', padding:'4px 12px', background:'#f1f5f9', borderRadius:'20px', fontSize:'13px', color:'#64748b' };
const navButtons = { display:'flex', gap:'12px', flexWrap:'wrap', justifyContent:'center' };
const navGroupS = { display:'flex', background:'#f1f5f9', padding:'4px', borderRadius:'14px' };
const btnIconS = { background:'transparent', border:'none', padding:'8px 12px', cursor:'pointer' };
const btnTodayS = { background:'white', border:'none', padding:'6px 16px', borderRadius:'10px', fontWeight:'600', cursor:'pointer' };
const layoutGrid = { display: 'grid', gridTemplateColumns: window.innerWidth < 900 ? '1fr' : '1fr 320px', gap: '25px' };
const sidePanel = { background:'white', padding:'25px', borderRadius:'24px', height:'fit-content', boxShadow:'0 10px 15px -3px rgba(0,0,0,0.05)' };
const sideTitleS = { fontSize:'18px', fontWeight:'700', marginBottom:'20px' };
const sideRow = { display:'flex', justifyContent:'space-between', padding:'12px 0', borderBottom:'1px solid #f1f5f9' };
const grandTotalS = { display:'flex', justifyContent:'space-between', marginTop:'20px', padding:'15px', background:'#f0fdf4', borderRadius:'16px', color:'#059669', fontSize:'18px', fontWeight:'bold' };
const gridStyle = { display:'grid', gridTemplateColumns:'120px repeat(5, 1fr)', gap:'12px' };
const mobileStack = { display:'flex', flexDirection:'column', gap:'15px' };
const dayCell = { background:'white', padding:'15px', borderRadius:'20px', textAlign:'center', boxShadow:'0 4px 6px -1px rgba(0,0,0,0.05)' };
const mobileDayLabel = { background:'#059669', color:'white', padding:'15px', borderRadius:'18px', fontWeight:'bold', display:'flex', justifyContent:'space-between' };
const dayCostBadgeS = { background:'rgba(255,255,255,0.2)', padding:'4px 10px', borderRadius:'12px', fontSize:'13px' };
const mealHeader = { textAlign:'center', fontWeight:'700', color:'#94a3b8', fontSize:'13px' };
const cellStyle = { minHeight:'110px', background:'white', borderRadius:'22px', border:'2px dashed #e2e8f0', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', position:'relative' };
const cellStyleActive = { ...cellStyle, border:'2px solid transparent', cursor:'default', boxShadow:'0 4px 12px rgba(0,0,0,0.03)' };
const mealContent = { width:'100%', textAlign:'center', padding:'10px' };
const mealNameS = { fontWeight:'bold', fontSize:'13px', marginBottom:'4px' };
const mealPriceS = { fontSize:'12px', color:'#059669', fontWeight:'bold' };
const btnGroupS = { display:'flex', justifyContent:'center', gap:'6px', marginTop:'8px' };
const btnViewS = { background:'white', border:'none', padding:'5px 10px', borderRadius:'8px', fontSize:'10px', fontWeight:'bold', cursor:'pointer' };
const btnDelS = { background:'#fee2e2', color:'#ef4444', border:'none', width:'26px', height:'26px', borderRadius:'8px', cursor:'pointer' };
const plusIconS = { opacity:0.3, fontSize:'24px', color:'#94a3b8' };
const shoppingPanel = { marginTop:'40px', background:'white', padding:'30px', borderRadius:'28px', boxShadow:'0 10px 15px -3px rgba(0,0,0,0.05)' };
const shoppingGrid = { display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(200px, 1fr))', gap:'16px' };
const shoppingItem = { display:'flex', alignItems:'center', gap:'12px', background:'#f8fafc', padding:'15px', borderRadius:'18px', border:'1px solid #f1f5f9' };
const shopIconS = { width:'35px', height:'35px', background:'white', borderRadius:'10px', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'16px' };
const overlayS = { position:'fixed', top:0, left:0, width:'100%', height:'100%', background:'rgba(15, 23, 42, 0.4)', backdropFilter:'blur(4px)', display:'flex', justifyContent:'center', alignItems:'center', zIndex:1000 };
const modalS = { background:'white', borderRadius:'28px', boxShadow:'0 25px 50px -12px rgba(0,0,0,0.25)', overflow:'hidden' };
const modalHeaderS = { padding:'20px 25px', background:'#f8fafc', borderBottom:'1px solid #f1f5f9', display:'flex', justifyContent:'space-between', alignItems:'center' };
const inputS = { width:'100%', padding:'12px', marginBottom:'10px', borderRadius:'12px', border:'1px solid #e2e8f0', boxSizing:'border-box' };
const btnPrim = { background:'#059669', color:'white', border:'none', padding:'12px 24px', borderRadius:'14px', fontWeight:'bold', cursor:'pointer' };
const btnSec = { background:'#f1f5f9', color:'#1e293b', border:'none', padding:'12px 24px', borderRadius:'14px', fontWeight:'bold', cursor:'pointer' };
const btnDanger = { background:'#fff1f2', color:'#e11d48', border:'none', padding:'12px 20px', borderRadius:'14px', fontWeight:'bold', cursor:'pointer' };
const btnSuccessFull = { background:'#059669', color:'white', border:'none', padding:'14px', borderRadius:'16px', width:'100%', cursor:'pointer', fontWeight:'bold' };
const filterBar = { display:'flex', gap:'8px', marginBottom:'15px', overflowX:'auto' };
const btnFilter = { background:'#f1f5f9', color:'#64748b', border:'none', padding:'8px 16px', borderRadius:'12px', cursor:'pointer', fontWeight:'bold' };
const btnFilterActive = { ...btnFilter, background:'#059669', color:'white' };
const productRowS = { display:'flex', justifyContent:'space-between', padding:'12px', borderBottom:'1px solid #f1f5f9', alignItems:'center' };
const iconBtn = { border:'none', background:'none', cursor:'pointer', fontSize:'18px' };
const loadingStyle = { display:'flex', justifyContent:'center', alignItems:'center', height:'100vh', color:'#059669', fontSize:'20px', fontWeight:'bold' };
const loginOverlay = { height:'100vh', display:'flex', justifyContent:'center', alignItems:'center', background:'#f8fafc' };
const loginForm = { background:'white', padding:'40px', borderRadius:'30px', width:'320px', boxShadow:'0 20px 25px -5px rgba(0,0,0,0.05)' };
const mobileMealTag = { position:'absolute', top:'6px', left:'10px', fontSize:'9px', color:'#94a3b8', fontWeight:'bold', textTransform:'uppercase' };
const formBoxS = { background:'#f8fafc', padding:'20px', borderRadius:'20px', marginBottom:'20px', border:'1px solid #f1f5f9' };
const recipeListItem = { padding:'15px', borderBottom:'1px solid #f1f5f9', cursor:'pointer', display:'flex', justifyContent:'space-between' };
const searchResultsS = { background:'white', border:'1px solid #e2e8f0', borderRadius:'12px', marginBottom:'10px' };
const searchItemS = { padding:'10px', cursor:'pointer', borderBottom:'1px solid #f1f5f9' };
const ingRowS = { display:'flex', justifyContent:'space-between', padding:'8px 0', alignItems:'center' };