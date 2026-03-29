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
  const [checkedItems, setCheckedItems] = useState({});
  const [manualShoppingList, setManualShoppingList] = useState([]);

  const [activeModal, setActiveModal] = useState(null); 
  const [selectedCell, setSelectedCell] = useState(null);
  const [viewingRecipe, setViewingRecipe] = useState(null);
  const [viewMode, setViewMode] = useState('desc');
  const [filterCategory, setFilterCategory] = useState(''); 
  const [recipeListCategory, setRecipeListCategory] = useState('Obiad');

  const [newProd, setNewProd] = useState({ id: null, name: '', price: '', amount: '', unit: 'g' });
  const [newRecipe, setNewRecipe] = useState({ id: null, name: '', category: 'Obiad', instructions: '', steps: [], ingredients: [], image_url: '' });
  const [searchQuery, setSearchQuery] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [uploading, setUploading] = useState(false);

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

  // --- LOGIKA UPLOADA ZDJĘCIA ---
  const handleUploadImage = async (e) => {
    try {
      setUploading(true);
      if (!e.target.files || e.target.files.length === 0) return;
      const file = e.target.files[0];
      const fileExt = file.name.split('.').pop();
      const fileName = `${Math.random()}.${fileExt}`;
      const { error: uploadError } = await supabase.storage.from('recipe-images').upload(fileName, file);
      if (uploadError) throw uploadError;
      const { data: { publicUrl } } = supabase.storage.from('recipe-images').getPublicUrl(fileName);
      setNewRecipe({ ...newRecipe, image_url: publicUrl });
    } catch (error) {
      alert('Błąd przesyłania zdjęcia! Upewnij się, że masz publiczny bucket "recipe-images".');
    } finally {
      setUploading(false);
    }
  };

  const weekDates = useMemo(() => {
    const now = new Date();
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1) + (weekOffset * 7);
    return DAYS.map((name, i) => {
      const d = new Date(new Date().setDate(diff + i));
      return { name, fullDate: d.toISOString().split('T')[0], displayDate: d.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit' }) };
    });
  }, [weekOffset]);

  // --- ANALITYKA ---
  const advancedStats = useMemo(() => {
    const monthlySpending = {};
    const recipeCounts = {};
    const ingredientUsage = {};
    mealPlan.forEach(meal => {
      const recipe = recipes.find(r => r.id === meal.recipe_id);
      if (!recipe) return;
      const month = meal.date.substring(0, 7);
      monthlySpending[month] = (monthlySpending[month] || 0) + parseFloat(recipe.total_cost);
      recipeCounts[recipe.name] = (recipeCounts[recipe.name] || 0) + 1;
      recipe.recipe_ingredients?.forEach(ri => {
        const pName = ri.products?.name;
        if (pName) {
          if (!ingredientUsage[pName]) ingredientUsage[pName] = { amount: 0, cost: 0 };
          const cost = ri.products.price_per_unit * ri.amount;
          ingredientUsage[pName].amount += parseFloat(ri.amount);
          ingredientUsage[pName].cost += cost;
        }
      });
    });
    return {
      monthly: Object.entries(monthlySpending).sort().reverse(),
      topRecipes: Object.entries(recipeCounts).sort((a,b) => b[1] - a[1]).slice(0, 5),
      topIngredients: Object.entries(ingredientUsage).sort((a,b) => b[1].cost - a[1].cost).slice(0, 5)
    };
  }, [mealPlan, recipes]);

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
              if (!shopping[p.id]) shopping[p.id] = { id: p.id, name: p.name, amount: 0, unit: p.unit, pricePerUnit: p.price_per_unit };
              shopping[p.id].amount += parseFloat(ri.amount || 0);
            }
          });
        }
      });
      daily[d.fullDate] = dCost.toFixed(2);
      totalWeekly += dCost;
    });
    manualShoppingList.forEach(item => {
      if (!shopping[item.id]) shopping[item.id] = { id: item.id, name: item.name, amount: 0, unit: item.unit, pricePerUnit: item.price_per_unit };
      shopping[item.id].amount += parseFloat(item.amount || 0);
      totalWeekly += (item.pricePerUnit * item.amount);
    });
    return { shoppingList: Object.values(shopping).map(it => ({...it, cost: (it.pricePerUnit * it.amount).toFixed(2)})), daily, totalWeekly: totalWeekly.toFixed(2) };
  }, [weekDates, mealPlan, recipes, manualShoppingList]);

  const toggleCheck = (id) => setCheckedItems(prev => ({ ...prev, [id]: !prev[id] }));

  const handleSaveProduct = async () => {
    const pPerU = parseFloat(newProd.price) / parseFloat(newProd.amount);
    const d = { name: newProd.name, price_per_unit: pPerU, unit: newProd.unit, last_input_quantity: parseFloat(newProd.amount) };
    if (newProd.id) await supabase.from('products').update(d).eq('id', newProd.id);
    else await supabase.from('products').insert([d]);
    setNewProd({ id: null, name: '', price: '', amount: '', unit: 'g' });
    fetchData();
  };

  const deleteProduct = async (id) => {
    if (!confirm("Usunąć produkt?")) return;
    await supabase.from('products').delete().eq('id', id);
    fetchData();
  };

  const handleSaveRecipe = async () => {
    const calc = (ing) => (parseFloat(ing.price_per_unit || ing.products?.price_per_unit || 0) * parseFloat(ing.amount || 0));
    const tCost = newRecipe.ingredients.reduce((s, i) => s + calc(i), 0).toFixed(2);
    const rData = { name: newRecipe.name, category: newRecipe.category, total_cost: tCost, instructions: newRecipe.instructions, steps: newRecipe.steps, image_url: newRecipe.image_url };
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
    setNewRecipe({ id: null, name: '', category: 'Obiad', instructions: '', steps: [], ingredients: [], image_url: '' });
    setActiveModal(null);
    fetchData();
  };

  const deleteRecipe = async (id) => {
    if (!confirm("Usunąć przepis?")) return;
    await supabase.from('recipes').delete().eq('id', id);
    fetchData();
  };

  const addToManualList = (item, type = 'product') => {
    if (type === 'product') {
      setManualShoppingList([...manualShoppingList, { ...item, amount: item.last_input_quantity || 1, pricePerUnit: item.price_per_unit }]);
    } else {
      const newItems = item.recipe_ingredients.map(ri => ({ ...ri.products, id: ri.product_id, amount: ri.amount, pricePerUnit: ri.products.price_per_unit }));
      setManualShoppingList([...manualShoppingList, ...newItems]);
    }
    setActiveModal(null);
  };

  const filteredProducts = products.filter(p => p.name.toLowerCase().includes(searchQuery.toLowerCase()));

  if (loading) return <div style={loadingStyle}>🍳 Rozgrzewanie kuchni...</div>;
  if (!session) return <LoginView />;

  return (
    <div style={appContainer}>
      <header style={isMobile ? headerMobile : headerStyle}>
        <div><h1 style={{margin:0, color:'#059669'}}>🥗 Jedzonko Planer</h1><small style={{color:'#64748b'}}>{weekDates[0].displayDate} - {weekDates[6].displayDate}</small></div>
        <div style={navButtons}>
          <button onClick={() => setWeekOffset(prev => prev - 1)} style={btnSec}>⬅</button>
          <button onClick={() => setWeekOffset(0)} style={weekOffset === 0 ? btnTodayActive : btnSec}>Dziś</button>
          <button onClick={() => setWeekOffset(prev => prev + 1)} style={btnSec}>➡</button>
          <button onClick={() => setActiveModal('stats')} style={btnStats}>📈 Analiza</button>
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
                const bgImg = m?.recipes?.image_url ? `linear-gradient(rgba(0,0,0,0.5), rgba(0,0,0,0.5)), url(${m.recipes.image_url})` : 'white';
                return (
                  <div key={`${day.fullDate}-${type}`} 
                       style={m ? {...cellStyleActive, backgroundImage: bgImg, backgroundSize: 'cover', backgroundPosition: 'center', color: m.recipes.image_url ? 'white' : 'inherit'} : cellStyle} 
                       onClick={() => { if(!m){setSelectedCell({date:day.fullDate, type}); setFilterCategory(type); setActiveModal('cell');} }}>
                    {isMobile && <span style={{...mobileMealTag, color: m?.recipes?.image_url ? '#fff' : '#94a3b8'}}>{type}</span>}
                    {m ? (
                      <div style={mealContent}>
                        <div style={mealNameS}>{m.recipes.name}</div>
                        <button style={btnViewS} onClick={(e)=>{e.stopPropagation(); setViewingRecipe(m.recipes); setViewMode('desc'); setActiveModal('view-recipe');}}>Pokaż</button>
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
            <h3 style={{marginTop:0, color:'#059669'}}>💰 Koszty</h3>
            {weekDates.map(d => <div key={d.fullDate} style={sideRow}><span>{d.name}</span><b>{stats.daily[d.fullDate]} zł</b></div>)}
            <div style={{...sideRow, border:'none', marginTop:'15px', fontSize:'18px'}}><span>Suma tyg.:</span><b style={{color:'#059669'}}>{stats.totalWeekly} zł</b></div>
          </div>
        )}
      </div>

      <div style={shoppingPanel}>
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom: '15px'}}>
          <h3 style={{color:'#059669', margin:0}}>🛒 Lista zakupów</h3>
          <div style={{display:'flex', gap:'5px'}}>
            <button style={btnPrimSmall} onClick={() => setActiveModal('shopping-add')}>+ Dodaj</button>
            <button style={{...btnSec, padding:'5px 15px', fontSize:'12px'}} onClick={() => {setCheckedItems({}); setManualShoppingList([])}}>Reset listy</button>
          </div>
        </div>
        <div style={shoppingGrid}>
          {stats.shoppingList.map(i => (
            <div key={i.id} onClick={() => toggleCheck(i.id)} style={{...shoppingItem, opacity: checkedItems[i.id] ? 0.5 : 1, border: checkedItems[i.id] ? '1px solid #059669' : '1px solid #f3f4f6', cursor: 'pointer'}}>
              <div style={{display:'flex', gap:'10px', alignItems:'center'}}>
                <div style={{width:'18px', height:'18px', border:'2px solid #059669', borderRadius:'4px', background: checkedItems[i.id] ? '#059669' : 'transparent', display:'flex', justifyContent:'center', alignItems:'center', color:'white', fontSize:'12px'}}>{checkedItems[i.id] && '✓'}</div>
                <div style={{textDecoration: checkedItems[i.id] ? 'line-through' : 'none'}}>
                  <b>{i.name}</b><br/><small>{i.amount} {i.unit}</small>
                </div>
              </div>
              <div style={{fontWeight:'bold', color:'#059669'}}>{i.cost} zł</div>
            </div>
          ))}
        </div>
      </div>

      {/* MODAL: ANALIZA */}
      {activeModal === 'stats' && (
        <Modal title="📈 Twoje Wydatki" onClose={() => setActiveModal(null)} isMobile={isMobile}>
          <div style={{maxHeight:'70vh', overflowY:'auto'}}>
            <div style={statSection}>
              <h4>💳 Wydatki miesięczne</h4>
              {advancedStats.monthly.map(([month, val]) => <div key={month} style={sideRow}><span>{month}</span><b style={{color:'#059669'}}>{val.toFixed(2)} zł</b></div>)}
            </div>
            <div style={statSection}>
              <h4>⭐ Najczęstsze dania</h4>
              {advancedStats.topRecipes.map(([name, count]) => <div key={name} style={sideRow}><span>{name}</span><b>{count}x</b></div>)}
            </div>
            <div style={statSection}>
              <h4>💸 Najdroższe składniki</h4>
              {advancedStats.topIngredients.map(([name, data]) => <div key={name} style={sideRow}><span>{name}</span><b style={{color:'#ef4444'}}>{data.cost.toFixed(2)} zł</b></div>)}
            </div>
          </div>
        </Modal>
      )}

      {/* MODAL: PRZEPISY */}
      {activeModal === 'recipe' && (
        <Modal title="👨‍🍳 Przepisy" onClose={() => setActiveModal(null)} isMobile={isMobile}>
          <div style={{maxHeight:'75vh', overflowY:'auto'}}>
            <div style={formBoxS}>
              <input style={inputS} placeholder="Nazwa dania" value={newRecipe.name} onChange={e => setNewRecipe({...newRecipe, name: e.target.value})} />
              <div style={{marginBottom:'10px'}}>
                <label style={uploadLabelS}>
                  {uploading ? '⌛ Wysyłanie...' : '📷 Dodaj zdjęcie (Aparat/Galeria)'}
                  <input type="file" accept="image/*" capture="environment" onChange={handleUploadImage} style={{display:'none'}} disabled={uploading} />
                </label>
                {newRecipe.image_url && <img src={newRecipe.image_url} style={{width:'100%', height:'120px', objectFit:'cover', borderRadius:'10px', marginTop:'10px'}} />}
              </div>
              <select style={inputS} value={newRecipe.category} onChange={e => setNewRecipe({...newRecipe, category: e.target.value})}>{MEAL_TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select>
              <textarea style={{...inputS, height:'60px'}} placeholder="Opis..." value={newRecipe.instructions} onChange={e => setNewRecipe({...newRecipe, instructions: e.target.value})} />
              <div>
                <label style={{fontWeight:'bold', fontSize:'14px'}}>Kroki:</label>
                {newRecipe.steps.map((step, idx) => (
                  <div key={idx} style={{display:'flex', gap:'5px', marginTop:'5px'}}>
                    <input style={inputS} value={step} onChange={e => { const s = [...newRecipe.steps]; s[idx] = e.target.value; setNewRecipe({...newRecipe, steps: s}); }} />
                    <button onClick={() => setNewRecipe({...newRecipe, steps: newRecipe.steps.filter((_, i) => i !== idx)})} style={{color:'red', border:'none', background:'none'}}>✕</button>
                  </div>
                ))}
                <button style={{...btnSec, width:'100%', padding:'5px', marginTop:'5px'}} onClick={() => setNewRecipe({...newRecipe, steps: [...newRecipe.steps, '']})}>+ Dodaj krok</button>
              </div>
              <div style={{position:'relative', marginTop:'10px'}}>
                <input style={inputS} placeholder="🔍 Składnik..." value={searchQuery} onFocus={() => setShowDropdown(true)} onBlur={() => setTimeout(() => setShowDropdown(false), 200)} onChange={e => setSearchQuery(e.target.value)} />
                {showDropdown && filteredProducts.length > 0 && (
                  <div style={searchResultsS}>{filteredProducts.map(p => <div key={p.id} style={searchItemS} onClick={() => { setNewRecipe({...newRecipe, ingredients: [...newRecipe.ingredients, {...p, amount: 100}]}); setSearchQuery(''); }}>{p.name} ({p.unit})</div>)}</div>
                )}
              </div>
              {newRecipe.ingredients.map((ing, idx) => (
                <div key={idx} style={ingRowS}>
                  <small>{ing.name}</small>
                  <div style={{display:'flex', alignItems:'center', gap:'5px'}}>
                    <input type="number" style={{width:'60px'}} value={ing.amount} onChange={e => {const c = [...newRecipe.ingredients]; c[idx].amount = e.target.value; setNewRecipe({...newRecipe, ingredients: c});}} /> <span>{ing.unit}</span>
                    <button onClick={() => setNewRecipe({...newRecipe, ingredients: newRecipe.ingredients.filter((_, i) => i !== idx)})} style={{color:'red', border:'none', background:'none'}}>✕</button>
                  </div>
                </div>
              ))}
              <button style={{...btnSuccessFull, marginTop:'10px'}} onClick={handleSaveRecipe}>Zapisz</button>
            </div>
            <div style={filterBar}>{MEAL_TYPES.map(cat => <button key={cat} onClick={() => setRecipeListCategory(cat)} style={recipeListCategory === cat ? btnFilterActive : btnFilter}>{cat}</button>)}</div>
            {recipes.filter(r => r.category === recipeListCategory).map(r => (
              <div key={r.id} style={productRowS}>
                <span style={{cursor:'pointer', flex:1}} onClick={() => {setNewRecipe({id:r.id, name:r.name, category:r.category, instructions:r.instructions, steps: r.steps || [], ingredients: r.recipe_ingredients.map(ri => ({...ri.products, amount: ri.amount, product_id: ri.product_id})), image_url: r.image_url})}}>{r.name}</span>
                <button onClick={() => deleteRecipe(r.id)} style={iconBtn}>🗑️</button>
              </div>
            ))}
          </div>
        </Modal>
      )}

      {/* MODAL: DODAWANIE DO ZAKUPÓW */}
      {activeModal === 'shopping-add' && (
        <Modal title="🛒 Dodaj do listy" onClose={() => setActiveModal(null)} isMobile={isMobile}>
          <h4>Produkty:</h4>
          <div style={{maxHeight:'200px', overflowY:'auto', marginBottom:'20px'}}>
            {products.map(p => <div key={p.id} style={productRowS} onClick={() => addToManualList(p, 'product')}><span>{p.name}</span> <button style={btnViewS}>+</button></div>)}
          </div>
          <h4>Z przepisów:</h4>
          <div style={{maxHeight:'200px', overflowY:'auto'}}>
            {recipes.map(r => <div key={r.id} style={productRowS} onClick={() => addToManualList(r, 'recipe')}><span>{r.name}</span> <button style={btnViewS}>+ Składniki</button></div>)}
          </div>
        </Modal>
      )}

      {/* MODAL: PRODUKTY */}
      {activeModal === 'product' && (
        <Modal title="📦 Produkty" onClose={() => setActiveModal(null)} isMobile={isMobile}>
          <div style={formBoxS}>
            <input style={inputS} placeholder="Nazwa" value={newProd.name} onChange={e => setNewProd({...newProd, name: e.target.value})} />
            <div style={{display:'flex', gap:'5px'}}><input style={inputS} type="number" placeholder="Cena" value={newProd.price} onChange={e => setNewProd({...newProd, price: e.target.value})} /><input style={inputS} type="number" placeholder="Ilość" value={newProd.amount} onChange={e => setNewProd({...newProd, amount: e.target.value})} /><select style={inputS} value={newProd.unit} onChange={e => setNewProd({...newProd, unit: e.target.value})}><option value="g">g</option><option value="ml">ml</option><option value="szt">szt</option></select></div>
            <button style={btnSuccessFull} onClick={handleSaveProduct}>Zapisz</button>
          </div>
          <div style={{maxHeight:'250px', overflowY:'auto'}}>
            {products.map(p => (
              <div key={p.id} style={productRowS}>
                <span style={{cursor:'pointer', flex:1}} onClick={() => setNewProd({id:p.id, name:p.name, price:(p.price_per_unit*(p.last_input_quantity||1)).toFixed(2), amount:p.last_input_quantity||1, unit:p.unit})}><b>{p.name}</b> ({p.price_per_unit.toFixed(2)})</span>
                <button onClick={() => deleteProduct(p.id)} style={iconBtn}>🗑️</button>
              </div>
            ))}
          </div>
        </Modal>
      )}

      {/* MODAL: WIDOK PRZEPISU */}
      {activeModal === 'view-recipe' && viewingRecipe && (
        <Modal title={viewingRecipe.name} onClose={() => setActiveModal(null)} isMobile={isMobile}>
          <div style={{display:'flex', gap:'10px', marginBottom:'15px'}}>
            <button style={viewMode === 'desc' ? btnFilterActive : btnFilter} onClick={() => setViewMode('desc')}>Opis</button>
            <button style={viewMode === 'steps' ? btnFilterActive : btnFilter} onClick={() => setViewMode('steps')}>Kroki ({viewingRecipe.steps?.length || 0})</button>
          </div>
          {viewingRecipe.image_url && <img src={viewingRecipe.image_url} style={{width:'100%', height:'220px', objectFit:'cover', borderRadius:'15px', marginBottom:'15px'}} />}
          <div style={{maxHeight:'45vh', overflowY:'auto'}}>
            {viewMode === 'desc' ? <p style={{whiteSpace:'pre-wrap', background:'#f8fafc', padding:'15px', borderRadius:'10px'}}>{viewingRecipe.instructions || "Brak opisu."}</p> : 
            viewingRecipe.steps?.map((s, i) => <div key={i} style={stepItemS}><b>Krok {i+1}</b><br/>{s}</div>)}
          </div>
        </Modal>
      )}

      {/* MODAL: WYBÓR DO KALENDARZA */}
      {activeModal === 'cell' && (
        <Modal title="Wybierz posiłek" onClose={() => setActiveModal(null)} isMobile={isMobile}>
          <div style={filterBar}>{["Wszystkie", ...MEAL_TYPES].map(cat => <button key={cat} onClick={() => setFilterCategory(cat === "Wszystkie" ? "" : cat)} style={filterCategory === (cat === "Wszystkie" ? "" : cat) ? btnFilterActive : btnFilter}>{cat}</button>)}</div>
          <div style={{maxHeight:'300px', overflowY:'auto'}}>{recipes.filter(r => !filterCategory || r.category === filterCategory).map(r => <div key={r.id} style={recipeListItem} onClick={async () => { await supabase.from('meal_plan').insert([{ date: selectedCell.date, meal_type: selectedCell.type, recipe_id: r.id }]); setActiveModal(null); fetchData(); }}><span>{r.name}</span> <b>{r.total_cost} zł</b></div>)}</div>
        </Modal>
      )}
    </div>
  );
}

