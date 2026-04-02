import 'regenerator-runtime/runtime'; // Wymagane przez react-speech-recognition
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';
import SpeechRecognition, { useSpeechRecognition } from 'react-speech-recognition';

// --- KONFIGURACJA KLIENTÓW ---
const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL || '',
  import.meta.env.VITE_SUPABASE_ANON_KEY || ''
);

const GEMINI_API_KEY = (import.meta.env.VITE_GEMINI_API_KEY || '').trim();

// --- STAŁE ---
const MEAL_TYPES = ['Śniadanie', 'Lunch', 'Obiad', 'Podwieczorek', 'Kolacja'];
const DAYS = [
  'Poniedziałek', 'Wtorek', 'Środa', 'Czwartek', 'Piątek', 'Sobota', 'Niedziela',
];

const sharedGradient = 'linear-gradient(135deg, #dcfce7 0%, #e2e8f0 100%)';
const MEAL_COLORS = {
  'Śniadanie': sharedGradient, 
  'Lunch': sharedGradient,     
  'Obiad': sharedGradient,     
  'Podwieczorek': sharedGradient, 
  'Kolacja': sharedGradient    
};

// --- FUNKCJE POMOCNICZE ---
const extractJSON = (text) => {
  try {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start !== -1 && end !== -1) {
      return JSON.parse(text.substring(start, end + 1));
    }
  } catch (e) {
    console.error("Błąd wyciągania JSON:", e);
    return null;
  }
  return null;
};

const renderStepWithIngredients = (text, ingredients) => {
  if (!text || !ingredients || ingredients.length === 0) return text;
  let parts = [{ text: text, isIng: false }];

  ingredients.forEach((ri) => {
    const name = ri.products?.name || ri.name; 
    if (!name) return;
    const words = name.split(' ').filter(w => w.length > 2);
    const searchWord = words.length > 0 ? words[0] : name;
    const minLen = Math.max(3, searchWord.length - 2);
    const stem = searchWord.toLowerCase().substring(0, minLen);
    const safeStem = stem.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');

    const newParts = [];
    parts.forEach(part => {
      if (part.isIng) {
        newParts.push(part); 
        return;
      }
      const regex = new RegExp(`(${safeStem}[a-ząćęłńóśźż]*)`, 'gi');
      const splits = part.text.split(regex);
      splits.forEach(s => {
        if (!s) return;
        if (s.toLowerCase().startsWith(stem)) {
          const displayUnit = ri.products?.unit || ri.unit || '';
          newParts.push({ text: s, isIng: true, ri: { amount: ri.amount, unit: displayUnit } });
        } else {
          newParts.push({ text: s, isIng: false });
        }
      });
    });
    parts = newParts;
  });

  return parts.map((p, i) => {
    if (p.isIng) {
      return (
        <span key={i} style={{
          color: '#059669', fontWeight: '800', backgroundColor: '#ecfdf5',
          padding: '4px 10px', borderRadius: '16px', whiteSpace: 'nowrap',
          border: '1px solid #a7f3d0'
        }}>
          {p.text} ({p.ri.amount} {p.ri.unit})
        </span>
      );
    }
    return <span key={i}>{p.text}</span>;
  });
};

