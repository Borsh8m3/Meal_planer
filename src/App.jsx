import { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY);

export default function App() {
  const [session, setSession] = useState(null);
  const [products, setProducts] = useState([]);
  const [isRecipeModalOpen, setIsRecipeModalOpen] = useState(false);
  const [isProductModalOpen, setIsProductModalOpen] = useState(false);

  // Stan nowego produktu
  const [newProd, setNewProd] = useState({ name: '', price: '', unit: 'kg' });
  
  // Stan kreatora przepisu
  const [recipeName, setRecipeName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIngredients, setSelectedIngredients] = useState([]); // [{id, name, amount, price_per_unit, unit}]

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session));
    fetchProducts();
  }, []);

  async function fetchProducts() {
    const { data } = await supabase.from('products').select('*');
    setProducts(data || []);
  }

  // LOGIKA DODAWANIA PRODUKTU DO BAZY
  const handleAddProduct = async () => {
    const { error } = await supabase.from('products').insert([{
      name: newProd.name,
      price_per_unit: parseFloat(newProd.price),
      unit: newProd.unit
    }]);
    if (!error) {
      setIsProductModalOpen(false);
      setNewProd({ name: '', price: '', unit: 'kg' });
      fetchProducts();
    }
  };

  // LOGIKA LICZENIA CENY SKŁADNIKA
  const calculateIngredientPrice = (ing) => {
    // Jeśli jednostka bazowa to kg, a wpisujemy w gramach (standard w przepisach)
    if (ing.unit === 'kg') {
      return (ing.price_per_unit * (ing.amount / 1000)).toFixed(2);
    }
    // Jeśli sztuki lub gramy bezpośrednio
    return (ing.price_per_unit * ing.amount).toFixed(2);
  };

  // ŁĄCZNA CENA PRZEPISU
  const totalPrice = selectedIngredients.reduce((sum, ing) => {
    return sum + parseFloat(calculateIngredientPrice(ing));
  }, 0).toFixed(2);

  const addIngredient = (p) => {
    if (!selectedIngredients.find(i => i.id === p.id)) {
      setSelectedIngredients([...selectedIngredients, { ...p, amount: p.unit === 'kg' ? 500 : 1 }]);
    }
    setSearchQuery('');
  };

  if (!session) return <div style={{padding: '50px'}}>Proszę się zalogować...</div>;

  return (
    <div style={containerStyle}>
      <header style={headerStyle}>
        <h1>🥗 Kuchnia & Koszty</h1>
        <div style={{display: 'flex', gap: '10px'}}>
          <button onClick={() => setIsProductModalOpen(true)} style={btnSecondary}>📦 Dodaj do Spiżarni</button>
          <button onClick={() => setIsRecipeModalOpen(true)} style={btnPrimary}>👨‍🍳 Nowy Przepis</button>
        </div>
      </header>

      {/* --- MODAL DODAWANIA PRODUKTU --- */}
      {isProductModalOpen && (
        <div style={modalOverlay}>
          <div style={modalContent}>
            <h3>📦 Nowy produkt w bazie</h3>
            <input style={inputFull} placeholder="Nazwa (np. Mąka)" value={newProd.name} onChange={e => setNewProd({...newProd, name: e.target.value})} />
            <div style={{display: 'flex', gap: '10px', marginBottom: '15px'}}>
              <input style={inputFull} type="number" placeholder="Cena (zł)" value={newProd.price} onChange={e => setNewProd({...newProd, price: e.target.value})} />
              <select style={selectStyle} value={newProd.unit} onChange={e => setNewProd({...newProd, unit: e.target.value})}>
                <option value="kg">za 1 kg</option>
                <option value="g">za 1 g</option>
                <option value="szt">za 1 szt</option>
              </select>
            </div>
            <div style={modalActions}>
              <button onClick={() => setIsProductModalOpen(false)} style={btnSecondary}>Anuluj</button>
              <button onClick={handleAddProduct} style={btnSuccess}>Dodaj do bazy</button>
            </div>
          </div>
        </div>
      )}

      {/* --- MODAL KREATORA PRZEPISU --- */}
      {isRecipeModalOpen && (
        <div style={modalOverlay}>
          <div style={modalContentLarge}>
            <h2>🍳 Kreator Przepisu</h2>
            <input style={inputFull} placeholder="Nazwa przepisu..." value={recipeName} onChange={e => setRecipeName(e.target.value)} />
            
            <div style={{position: 'relative', margin: '20px 0'}}>
              <input style={inputSearch} placeholder="🔍 Szukaj składnika..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
              {searchQuery && (
                <div style={searchResults}>
                  {products.filter(p => p.name.toLowerCase().includes(searchQuery.toLowerCase())).map(p => (
                    <div key={p.id} onClick={() => addIngredient(p)} style={searchItem}>
                      {p.name} <span style={{fontSize: '11px', color: '#666'}}>({p.price_per_unit}zł / {p.unit})</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={ingredientTable}>
              {selectedIngredients.map((ing, idx) => (
                <div key={idx} style={ingRow}>
                  <span style={{flex: 2}}>{ing.name}</span>
                  <div style={{flex: 1, display: 'flex', alignItems: 'center', gap: '5px'}}>
                    <input 
                      type="number" 
                      style={inputSmall} 
                      value={ing.amount} 
                      onChange={e => {
                        const newIngs = [...selectedIngredients];
                        newIngs[idx].amount = e.target.value;
                        setSelectedIngredients(newIngs);
                      }}
                    />
                    <span style={{fontSize: '12px'}}>{ing.unit === 'kg' ? 'g' : ing.unit}</span>
                  </div>
                  <span style={{flex: 1, textAlign: 'right', fontWeight: 'bold'}}>{calculateIngredientPrice(ing)} zł</span>
                </div>
              ))}
            </div>

            <div style={totalContainer}>
              <span>Przewidywany koszt:</span>
              <span style={{fontSize: '24px', color: '#10b981'}}>{totalPrice} zł</span>
            </div>

            <div style={modalActions}>
              <button onClick={() => setIsRecipeModalOpen(false)} style={btnSecondary}>Anuluj</button>
              <button style={btnSuccess}>💾 Zapisz Przepis</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// --- STYLE (Uproszczone dla czytelności) ---
const containerStyle = { padding: '30px', fontFamily: 'Segoe UI, sans-serif' };
const headerStyle = { display: 'flex', justifyContent: 'space-between', borderBottom: '2px solid #eee', paddingBottom: '20px' };
const modalOverlay = { position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 };
const modalContent = { background: 'white', padding: '25px', borderRadius: '15px', width: '400px' };
const modalContentLarge = { background: 'white', padding: '25px', borderRadius: '15px', width: '600px', maxHeight: '90vh', overflowY: 'auto' };
const inputFull = { width: '100%', padding: '12px', marginBottom: '10px', borderRadius: '8px', border: '1px solid #ddd', boxSizing: 'border-box' };
const selectStyle = { padding: '10px', borderRadius: '8px', border: '1px solid #ddd' };
const inputSearch = { width: '100%', padding: '15px', borderRadius: '30px', border: '2px solid #3b82f6', boxSizing: 'border-box' };
const searchResults = { position: 'absolute', width: '100%', background: 'white', border: '1px solid #ddd', borderRadius: '8px', zIndex: 100 };
const searchItem = { padding: '12px', cursor: 'pointer', borderBottom: '1px solid #eee' };
const ingredientTable = { margin: '20px 0', borderTop: '1px solid #eee' };
const ingRow = { display: 'flex', padding: '10px 0', borderBottom: '1px solid #f9f9f9', alignItems: 'center' };
const inputSmall = { width: '70px', padding: '8px', borderRadius: '6px', border: '1px solid #ccc' };
const totalContainer = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px', background: '#f8fafc', borderRadius: '12px', marginTop: '20px' };
const modalActions = { display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' };
const btnPrimary = { background: '#3b82f6', color: 'white', border: 'none', padding: '12px 25px', borderRadius: '10px', cursor: 'pointer' };
const btnSecondary = { background: '#f1f5f9', color: '#475569', border: 'none', padding: '12px 25px', borderRadius: '10px', cursor: 'pointer' };
const btnSuccess = { background: '#10b981', color: 'white', border: 'none', padding: '12px 25px', borderRadius: '10px', cursor: 'pointer', fontWeight: 'bold' };