// --- LOGIN & MODAL HELPERS ---
function LoginView() {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const handleLogin = async (e) => { e.preventDefault(); const { error } = await supabase.auth.signInWithPassword({ email, password }); if (error) alert(error.message); };
  return (<div style={loginOverlay}><form onSubmit={handleLogin} style={loginForm}><h2>Jedzonko P</h2><input style={inputS} type="email" placeholder="Email" onChange={e => setEmail(e.target.value)} /><input style={inputS} type="password" placeholder="Hasło" onChange={e => setPassword(e.target.value)} /><button style={btnSuccessFull}>Zaloguj</button></form></div>);
}

function Modal({ title, children, onClose, isMobile }) {
  const mS = { background: 'white', padding: isMobile ? '15px' : '25px', borderRadius: '20px', width: isMobile ? '90%' : '550px', boxShadow: '0 20px 50px rgba(0,0,0,0.15)', zIndex: 1100, position: 'relative' };
  return (<div style={overlayS}><div style={mS}><div style={{display:'flex', justifyContent:'space-between', marginBottom:'15px', alignItems:'center'}}><h3 style={{margin:0}}>{title}</h3><button onClick={onClose} style={{border:'none', background:'none', fontSize:'28px', cursor:'pointer'}}>✕</button></div>{children}</div></div>);
}

