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

  if (loading) return <div style={loadingStyle}>Przygotowywanie kuchni...</div>;
  if (!session) return <LoginView />;

  return (
    <div style={appContainer}>
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
            <h3 style={sideTitleS}>💰 Podsumowanie</h3>
            {weekDates.map(d => (
              <div key={d.fullDate} style={sideRow}>
                <span>{d.name}</span>
                <b style={{color: stats.daily[d.fullDate] > 0 ? '#059669' : '#94a3b8'}}>{stats.daily[d.fullDate]} zł</b>
              </div>
            ))}
            <div style={grandTotalS}>
              <span>Łącznie</span>
              <b>{stats.totalWeekly} zł</b>
            </div>
          </div>
        )}
      </div>

      <div style={shoppingPanel}>
        <div style={{display:'flex', alignItems:'center', gap:'10px', marginBottom:'20px'}}>
           <h3 style={{margin:0, color:'#059669'}}>🛒 Lista zakupów</h3>
           <div style={shoppingBadgeS}>{stats.shoppingList.length} poz.</div>
        </div>
        <div style={shoppingGrid}>
          {stats.shoppingList.map(i => (
            <div key={i.name} style={shoppingItem}>
              <div style={shopIconS}>📍</div>
              <div>
                <div style={{fontWeight:'700', fontSize:'15px'}}>{i.name}</div>
                <div style={{color:'#64748b', fontSize:'12px'}}>{i.amount} {i.unit} • {i.cost} zł</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// --- LOGIN & MODAL HELPERS (Styles updated) ---
function LoginView() {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const handleLogin = async (e) => { e.preventDefault(); const { error } = await supabase.auth.signInWithPassword({ email, password }); if (error) alert(error.message); };
  return (
    <div style={loginOverlay}>
      <form onSubmit={handleLogin} style={loginForm}>
        <div style={{textAlign:'center', marginBottom:'25px'}}><span style={{fontSize:'40px'}}>🍳</span><h2 style={{margin:'10px 0', color:'#059669'}}>Jedzonko planer</h2></div>
        <input style={inputS} type="email" placeholder="Twój email" onChange={e => setEmail(e.target.value)} />
        <input style={inputS} type="password" placeholder="Hasło" onChange={e => setPassword(e.target.value)} />
        <button style={btnSuccessFull}>Zaloguj się</button>
      </form>
    </div>
  );
}

function Modal({ title, children, onClose, isMobile }) {
  return (
    <div style={overlayS}>
      <div style={{...modalS, width: isMobile ? '95%' : '580px'}}>
        <div style={modalHeaderS}>
          <h3 style={{margin:0, fontSize:'1.2rem'}}>{title}</h3>
          <button onClick={onClose} style={closeBtnS}>✕</button>
        </div>
        <div style={modalBodyS}>{children}</div>
      </div>
    </div>
  );
}

// --- REFRESHED UI STYLES ---
const appContainer = { padding:'20px', backgroundColor:'#f8fafc', minHeight:'100vh', color:'#1e293b', fontFamily:'"Inter", -apple-system, sans-serif' };
const headerStyle = { display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'30px', background:'white', padding:'20px 30px', borderRadius:'24px', boxShadow:'0 10px 15px -3px rgba(0,0,0,0.05)' };
const headerMobile = { display:'flex', flexDirection:'column', gap:'20px', marginBottom:'25px', background:'white', padding:'20px', borderRadius:'24px', textAlign:'center' };
const logoTitleS = { margin:0, background: 'linear-gradient(90deg, #059669, #0d9488)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', fontWeight:'800', letterSpacing:'-0.5px' };
const logoCircleS = { width: '60px', height: '60px', backgroundColor: '#f0fdf4', borderRadius: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.05)' };
const weekBadgeS = { display:'inline-block', marginTop:'5px', padding:'4px 12px', background:'#f1f5f9', borderRadius:'20px', fontSize:'13px', color:'#64748b', fontWeight:'500' };
const navButtons = { display:'flex', gap:'12px', flexWrap:'wrap', justifyContent:'center', alignItems:'center' };
const navGroupS = { display:'flex', background:'#f1f5f9', padding:'4px', borderRadius:'14px', gap:'2px' };
const btnIconS = { background:'transparent', border:'none', padding:'8px 12px', cursor:'pointer', fontSize:'16px' };
const btnTodayS = { background:'white', border:'none', padding:'6px 16px', borderRadius:'10px', fontWeight:'600', cursor:'pointer', boxShadow:'0 2px 4px rgba(0,0,0,0.05)' };
const layoutGrid = { display: 'grid', gridTemplateColumns: window.innerWidth < 900 ? '1fr' : '1fr 320px', gap: '25px' };
const sidePanel = { background:'white', padding:'25px', borderRadius:'24px', height:'fit-content', boxShadow:'0 10px 15px -3px rgba(0,0,0,0.05)' };
const sideTitleS = { fontSize:'18px', fontWeight:'700', marginBottom:'20px' };
const sideRow = { display:'flex', justifyContent:'space-between', padding:'12px 0', borderBottom:'1px solid #f1f5f9', fontSize:'14px' };
const grandTotalS = { display:'flex', justifyContent:'space-between', marginTop:'20px', padding:'15px', background:'#f0fdf4', borderRadius:'16px', color:'#059669', fontSize:'18px' };
const gridStyle = { display:'grid', gridTemplateColumns:'120px repeat(5, 1fr)', gap:'12px' };
const mobileStack = { display:'flex', flexDirection:'column', gap:'15px' };
const dayCell = { background:'white', padding:'15px', borderRadius:'20px', textAlign:'center', boxShadow:'0 4px 6px -1px rgba(0,0,0,0.05)', display:'flex', flexDirection:'column', justifyContent:'center' };
const mobileDayLabel = { background:'linear-gradient(135deg, #059669, #10b981)', color:'white', padding:'15px', borderRadius:'18px', fontWeight:'700', display:'flex', justifyContent:'space-between', alignItems:'center', boxShadow:'0 10px 15px -3px rgba(16, 185, 129, 0.3)' };
const dayCostBadgeS = { background:'rgba(255,255,255,0.2)', padding:'4px 10px', borderRadius:'12px', fontSize:'13px' };
const mealHeader = { textAlign:'center', fontWeight:'700', color:'#94a3b8', fontSize:'14px', textTransform:'uppercase', letterSpacing:'1px' };
const cellStyle = { minHeight:'120px', background:'rgba(255,255,255,0.5)', borderRadius:'22px', border:'2px dashed #e2e8f0', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', transition:'all 0.2s ease' };
const cellStyleActive = { ...cellStyle, border:'2px solid transparent', cursor:'default', boxShadow:'0 4px 12px rgba(0,0,0,0.03)', transform:'scale(1)' };
const plusIconS = { opacity:0.3, fontSize:'28px', color:'#94a3b8', fontWeight:'300' };
const mealContent = { width:'100%', textAlign:'center', padding:'15px' };
const mealNameS = { fontWeight:'700', fontSize:'14px', color:'#1e293b', marginBottom:'4px' };
const mealPriceS = { fontSize:'13px', color:'#059669', fontWeight:'700', opacity:0.8 };
const btnGroupS = { display:'flex', justifyContent:'center', gap:'6px', marginTop:'12px' };
const btnViewS = { background:'white', color:'#1e293b', border:'none', padding:'6px 12px', borderRadius:'10px', fontSize:'11px', fontWeight:'600', cursor:'pointer', boxShadow:'0 2px 4px rgba(0,0,0,0.05)' };
const btnDelS = { background:'#fee2e2', color:'#ef4444', border:'none', width:'28px', height:'28px', borderRadius:'10px', cursor:'pointer', fontWeight:'bold' };
const shoppingPanel = { marginTop:'40px', background:'white', padding:'30px', borderRadius:'28px', boxShadow:'0 10px 15px -3px rgba(0,0,0,0.05)' };
const shoppingBadgeS = { fontSize:'12px', background:'#f1f5f9', padding:'4px 10px', borderRadius:'20px', color:'#64748b', fontWeight:'600' };
const shoppingGrid = { display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(220px, 1fr))', gap:'16px' };
const shoppingItem = { display:'flex', alignItems:'center', gap:'15px', background:'#f8fafc', padding:'16px', borderRadius:'18px', border:'1px solid #f1f5f9' };
const shopIconS = { width:'40px', height:'40px', background:'white', borderRadius:'12px', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'18px', boxShadow:'0 2px 4px rgba(0,0,0,0.03)' };
const inputS = { width:'100%', padding:'14px', marginBottom:'12px', borderRadius:'14px', border:'1px solid #e2e8f0', outline:'none', fontSize:'15px', transition:'border 0.2s', ':focus': { borderColor: '#059669'} };
const btnPrim = { background:'linear-gradient(135deg, #059669, #10b981)', color:'white', border:'none', padding:'12px 24px', borderRadius:'14px', fontWeight:'700', cursor:'pointer', boxShadow:'0 4px 6px rgba(16, 185, 129, 0.2)' };
const btnSec = { background:'#f1f5f9', color:'#1e293b', border:'none', padding:'12px 24px', borderRadius:'14px', fontWeight:'600', cursor:'pointer' };
const btnDanger = { background:'#fff1f2', color:'#e11d48', border:'none', padding:'12px 20px', borderRadius:'14px', fontWeight:'600', cursor:'pointer' };
const btnSuccessFull = { background:'linear-gradient(135deg, #059669, #10b981)', color:'white', border:'none', padding:'16px', borderRadius:'16px', width:'100%', cursor:'pointer', fontWeight:'800', fontSize:'16px' };
const overlayS = { position:'fixed', top:0, left:0, width:'100%', height:'100%', background:'rgba(15, 23, 42, 0.4)', backdropFilter:'blur(8px)', display:'flex', justifyContent:'center', alignItems:'center', zIndex:1000 };
const modalS = { background: 'white', borderRadius: '28px', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)', overflow:'hidden' };
const modalHeaderS = { padding:'25px 30px', background:'#f8fafc', borderBottom:'1px solid #f1f5f9', display:'flex', justifyContent:'space-between', alignItems:'center' };
const modalBodyS = { padding:'30px' };
const closeBtnS = { border:'none', background:'none', fontSize:'24px', color:'#94a3b8', cursor:'pointer' };
const loadingStyle = { display:'flex', justifyContent:'center', alignItems:'center', height:'100vh', color:'#059669', fontSize:'20px', fontWeight:'700' };
const loginOverlay = { height:'100vh', display:'flex', justifyContent:'center', alignItems:'center', background:'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)' };
const loginForm = { background:'white', padding:'50px', borderRadius:'32px', width:'380px', boxShadow:'0 20px 25px -5px rgba(0,0,0,0.05)' };
const mobileMealTag = { position:'absolute', top:'8px', left:'12px', fontSize:'10px', color:'#94a3b8', fontWeight:'800', textTransform:'uppercase', letterSpacing:'0.5px' };
const formBoxS = { background:'#f8fafc', padding:'20px', borderRadius:'20px', marginBottom:'20px', border:'1px solid #f1f5f9' };
const productRowS = { display:'flex', justifyContent:'space-between', padding:'14px', borderBottom:'1px solid #f1f5f9', alignItems:'center' };
const iconBtn = { border:'none', background:'none', cursor:'pointer', fontSize:'20px' };
const filterBar = { display:'flex', gap:'8px', marginBottom:'20px', overflowX:'auto', paddingBottom:'8px' };
const btnFilter = { background:'#f1f5f9', color:'#64748b', border:'none', padding:'10px 18px', borderRadius:'12px', cursor:'pointer', fontWeight:'600', whiteSpace:'nowrap' };
const btnFilterActive = { ...btnFilter, background:'#059669', color:'white' };
const searchResultsS = { background:'white', border:'1px solid #e2e8f0', borderRadius:'14px', marginBottom:'15px', boxShadow:'0 10px 15px -3px rgba(0,0,0,0.05)' };
const searchItemS = { padding:'14px', cursor:'pointer', borderBottom:'1px solid #f1f5f9' };
const ingRowS = { display:'flex', justifyContent:'space-between', padding:'10px 0', alignItems:'center' };
const recipeListItem = { padding:'18px', borderBottom:'1px solid #f1f5f9', cursor:'pointer', display:'flex', justifyContent:'space-between', transition:'background 0.2s', ':hover': {background:'#f8fafc'} };