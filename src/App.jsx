import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY);

const MEAL_TYPES = ['Śniadanie', 'Lunch', 'Obiad', 'Podwieczorek', 'Kolacja'];
const DAYS = [
  'Poniedziałek',
  'Wtorek',
  'Środa',
  'Czwartek',
  'Piątek',
  'Sobota',
  'Niedziela',
];

export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [products, setProducts] = useState([]);
  const [recipes, setRecipes] = useState([]);
  const [mealPlan, setMealPlan] = useState([]);
  const [weekOffset, setWeekOffset] = useState(0);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 900);

  // Stan dla ręcznie dodanych rzeczy do koszyka
  const [manualCart, setManualCart] = useState([]);
  const [checkedItems, setCheckedItems] = useState({});

  const [activeModal, setActiveModal] = useState(null);
  const [selectedCell, setSelectedCell] = useState(null);
  const [viewingRecipe, setViewingRecipe] = useState(null);
  const [viewMode, setViewMode] = useState('desc');
  const [filterCategory, setFilterCategory] = useState('');
  const [recipeListCategory, setRecipeListCategory] = useState('Obiad');

  const [newProd, setNewProd] = useState({
    id: null,
    name: '',
    price: '',
    amount: '',
    unit: 'g',
  });
  const [newRecipe, setNewRecipe] = useState({
    id: null,
    name: '',
    category: 'Obiad',
    instructions: '',
    image_url: '',
    steps: [],
    ingredients: [],
    is_favorite: false,
  });
  const [searchQuery, setSearchQuery] = useState('');

  const handleLogout = useCallback(() => supabase.auth.signOut(), []);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 900);
    window.addEventListener('resize', handleResize);
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) =>
      setSession(session)
    );
    return () => {
      subscription.unsubscribe();
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  useEffect(() => {
    if (session) fetchData();
  }, [session, weekOffset]);

  async function fetchData() {
    const { data: prods } = await supabase
      .from('products')
      .select('*')
      .order('name');
    const { data: recs } = await supabase
      .from('recipes')
      .select('*, recipe_ingredients(*, products(*))')
      .order('name');
    const { data: plan } = await supabase
      .from('meal_plan')
      .select('*, recipes(*)');
    setProducts(prods || []);
    setRecipes(recs || []);
    setMealPlan(plan || []);
  }

  const weekDates = useMemo(() => {
    const now = new Date();
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1) + weekOffset * 7;
    return DAYS.map((name, i) => {
      const d = new Date(new Date().setDate(diff + i));
      return {
        name,
        fullDate: d.toISOString().split('T')[0],
        displayDate: d.toLocaleDateString('pl-PL', {
          day: '2-digit',
          month: '2-digit',
        }),
      };
    });
  }, [weekOffset]);

  // --- LOGIKA KOSZYKA (DYNAMICZNA Z TYGODNIA + RĘCZNA) ---
  const finalShoppingList = useMemo(() => {
    const combined = {};
    // 1. Składniki z planu na tydzień
    weekDates.forEach((d) => {
      const dayMeals = mealPlan.filter((m) => m.date === d.fullDate);
      dayMeals.forEach((m) => {
        const r = recipes.find((rec) => rec.id === m.recipe_id);
        r?.recipe_ingredients?.forEach((ri) => {
          const p = ri.products;
          if (!p) return;
          const key = `${p.name}-${p.unit}`;
          if (!combined[key])
            combined[key] = {
              id: p.id,
              name: p.name,
              amount: 0,
              unit: p.unit,
              cost: 0,
              pricePU: p.price_per_unit,
            };
          combined[key].amount += parseFloat(ri.amount || 0);
        });
      });
    });
    // 2. Składniki dodane ręcznie
    manualCart.forEach((item) => {
      const key = `${item.name}-${item.unit}`;
      if (!combined[key])
        combined[key] = {
          id: item.id,
          name: item.name,
          amount: 0,
          unit: item.unit,
          cost: 0,
          pricePU: item.pricePU,
        };
      combined[key].amount += parseFloat(item.amount);
    });
    return Object.values(combined).map((it) => ({
      ...it,
      cost: (it.pricePU * it.amount).toFixed(2),
    }));
  }, [weekDates, mealPlan, recipes, manualCart]);

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () =>
        setNewRecipe({ ...newRecipe, image_url: reader.result });
      reader.readAsDataURL(file);
    }
  };

  const handleSaveProduct = async () => {
    const pPerU = parseFloat(newProd.price) / parseFloat(newProd.amount);
    const d = {
      name: newProd.name,
      price_per_unit: pPerU,
      unit: newProd.unit,
      last_input_quantity: parseFloat(newProd.amount),
    };
    if (newProd.id)
      await supabase.from('products').update(d).eq('id', newProd.id);
    else await supabase.from('products').insert([d]);
    setNewProd({ id: null, name: '', price: '', amount: '', unit: 'g' });
    fetchData();
  };

  const handleSaveRecipe = async () => {
    const calc = (ing) =>
      parseFloat(ing.price_per_unit || ing.products?.price_per_unit || 0) *
      parseFloat(ing.amount || 0);
    const tCost = newRecipe.ingredients
      .reduce((s, i) => s + calc(i), 0)
      .toFixed(2);
    const rData = {
      name: newRecipe.name,
      category: newRecipe.category,
      total_cost: tCost,
      instructions: newRecipe.instructions,
      steps: newRecipe.steps,
      image_url: newRecipe.image_url,
      is_favorite: newRecipe.is_favorite,
    };
    let rId = newRecipe.id;
    if (newRecipe.id) {
      await supabase.from('recipes').update(rData).eq('id', newRecipe.id);
      await supabase
        .from('recipe_ingredients')
        .delete()
        .eq('recipe_id', newRecipe.id);
    } else {
      const { data } = await supabase
        .from('recipes')
        .insert([rData])
        .select()
        .single();
      rId = data.id;
    }
    const ings = newRecipe.ingredients.map((ing) => ({
      recipe_id: rId,
      product_id: ing.id || ing.product_id,
      amount: ing.amount,
    }));
    await supabase.from('recipe_ingredients').insert(ings);
    setNewRecipe({
      id: null,
      name: '',
      category: 'Obiad',
      instructions: '',
      image_url: '',
      steps: [],
      ingredients: [],
      is_favorite: false,
    });
    setActiveModal(null);
    fetchData();
  };

  if (loading)
    return <div style={loadingStyle}>🍳 Rozgrzewanie patelni...</div>;
  if (!session) return <LoginView />;

  return (
    <div style={appContainer}>
      <header style={isMobile ? headerMobile : headerStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
          <div style={logoCircleS}>🥗</div>
          <div>
            <h1 style={logoTitleS}>Jedzonko Planer</h1>
            <small style={{ color: '#64748b', fontWeight: 'bold' }}>
              {weekDates[0].displayDate} - {weekDates[6].displayDate}
            </small>
          </div>
        </div>
        <div style={navButtons}>
          <button onClick={() => setWeekOffset((p) => p - 1)} style={btnSec}>
            ⬅
          </button>
          <button
            onClick={() => setWeekOffset(0)}
            style={weekOffset === 0 ? btnTodayActive : btnSec}
          >
            Dziś
          </button>
          <button onClick={() => setWeekOffset((p) => p + 1)} style={btnSec}>
            ➡
          </button>
          <button onClick={() => setActiveModal('product')} style={btnSec}>
            📦 Produkty
          </button>
          <button onClick={() => setActiveModal('recipe')} style={btnPrim}>
            👨‍🍳 Przepisy
          </button>
          <button onClick={handleLogout} style={btnDanger}>
            Wyloguj
          </button>
        </div>
      </header>

      <div style={layoutGrid}>
        <div style={isMobile ? mobileStack : gridStyle}>
          {!isMobile && <div />}
          {!isMobile &&
            MEAL_TYPES.map((m) => (
              <div key={m} style={mealHeader}>
                {m}
              </div>
            ))}
          {weekDates.map((day) => (
            <React.Fragment key={day.fullDate}>
              <div style={isMobile ? mobileDayLabel : dayCell}>
                <b>{day.name}</b>
                <br />
                <small>{day.displayDate}</small>
              </div>
              {MEAL_TYPES.map((type) => {
                const m = mealPlan.find(
                  (p) => p.date === day.fullDate && p.meal_type === type
                );
                const bgImage = m?.recipes?.image_url
                  ? `linear-gradient(rgba(255,255,255,0.7), rgba(255,255,255,0.7)), url(${m.recipes.image_url})`
                  : 'white';
                return (
                  <div
                    key={`${day.fullDate}-${type}`}
                    style={{
                      ...(m ? cellStyleActive : cellStyle),
                      backgroundImage: bgImage,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                    }}
                    onClick={() => {
                      if (!m) {
                        setSelectedCell({ date: day.fullDate, type });
                        setFilterCategory(type);
                        setActiveModal('cell');
                      }
                    }}
                  >
                    {isMobile && <span style={mobileMealTag}>{type}</span>}
                    {m ? (
                      <div style={mealContent}>
                        <div style={mealNameS}>
                          {m.recipes.is_favorite && '❤️ '}
                          {m.recipes.name}
                        </div>
                        <div style={mealPriceS}>
                          {parseFloat(m.recipes.total_cost).toFixed(2)} zł
                        </div>
                        <div
                          style={{
                            display: 'flex',
                            gap: '5px',
                            justifyContent: 'center',
                            marginTop: '8px',
                          }}
                        >
                          <button
                            style={btnViewSmall}
                            onClick={(e) => {
                              e.stopPropagation();
                              setViewingRecipe(m.recipes);
                              setViewMode('desc');
                              setActiveModal('view-recipe');
                            }}
                          >
                            Pokaż
                          </button>
                          <button
                            style={btnDelSmall}
                            onClick={async (e) => {
                              e.stopPropagation();
                              if (confirm('Usunąć?')) {
                                await supabase
                                  .from('meal_plan')
                                  .delete()
                                  .eq('id', m.id);
                                fetchData();
                              }
                            }}
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    ) : (
                      <span style={{ opacity: 0.2, fontSize: '24px' }}>+</span>
                    )}
                  </div>
                );
              })}
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* POPRAWIONA LISTA ZAKUPÓW */}
      <div style={shoppingPanel}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '20px',
          }}
        >
          <h3 style={{ color: '#059669', margin: 0 }}>🛒 Lista zakupów</h3>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              style={btnPrimSmall}
              onClick={() => setActiveModal('add-to-cart')}
            >
              Dodaj +
            </button>
            <button
              style={{ ...btnSec, padding: '8px 16px', fontSize: '12px' }}
              onClick={() => {
                setManualCart([]);
                setCheckedItems({});
              }}
            >
              Reset
            </button>
          </div>
        </div>
        <div style={shoppingGrid}>
          {finalShoppingList.map((i) => {
            const isChecked = checkedItems[i.name];
            let dAmount = i.amount;
            let dUnit = i.unit;
            if ((i.unit === 'g' || i.unit === 'ml') && i.amount >= 1000) {
              dAmount = (i.amount / 1000).toFixed(2);
              dUnit = i.unit === 'g' ? 'kg' : 'l';
            }
            return (
              <div
                key={i.name}
                onClick={() =>
                  setCheckedItems((p) => ({ ...p, [i.name]: !p[i.name] }))
                }
                style={{
                  ...shoppingItem,
                  opacity: isChecked ? 0.5 : 1,
                  border: isChecked ? '1px solid #059669' : '1px solid #e2e8f0',
                  background: isChecked ? '#f0fdf4' : '#fff',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    gap: '12px',
                    alignItems: 'center',
                    flex: 1,
                  }}
                >
                  <div
                    style={{
                      width: '22px',
                      height: '22px',
                      border: '2px solid #059669',
                      borderRadius: '6px',
                      background: isChecked ? '#059669' : 'transparent',
                      color: 'white',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '14px',
                    }}
                  >
                    {isChecked && '✓'}
                  </div>
                  <div>
                    <div
                      style={{
                        fontWeight: '700',
                        fontSize: '14px',
                        textDecoration: isChecked ? 'line-through' : 'none',
                      }}
                    >
                      {i.name}
                    </div>
                    <div style={{ fontSize: '12px', color: '#64748b' }}>
                      {dAmount} {dUnit}
                    </div>
                  </div>
                </div>
                <b
                  style={{
                    color: isChecked ? '#94a3b8' : '#059669',
                    fontSize: '14px',
                  }}
                >
                  {i.cost} zł
                </b>
              </div>
            );
          })}
        </div>
      </div>

      {/* MODAL: DODAWANIE RĘCZNE DO KOSZYKA */}
      {activeModal === 'add-to-cart' && (
        <Modal
          title="🛒 Dodaj do listy"
          onClose={() => setActiveModal(null)}
          isMobile={isMobile}
        >
          <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>
            <h4 style={{ marginTop: 0 }}>Składniki z przepisu:</h4>
            {recipes.map((r) => (
              <div
                key={r.id}
                style={recipeListItem}
                onClick={() => {
                  const ings = r.recipe_ingredients.map((ri) => ({
                    id: ri.products.id,
                    name: ri.products.name,
                    amount: ri.amount,
                    unit: ri.products.unit,
                    pricePU: ri.products.price_per_unit,
                  }));
                  setManualCart((p) => [...p, ...ings]);
                  setActiveModal(null);
                }}
              >
                <span>{r.name}</span>{' '}
                <button style={btnCartAddSmall}>+ Wszystkie</button>
              </div>
            ))}
            <h4 style={{ marginTop: '20px' }}>Pojedynczy produkt:</h4>
            {products.map((p) => (
              <div
                key={p.id}
                style={productRowS}
                onClick={() => {
                  setManualCart((prev) => [
                    ...prev,
                    {
                      id: p.id,
                      name: p.name,
                      amount: p.last_input_quantity || 100,
                      unit: p.unit,
                      pricePU: p.price_per_unit,
                    },
                  ]);
                  setActiveModal(null);
                }}
              >
                <span>{p.name}</span>{' '}
                <button style={btnCartAddSmall}>Dodaj +</button>
              </div>
            ))}
          </div>
        </Modal>
      )}

      {/* MODAL: PRZEPISY (Z FOTO I KROKAMI) */}
      {activeModal === 'recipe' && (
        <Modal
          title="👨‍🍳 Zarządzanie"
          onClose={() => setActiveModal(null)}
          isMobile={isMobile}
        >
          <div style={{ maxHeight: '75vh', overflowY: 'auto' }}>
            <div style={formBoxS}>
              <input
                style={inputS}
                placeholder="Nazwa dania"
                value={newRecipe.name}
                onChange={(e) =>
                  setNewRecipe({ ...newRecipe, name: e.target.value })
                }
              />
              <div style={{ marginBottom: '15px' }}>
                <label style={fileLabelS}>
                  {newRecipe.image_url
                    ? '✅ Zdjęcie wybrane'
                    : '📷 Dodaj zdjęcie z galerii'}
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleFileUpload}
                    style={{ display: 'none' }}
                  />
                </label>
                {newRecipe.image_url && (
                  <img
                    src={newRecipe.image_url}
                    style={{
                      width: '100%',
                      height: '120px',
                      objectFit: 'cover',
                      borderRadius: '12px',
                      marginTop: '10px',
                    }}
                  />
                )}
              </div>
              <textarea
                style={inputS}
                placeholder="Opis ogólny..."
                value={newRecipe.instructions}
                onChange={(e) =>
                  setNewRecipe({ ...newRecipe, instructions: e.target.value })
                }
              />
              <div style={{ margin: '15px 0' }}>
                <label style={{ fontWeight: 'bold', fontSize: '14px' }}>
                  Kroki:
                </label>
                {newRecipe.steps.map((s, i) => (
                  <div
                    key={i}
                    style={{ display: 'flex', gap: '8px', marginTop: '8px' }}
                  >
                    <div style={stepCircleS}>{i + 1}</div>
                    <input
                      style={inputS}
                      value={s}
                      onChange={(e) => {
                        const c = [...newRecipe.steps];
                        c[i] = e.target.value;
                        setNewRecipe({ ...newRecipe, steps: c });
                      }}
                    />
                    <button
                      onClick={() =>
                        setNewRecipe({
                          ...newRecipe,
                          steps: newRecipe.steps.filter((_, idx) => idx !== i),
                        })
                      }
                      style={btnDelSmall}
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <button
                  style={{ ...btnSec, width: '100%', padding: '10px' }}
                  onClick={() =>
                    setNewRecipe({
                      ...newRecipe,
                      steps: [...newRecipe.steps, ''],
                    })
                  }
                >
                  + Dodaj krok
                </button>
              </div>
              <input
                style={inputS}
                placeholder="🔍 Składnik..."
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <div style={searchResultsS}>
                  {products
                    .filter((p) =>
                      p.name.toLowerCase().includes(searchQuery.toLowerCase())
                    )
                    .map((p) => (
                      <div
                        key={p.id}
                        style={searchItemS}
                        onClick={() => {
                          setNewRecipe({
                            ...newRecipe,
                            ingredients: [
                              ...newRecipe.ingredients,
                              { ...p, amount: 100 },
                            ],
                          });
                          setSearchQuery('');
                        }}
                      >
                        {p.name}
                      </div>
                    ))}
                </div>
              )}
              {newRecipe.ingredients.map((ing, idx) => (
                <div key={idx} style={ingRowS}>
                  <span>{ing.name}</span>
                  <button
                    onClick={() =>
                      setNewRecipe({
                        ...newRecipe,
                        ingredients: newRecipe.ingredients.filter(
                          (_, i) => i !== idx
                        ),
                      })
                    }
                    style={{ color: 'red', border: 'none', background: 'none' }}
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button style={btnSuccessFull} onClick={handleSaveRecipe}>
                Zapisz Przepis
              </button>
            </div>
            {recipes
              .filter((r) => r.category === recipeListCategory)
              .map((r) => (
                <div key={r.id} style={productRowS}>
                  <span>{r.name}</span>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      onClick={() =>
                        setNewRecipe({
                          ...r,
                          steps: r.steps || [],
                          ingredients: r.recipe_ingredients.map((ri) => ({
                            ...ri.products,
                            amount: ri.amount,
                            product_id: ri.product_id,
                          })),
                        })
                      }
                      style={iconBtn}
                    >
                      ✏️
                    </button>
                  </div>
                </div>
              ))}
          </div>
        </Modal>
      )}

      {/* MODAL: PRODUKTY (Z USUWANIEM) */}
      {activeModal === 'product' && (
        <Modal
          title="📦 Produkty"
          onClose={() => setActiveModal(null)}
          isMobile={isMobile}
        >
          <div style={formBoxS}>
            <input
              style={inputS}
              placeholder="Nazwa"
              value={newProd.name}
              onChange={(e) => setNewProd({ ...newProd, name: e.target.value })}
            />
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                style={inputS}
                type="number"
                placeholder="Cena"
                value={newProd.price}
                onChange={(e) =>
                  setNewProd({ ...newProd, price: e.target.value })
                }
              />
              <input
                style={inputS}
                type="number"
                placeholder="Ilość"
                value={newProd.amount}
                onChange={(e) =>
                  setNewProd({ ...newProd, amount: e.target.value })
                }
              />
              <select
                style={inputS}
                value={newProd.unit}
                onChange={(e) =>
                  setNewProd({ ...newProd, unit: e.target.value })
                }
              >
                <option value="g">g</option>
                <option value="ml">ml</option>
                <option value="szt">szt</option>
              </select>
            </div>
            <button style={btnSuccessFull} onClick={handleSaveProduct}>
              Zapisz
            </button>
          </div>
          <div style={{ maxHeight: '350px', overflowY: 'auto' }}>
            {products.map((p) => (
              <div key={p.id} style={productRowS}>
                <div>
                  <b>{p.name}</b>
                  <br />
                  <small>
                    {parseFloat(p.price_per_unit).toFixed(4)}/{p.unit}
                  </small>
                </div>
                <div style={{ display: 'flex', gap: '12px' }}>
                  <button
                    onClick={() =>
                      setNewProd({
                        id: p.id,
                        name: p.name,
                        price: (
                          p.price_per_unit * p.last_input_quantity
                        ).toFixed(2),
                        amount: p.last_input_quantity,
                        unit: p.unit,
                      })
                    }
                    style={iconBtn}
                  >
                    ✏️
                  </button>
                  <button
                    onClick={async () => {
                      if (confirm('Usunąć produkt?')) {
                        await supabase.from('products').delete().eq('id', p.id);
                        fetchData();
                      }
                    }}
                    style={{ ...iconBtn, color: '#ef4444' }}
                  >
                    🗑️
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Modal>
      )}

      {/* MODAL PODGLĄD */}
      {activeModal === 'view-recipe' && viewingRecipe && (
        <Modal
          title={viewingRecipe.name}
          onClose={() => setActiveModal(null)}
          isMobile={isMobile}
        >
          <div style={{ display: 'flex', gap: '10px', marginBottom: '15px' }}>
            <button
              style={viewMode === 'desc' ? btnFilterActive : btnFilter}
              onClick={() => setViewMode('desc')}
            >
              Opis
            </button>
            <button
              style={viewMode === 'steps' ? btnFilterActive : btnFilter}
              onClick={() => setViewMode('steps')}
            >
              Kroki
            </button>
          </div>
          <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>
            {viewMode === 'desc' ? (
              <p
                style={{
                  whiteSpace: 'pre-wrap',
                  background: '#f8fafc',
                  padding: '15px',
                  borderRadius: '10px',
                }}
              >
                {viewingRecipe.instructions}
              </p>
            ) : (
              viewingRecipe.steps?.map((s, i) => (
                <div key={i} style={stepItemS}>
                  <div style={stepCircleS}>{i + 1}</div>
                  <div style={{ flex: 1 }}>{s}</div>
                </div>
              ))
            )}
          </div>
        </Modal>
      )}

      {activeModal === 'cell' && (
        <Modal
          title="Dodaj do planu"
          onClose={() => setActiveModal(null)}
          isMobile={isMobile}
        >
          <div style={filterBar}>
            {['Wszystkie', ...MEAL_TYPES].map((cat) => (
              <button
                key={cat}
                onClick={() =>
                  setFilterCategory(cat === 'Wszystkie' ? '' : cat)
                }
                style={
                  filterCategory === (cat === 'Wszystkie' ? '' : cat)
                    ? btnFilterActive
                    : btnFilter
                }
              >
                {cat}
              </button>
            ))}
          </div>
          <div style={{ maxHeight: '350px', overflowY: 'auto' }}>
            {recipes
              .filter((r) => !filterCategory || r.category === filterCategory)
              .map((r) => (
                <div
                  key={r.id}
                  style={recipeListItem}
                  onClick={async () => {
                    await supabase.from('meal_plan').insert([
                      {
                        date: selectedCell.date,
                        meal_type: selectedCell.type,
                        recipe_id: r.id,
                      },
                    ]);
                    setActiveModal(null);
                    fetchData();
                  }}
                >
                  <span>{r.name}</span>{' '}
                  <b>{parseFloat(r.total_cost).toFixed(2)} zł</b>
                </div>
              ))}
          </div>
        </Modal>
      )}
    </div>
  );
}

// --- LOGIN ---
function LoginView() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const handleLogin = async (e) => {
    e.preventDefault();
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) alert(error.message);
  };
  return (
    <div style={loginOverlay}>
      <form onSubmit={handleLogin} style={loginForm}>
        <h2>🥗 Jedzonko Planer</h2>
        <input
          style={inputS}
          type="email"
          placeholder="Email"
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          style={inputS}
          type="password"
          placeholder="Hasło"
          onChange={(e) => setPassword(e.target.value)}
        />
        <button style={btnSuccessFull}>Zaloguj</button>
      </form>
    </div>
  );
}

function Modal({ title, children, onClose, isMobile }) {
  const mS = {
    background: 'white',
    padding: isMobile ? '20px' : '30px',
    borderRadius: '24px',
    width: isMobile ? '92%' : '580px',
    boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)',
    zIndex: 1100,
    position: 'relative',
  };
  return (
    <div style={overlayS} onClick={onClose}>
      <div style={mS} onClick={(e) => e.stopPropagation()}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginBottom: '15px',
            alignItems: 'center',
          }}
        >
          <h3>{title}</h3>
          <button
            onClick={onClose}
            style={{
              border: 'none',
              background: 'none',
              fontSize: '28px',
              cursor: 'pointer',
              color: '#94a3b8',
            }}
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// --- STYLES ---
const appContainer = {
  padding: '15px',
  backgroundColor: '#f8fafc',
  minHeight: '100vh',
  fontFamily: 'sans-serif',
};
const headerStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: '20px',
  background: 'white',
  padding: '15px 20px',
  borderRadius: '18px',
  boxShadow: '0 4px 6px rgba(0,0,0,0.05)',
};
const headerMobile = {
  ...headerStyle,
  flexDirection: 'column',
  gap: '15px',
  textAlign: 'center',
};
const logoTitleS = {
  margin: 0,
  color: '#059669',
  fontSize: '22px',
  fontWeight: '800',
};
const logoCircleS = {
  width: '45px',
  height: '45px',
  backgroundColor: '#ecfdf5',
  borderRadius: '12px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: '2px solid #059669',
  fontSize: '24px',
};
const navButtons = {
  display: 'flex',
  gap: '8px',
  flexWrap: 'wrap',
  justifyContent: 'center',
};
const btnTodayActive = {
  background: '#059669',
  color: 'white',
  border: 'none',
  padding: '10px 18px',
  borderRadius: '12px',
  fontWeight: 'bold',
};
const btnSec = {
  background: '#f1f5f9',
  color: '#475569',
  border: 'none',
  padding: '10px 18px',
  borderRadius: '12px',
  cursor: 'pointer',
  fontWeight: 'bold',
};
const btnPrim = {
  background: '#059669',
  color: 'white',
  border: 'none',
  padding: '10px 18px',
  borderRadius: '12px',
  fontWeight: '800',
  cursor: 'pointer',
};
const btnPrimSmall = { ...btnPrim, padding: '8px 16px', fontSize: '12px' };
const btnDanger = {
  background: '#fef2f2',
  color: '#ef4444',
  border: 'none',
  padding: '10px 18px',
  borderRadius: '12px',
  fontWeight: 'bold',
};
const gridStyle = {
  display: 'grid',
  gridTemplateColumns: '100px repeat(5, 1fr)',
  gap: '10px',
};
const layoutGrid = { display: 'grid', gridTemplateColumns: '1fr', gap: '20px' };
const mobileStack = { display: 'flex', flexDirection: 'column', gap: '12px' };
const dayCell = {
  background: 'white',
  padding: '12px',
  borderRadius: '15px',
  textAlign: 'center',
  borderLeft: '6px solid #059669',
  fontWeight: 'bold',
  boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
};
const mobileDayLabel = {
  background: '#059669',
  color: 'white',
  padding: '12px',
  borderRadius: '15px',
  fontWeight: 'bold',
};
const mealHeader = {
  textAlign: 'center',
  fontWeight: '800',
  color: '#94a3b8',
  fontSize: '12px',
};
const cellStyle = {
  minHeight: '110px',
  background: 'white',
  borderRadius: '18px',
  border: '1px solid #e2e8f0',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  position: 'relative',
  overflow: 'hidden',
};
const cellStyleActive = { ...cellStyle, border: '2px solid #059669' };
const mealContent = {
  width: '100%',
  textAlign: 'center',
  padding: '10px',
  background: 'rgba(255,255,255,0.85)',
  borderRadius: '12px',
  margin: '5px',
};
const mealNameS = { fontWeight: '800', fontSize: '12px', color: '#1e293b' };
const mealPriceS = { fontSize: '11px', color: '#059669', fontWeight: 'bold' };
const btnViewSmall = {
  background: '#059669',
  color: 'white',
  border: 'none',
  padding: '6px 10px',
  borderRadius: '8px',
  fontSize: '10px',
  fontWeight: 'bold',
  cursor: 'pointer',
};
const btnDelSmall = {
  background: '#fee2e2',
  color: '#ef4444',
  border: 'none',
  borderRadius: '8px',
  width: '24px',
  height: '24px',
  fontSize: '12px',
  cursor: 'pointer',
};
const shoppingPanel = {
  marginTop: '30px',
  background: 'white',
  padding: '20px',
  borderRadius: '22px',
  boxShadow: '0 4px 6px rgba(0,0,0,0.05)',
};
const shoppingGrid = {
  display: 'grid',
  gridTemplateColumns:
    window.innerWidth < 600 ? '1fr' : 'repeat(auto-fill, minmax(240px, 1fr))',
  gap: '12px',
};
const shoppingItem = {
  padding: '16px',
  borderRadius: '16px',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  boxShadow: '0 2px 4px rgba(0,0,0,0.02)',
};
const inputS = {
  width: '100%',
  padding: '12px',
  marginBottom: '8px',
  borderRadius: '12px',
  border: '1px solid #e2e8f0',
  boxSizing: 'border-box',
  fontSize: '16px',
};
const btnSuccessFull = {
  background: '#059669',
  color: 'white',
  border: 'none',
  padding: '15px',
  borderRadius: '15px',
  width: '100%',
  cursor: 'pointer',
  fontWeight: '800',
  fontSize: '16px',
  marginTop: '10px',
};
const btnFilter = {
  background: '#f1f5f9',
  color: '#64748b',
  border: 'none',
  padding: '8px 16px',
  borderRadius: '12px',
  cursor: 'pointer',
  fontWeight: 'bold',
};
const btnFilterActive = { ...btnFilter, background: '#059669', color: 'white' };
const filterBar = {
  display: 'flex',
  gap: '8px',
  marginBottom: '15px',
  overflowX: 'auto',
};
const productRowS = {
  display: 'flex',
  justifyContent: 'space-between',
  padding: '15px',
  borderBottom: '1px solid #f1f5f9',
  alignItems: 'center',
};
const recipeListItem = {
  padding: '15px',
  borderBottom: '1px solid #f1f5f9',
  cursor: 'pointer',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
};
const searchResultsS = {
  background: 'white',
  border: '1px solid #e2e8f0',
  borderRadius: '12px',
  marginBottom: '15px',
};
const searchItemS = {
  padding: '12px',
  cursor: 'pointer',
  borderBottom: '1px solid #f1f5f9',
};
const iconBtn = {
  border: 'none',
  background: 'none',
  cursor: 'pointer',
  fontSize: '22px',
};
const overlayS = {
  position: 'fixed',
  top: 0,
  left: 0,
  width: '100%',
  height: '100%',
  background: 'rgba(15, 23, 42, 0.6)',
  backdropFilter: 'blur(4px)',
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  zIndex: 1000,
};
const loginOverlay = {
  height: '100vh',
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  background: '#f3f4f6',
};
const loginForm = {
  background: 'white',
  padding: '40px',
  borderRadius: '30px',
  width: '340px',
};
const loadingStyle = {
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  height: '100vh',
  color: '#059669',
  fontSize: '22px',
  fontWeight: 'bold',
};
const mobileMealTag = {
  position: 'absolute',
  top: '6px',
  left: '10px',
  fontSize: '9px',
  color: '#94a3b8',
  fontWeight: 'bold',
  textTransform: 'uppercase',
};
const formBoxS = {
  background: '#f8fafc',
  padding: '18px',
  borderRadius: '20px',
  marginBottom: '20px',
  border: '1px solid #e2e8f0',
};
const stepItemS = {
  padding: '15px',
  background: '#f0fdf4',
  borderRadius: '15px',
  borderLeft: '5px solid #059669',
  marginBottom: '12px',
  display: 'flex',
  gap: '15px',
  alignItems: 'center',
};
const stepCircleS = {
  width: '28px',
  height: '28px',
  background: '#059669',
  color: 'white',
  borderRadius: '50%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontWeight: 'bold',
  flexShrink: 0,
};
const fileLabelS = {
  display: 'block',
  padding: '15px',
  background: '#f1f5f9',
  border: '2px dashed #cbd5e1',
  borderRadius: '12px',
  textAlign: 'center',
  cursor: 'pointer',
  color: '#475569',
  fontWeight: 'bold',
  fontSize: '14px',
};
const btnCartAddSmall = {
  background: '#e0f2fe',
  color: '#0369a1',
  border: 'none',
  padding: '4px 8px',
  borderRadius: '6px',
  fontSize: '11px',
  fontWeight: 'bold',
  cursor: 'pointer',
};