// --- STYLE ---
const appContainer = { padding:'20px', backgroundColor:'#f3f4f6', minHeight:'100vh', fontFamily:'sans-serif' };
const headerStyle = { display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'20px', background:'white', padding:'20px', borderRadius:'15px', boxShadow:'0 2px 4px rgba(0,0,0,0.05)' };
const headerMobile = { display:'flex', flexDirection:'column', gap:'15px', marginBottom:'20px', background:'white', padding:'20px', borderRadius:'15px', textAlign:'center' };
const navButtons = { display:'flex', gap:'8px', flexWrap:'wrap', justifyContent:'center' };
const layoutGrid = { display: 'grid', gridTemplateColumns: window.innerWidth < 900 ? '1fr' : '1fr 280px', gap: '20px' };
const sidePanel = { background:'white', padding:'20px', borderRadius:'15px', height:'fit-content', boxShadow:'0 2px 4px rgba(0,0,0,0.05)' };
const sideRow = { display:'flex', justifyContent:'space-between', padding:'10px 0', borderBottom:'1px solid #f3f4f6' };
const gridStyle = { display:'grid', gridTemplateColumns:'110px repeat(5, 1fr)', gap:'10px' };
const mobileStack = { display:'flex', flexDirection:'column', gap:'12px' };
const dayCell = { background:'white', padding:'12px', borderRadius:'12px', textAlign:'center', borderLeft:'5px solid #059669' };
const mobileDayLabel = { background:'#059669', color:'white', padding:'12px', borderRadius:'12px', textAlign:'center', fontWeight:'bold', display:'flex', justifyContent:'space-between' };
const mealHeader = { textAlign:'center', fontWeight:'bold', color:'#64748b' };
const cellStyle = { minHeight:'100px', background:'white', borderRadius:'12px', border:'1px solid #e5e7eb', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', position:'relative', overflow:'hidden' };
const cellStyleActive = { ...cellStyle, border:'2px solid #059669' };
const mealContent = { width:'100%', textAlign:'center', padding:'10px', zIndex: 2 };
const mealNameS = { fontWeight:'bold', fontSize:'13px' };
const btnViewS = { background:'#f3f4f6', border:'none', padding:'5px 12px', borderRadius:'6px', fontSize:'10px', cursor:'pointer', marginTop:'8px' };
const btnDeleteSmall = { position:'absolute', top:'5px', right:'5px', background:'#fee2e2', color:'#ef4444', border:'none', borderRadius:'50%', width:'22px', height:'22px' };
const shoppingPanel = { marginTop:'30px', background:'white', padding:'25px', borderRadius:'15px', boxShadow:'0 2px 4px rgba(0,0,0,0.05)' };
const shoppingGrid = { display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(200px, 1fr))', gap:'15px' };
const shoppingItem = { background:'#f9fafb', padding:'15px', borderRadius:'12px', border:'1px solid #f3f4f6', display:'flex', justifyContent:'space-between', alignItems:'center' };
const inputS = { width:'100%', padding:'10px', marginBottom:'5px', borderRadius:'10px', border:'1px solid #d1d5db', boxSizing:'border-box' };
const btnPrim = { background:'#059669', color:'white', border:'none', padding:'10px 20px', borderRadius:'10px', fontWeight:'bold' };
const btnPrimSmall = { ...btnPrim, padding:'5px 15px', fontSize:'12px' };
const btnSec = { background:'#f3f4f6', color:'#374151', border:'none', padding:'10px 20px', borderRadius:'10px' };
const btnTodayActive = { ...btnSec, background:'#059669', color:'white', boxShadow:'0 0 10px rgba(5, 150, 105, 0.4)' };
const btnStats = { background:'#3182ce', color:'white', border:'none', padding:'10px 20px', borderRadius:'10px', fontWeight:'bold' };
const btnDanger = { background:'#ef4444', color:'white', border:'none', padding:'10px 20px', borderRadius:'10px' };
const btnSuccessFull = { background:'#059669', color:'white', border:'none', padding:'14px', borderRadius:'12px', width:'100%', cursor:'pointer', fontWeight:'bold' };
const btnFilter = { background:'#f3f4f6', color:'#6b7280', border:'none', padding:'8px 16px', borderRadius:'20px', cursor:'pointer' };
const btnFilterActive = { ...btnFilter, background:'#059669', color:'white' };
const filterBar = { display:'flex', gap:'5px', marginBottom:'15px', overflowX:'auto' };
const productRowS = { display:'flex', justifyContent:'space-between', padding:'10px', borderBottom:'1px solid #f3f4f6', alignItems:'center' };
const recipeListItem = { padding:'15px', borderBottom:'1px solid #f3f4f6', cursor:'pointer', display:'flex', justifyContent:'space-between' };
const searchResultsS = { position:'absolute', top:'100%', left:0, right:0, zIndex:10, background:'white', border:'1px solid #e5e7eb', borderRadius:'10px', boxShadow:'0 4px 6px rgba(0,0,0,0.1)', maxHeight:'200px', overflowY:'auto' };
const searchItemS = { padding:'12px', cursor:'pointer', borderBottom:'1px solid #f3f4f6' };
const ingRowS = { display:'flex', justifyContent:'space-between', padding:'8px 0', alignItems:'center', borderBottom:'1px solid #f9fafb' };
const iconBtn = { border:'none', background:'none', cursor:'pointer', fontSize:'18px' };
const overlayS = { position:'fixed', top:0, left:0, width:'100%', height:'100%', background:'rgba(0,0,0,0.4)', display:'flex', justifyContent:'center', alignItems:'center', zIndex:1000 };
const loginOverlay = { height:'100vh', display:'flex', justifyContent:'center', alignItems:'center', background:'#f3f4f6' };
const loginForm = { background:'white', padding:'40px', borderRadius:'25px', width:'320px', boxShadow:'0 10px 25px rgba(0,0,0,0.1)' };
const loadingStyle = { display:'flex', justifyContent:'center', alignItems:'center', height:'100vh', color:'#059669', fontSize:'20px' };
const mobileMealTag = { position:'absolute', top:'5px', left:'8px', fontSize:'9px', color:'#94a3b8', fontWeight:'bold' };
const formBoxS = { background:'#f9fafb', padding:'15px', borderRadius:'15px', marginBottom:'20px', border:'1px solid #e5e7eb' };
const stepItemS = { padding:'15px', background:'#f0fdf4', borderRadius:'10px', borderLeft:'4px solid #059669', marginBottom:'10px' };
const uploadLabelS = { display:'block', background:'#f0fdf4', border:'2px dashed #059669', color:'#059669', padding:'15px', borderRadius:'10px', textAlign:'center', cursor:'pointer', fontWeight:'bold' };
const statSection = { marginBottom:'25px', padding:'15px', background:'#f8fafc', borderRadius:'15px', border:'1px solid #e2e8f0' };