// --- KOMPONENT GŁÓWNY ---
export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [products, setProducts] = useState([]);
  const [recipes, setRecipes] = useState([]);
  const [mealPlan, setMealPlan] = useState([]);
  const [weekOffset, setWeekOffset] = useState(0);
  
  const [isMobile, setIsMobile] = useState(window.innerWidth < 900);
  const [isLandscape, setIsLandscape] = useState(window.innerWidth > window.innerHeight);

  const [manualCart, setManualCart] = useState([]);
  const [checkedItems, setCheckedItems] = useState({});

  const [activeModal, setActiveModal] = useState(null);
  const [selectedCell, setSelectedCell] = useState(null);
  const [viewingRecipe, setViewingRecipe] = useState(null);
  const [viewMode, setViewMode] = useState('desc'); // 'desc', 'steps', 'ai-assist'
  const [filterCategory, setFilterCategory] = useState('');
  const [recipeListCategory, setRecipeListCategory] = useState(''); 
  const [statTimeRange, setStatTimeRange] = useState('month'); 

  // --- ASYSTENT AI ---
  const [aiChatHistory, setAiChatHistory] = useState([]);
  const [aiChatQuery, setAiChatQuery] = useState('');
  const [aiSuggestedRecipe, setAiSuggestedRecipe] = useState(null);
  const chatScrollRef = useRef(null);

  // --- LOGIKA GOTOWANIA ---
  const [cookingStep, setCookingStep] = useState(0);
  const [isVoiceActive, setIsVoiceActive] = useState(false); 
  const [isMicPaused, setIsMicPaused] = useState(false);     
  const [isTtsActive, setIsTtsActive] = useState(false);     
  const [repeatTrigger, setRepeatTrigger] = useState(0); 
  
  const isVoiceActiveRef = useRef(isVoiceActive);
  const isMicPausedRef = useRef(isMicPaused);
  const isTtsActiveRef = useRef(isTtsActive);
  const stepsLengthRef = useRef(0); 

  const [isAiLoading, setIsAiLoading] = useState(false); 
  const [showAiPanel, setShowAiPanel] = useState(false); 
  const [aiUrl, setAiUrl] = useState(''); 

  const [showRecipeForm, setShowRecipeForm] = useState(false);
  const [showProductForm, setShowProductForm] = useState(false); 
  const [cartModalTab, setCartModalTab] = useState('recipes'); 
  
  const [commentText, setCommentText] = useState('');
  const [commentingMealId, setCommentingMealId] = useState(null);

  const [showSearchDropdown, setShowSearchDropdown] = useState(false);
  const searchContainerRef = useRef(null);

  const [newProd, setNewProd] = useState({ id: null, name: '', price: '', amount: '', unit: 'g' });
  const [newRecipe, setNewRecipe] = useState({ id: null, name: '', category: 'Obiad', instructions: '', image_url: '', steps: [], ingredients: [], is_favorite: false, portions: 1 });
  const [searchQuery, setSearchQuery] = useState('');

  const handleLogout = useCallback(() => supabase.auth.signOut(), []);

  // --- OBSŁUGA CZATU AI SCROLL ---
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [aiChatHistory]);

  // --- NAWIGACJA KALENDARZA ---
  const jumpToDate = (dateStr) => {
    const selected = new Date(dateStr);
    const today = new Date();
    const getMonday = (d) => {
      const date = new Date(d);
      const day = date.getDay();
      const diff = date.getDate() - day + (day === 0 ? -6 : 1);
      const monday = new Date(date.setDate(diff));
      monday.setHours(0,0,0,0);
      return monday;
    };
    const startOfSelectedWeek = getMonday(selected);
    const startOfCurrentWeek = getMonday(today);
    const diffInMs = startOfSelectedWeek.getTime() - startOfCurrentWeek.getTime();
    const offset = Math.round(diffInMs / (7 * 24 * 60 * 60 * 1000));
    setWeekOffset(offset);
    setActiveModal(null);
  };

  // --- RECOGNITION I TTS ---
  const handleMicPauseAndAction = useCallback(() => {
    setIsMicPaused(true);
    SpeechRecognition.stopListening();
    if (!isTtsActiveRef.current) {
      setTimeout(() => {
        setIsMicPaused(false);
        if (isVoiceActiveRef.current) SpeechRecognition.startListening({ continuous: true, language: 'pl-PL' });
      }, 1500);
    }
  }, []);

  const { transcript, listening, resetTranscript, browserSupportsSpeechRecognition } = useSpeechRecognition({ commands: [] });

  useEffect(() => {
    if (isMicPaused) resetTranscript();
  }, [isMicPaused, resetTranscript]);

  useEffect(() => {
    if (!isVoiceActive || isMicPaused || !transcript) return;
    const lowerTranscript = transcript.toLowerCase();
    const hasWord = (words) => words.some(w => lowerTranscript.includes(w));
    if (hasWord(['dalej', 'następny', 'następna', 'kolejny', 'kolejna', 'dali', 'działa'])) {
      setCookingStep(prev => Math.min(prev + 1, Math.max(0, stepsLengthRef.current - 1)));
      resetTranscript();
      handleMicPauseAndAction();
    } else if (hasWord(['wstecz', 'poprzedni', 'poprzednia', 'cofnij', 'wróć'])) {
      setCookingStep(prev => Math.max(prev - 1, 0));
      resetTranscript();
      handleMicPauseAndAction();
    } else if (hasWord(['powtórz', 'jeszcze raz', 'czytaj'])) {
      setRepeatTrigger(prev => prev + 1);
      resetTranscript();
      handleMicPauseAndAction();
    } else if (hasWord(['zamknij', 'koniec', 'zakończ'])) {
      setIsVoiceActive(false); setIsMicPaused(false); window.speechSynthesis.cancel(); SpeechRecognition.stopListening(); resetTranscript(); setActiveModal('view-recipe');
    }
  }, [transcript, isVoiceActive, isMicPaused, handleMicPauseAndAction, resetTranscript]);

  const toggleVoiceMode = () => {
    if (!browserSupportsSpeechRecognition) return alert("Brak wsparcia mowy.");
    if (isVoiceActive) { setIsVoiceActive(false); setIsMicPaused(false); SpeechRecognition.stopListening(); window.speechSynthesis.cancel(); }
    else { setIsVoiceActive(true); setIsMicPaused(false); resetTranscript(); SpeechRecognition.startListening({ continuous: true, language: 'pl-PL' }); }
  };

  // --- DATA FETCHING ---
  async function fetchData() {
    const { data: prods } = await supabase.from('products').select('*').order('name');
    const { data: recs } = await supabase.from('recipes').select('*, recipe_ingredients(*, products(*))').order('name');
    const { data: plan } = await supabase.from('meal_plan').select('*, recipes(*)');
    setProducts(prods || []); setRecipes(recs || []); setMealPlan(plan || []);
  }

  useEffect(() => {
    const handleClickOutside = (e) => { if (searchContainerRef.current && !searchContainerRef.current.contains(e.target)) setShowSearchDropdown(false); };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    document.title = "Jedzonko Planer 🥗";
    const handleResize = () => { setIsMobile(window.innerWidth < 900); setIsLandscape(window.innerWidth > window.innerHeight); };
    window.addEventListener('resize', handleResize);
    supabase.auth.getSession().then(({ data: { session } }) => { setSession(session); setLoading(false); });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => setSession(session));
    return () => { subscription.unsubscribe(); window.removeEventListener('resize', handleResize); };
  }, []);

  useEffect(() => { if (session) fetchData(); }, [session, weekOffset]);
  useEffect(() => { stepsLengthRef.current = viewingRecipe?.steps?.length || 0; }, [viewingRecipe]);
  useEffect(() => { isTtsActiveRef.current = isTtsActive; isMicPausedRef.current = isMicPaused; isVoiceActiveRef.current = isVoiceActive; }, [isTtsActive, isMicPaused, isVoiceActive]);

  useEffect(() => {
    if (activeModal === 'cooking-mode' && isTtsActive && viewingRecipe?.steps) {
      window.speechSynthesis.cancel(); setIsMicPaused(true); SpeechRecognition.stopListening();
      const stepText = viewingRecipe.steps[cookingStep];
      if (stepText) {
        const u = new SpeechSynthesisUtterance(`Krok ${cookingStep + 1}. ${stepText}`);
        u.lang = 'pl-PL'; u.onend = () => { setIsMicPaused(false); if (isVoiceActiveRef.current) SpeechRecognition.startListening({ continuous: true, language: 'pl-PL' }); };
        u.onerror = u.onend; setTimeout(() => window.speechSynthesis.speak(u), 150);
      } else { setIsMicPaused(false); if (isVoiceActiveRef.current) SpeechRecognition.startListening({ continuous: true, language: 'pl-PL' }); }
    }
  }, [cookingStep, activeModal, isTtsActive, viewingRecipe, repeatTrigger]);

  // --- STATYSTYKI ---
  const advancedStats = useMemo(() => {
    const now = new Date();
    const currentMonthStr = now.toISOString().slice(0, 7); 
    const ingredientStats = {}; 
    const recipeStats = {};
    let scopedCost = 0; 
    let scopedDays = new Set();

    mealPlan.forEach((meal) => {
      const monthKey = meal.date.slice(0, 7);
      if (statTimeRange === 'month' && monthKey !== currentMonthStr) return;

      const recipe = recipes.find((r) => r.id === meal.recipe_id); if (!recipe) return;
      const cost = parseFloat(recipe.total_cost || 0); 
      scopedCost += cost;
      scopedDays.add(meal.date);

      if (!recipeStats[recipe.name]) recipeStats[recipe.name] = { count: 0 };
      recipeStats[recipe.name].count += 1;

      recipe.recipe_ingredients?.forEach((ri) => {
        const p = ri.products; if (!p) return;
        if (!ingredientStats[p.name]) ingredientStats[p.name] = { count: 0, totalCost: 0 };
        ingredientStats[p.name].count += 1; 
        ingredientStats[p.name].totalCost += p.price_per_unit * ri.amount;
      });
    });

    const topByCount = Object.entries(ingredientStats).sort((a, b) => b[1].count - a[1].count).slice(0, 15);
    const topByCost = Object.entries(ingredientStats).sort((a, b) => b[1].totalCost - a[1].totalCost).slice(0, 15);
    const topRecs = Object.entries(recipeStats).sort((a, b) => b[1].count - a[1].count).slice(0, 15);

    return { 
      topByCount, topByCost, topRecs, 
      total: scopedCost.toFixed(2), 
      avg: scopedDays.size > 0 ? (scopedCost / scopedDays.size).toFixed(2) : 0 
    };
  }, [mealPlan, recipes, statTimeRange]);

  // --- ZAKUPY ---
  const finalShoppingList = useMemo(() => {
    const combined = {};
    const now = new Date(); const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1) + weekOffset * 7;
    const weekDatesArr = DAYS.map((_, i) => new Date(new Date().setDate(diff + i)).toISOString().split('T')[0]);

    mealPlan.filter((m) => weekDatesArr.includes(m.date)).forEach((m) => {
      recipes.find((rec) => rec.id === m.recipe_id)?.recipe_ingredients?.forEach((ri) => {
        const p = ri.products; if (!p) return;
        const key = `${p.name}-${p.unit}`;
        if (!combined[key]) combined[key] = { name: p.name, amount: 0, unit: p.unit, cost: 0, pricePU: p.price_per_unit };
        combined[key].amount += parseFloat(ri.amount || 0);
      });
    });
    manualCart.forEach((item) => {
      const key = `${item.name}-${item.unit}`;
      if (!combined[key]) combined[key] = { name: item.name, amount: 0, unit: item.unit, cost: 0, pricePU: item.pricePU };
      combined[key].amount += parseFloat(item.amount);
    });
    return Object.values(combined).map((it) => ({ ...it, cost: (it.pricePU * it.amount).toFixed(2) }));
  }, [weekOffset, mealPlan, recipes, manualCart]);

  const dailyCosts = useMemo(() => {
    const daily = {}; let weeklyTotal = 0;
    const now = new Date(); const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1) + weekOffset * 7;
    const dates = DAYS.map((_, i) => new Date(new Date().setDate(diff + i)).toISOString().split('T')[0]);

    dates.forEach((d) => {
      let daySum = 0;
      mealPlan.filter((m) => m.date === d).forEach((m) => {
        const r = recipes.find((rec) => rec.id === m.recipe_id);
        if (r?.total_cost) daySum += parseFloat(r.total_cost);
      });
      daily[d] = daySum.toFixed(2); weeklyTotal += daySum;
    });
    return { daily, weeklyTotal: weeklyTotal.toFixed(2) };
  }, [weekOffset, mealPlan, recipes]);

  // --- LOGIKA AI (ZDJĘCIA / URL / ASYSTENT) ---
  const mapAiIngredientsToDb = (aiIngredients) => {
    return (aiIngredients || []).map(aiIng => {
      const aiNameLower = aiIng.name.toLowerCase();
      let found = products.find(p => p.name.toLowerCase() === aiNameLower || p.name.toLowerCase().includes(aiNameLower));
      if (found) return { ...found, amount: aiIng.amount || 100 };
      return { id: null, name: `⚠️ ${aiIng.name}`, amount: aiIng.amount || 100, unit: aiIng.unit || 'g' };
    });
  }

  const handleAiRecipeScan = async (e) => {
    const file = e.target.files[0]; if (!file || !GEMINI_API_KEY) return;
    setIsAiLoading(true);
    try {
      const base64 = await new Promise((res) => { const r = new FileReader(); r.onloadend = () => res(r.result.split(',')[1]); r.readAsDataURL(file); });
      const prompt = `Jesteś ekspertem kulinarnym. Przeanalizuj zdjęcie przepisu. Zwróć JSON w bloku json. Format: {"name": "...", "instructions": "...", "portions": 2, "steps":["..."], "ingredients":[{"name": "...", "amount": 100, "unit": "g"}]}`;
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType: file.type, data: base64 } }] }], generationConfig: { responseMimeType: "application/json" } })
      });
      const data = await response.json();
      const text = data.candidates[0].content.parts[0].text;
      const aiRecipe = extractJSON(text);
      if (aiRecipe) {
        const mappedIngredients = mapAiIngredientsToDb(aiRecipe.ingredients);
        setNewRecipe({
          id: null, name: aiRecipe.name, category: 'Obiad', instructions: aiRecipe.instructions,
          steps: aiRecipe.steps || [], ingredients: mappedIngredients, portions: aiRecipe.portions || 1, image_url: ''
        });
        setShowRecipeForm(true);
        setActiveModal('recipe');
      }
    } catch (err) { alert("Błąd AI"); } finally { setIsAiLoading(false); setShowAiPanel(false); }
  };

  const handleAiRecipeFromUrl = async () => {
    if (!aiUrl || !GEMINI_API_KEY) return;
    setIsAiLoading(true);
    try {
      const prompt = `Przeanalizuj przepis z URL: ${aiUrl}. Zwróć JSON w bloku json. Format: {"name": "...", "instructions": "...", "portions": 2, "steps":["..."], "ingredients":[{"name": "...", "amount": 100, "unit": "g"}]}`;
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json" } })
      });
      const data = await response.json();
      const text = data.candidates[0].content.parts[0].text;
      const aiRecipe = extractJSON(text);
      if (aiRecipe) {
        const mappedIngredients = mapAiIngredientsToDb(aiRecipe.ingredients);
        setNewRecipe({
          id: null, name: aiRecipe.name, category: 'Obiad', instructions: aiRecipe.instructions,
          steps: aiRecipe.steps || [], ingredients: mappedIngredients, portions: aiRecipe.portions || 1, image_url: ''
        });
        setShowRecipeForm(true);
        setActiveModal('recipe');
      }
    } catch (err) { alert("Błąd AI"); } finally { setIsAiLoading(false); setShowAiPanel(false); setAiUrl(''); }
  };

  // --- ASYSTENT KULINARNY (MODYFIKATOR DIETETYCZNY) ---
  const handleAiDietAssist = async () => {
    if (!aiChatQuery.trim() || !GEMINI_API_KEY || !viewingRecipe) return;
    const userQuery = aiChatQuery;
    setAiChatQuery('');
    setAiChatHistory(prev => [...prev, { role: 'user', text: userQuery }]);
    setIsAiLoading(true);

    try {
      const currentRecipe = {
        name: viewingRecipe.name,
        ingredients: viewingRecipe.recipe_ingredients.map(ri => `${ri.products?.name} (${ri.amount}${ri.products?.unit})`),
        steps: viewingRecipe.steps
      };

      const prompt = `Jesteś dietetykiem i kucharzem. Użytkownik chce dostosować ten przepis: ${JSON.stringify(currentRecipe)}. 
      PROŚBA: ${userQuery}. 
      Zaproponuj zamienniki zgodne z wytycznymi dietetycznymi. Wyjaśnij dlaczego to zmieniasz.
      NA KONIEC ODPOWIEDZI zwróć nowy, kompletny przepis jako JSON w bloku: \`\`\`json {"name": "Zmieniona nazwa", "ingredients": [{"name": "składnik", "amount": 100, "unit": "g"}], "steps": ["krok 1"], "instructions": "krótki opis"} \`\`\``;

      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
      });
      const data = await response.json();
      const text = data.candidates[0].content.parts[0].text;
      
      const suggested = extractJSON(text);
      if (suggested) setAiSuggestedRecipe(suggested);
      
      const displayText = text.split('```json')[0].trim();
      setAiChatHistory(prev => [...prev, { role: 'ai', text: displayText }]);
    } catch (e) { 
      setAiChatHistory(prev => [...prev, { role: 'ai', text: "Wystąpił błąd podczas generowania propozycji." }]);
    } finally { setIsAiLoading(false); }
  };

  const applyAiAssistChanges = () => {
    if (!aiSuggestedRecipe) return;
    const mapped = (aiSuggestedRecipe.ingredients || []).map(i => {
      let found = products.find(p => p.name.toLowerCase() === i.name.toLowerCase());
      return found ? { ...found, amount: i.amount } : { id: null, name: `⚠️ ${i.name}`, amount: i.amount, unit: i.unit };
    });
    setNewRecipe({
      id: null, // Zawsze nowy przepis na bazie zmian
      name: aiSuggestedRecipe.name,
      category: viewingRecipe.category || 'Obiad',
      instructions: aiSuggestedRecipe.instructions || '',
      steps: aiSuggestedRecipe.steps || [],
      ingredients: mapped,
      portions: viewingRecipe.portions || 1,
      image_url: viewingRecipe.image_url || '',
      is_favorite: false
    });
    setActiveModal('recipe');
    setShowRecipeForm(true);
    setAiSuggestedRecipe(null);
    setAiChatHistory([]);
  };

  // --- ZAPIS PRODUKTÓW I PRZEPISÓW ---
  const handleSaveProduct = async () => {
    const pPerU = parseFloat(newProd.price) / parseFloat(newProd.amount);
    const d = { name: newProd.name, price_per_unit: pPerU, unit: newProd.unit, last_input_quantity: parseFloat(newProd.amount) };
    if (newProd.id) await supabase.from('products').update(d).eq('id', newProd.id);
    else await supabase.from('products').insert([d]);
    setNewProd({ id: null, name: '', price: '', amount: '', unit: 'g' });
    setShowProductForm(false); fetchData();
  };

  const handleSaveRecipe = async () => {
    if (!newRecipe.name) return;
    const validIngredients = newRecipe.ingredients.filter(ing => ing.id || ing.product_id);
    const tCost = validIngredients.reduce((s, i) => s + (parseFloat(i.price_per_unit || i.products?.price_per_unit || 0) * parseFloat(i.amount || 0)), 0).toFixed(2);
    const rData = { 
      name: newRecipe.name, 
      category: newRecipe.category, 
      total_cost: tCost, 
      instructions: newRecipe.instructions, 
      steps: newRecipe.steps, 
      image_url: newRecipe.image_url, 
      is_favorite: newRecipe.is_favorite, 
      portions: newRecipe.portions || 1 
    };
    
    let rId = newRecipe.id;
    if (newRecipe.id) { 
      await supabase.from('recipes').update(rData).eq('id', newRecipe.id); 
      await supabase.from('recipe_ingredients').delete().eq('recipe_id', newRecipe.id); 
    } else { 
      const { data } = await supabase.from('recipes').insert([rData]).select().single(); 
      rId = data.id; 
    }
    
    await supabase.from('recipe_ingredients').insert(validIngredients.map(ing => ({ recipe_id: rId, product_id: ing.id || ing.product_id, amount: ing.amount })));
    setNewRecipe({ id: null, name: '', category: 'Obiad', instructions: '', image_url: '', steps: [], ingredients: [], is_favorite: false, portions: 1 });
    setShowRecipeForm(false); fetchData();
  };

  const handleEditRecipeDirectly = (recipeInfo) => {
    const r = recipes.find(r => r.id === recipeInfo.id); if (!r) return;
    setNewRecipe({ ...r, portions: r.portions || 1, ingredients: (r.recipe_ingredients || []).map(ri => ({ ...ri.products, amount: ri.amount, product_id: ri.product_id })) });
    setRecipeListCategory(r.category || 'Obiad'); setShowRecipeForm(true); setActiveModal('recipe');
  };

  if (loading) return <div style={loadingStyle}>🍳 Ładowanie...</div>;
  if (!session) return <LoginView />;

  const currentWeekDates = DAYS.map((name, i) => {
    const now = new Date(); const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1) + weekOffset * 7;
    const d = new Date(new Date().setDate(diff + i));
    return { name, fullDate: d.toISOString().split('T')[0], displayDate: d.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit' }) };
  });

  return (
    <div style={appContainer}>
      <style>{`
        @keyframes slideUp { from { transform: translateY(100%); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        .sheet-container { position: fixed; bottom: 0; left: 0; right: 0; z-index: 1200; display: flex; justify-content: center; align-items: flex-end; height: 100vh; background: rgba(15, 23, 42, 0.6); backdrop-filter: blur(8px); animation: fadeIn 0.3s forwards; }
        .sheet-card { width: 100%; max-width: 800px; height: 92vh; background: #fff; border-radius: 40px 40px 0 0; display: flex; flex-direction: column; animation: slideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1); overflow: hidden; box-shadow: 0 -10px 40px rgba(0,0,0,0.15); }
        .sheet-header { padding: 20px 25px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #f1f5f9; }
        .sheet-content { flex: 1; padding: 25px; overflow-y: auto; }
        .drag-handle { width: 50px; height: 6px; background: #cbd5e1; border-radius: 10px; margin: 15px auto 0 auto; flex-shrink: 0; }
        .hide-scrollbar::-webkit-scrollbar { display: none; }
        .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
        .compact-row { display: flex; justify-content: space-between; padding: 12px 18px; background: #f8fafc; border-radius: 16px; margin-bottom: 8px; align-items: center; border: 1px solid #e2e8f0; cursor: pointer; transition: 0.2s; }
        .compact-row:hover { background: #ecfdf5; border-color: #a7f3d0; }
        .chat-bubble-u { background: #059669; color: #fff; padding: 12px 16px; border-radius: 20px 20px 4px 20px; align-self: flex-end; max-width: 80%; font-size: 14px; font-weight: 600; line-height: 1.5; }
        .chat-bubble-a { background: #f1f5f9; color: #1e293b; padding: 12px 16px; border-radius: 20px 20px 20px 4px; align-self: flex-start; max-width: 80%; font-size: 14px; font-weight: 600; line-height: 1.5; border: 1px solid #e2e8f0; }
        .toggle-btn { flex: 1; padding: 10px 0; border: none; border-radius: 12px; font-weight: 900; font-size: 13px; cursor: pointer; transition: 0.2s; }
        .quick-date-btn { background: #f1f5f9; border: none; padding: 15px; border-radius: 20px; font-weight: 800; color: #475569; cursor: pointer; text-align: left; display: flex; justify-content: space-between; align-items: center; }
        .quick-date-btn:hover { background: #e2e8f0; }
      `}</style>

      <header style={isMobile ? headerMobile : headerStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
          <div style={logoCircleS}>🥗</div>
          <div>
            <h1 style={logoTitleS}>Jedzonko Planer</h1>
            <small style={{ color: '#64748b', fontWeight: '800' }}>{currentWeekDates[0].displayDate} - {currentWeekDates[6].displayDate}</small>
          </div>
        </div>
        <div style={navButtons}>
          <button onClick={() => setWeekOffset(p => p - 1)} style={btnSec}>⬅</button>
          <button onClick={() => setActiveModal('calendar-jump')} style={btnSec} title="Wybierz tydzień">📅</button>
          <button onClick={() => setWeekOffset(0)} style={weekOffset === 0 ? btnTodayActive : btnSec}>Dziś</button>
          <button onClick={() => setWeekOffset(p => p + 1)} style={btnSec}>➡</button>
          <button onClick={() => setActiveModal('stats')} style={btnStats}>📈 Statystyki</button>
          <button onClick={() => setActiveModal('product')} style={btnSec}>📦 Baza</button>
          <button onClick={() => setActiveModal('recipe')} style={btnPrim}>👨‍🍳 Przepisy</button>
          <button onClick={handleLogout} style={btnDanger}>Wyloguj</button>
        </div>
      </header>

      {/* --- GRID KALENDARZA --- */}
      <div style={layoutGrid}>
        <div style={isMobile ? mobileStack : gridStyle}>
          {!isMobile && <div />}
          {!isMobile && [...MEAL_TYPES, 'Suma'].map((m) => (<div key={m} style={mealHeader}>{m}</div>))}
          {currentWeekDates.map((day) => (
            <React.Fragment key={day.fullDate}>
              <div style={isMobile ? mobileDayLabel : dayCell}>
                <b style={{fontSize: '13px'}}>{day.name}</b>
                <small style={{fontSize: '11px', marginTop: '4px'}}>{day.displayDate}</small>
              </div>
              {MEAL_TYPES.map((type) => {
                const m = mealPlan.find((p) => p.date === day.fullDate && p.meal_type === type && p.recipes);
                const hasImg = Boolean(m?.recipes?.image_url);
                const bg = hasImg ? `linear-gradient(to bottom, rgba(0,0,0,0.01) 30%, rgba(0,0,0,0.85) 100%), url(${m.recipes.image_url})` : MEAL_COLORS[type];
                return (
                  <div key={`${day.fullDate}-${type}`} style={{ ...(m ? cellStyleActive : cellStyleEmpty), backgroundImage: m ? bg : undefined, backgroundSize: 'cover', backgroundPosition: 'center', paddingBottom: '10px' }} onClick={() => { if (!m) { setSelectedCell({ date: day.fullDate, type }); setFilterCategory(type); setActiveModal('cell'); } }}>
                    {isMobile && <span style={mobileMealTag}>{type}</span>}
                    {m ? (
                      <div style={mealContent}>
                        <div style={{ ...mealNameS, color: hasImg ? 'white' : '#1e293b' }}>{m.recipes.name}</div>
                        <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', marginTop: '12px' }}>
                          <button style={btnActionSmall} onClick={(e) => { e.stopPropagation(); setCommentingMealId(m.id); setCommentText(m.comment || ''); setActiveModal('meal-comment'); }}>📝</button>
                          <button style={btnActionSmall} onClick={(e) => { e.stopPropagation(); setViewingRecipe(m.recipes); setViewMode('desc'); setActiveModal('view-recipe'); }}>ℹ️</button>
                          <button style={btnActionSmall} onClick={(e) => { e.stopPropagation(); if (confirm('Usunąć z planu?')) supabase.from('meal_plan').delete().eq('id', m.id).then(() => fetchData()); }}>✕</button>
                        </div>
                      </div>
                    ) : (<div style={emptyCellPlus}>+</div>)}
                  </div>
                );
              })}
              <div style={isMobile ? mobileSumLabel : daySumCell}>
                {isMobile && <small>SUMA DNIA:</small>}
                <b>{dailyCosts.daily[day.fullDate]} zł</b>
              </div>
            </React.Fragment>
          ))}
        </div>
      </div>

      <div style={weekSummaryPanel}>
          <span style={{ color: '#64748b', fontWeight: '900', letterSpacing: '1px' }}>CAŁKOWITY KOSZT TYGODNIA</span>
          <div style={{ fontSize: '38px', fontWeight: '900', color: '#059669', marginTop: '5px' }}>{dailyCosts.weeklyTotal} zł</div>
      </div>

      <div style={shoppingPanel}>
        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px'}}>
          <h3 style={{ color: '#059669', margin: 0, fontSize: '20px', fontWeight: '900' }}>🛒 Lista zakupów</h3>
          <div style={{display: 'flex', gap: '10px'}}>
            <button style={btnPrimSmall} onClick={() => setActiveModal('add-to-cart')}>Dodaj +</button>
            <button style={{...btnSec, padding: '8px 14px', fontSize: '12px'}} onClick={() => { setManualCart([]); setCheckedItems({}); }}>Reset</button>
          </div>
        </div>
        <div style={shoppingGrid}>
          {finalShoppingList.map((i) => (
            <div key={i.name} onClick={() => setCheckedItems(p => ({ ...p, [i.name]: !p[i.name] }))} style={{ ...shoppingItem, opacity: checkedItems[i.name] ? 0.5 : 1, background: checkedItems[i.name] ? '#f0fdf4' : '#f8fafc' }}>
              <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                <div style={{ width: '22px', height: '22px', border: '2px solid #059669', borderRadius: '8px', background: checkedItems[i.name] ? '#059669' : 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '12px' }}>{checkedItems[i.name] && '✓'}</div>
                <div>
                  <div style={{fontWeight: '800', fontSize: '14px', textDecoration: checkedItems[i.name] ? 'line-through' : 'none'}}>{i.name}</div>
                  <div style={{fontSize: '12px', color: '#64748b'}}>{i.amount} {i.unit}</div>
                </div>
              </div>
              <b style={{color: '#059669', fontSize: '14px'}}>{i.cost} zł</b>
            </div>
          ))}
        </div>
      </div>

      {/* --- MODAL SKOKU DO DATY --- */}
      {activeModal === 'calendar-jump' && (
        <div className="sheet-container" onClick={() => setActiveModal(null)}>
          <div className="sheet-card" style={{ height: 'auto', paddingBottom: '40px' }} onClick={e => e.stopPropagation()}>
            <div className="drag-handle" />
            <div className="sheet-header">
              <h2 style={{fontSize: '22px'}}>📅 Skocz do daty</h2>
              <button onClick={() => setActiveModal(null)} style={iconBtn}>✕</button>
            </div>
            <div className="sheet-content">
              <input type="date" style={{...inputS, fontSize: '18px', marginBottom: '30px'}} onChange={(e) => jumpToDate(e.target.value)} />
              <div style={{display: 'flex', flexDirection: 'column', gap: '12px'}}>
                <button className="quick-date-btn" onClick={() => { const d = new Date(); d.setMonth(d.getMonth() - 1); jumpToDate(d.toISOString().split('T')[0]); }}><span>Miesiąc temu</span> 🕒</button>
                <button className="quick-date-btn" onClick={() => { const d = new Date(); d.setMonth(d.getMonth() - 3); jumpToDate(d.toISOString().split('T')[0]); }}><span>3 miesiące temu</span> ⏳</button>
                <button className="quick-date-btn" onClick={() => { const d = new Date(); d.setMonth(d.getMonth() - 6); jumpToDate(d.toISOString().split('T')[0]); }}><span>Pół roku temu</span> 🏛️</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* --- MODAL STATYSTYK (ODCHUDZONY) --- */}
      {activeModal === 'stats' && (
        <div className="sheet-container" onClick={() => setActiveModal(null)}>
          <div className="sheet-card" onClick={e => e.stopPropagation()}>
            <div className="drag-handle" />
            <div className="sheet-header">
              <h2>📈 Statystyki</h2>
              <button onClick={() => setActiveModal(null)} style={iconBtn}>✕</button>
            </div>
            <div className="sheet-content hide-scrollbar">
              <div style={{display: 'flex', background: '#f1f5f9', borderRadius: '20px', padding: '6px', marginBottom: '25px', width: 'fit-content', margin: '0 auto 25px auto'}}>
                <button className="toggle-btn" style={{background: statTimeRange==='month'?'#fff':'none', color: statTimeRange==='month'?'#059669':'#64748b', boxShadow: statTimeRange==='month'?'0 2px 8px rgba(0,0,0,0.05)':'none'}} onClick={()=>setStatTimeRange('month')}>Ten miesiąc</button>
                <button className="toggle-btn" style={{background: statTimeRange==='all'?'#fff':'none', color: statTimeRange==='all'?'#059669':'#64748b', boxShadow: statTimeRange==='all'?'0 2px 8px rgba(0,0,0,0.05)':'none'}} onClick={()=>setStatTimeRange('all')}>Pełen okres</button>
              </div>
              
              <div style={{...statBoxS, background: 'linear-gradient(135deg, #059669 0%, #10b981 100%)', color: '#fff', textAlign: 'center', padding: '40px 20px'}}>
                <h3 style={{margin: '0 0 10px 0', opacity: 0.9}}>Łączne wydatki</h3>
                <div style={{fontSize: '54px', fontWeight: '900'}}>{advancedStats.total} zł</div>
                <div style={{background: 'rgba(255,255,255,0.2)', padding: '10px 20px', borderRadius: '20px', display: 'inline-block', fontWeight: 'bold', marginTop: '15px'}}>Średnio: {advancedStats.avg} zł / dzień</div>
              </div>
              
              <h3 style={{margin: '30px 0 20px 0', color: '#0f172a', fontWeight: '900', fontSize: '18px'}}>⭐ Ulubione (Top 15)</h3>
              <div style={{display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '15px'}}>
                <div>
                  <small style={{display:'block', marginBottom:'10px', color:'#64748b', fontWeight:'800'}}>SKŁADNIKI</small>
                  {advancedStats.topByCount.map(([n, d]) => (
                    <div key={n} className="compact-row"><span>{n}</span><b style={{color: '#059669'}}>{d.count}x</b></div>
                  ))}
                </div>
                <div>
                  <small style={{display:'block', marginBottom:'10px', color:'#64748b', fontWeight:'800'}}>PRZEPISY</small>
                  {advancedStats.topRecs.map(([n, d]) => (
                    <div key={n} className="compact-row"><span>{n}</span><b style={{color: '#3b82f6'}}>{d.count}x</b></div>
                  ))}
                </div>
              </div>

              <h3 style={{margin: '40px 0 20px 0', color: '#0f172a', fontWeight: '900', fontSize: '18px'}}>💸 Wydatki (Najdroższe składniki)</h3>
              <div style={{display: 'flex', flexDirection: 'column'}}>
                {advancedStats.topByCost.map(([n, d]) => (
                  <div key={n} className="compact-row">
                    <span>{n}</span>
                    <b style={{color: '#ef4444'}}>{d.totalCost.toFixed(2)} zł</b>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* --- WYBÓR POSIŁKU (DO PLANU) --- */}
      {activeModal === 'cell' && (
        <div className="sheet-container" onClick={() => setActiveModal(null)}>
          <div className="sheet-card" onClick={e => e.stopPropagation()}>
            <div className="drag-handle" />
            <div className="sheet-header">
              <h2 style={{fontSize: '20px'}}>Wybierz: {selectedCell?.type}</h2>
              <button onClick={() => setActiveModal(null)} style={iconBtn}>✕</button>
            </div>
            <div className="sheet-content hide-scrollbar">
              <div style={filterBar}>
                {['Wszystkie', ...MEAL_TYPES].map(cat => (
                  <button key={cat} onClick={() => setFilterCategory(cat === 'Wszystkie' ? '' : cat)} style={filterCategory === (cat === 'Wszystkie' ? '' : cat) ? btnFilterActive : btnFilter}>{cat}</button>
                ))}
              </div>
              <div style={{marginTop: '20px'}}>
                {recipes.filter(r => !filterCategory || r.category === filterCategory).sort((a,b) => b.is_favorite - a.is_favorite).map(r => (
                  <div key={r.id} className="compact-row" onClick={async () => {
                    await supabase.from('meal_plan').insert([{ date: selectedCell.date, meal_type: selectedCell.type, recipe_id: r.id }]);
                    setActiveModal(null); fetchData();
                  }}>
                    <div style={{fontWeight:'800'}}>{r.is_favorite && '⭐ '}{r.name}</div>
                    <b style={{color: '#059669'}}>{parseFloat(r.total_cost).toFixed(2)} zł</b>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* --- WIDOK PRZEPISU + ASYSTENT AI --- */}
      {activeModal === 'view-recipe' && viewingRecipe && (
        <div className="sheet-container" onClick={() => setActiveModal(null)}>
          <div className="sheet-card" onClick={e => e.stopPropagation()}>
            <div style={{ ...heroImageS, backgroundImage: viewingRecipe.image_url ? `url(${viewingRecipe.image_url})` : sharedGradient }}>
              <button onClick={() => setActiveModal(null)} style={floatingCloseBtnS}>✕</button>
            </div>
            <div className="sheet-content hide-scrollbar" style={{marginTop: '-35px', background: '#fff', borderRadius: '35px 35px 0 0', paddingBottom: '140px'}}>
              <div style={dragHandleS} />
              <h2 style={{fontSize: '32px', fontWeight: '900', marginBottom: '10px'}}>{viewingRecipe.name}</h2>
              <div style={{display: 'flex', justifyContent: 'space-between', marginBottom: '25px'}}>
                <span style={{fontSize: '22px', fontWeight: '900', color: '#059669'}}>{parseFloat(viewingRecipe.total_cost || 0).toFixed(2)} zł</span>
                <span style={{color: '#64748b', fontWeight: '800', background: '#f1f5f9', padding: '6px 15px', borderRadius: '15px'}}>Porcje: {viewingRecipe.portions}</span>
              </div>

              <div style={{display: 'flex', gap: '10px', marginBottom: '30px', background: '#f1f5f9', padding: '6px', borderRadius: '18px'}}>
                <button className="toggle-btn" style={{background: viewMode==='desc'?'#fff':'none', boxShadow: viewMode==='desc'?'0 2px 8px rgba(0,0,0,0.05)':'none'}} onClick={()=>setViewMode('desc')}>Opis</button>
                <button className="toggle-btn" style={{background: viewMode==='steps'?'#fff':'none', boxShadow: viewMode==='steps'?'0 2px 8px rgba(0,0,0,0.05)':'none'}} onClick={()=>setViewMode('steps')}>Kroki</button>
                <button className="toggle-btn" style={{background: viewMode==='ai-assist'?'#059669':'none', color: viewMode==='ai-assist'?'#fff':'#64748b'}} onClick={()=>{ setViewMode('ai-assist'); if(aiChatHistory.length===0) setAiChatHistory([{role:'ai', text: 'Cześć! Jestem Twoim asystentem kulinarnego dopasowania. Potrzebujesz zamienników składników? Chcesz zmienić dietę tego przepisu (np. na keto, wege, bez laktozy)? Napisz mi, co chcesz zmienić!'}]); }}>✨ Asystent AI</button>
              </div>

              {viewMode === 'desc' && (
                <>
                  <h4 style={{marginBottom:'15px', fontWeight:'900'}}>🛒 Składniki</h4>
                  <div style={{display:'flex', flexWrap:'wrap', gap:'10px', marginBottom:'30px'}}>
                    {viewingRecipe.recipe_ingredients?.map((ri, idx) => (
                      <div key={idx} style={{padding:'12px 18px', background:'#f8fafc', borderRadius:'18px', border:'1px solid #e2e8f0', fontWeight:'700', fontSize:'14px'}}>
                        {ri.products?.name} <span style={{color:'#94a3b8', margin:'0 5px'}}>|</span> {ri.amount}{ri.products?.unit}
                      </div>
                    ))}
                  </div>
                  <p style={{whiteSpace:'pre-wrap', lineHeight:'1.8', color:'#475569', fontWeight:'600'}}>{viewingRecipe.instructions}</p>
                </>
              )}

              {viewMode === 'steps' && (
                <div style={{display:'flex', flexDirection:'column', gap:'15px'}}>
                  {viewingRecipe.steps?.map((s, i) => (
                    <div key={i} style={stepItemS}>
                      <div style={stepCircleS}>{i+1}</div>
                      <div style={{flex:1, fontWeight:'600', lineHeight:'1.5'}}>{renderStepWithIngredients(s, viewingRecipe.recipe_ingredients)}</div>
                    </div>
                  ))}
                </div>
              )}

              {viewMode === 'ai-assist' && (
                <div style={{display:'flex', flexDirection:'column', height:'100%', minHeight:'400px'}}>
                  <div ref={chatScrollRef} className="hide-scrollbar" style={{flex:1, overflowY:'auto', display:'flex', flexDirection:'column', gap:'12px', paddingBottom:'20px'}}>
                    {aiChatHistory.map((m, i) => (
                      <div key={i} className={m.role==='user'?'chat-bubble-u':'chat-bubble-a'}>{m.text}</div>
                    ))}
                    {isAiLoading && <div className="chat-bubble-a">Analizuję składniki i szukam zamienników... ⏳</div>}
                    
                    {aiSuggestedRecipe && (
                      <div style={{padding:'20px', background:'#ecfdf5', borderRadius:'25px', border:'2px solid #059669', textAlign:'center', marginTop:'10px'}}>
                        <div style={{fontWeight:'900', color:'#059669', marginBottom:'15px'}}>AI przygotowało nową wersję!</div>
                        <button onClick={applyAiAssistChanges} style={{...btnSuccessFull, boxShadow:'0 8px 20px rgba(5,150,105,0.2)'}}>🪄 Zapisz jako nowy przepis</button>
                      </div>
                    )}
                  </div>
                  <div style={{display:'flex', gap:'10px', padding:'15px 0', borderTop:'1px solid #f1f5f9'}}>
                    <input style={{...inputS, marginBottom:0}} placeholder="Np. brak mi jajek, zrób wersję wegańską..." value={aiChatQuery} onChange={e=>setAiChatQuery(e.target.value)} onKeyDown={e=>e.key==='Enter'&&handleAiDietAssist()} />
                    <button onClick={handleAiDietAssist} disabled={isAiLoading} style={{...btnPrim, borderRadius:'50%', width:'55px', height:'55px', flexShrink:0, fontSize:'20px'}}>➤</button>
                  </div>
                </div>
              )}
            </div>
            {viewMode !== 'ai-assist' && (
              <div style={fabContainerS}><button style={fabButtonS} onClick={() => { setCookingStep(0); setActiveModal('cooking-mode'); }}>👨‍🍳 ROZPOCZNIJ GOTOWANIE</button></div>
            )}
          </div>
        </div>
      )}

      {/* --- MODAL PRODUKTÓW (BAZA) --- */}
      {activeModal === 'product' && (
        <div className="sheet-container" onClick={() => {setActiveModal(null); setShowProductForm(false);}}>
          <div className="sheet-card" onClick={e => e.stopPropagation()}>
            <div className="drag-handle" />
            <div className="sheet-header">
              <h2>📦 Baza Produktów</h2>
              <button onClick={() => setActiveModal(null)} style={iconBtn}>✕</button>
            </div>
            <div className="sheet-content hide-scrollbar">
              {!showProductForm ? (
                <>
                  <button style={{...btnSuccessFull, marginBottom:'25px'}} onClick={()=>{setNewProd({id:null, name:'', price:'', amount:'', unit:'g'}); setShowProductForm(true);}}>+ Dodaj produkt</button>
                  {products.map(p => (
                    <div key={p.id} className="compact-row" onClick={()=>{setNewProd({id:p.id, name:p.name, price:(p.price_per_unit*p.last_input_quantity).toFixed(2), amount:p.last_input_quantity, unit:p.unit}); setShowProductForm(true);}}>
                      <div>
                        <div style={{fontWeight:'800'}}>{p.name}</div>
                        <small style={{color:'#64748b'}}>{p.last_input_quantity}{p.unit} / {(p.price_per_unit*p.last_input_quantity).toFixed(2)} zł</small>
                      </div>
                      <div style={{display:'flex', gap:'10px'}}>
                        <button style={{...btnActionSmall, background:'#fee2e2', color:'#ef4444'}} onClick={(e)=>{e.stopPropagation(); confirm('Usunąć?') && supabase.from('products').delete().eq('id', p.id).then(()=>fetchData());}}>🗑️</button>
                      </div>
                    </div>
                  ))}
                </>
              ) : (
                <div>
                  <button style={{...btnSec, marginBottom:'20px'}} onClick={()=>setShowProductForm(false)}>⬅ Wróć</button>
                  <input style={inputS} placeholder="Nazwa" value={newProd.name} onChange={e=>setNewProd({...newProd, name:e.target.value})} />
                  <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:'15px'}}>
                    <input style={inputS} type="number" placeholder="Cena (zł)" value={newProd.price} onChange={e=>setNewProd({...newProd, price:e.target.value})} />
                    <input style={inputS} type="number" placeholder="Ilość" value={newProd.amount} onChange={e=>setNewProd({...newProd, amount:e.target.value})} />
                  </div>
                  <select style={inputS} value={newProd.unit} onChange={e=>setNewProd({...newProd, unit:e.target.value})}>
                    <option value="g">gramy (g)</option><option value="ml">mililitry (ml)</option><option value="szt">sztuki (szt)</option>
                  </select>
                  <button style={btnSuccessFull} onClick={handleSaveProduct}>ZAPISZ PRODUKT</button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* --- MODAL PRZEPISÓW (LISTA + FORMULARZ) --- */}
      {activeModal === 'recipe' && (
        <div className="sheet-container" onClick={() => {setActiveModal(null); setShowRecipeForm(false);}}>
          <div className="sheet-card" onClick={e => e.stopPropagation()}>
            <div className="drag-handle" />
            <div className="sheet-header">
              <h2>👨‍🍳 Moje Przepisy</h2>
              <button onClick={() => setActiveModal(null)} style={iconBtn}>✕</button>
            </div>
            <div className="sheet-content hide-scrollbar">
              {!showRecipeForm ? (
                <>
                  <button style={{...btnSuccessFull, marginBottom:'25px'}} onClick={()=>{setNewRecipe({id:null, name:'', category:'Obiad', instructions:'', image_url:'', steps:[], ingredients:[], is_favorite:false, portions:1}); setShowRecipeForm(true);}}>+ Dodaj nowy przepis</button>
                  <div style={filterBar}>
                    {['Wszystkie', ...MEAL_TYPES].map(cat => (
                      <button key={cat} onClick={()=>setRecipeListCategory(cat==='Wszystkie'?'':cat)} style={recipeListCategory===(cat==='Wszystkie'?'':cat)?btnFilterActive:btnFilter}>{cat}</button>
                    ))}
                  </div>
                  {recipes.filter(r => !recipeListCategory || r.category===recipeListCategory).map(r => (
                    <div key={r.id} className="compact-row" onClick={()=>handleEditRecipeDirectly(r)}>
                      <div style={{fontWeight:'800'}}>{r.is_favorite && '⭐ '}{r.name}</div>
                      <div style={{display:'flex', gap:'10px', alignItems:'center'}}>
                        <b style={{color:'#059669'}}>{parseFloat(r.total_cost).toFixed(2)} zł</b>
                        <button style={{...btnActionSmall, background:'#fee2e2', color:'#ef4444'}} onClick={(e)=>{e.stopPropagation(); confirm('Usunąć?') && supabase.from('recipes').delete().eq('id',r.id).then(()=>fetchData());}}>🗑️</button>
                      </div>
                    </div>
                  ))}
                </>
              ) : (
                <div style={{paddingBottom:'40px'}}>
                  <button style={{...btnSec, marginBottom:'20px'}} onClick={()=>setShowRecipeForm(false)}>⬅ Wróć</button>
                  
                  {/* MAGIA AI */}
                  <div style={{...formBoxS, background:'#fdf4ff', borderColor:'#f0abfc', marginBottom:'25px'}}>
                    <h4 onClick={()=>setShowAiPanel(!showAiPanel)} style={{cursor:'pointer', color:'#c026d3', display:'flex', justifyContent:'space-between', margin:0}}><span>✨ Magia AI (Skanuj/URL)</span> <span>{showAiPanel?'▲':'▼'}</span></h4>
                    {showAiPanel && (
                      <div style={{marginTop:'20px', display:'flex', flexDirection:'column', gap:'15px'}}>
                        <input style={{...inputS, borderColor:'#fbcfe8'}} placeholder="Wklej link do przepisu..." value={aiUrl} onChange={e=>setAiUrl(e.target.value)} />
                        <button onClick={handleAiRecipeFromUrl} style={{...btnPrim, background:'#d946ef'}}>{isAiLoading?'Analizuję...':'Pobierz przepis'}</button>
                        <label style={{...btnPrim, textAlign:'center', background:'#d946ef', cursor:'pointer', padding:'16px'}}>
                          📷 Skanuj zdjęcie
                          <input type="file" accept="image/*" style={{display:'none'}} onChange={handleAiRecipeScan} />
                        </label>
                      </div>
                    )}
                  </div>

                  <div style={{display:'flex', gap:'10px', alignItems:'center', marginBottom:'15px'}}>
                    <input style={{...inputS, marginBottom:0, flex:1}} placeholder="Nazwa dania" value={newRecipe.name} onChange={e=>setNewRecipe({...newRecipe, name:e.target.value})} />
                    <button onClick={()=>setNewRecipe({...newRecipe, is_favorite:!newRecipe.is_favorite})} style={{...iconBtn, fontSize:'24px', background:'none'}}>{newRecipe.is_favorite?'⭐':'☆'}</button>
                  </div>
                  
                  <div style={{display:'grid', gridTemplateColumns:'1fr 120px', gap:'15px', marginBottom:'20px'}}>
                    <select style={inputS} value={newRecipe.category} onChange={e=>setNewRecipe({...newRecipe, category:e.target.value})}>{MEAL_TYPES.map(c=><option key={c} value={c}>{c}</option>)}</select>
                    <input style={inputS} type="number" placeholder="Porcje" value={newRecipe.portions} onChange={e=>setNewRecipe({...newRecipe, portions:parseInt(e.target.value)||1})} />
                  </div>

                  <h4 style={{marginBottom:'15px', fontWeight:'900'}}>Składniki</h4>
                  <div ref={searchContainerRef} style={{position:'relative', marginBottom:'15px'}}>
                    <input style={inputS} placeholder="🔍 Szukaj składnika w bazie..." value={searchQuery} onChange={e=>{setSearchQuery(e.target.value); setShowSearchDropdown(true);}} />
                    {showSearchDropdown && (
                      <div style={{position:'absolute', top:'100%', left:0, right:0, zIndex:1000, background:'#fff', borderRadius:'20px', border:'1px solid #e2e8f0', boxShadow:'0 10px 25px rgba(0,0,0,0.1)', maxHeight:'250px', overflowY:'auto'}}>
                        {products.filter(p=>p.name.toLowerCase().includes(searchQuery.toLowerCase())).map(p => (
                          <div key={p.id} style={{padding:'15px', borderBottom:'1px solid #f1f5f9', cursor:'pointer', fontWeight:'700'}} onClick={()=>{setNewRecipe({...newRecipe, ingredients:[...newRecipe.ingredients, {...p, amount:100}]}); setSearchQuery(''); setShowSearchDropdown(false);}}>
                            {p.name} <small style={{color:'#94a3b8'}}>({p.unit})</small>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div style={{display:'flex', flexDirection:'column', gap:'10px', marginBottom:'30px'}}>
                    {newRecipe.ingredients.map((ing, idx) => (
                      <div key={idx} style={{...compactRow, background:'#f8fafc', padding:'15px'}}>
                        <span style={{fontWeight:'700', color: ing.id ? '#0f172a' : '#ef4444', flex:1}}>{ing.name}</span>
                        <input type="number" style={{...inputS, width:'80px', marginBottom:0, padding:'8px'}} value={ing.amount} onChange={e=>{const c=[...newRecipe.ingredients]; c[idx].amount=e.target.value; setNewRecipe({...newRecipe, ingredients:c});}} />
                        <small style={{fontWeight:'900', margin:'0 10px', width:'30px'}}>{ing.unit}</small>
                        <button style={{...iconBtn, width:'32px', height:'32px', color:'#ef4444'}} onClick={()=>setNewRecipe({...newRecipe, ingredients: newRecipe.ingredients.filter((_, i)=>i!==idx)})}>✕</button>
                      </div>
                    ))}
                  </div>

                  <h4 style={{marginBottom:'15px', fontWeight:'900'}}>Kroki gotowania</h4>
                  {newRecipe.steps.map((s, i) => (
                    <div key={i} style={{display:'flex', gap:'10px', marginBottom:'10px'}}>
                      <div style={stepCircleS}>{i+1}</div>
                      <textarea style={{...inputS, marginBottom:0, minHeight:'60px', flex:1}} value={s} onChange={e=>{const c=[...newRecipe.steps]; c[i]=e.target.value; setNewRecipe({...newRecipe, steps:c});}} />
                      <button style={{...iconBtn, color:'#ef4444'}} onClick={()=>setNewRecipe({...newRecipe, steps: newRecipe.steps.filter((_, idx)=>idx!==i)})}>✕</button>
                    </div>
                  ))}
                  <button style={{...btnSec, width:'100%', marginBottom:'30px'}} onClick={()=>setNewRecipe({...newRecipe, steps:[...newRecipe.steps, '']})}>+ Dodaj krok</button>

                  <textarea style={{...inputS, minHeight:'100px'}} placeholder="Instrukcje / Opis ogólny..." value={newRecipe.instructions} onChange={e=>setNewRecipe({...newRecipe, instructions:e.target.value})} />
                  
                  <button style={{...btnSuccessFull, padding:'20px', fontSize:'18px'}} onClick={handleSaveRecipe}>ZAPISZ PRZEPIS</button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* --- MODAL DODAWANIA DO KOSZYKA (INDYWIDUALNIE) --- */}
      {activeModal === 'add-to-cart' && (
        <div className="sheet-container" onClick={() => setActiveModal(null)}>
          <div className="sheet-card" style={{height:'80vh'}} onClick={e => e.stopPropagation()}>
            <div className="drag-handle" />
            <div className="sheet-header">
              <h2>🛒 Dodaj do zakupów</h2>
              <button onClick={() => setActiveModal(null)} style={iconBtn}>✕</button>
            </div>
            <div className="sheet-content hide-scrollbar">
              <div style={filterBar}>
                <button className="toggle-btn" style={{background: cartModalTab==='recipes'?'#059669':'#f1f5f9', color: cartModalTab==='recipes'?'#fff':'#64748b'}} onClick={()=>setCartModalTab('recipes')}>Z przepisów</button>
                <button className="toggle-btn" style={{background: cartModalTab==='products'?'#059669':'#f1f5f9', color: cartModalTab==='products'?'#fff':'#64748b'}} onClick={()=>setCartModalTab('products')}>Produkty</button>
              </div>
              <div style={{marginTop:'20px'}}>
                {cartModalTab === 'recipes' ? recipes.map(r => (
                  <div key={r.id} className="compact-row" onClick={() => { setManualCart(p => [...p, ...r.recipe_ingredients.map(ri => ({ ...ri.products, amount: ri.amount, pricePU: ri.products.price_per_unit }))]); setActiveModal(null); }}>
                    <span style={{fontWeight:'800'}}>{r.name}</span>
                    <button style={{...btnPrim, padding:'8px 15px', fontSize:'12px'}}>+ Cały przepis</button>
                  </div>
                )) : products.map(p => (
                  <div key={p.id} className="compact-row" onClick={() => { setManualCart(prev => [...prev, {...p, amount: p.last_input_quantity || 100, pricePU: p.price_per_unit}]); setActiveModal(null); }}>
                    <span style={{fontWeight:'800'}}>{p.name}</span>
                    <button style={{...btnPrim, background:'#3b82f6', padding:'8px 15px', fontSize:'12px'}}>+ Dodaj</button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* --- TRYB GOTOWANIA --- */}
      {activeModal === 'cooking-mode' && viewingRecipe && (
        <div style={cookingOverlayS}>
          <div style={cookingCardS}>
            <div style={{display:'flex', justifyContent:'space-between', marginBottom:'30px'}}>
              <button onClick={() => setActiveModal('view-recipe')} style={{...btnSec, borderRadius:'20px', padding:'12px 25px'}}>⬅ Powrót</button>
              <div style={{display:'flex', gap:'10px'}}>
                <button onClick={() => setIsTtsActive(!isTtsActive)} style={{...btnSec, background: isTtsActive ? '#e0e7ff':'#f1f5f9', color: isTtsActive ? '#4f46e5':'#475569'}}>{isTtsActive?'🔊 ON':'🔈 OFF'}</button>
                <button onClick={toggleVoiceMode} style={{...btnSec, background: isVoiceActive ? '#fee2e2':'#f1f5f9', color: isVoiceActive ? '#ef4444':'#475569'}}>{isVoiceActive?'🔴 SŁUCHAM':'🎙️ MIKROFON'}</button>
              </div>
            </div>
            <div style={{textAlign:'center', fontSize: isMobile ? '24px' : '38px', fontWeight: '800', flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: '1.4', padding: '0 20px'}}>
              {renderStepWithIngredients(viewingRecipe.steps[cookingStep], viewingRecipe.recipe_ingredients)}
            </div>
            <div style={{display:'flex', gap:'20px', marginTop:'30px'}}>
              <button style={{...btnSuccessFull, background:'#f1f5f9', color:'#1e293b'}} onClick={() => setCookingStep(p => Math.max(0, p-1))} disabled={cookingStep===0}>Wstecz</button>
              <button style={btnSuccessFull} onClick={() => cookingStep === viewingRecipe.steps.length-1 ? setActiveModal('view-recipe') : setCookingStep(p => p+1)}>
                {cookingStep === viewingRecipe.steps.length-1 ? 'ZAKOŃCZ 🎉' : 'Następny ➡'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// --- WIDOK LOGOWANIA ---
function LoginView() {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const handleLogin = async (e) => { e.preventDefault(); const { error } = await supabase.auth.signInWithPassword({ email, password }); if (error) alert(error.message); };
  return (
    <div style={loginOverlay}>
      <form onSubmit={handleLogin} style={loginForm}>
        <div style={{textAlign:'center', marginBottom:'30px'}}>
          <div style={{...logoCircleS, margin:'0 auto 15px auto', width:'70px', height:'70px', fontSize:'36px'}}>🥗</div>
          <h2 style={{ color: '#059669', fontSize: '28px', fontWeight: '900' }}>Jedzonko Planer</h2>
          <p style={{color:'#64748b', fontWeight:'700'}}>Zaloguj się, aby planować posiłki</p>
        </div>
        <input style={inputS} type="email" placeholder="Email" onChange={e => setEmail(e.target.value)} />
        <input style={inputS} type="password" placeholder="Hasło" onChange={e => setPassword(e.target.value)} />
        <button style={{...btnSuccessFull, padding:'20px', marginTop:'10px'}}>Zaloguj się</button>
      </form>
    </div>
  );
}

// --- STYLE (PEŁNE) ---
const appContainer = { padding: '15px', backgroundColor: '#f8fafc', minHeight: '100vh', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' };
const headerStyle = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', background: 'white', padding: '20px', borderRadius: '35px', boxShadow: '0 4px 25px rgba(0,0,0,0.03)' };
const headerMobile = { ...headerStyle, flexDirection: 'column', gap: '15px' };
const logoTitleS = { margin: 0, color: '#059669', fontSize: '22px', fontWeight: '900' };
const logoCircleS = { width: '50px', height: '50px', backgroundColor: '#ecfdf5', borderRadius: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '3px solid #059669', fontSize: '26px' };
const navButtons = { display: 'flex', gap: '10px', flexWrap: 'wrap', justifyContent: 'center' };
const btnTodayActive = { background: '#059669', color: 'white', border: 'none', padding: '12px 22px', borderRadius: '25px', fontWeight: '900', fontSize: '13px', cursor: 'pointer' };
const btnSec = { background: '#f1f5f9', color: '#475569', border: 'none', padding: '12px 22px', borderRadius: '25px', cursor: 'pointer', fontWeight: '900', fontSize: '13px' };
const btnPrim = { background: '#059669', color: 'white', border: 'none', padding: '12px 22px', borderRadius: '25px', fontWeight: '900', cursor: 'pointer', fontSize: '13px' };
const btnPrimSmall = { ...btnPrim, padding: '10px 18px', fontSize: '12px' };
const btnStats = { background: '#3b82f6', color: 'white', border: 'none', padding: '12px 22px', borderRadius: '25px', fontWeight: '900', fontSize: '13px', cursor: 'pointer' };
const btnDanger = { background: '#fef2f2', color: '#ef4444', border: 'none', padding: '12px 22px', borderRadius: '25px', fontWeight: '900', fontSize: '13px', cursor: 'pointer' };
const gridStyle = { display: 'grid', gridTemplateColumns: '120px repeat(6, 1fr)', gap: '15px' };
const layoutGrid = { display: 'grid', gridTemplateColumns: '1fr', gap: '20px' };
const mobileStack = { display: 'flex', flexDirection: 'column', gap: '15px' };
const dayCell = { background: 'white', padding: '25px 10px', borderRadius: '35px', textAlign: 'center', borderLeft: '8px solid #059669', display: 'flex', flexDirection: 'column', justifyContent: 'center', boxShadow: '0 4px 15px rgba(0,0,0,0.02)' };
const mobileDayLabel = { background: '#0f172a', color: 'white', padding: '20px', borderRadius: '35px', fontWeight: '900', textAlign: 'center', fontSize: '16px' };
const mealHeader = { textAlign: 'center', fontWeight: '900', color: '#94a3b8', fontSize: '13px' };
const cellStyleEmpty = { minHeight: '130px', background: '#f8fafc', borderRadius: '35px', border: '3px dashed #cbd5e1', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', position: 'relative', overflow: 'hidden' };
const cellStyleActive = { ...cellStyleEmpty, border: 'none', boxShadow: '0 15px 30px -10px rgba(0,0,0,0.08)' };
const emptyCellPlus = { width: '45px', height: '45px', borderRadius: '50%', background: '#e2e8f0', color: '#64748b', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '900', fontSize: '26px' };
const mealContent = { width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', padding: '20px 10px 24px 10px' };
const mealNameS = { fontWeight: '900', fontSize: '14px', textAlign: 'center', color: '#1e293b', lineHeight: '1.4' };
const daySumCell = { background: '#f0fdf4', padding: '25px', borderRadius: '35px', textAlign: 'center', border: '2px dashed #059669' };
const mobileSumLabel = { background: '#059669', color: 'white', padding: '20px', borderRadius: '35px', fontWeight: '900', display: 'flex', justifyContent: 'space-between', alignItems: 'center' };
const weekSummaryPanel = { margin: '35px 0', background: 'white', padding: '35px', borderRadius: '45px', border: '4px solid #059669', boxShadow: '0 25px 50px -15px rgba(5,150,105,0.15)' };
const btnActionSmall = { border: 'none', borderRadius: '16px', width: '38px', height: '38px', cursor: 'pointer', background: 'rgba(255,255,255,0.3)', backdropFilter: 'blur(8px)', color:'#fff', fontSize: '16px' };
const mobileMealTag = { position: 'absolute', top: '15px', left: '15px', fontSize: '11px', fontWeight: '900', opacity: 0.9 };
const shoppingPanel = { marginTop: '35px', background: 'white', padding: '35px', borderRadius: '45px', boxShadow: '0 10px 40px rgba(0,0,0,0.04)' };
const shoppingGrid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '15px' };
const shoppingItem = { padding: '18px', borderRadius: '25px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid #f1f5f9' };
const inputS = { width: '100%', padding: '18px 25px', marginBottom: '18px', borderRadius: '28px', border: '2px solid #e2e8f0', fontSize: '16px', background:'#f8fafc', fontWeight: '700', outline: 'none', boxSizing: 'border-box' };
const btnSuccessFull = { background: '#059669', color: 'white', border: 'none', padding: '20px', borderRadius: '32px', width: '100%', fontWeight: '900', cursor: 'pointer', fontSize:'17px', boxShadow: '0 12px 25px rgba(5,150,105,0.25)' };
const btnFilter = { background: '#f1f5f9', color: '#64748b', border: 'none', padding: '14px 28px', borderRadius: '25px', fontWeight: '900', fontSize: '13px' };
const btnFilterActive = { ...btnFilter, background: '#059669', color: 'white', boxShadow: '0 6px 15px rgba(5,150,105,0.25)' };
const filterBar = { display: 'flex', gap: '12px', marginBottom: '25px', overflowX: 'auto', paddingBottom: '10px' };
const iconBtn = { border: 'none', background: '#f1f5f9', borderRadius: '50%', width: '45px', height: '45px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#475569' };
const loginOverlay = { height: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'center', background: '#f3f4f6' };
const loginForm = { background: 'white', padding: '55px 45px', borderRadius: '45px', width: '90%', maxWidth: '440px', boxShadow: '0 30px 60px -15px rgba(0,0,0,0.12)' };
const loadingStyle = { display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', color: '#059669', fontSize: '22px', fontWeight: '900' };
const formBoxS = { background: '#f8fafc', padding: '30px', borderRadius: '35px', border: '2px solid #e2e8f0' };
const stepItemS = { padding: '22px', background: '#f8fafc', borderRadius: '28px', marginBottom: '15px', display: 'flex', gap: '18px', alignItems: 'center' };
const stepCircleS = { width: '40px', height: '40px', background: '#059669', color: 'white', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '900', flexShrink: 0 };
const statBoxS = { padding: '35px', borderRadius: '40px', marginBottom: '25px' };
const heroImageS = { height: '38%', width: '100%', backgroundSize: 'cover', backgroundPosition: 'center', position: 'relative' };
const floatingCloseBtnS = { position: 'absolute', top: '25px', right: '25px', width: '48px', height: '48px', borderRadius: '50%', background: 'rgba(15,23,42,0.6)', color: '#fff', border:'none', backdropFilter:'blur(10px)', fontWeight: '900', cursor: 'pointer' };
const immersiveContentS = { flex: 1, padding: '40px', overflowY: 'auto', marginTop:'-40px', background:'#fff', borderTopLeftRadius:'45px', borderTopRightRadius:'45px' };
const dragHandleS = { width: '55px', height: '7px', background: '#cbd5e1', borderRadius: '10px', margin: '0 auto 30px auto' };
const fabContainerS = { position: 'absolute', bottom: '35px', left: 0, right: 0, display: 'flex', justifyContent: 'center' };
const fabButtonS = { background: '#059669', color: '#fff', border: 'none', padding: '22px 50px', borderRadius: '60px', fontWeight: '900', fontSize: '17px', boxShadow: '0 18px 35px rgba(5,150,105,0.4)', cursor: 'pointer' };
const cookingOverlayS = { position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', zIndex: 1200, background: 'rgba(0,0,0,0.95)', display: 'flex', justifyContent: 'center', alignItems: 'flex-end' };
const cookingCardS = { width: '100%', maxWidth: '800px', height: '95vh', background: '#fff', borderRadius: '40px 40px 0 0', padding: '30px', display: 'flex', flexDirection: 'column' };