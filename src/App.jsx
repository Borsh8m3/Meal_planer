import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from 'react';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY);

// Klucz do Google Gemini AI
const GEMINI_API_KEY = (import.meta.env.VITE_GEMINI_API_KEY || '').trim();

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

const sharedGradient = 'linear-gradient(135deg, #dcfce7 0%, #e2e8f0 100%)';
const MEAL_COLORS = {
  Śniadanie: sharedGradient,
  Lunch: sharedGradient,
  Obiad: sharedGradient,
  Podwieczorek: sharedGradient,
  Kolacja: sharedGradient,
};

const renderStepWithIngredients = (text, ingredients) => {
  if (!text || !ingredients || ingredients.length === 0) return text;
  let parts = [{ text: text, isIng: false }];

  ingredients.forEach((ri) => {
    const name = ri.products?.name || ri.name;
    if (!name) return;

    const words = name.split(' ').filter((w) => w.length > 2);
    const searchWord = words.length > 0 ? words[0] : name;

    const minLen = Math.max(3, searchWord.length - 2);
    const stem = searchWord.toLowerCase().substring(0, minLen);
    const safeStem = stem.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');

    const newParts = [];
    parts.forEach((part) => {
      if (part.isIng) {
        newParts.push(part);
        return;
      }
      const regex = new RegExp(`(${safeStem}[a-ząćęłńóśźż]*)`, 'gi');
      const splits = part.text.split(regex);

      splits.forEach((s) => {
        if (!s) return;
        if (s.toLowerCase().startsWith(stem)) {
          const displayUnit = ri.products?.unit || ri.unit || '';
          newParts.push({
            text: s,
            isIng: true,
            ri: { amount: ri.amount, unit: displayUnit },
          });
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
        <span
          key={i}
          style={{
            color: '#059669',
            fontWeight: '800',
            backgroundColor: '#ecfdf5',
            padding: '2px 6px',
            borderRadius: '6px',
            whiteSpace: 'nowrap',
            border: '1px solid #a7f3d0',
          }}
        >
          {p.text} ({p.ri.amount} {p.ri.unit})
        </span>
      );
    }
    return <span key={i}>{p.text}</span>;
  });
};

export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [products, setProducts] = useState([]);
  const [recipes, setRecipes] = useState([]);
  const [mealPlan, setMealPlan] = useState([]);
  const [weekOffset, setWeekOffset] = useState(0);

  const [isMobile, setIsMobile] = useState(window.innerWidth < 900);
  const [isLandscape, setIsLandscape] = useState(
    window.innerWidth > window.innerHeight
  );

  const [manualCart, setManualCart] = useState([]);
  const [checkedItems, setCheckedItems] = useState({});

  const [activeModal, setActiveModal] = useState(null);
  const [selectedCell, setSelectedCell] = useState(null);
  const [viewingRecipe, setViewingRecipe] = useState(null);
  const [viewMode, setViewMode] = useState('desc');
  const [filterCategory, setFilterCategory] = useState('');
  const [recipeListCategory, setRecipeListCategory] = useState('');
  const [statTab, setStatTab] = useState('summary');

  const [cookingStep, setCookingStep] = useState(0);
  const [isVoiceActive, setIsVoiceActive] = useState(false);
  const [lastHeard, setLastHeard] = useState('');
  const recognitionRef = useRef(null);
  const isVoiceActiveRef = useRef(isVoiceActive);
  const stepsLengthRef = useRef(0);

  const [isAiLoading, setIsAiLoading] = useState(false);
  const [showAiPanel, setShowAiPanel] = useState(false);
  const [aiUrl, setAiUrl] = useState('');

  const [showRecipeForm, setShowRecipeForm] = useState(false);
  const [showProductForm, setShowProductForm] = useState(false);
  const [cartModalTab, setCartModalTab] = useState('recipes');

  const [commentText, setCommentText] = useState('');
  const [commentingMealId, setCommentingMealId] = useState(null);

  // Zmienne do dropdowna w wyszukiwarce
  const [showSearchDropdown, setShowSearchDropdown] = useState(false);
  const searchContainerRef = useRef(null);

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

  // Chowanie dropdowna po kliknięciu w tło
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        searchContainerRef.current &&
        !searchContainerRef.current.contains(event.target)
      ) {
        setShowSearchDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    document.title = 'Jedzonko Planer 🥗';
    const existingFavicons = document.querySelectorAll("link[rel*='icon']");
    existingFavicons.forEach((el) => el.remove());

    const link = document.createElement('link');
    link.rel = 'icon';
    link.href =
      'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">🥗</text></svg>';
    document.head.appendChild(link);

    const handleResize = () => {
      setIsMobile(window.innerWidth < 900);
      setIsLandscape(window.innerWidth > window.innerHeight);
    };
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

  useEffect(() => {
    if (viewingRecipe?.steps) {
      stepsLengthRef.current = viewingRecipe.steps.length;
    } else {
      stepsLengthRef.current = 0;
    }
  }, [viewingRecipe]);

  useEffect(() => {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.lang = 'pl-PL';
      recognition.continuous = true;
      recognition.interimResults = false;

      recognition.onresult = (event) => {
        const currentIdx = event.resultIndex;
        const transcript = event.results[currentIdx][0].transcript
          .toLowerCase()
          .trim();
        setLastHeard(transcript);

        if (
          transcript.includes('dalej') ||
          transcript.includes('następny') ||
          transcript.includes('kolejn')
        ) {
          setCookingStep((prev) =>
            Math.min(prev + 1, Math.max(0, stepsLengthRef.current - 1))
          );
        } else if (
          transcript.includes('wstecz') ||
          transcript.includes('poprzedni') ||
          transcript.includes('cofnij') ||
          transcript.includes('wróć')
        ) {
          setCookingStep((prev) => Math.max(prev - 1, 0));
        } else if (
          transcript.includes('zamknij') ||
          transcript.includes('koniec') ||
          transcript.includes('zakończ')
        ) {
          setActiveModal('view-recipe');
          setIsVoiceActive(false);
        }
      };

      recognition.onerror = (event) => {
        console.error('Błąd rozpoznawania:', event.error);
        if (event.error === 'not-allowed') setIsVoiceActive(false);
      };

      recognition.onend = () => {
        if (isVoiceActiveRef.current) {
          try {
            recognition.start();
          } catch (e) {}
        }
      };

      recognitionRef.current = recognition;
    }

    return () => {
      if (recognitionRef.current) recognitionRef.current.stop();
    };
  }, []);

  useEffect(() => {
    isVoiceActiveRef.current = isVoiceActive;
    if (isVoiceActive && recognitionRef.current) {
      setLastHeard('');
      try {
        recognitionRef.current.start();
      } catch (e) {}
    } else if (!isVoiceActive && recognitionRef.current) {
      recognitionRef.current.stop();
    }
  }, [isVoiceActive]);

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

  const advancedStats = useMemo(() => {
    const monthlySpending = {};
    const ingredientStats = {};
    const mealTypeCosts = {
      Śniadanie: 0,
      Lunch: 0,
      Obiad: 0,
      Podwieczorek: 0,
      Kolacja: 0,
    };
    let currentMonthCost = 0;

    const currentMonthLabel = new Date().toLocaleDateString('pl-PL', {
      month: 'long',
      year: 'numeric',
    });

    mealPlan.forEach((meal) => {
      const recipe = recipes.find((r) => r.id === meal.recipe_id);
      if (!recipe) return;
      const cost = parseFloat(recipe.total_cost || 0);

      const dateObj = new Date(meal.date);
      const monthLabel = dateObj.toLocaleDateString('pl-PL', {
        month: 'long',
        year: 'numeric',
      });

      monthlySpending[monthLabel] = (monthlySpending[monthLabel] || 0) + cost;
      if (monthLabel === currentMonthLabel) currentMonthCost += cost;

      if (mealTypeCosts[meal.meal_type] !== undefined) {
        mealTypeCosts[meal.meal_type] += cost;
      }

      recipe.recipe_ingredients?.forEach((ri) => {
        const p = ri.products;
        if (!p) return;
        if (!ingredientStats[p.name])
          ingredientStats[p.name] = { count: 0, totalCost: 0, unit: p.unit };
        ingredientStats[p.name].count += 1;
        ingredientStats[p.name].totalCost += p.price_per_unit * ri.amount;
      });
    });

    const topByCount = Object.entries(ingredientStats)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 5);
    const topByCost = Object.entries(ingredientStats)
      .sort((a, b) => b[1].totalCost - a[1].totalCost)
      .slice(0, 6);

    const maxMonthly = Math.max(0, ...Object.values(monthlySpending));
    const maxMealType = Math.max(0, ...Object.values(mealTypeCosts));
    const maxIngCost = topByCost.length > 0 ? topByCost[0][1].totalCost : 0;

    const uniqueDays = new Set(mealPlan.map((m) => m.date)).size;
    const avgDailyCost =
      uniqueDays > 0 ? (currentMonthCost / uniqueDays).toFixed(2) : 0;

    return {
      monthly: Object.entries(monthlySpending).reverse(),
      topByCount,
      topByCost,
      mealTypeCosts: Object.entries(mealTypeCosts).sort((a, b) => b[1] - a[1]),
      currentMonthLabel,
      currentMonthCost: currentMonthCost.toFixed(2),
      avgDailyCost,
      plannedMealsCount: mealPlan.length,
      maxMonthly,
      maxMealType,
      maxIngCost,
    };
  }, [mealPlan, recipes]);

  const finalShoppingList = useMemo(() => {
    const combined = {};
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

  const dailyCosts = useMemo(() => {
    const daily = {};
    let weeklyTotal = 0;
    weekDates.forEach((d) => {
      const dayMeals = mealPlan.filter((m) => m.date === d.fullDate);
      let daySum = 0;
      dayMeals.forEach((m) => {
        const r = recipes.find((rec) => rec.id === m.recipe_id);
        if (r?.total_cost) daySum += parseFloat(r.total_cost);
      });
      daily[d.fullDate] = daySum.toFixed(2);
      weeklyTotal += daySum;
    });
    return { daily, weeklyTotal: weeklyTotal.toFixed(2) };
  }, [weekDates, mealPlan, recipes]);

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () =>
        setNewRecipe((prev) => ({ ...prev, image_url: reader.result }));
      reader.readAsDataURL(file);
    }
  };

  const processAiResponse = (data) => {
    if (data.error) throw new Error(data.error.message);
    if (!data.candidates || data.candidates.length === 0) {
      throw new Error('Odpowiedź od AI jest pusta.');
    }

    let jsonText = data.candidates[0].content.parts[0].text;
    jsonText = jsonText
      .replace(/```json\n?/gi, '')
      .replace(/```/gi, '')
      .trim();

    const aiRecipe = JSON.parse(jsonText);

    // MĄDRZEJSZE MAPOWANIE SKŁADNIKÓW Z AI
    const mappedIngredients = (aiRecipe.ingredients || []).map((aiIng) => {
      const aiNameLower = aiIng.name.toLowerCase();

      // 1. Dokładne dopasowanie
      let foundDbProduct = products.find(
        (p) => p.name.toLowerCase() === aiNameLower
      );

      // 2. Dopasowanie częściowe (inkluzja w obie strony)
      if (!foundDbProduct) {
        foundDbProduct = products.find(
          (p) =>
            p.name.toLowerCase().includes(aiNameLower) ||
            aiNameLower.includes(p.name.toLowerCase())
        );
      }

      // 3. Dopasowanie po słowach (szukanie np. słowa "mąka" w "mąka pszenna typ 500")
      if (!foundDbProduct) {
        const words = aiNameLower.split(/[\s,.-]+/).filter((w) => w.length > 3);
        for (const word of words) {
          foundDbProduct = products.find((p) =>
            p.name.toLowerCase().includes(word)
          );
          if (foundDbProduct) break;
        }
      }

      if (foundDbProduct) {
        return {
          ...foundDbProduct,
          amount: aiIng.amount || 100,
          unit: aiIng.unit || foundDbProduct.unit,
        };
      }

      // Brak w bazie
      return {
        id: null,
        name: `⚠️ ${aiIng.name}`,
        amount: aiIng.amount || 100,
        unit: aiIng.unit || 'g',
      };
    });

    setNewRecipe((prev) => ({
      ...prev,
      name: aiRecipe.name || prev.name || '',
      instructions: aiRecipe.instructions || prev.instructions || '',
      steps: aiRecipe.steps || prev.steps || [],
      ingredients: [...prev.ingredients, ...mappedIngredients],
    }));
  };

  const handleAiRecipeScan = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!GEMINI_API_KEY) {
      alert(
        'Brak klucza API! Dodaj VITE_GEMINI_API_KEY do GitHub Secrets i przebuduj apkę.'
      );
      return;
    }

    setIsAiLoading(true);
    try {
      const base64data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const prompt = `Jesteś ekspertem kulinarnym. Przeanalizuj załączone zdjęcie przepisu. Zwróć odpowiedź TYLKO I WYŁĄCZNIE jako poprawny obiekt JSON. Format:
      {
        "name": "Nazwa dania",
        "instructions": "Krótki opis, wstęp lub notatki do przepisu",
        "steps": ["krok 1", "krok 2", "krok 3"],
        "ingredients": [
          {"name": "Składnik 1", "amount": 100, "unit": "g"}
        ]
      }`;

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.0-flash-preview:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  { text: prompt },
                  { inlineData: { mimeType: file.type, data: base64data } },
                ],
              },
            ],
            generationConfig: { responseMimeType: 'application/json' },
          }),
        }
      );

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Błąd API: ${response.status} - ${errText}`);
      }

      const data = await response.json();
      processAiResponse(data);
    } catch (err) {
      console.error('Błąd parsowania lub API:', err);
      alert(`Wystąpił błąd podczas analizy zdjęcia:\n${err.message}`);
    } finally {
      setIsAiLoading(false);
      setShowAiPanel(false);
    }
  };

  const handleAiRecipeFromUrl = async () => {
    if (!aiUrl) return;
    if (!GEMINI_API_KEY) {
      alert(
        'Brak klucza API! Dodaj VITE_GEMINI_API_KEY do GitHub Secrets i przebuduj apkę.'
      );
      return;
    }

    setIsAiLoading(true);
    try {
      const prompt = `Jesteś ekspertem kulinarnym. Przeczytaj i przeanalizuj przepis znajdujący się na podanej stronie internetowej: ${aiUrl}. Zwróć odpowiedź TYLKO I WYŁĄCZNIE jako poprawny obiekt JSON. Format:
      {
        "name": "Nazwa dania",
        "instructions": "Krótki opis, wstęp lub notatki do przepisu",
        "steps": ["krok 1", "krok 2", "krok 3"],
        "ingredients": [
          {"name": "Składnik 1", "amount": 100, "unit": "g"}
        ]
      }`;

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.0-flash-preview:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: 'application/json' },
          }),
        }
      );

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Błąd API: ${response.status} - ${errText}`);
      }

      const data = await response.json();
      processAiResponse(data);
      setAiUrl('');
      setShowAiPanel(false);
    } catch (err) {
      console.error('Błąd parsowania lub API:', err);
      alert(`Wystąpił błąd podczas analizy linku:\n${err.message}`);
    } finally {
      setIsAiLoading(false);
    }
  };

  const handleSaveRecipe = async () => {
    if (!newRecipe.name) return;

    const validIngredients = newRecipe.ingredients.filter(
      (ing) => ing.id || ing.product_id
    );
    const calc = (ing) =>
      parseFloat(ing.price_per_unit || ing.products?.price_per_unit || 0) *
      parseFloat(ing.amount || 0);
    const tCost = validIngredients.reduce((s, i) => s + calc(i), 0).toFixed(2);

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

    const ings = validIngredients.map((ing) => ({
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
    setShowRecipeForm(false);
    fetchData();
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
    setShowProductForm(false);
    fetchData();
  };

  const handleEditRecipeDirectly = (recipeInfo) => {
    const fullRecipe = recipes.find((r) => r.id === recipeInfo.id);
    if (!fullRecipe) return;
    setNewRecipe({
      ...fullRecipe,
      ingredients: (fullRecipe.recipe_ingredients || []).map((ri) => ({
        ...ri.products,
        amount: ri.amount,
        product_id: ri.product_id,
      })),
    });
    setRecipeListCategory(fullRecipe.category || 'Obiad');
    setShowRecipeForm(true);
    setActiveModal('recipe');
    setTimeout(() => {
      const scrollContainer = document.querySelector(
        '.recipe-scroll-container'
      );
      if (scrollContainer) scrollContainer.scrollTop = 0;
    }, 50);
  };

  const handleToggleFavorite = async (recipeId, currentStatus) => {
    await supabase
      .from('recipes')
      .update({ is_favorite: !currentStatus })
      .eq('id', recipeId);
    fetchData();
  };

  if (loading) return <div style={loadingStyle}>🍳 Ładowanie...</div>;
  if (!session) return <LoginView />;

  return (
    <div style={appContainer}>
      <header style={isMobile ? headerMobile : headerStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
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
          <button
            onClick={() => {
              setStatTab('summary');
              setActiveModal('stats');
            }}
            style={btnStats}
          >
            📈 Statystyki
          </button>
          <button onClick={() => setActiveModal('product')} style={btnSec}>
            📦
          </button>
          <button onClick={() => setActiveModal('recipe')} style={btnPrim}>
            👨‍🍳
          </button>
          <button onClick={handleLogout} style={btnDanger}>
            Wyloguj
          </button>
        </div>
      </header>

      {/* KALENDARZ - Widok główny */}
      <div style={layoutGrid}>
        <div style={isMobile ? mobileStack : gridStyle}>
          {!isMobile && <div />}
          {!isMobile &&
            [...MEAL_TYPES, 'Suma'].map((m) => (
              <div key={m} style={mealHeader}>
                {m}
              </div>
            ))}

          {weekDates.map((day) => (
            <React.Fragment key={day.fullDate}>
              <div style={isMobile ? mobileDayLabel : dayCell}>
                <b
                  style={{
                    fontSize: '12px',
                    wordBreak: 'break-word',
                    hyphens: 'auto',
                    width: '100%',
                    lineHeight: '1.2',
                  }}
                >
                  {day.name}
                </b>
                {!isMobile && <br />}
                <small
                  style={{
                    fontSize: '10px',
                    color: isMobile ? '#cbd5e1' : '#64748b',
                    marginTop: '4px',
                  }}
                >
                  {day.displayDate}
                </small>
              </div>

              {MEAL_TYPES.map((type) => {
                const m = mealPlan.find(
                  (p) =>
                    p.date === day.fullDate && p.meal_type === type && p.recipes
                );
                const hasImage = Boolean(
                  m?.recipes?.image_url && m.recipes.image_url.trim() !== ''
                );
                const bgStyle = hasImage
                  ? `linear-gradient(to bottom, rgba(0,0,0,0.1) 40%, rgba(0,0,0,0.8) 100%), url(${m.recipes.image_url})`
                  : MEAL_COLORS[type];

                return (
                  <div
                    key={`${day.fullDate}-${type}`}
                    style={{
                      ...(m ? cellStyleActive : cellStyleEmpty),
                      backgroundImage: m ? bgStyle : undefined,
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
                    {isMobile && (
                      <span
                        style={{
                          ...mobileMealTag,
                          color: hasImage ? 'white' : '#475569',
                          textShadow: hasImage
                            ? '0 1px 2px rgba(0,0,0,0.8)'
                            : 'none',
                        }}
                      >
                        {type}
                      </span>
                    )}

                    {m ? (
                      <div style={mealContent}>
                        <div
                          style={{
                            ...mealNameS,
                            color: hasImage ? 'white' : '#1e293b',
                            textShadow: hasImage
                              ? '0 2px 4px rgba(0,0,0,0.5)'
                              : 'none',
                          }}
                        >
                          {m.recipes.is_favorite && '⭐ '}
                          {m.recipes.name}
                          {m.comment && (
                            <span
                              style={{ marginLeft: '4px' }}
                              title="Masz notatkę do tego posiłku"
                            >
                              📝
                            </span>
                          )}
                        </div>
                        <div
                          style={{
                            display: 'flex',
                            gap: '6px',
                            justifyContent: 'center',
                            marginTop: '8px',
                          }}
                        >
                          <button
                            style={{
                              ...btnActionSmall,
                              color: hasImage ? 'white' : '#f59e0b',
                              background: hasImage
                                ? 'rgba(255,255,255,0.25)'
                                : 'rgba(245, 158, 11, 0.15)',
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              setCommentingMealId(m.id);
                              setCommentText(m.comment || '');
                              setActiveModal('meal-comment');
                            }}
                            title="Notatka do posiłku"
                          >
                            📝
                          </button>
                          <button
                            style={{
                              ...btnActionSmall,
                              color: hasImage ? 'white' : '#059669',
                              background: hasImage
                                ? 'rgba(255,255,255,0.25)'
                                : 'rgba(5, 150, 105, 0.15)',
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              setViewingRecipe(m.recipes);
                              setViewMode('desc');
                              setActiveModal('view-recipe');
                            }}
                          >
                            ℹ️
                          </button>
                          <button
                            style={{
                              ...btnActionSmall,
                              color: hasImage ? 'white' : '#059669',
                              background: hasImage
                                ? 'rgba(255,255,255,0.25)'
                                : 'rgba(5, 150, 105, 0.15)',
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleEditRecipeDirectly(m.recipes);
                            }}
                          >
                            ✏️
                          </button>
                          <button
                            style={{
                              ...btnActionSmall,
                              background: hasImage
                                ? 'rgba(239, 68, 68, 0.8)'
                                : '#ef4444',
                              color: 'white',
                              border: 'none',
                            }}
                            onClick={async (e) => {
                              e.stopPropagation();
                              if (confirm('Usunąć z planu?')) {
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
                      <div style={emptyCellPlus}>+</div>
                    )}
                  </div>
                );
              })}

              <div style={isMobile ? mobileSumLabel : daySumCell}>
                {isMobile && (
                  <span style={{ fontSize: '10px', opacity: 0.8 }}>
                    SUMA DNIA:
                  </span>
                )}
                <b
                  style={{
                    fontSize: '14px',
                    color: isMobile ? 'white' : '#059669',
                  }}
                >
                  {dailyCosts.daily[day.fullDate]} zł
                </b>
              </div>
            </React.Fragment>
          ))}
        </div>
      </div>

      <div style={weekSummaryPanel}>
        <div style={{ textAlign: 'center' }}>
          <span
            style={{ color: '#64748b', fontSize: '14px', fontWeight: 'bold' }}
          >
            CAŁKOWITY KOSZT TYGODNIA
          </span>
          <div
            style={{ fontSize: '32px', fontWeight: '900', color: '#059669' }}
          >
            {dailyCosts.weeklyTotal} zł
          </div>
        </div>
      </div>

      {/* --- KOSZYK --- */}
      <div style={shoppingPanel}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '15px',
          }}
        >
          <h3 style={{ color: '#059669', margin: 0, fontSize: '18px' }}>
            🛒 Lista zakupów
          </h3>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              style={btnPrimSmall}
              onClick={() => setActiveModal('add-to-cart')}
            >
              Dodaj +
            </button>
            <button
              style={{ ...btnSec, padding: '5px 10px', fontSize: '11px' }}
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
                    overflow: 'hidden',
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
                      flexShrink: 0,
                    }}
                  >
                    {isChecked && '✓'}
                  </div>
                  <div style={{ overflow: 'hidden' }}>
                    <div
                      style={{
                        fontWeight: '700',
                        fontSize: '13px',
                        textDecoration: isChecked ? 'line-through' : 'none',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        color: '#1e293b',
                      }}
                    >
                      {i.name}
                    </div>
                    <div style={{ fontSize: '11px', color: '#64748b' }}>
                      {dAmount} {dUnit}
                    </div>
                  </div>
                </div>
                <b
                  style={{
                    color: isChecked ? '#94a3b8' : '#059669',
                    fontSize: '13px',
                    marginLeft: '8px',
                    flexShrink: 0,
                  }}
                >
                  {i.cost} zł
                </b>
              </div>
            );
          })}
        </div>
      </div>

      {/* --- MODALE --- */}

      {/* MODAL: Notatka do posiłku */}
      {activeModal === 'meal-comment' && (
        <Modal
          title="📝 Notatka do posiłku"
          onClose={() => setActiveModal(null)}
          isMobile={isMobile}
          isLandscape={isLandscape}
        >
          <textarea
            style={{ ...inputS, minHeight: '120px' }}
            placeholder="Jak się czujesz po tym posiłku? Masz jakieś uwagi do diety?"
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
          />
          <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
            <button
              style={{ ...btnSec, flex: 1 }}
              onClick={() => setActiveModal(null)}
            >
              Anuluj
            </button>
            <button
              style={{ ...btnSuccessFull, flex: 2, marginTop: 0 }}
              onClick={async () => {
                await supabase
                  .from('meal_plan')
                  .update({ comment: commentText })
                  .eq('id', commentingMealId);
                setActiveModal(null);
                fetchData();
              }}
            >
              Zapisz notatkę
            </button>
          </div>
        </Modal>
      )}

      {/* MODAL: Statystyki */}
      {activeModal === 'stats' && (
        <Modal
          title="📈 Twoje Statystyki"
          onClose={() => setActiveModal(null)}
          isMobile={isMobile}
          isLandscape={isLandscape}
        >
          <div
            style={{
              display: 'flex',
              gap: '8px',
              marginBottom: '20px',
              borderBottom: '2px solid #f1f5f9',
              paddingBottom: '10px',
              overflowX: 'auto',
            }}
          >
            <button
              style={statTab === 'summary' ? statTabActive : statTabBtn}
              onClick={() => setStatTab('summary')}
            >
              📊 Podsumowanie
            </button>
            <button
              style={statTab === 'expenses' ? statTabActive : statTabBtn}
              onClick={() => setStatTab('expenses')}
            >
              💸 Wydatki
            </button>
            <button
              style={statTab === 'products' ? statTabActive : statTabBtn}
              onClick={() => setStatTab('products')}
            >
              🛒 Składniki
            </button>
          </div>

          <div
            style={{
              maxHeight: isMobile && isLandscape ? '70vh' : '65vh',
              overflowY: 'auto',
              paddingRight: '5px',
            }}
          >
            {statTab === 'summary' && (
              <>
                <div
                  style={{
                    ...statBoxS,
                    background:
                      'linear-gradient(135deg, #10B981 0%, #059669 100%)',
                    color: 'white',
                    border: 'none',
                  }}
                >
                  <h4
                    style={{
                      margin: '0 0 10px 0',
                      fontSize: '14px',
                      opacity: 0.9,
                    }}
                  >
                    Obecny miesiąc ({advancedStats.currentMonthLabel})
                  </h4>
                  <div style={{ fontSize: '36px', fontWeight: '900' }}>
                    {advancedStats.currentMonthCost} zł
                  </div>
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: '15px',
                    marginBottom: '15px',
                  }}
                >
                  <div style={{ ...statBoxS, marginBottom: 0 }}>
                    <div
                      style={{
                        color: '#64748b',
                        fontSize: '12px',
                        fontWeight: 'bold',
                      }}
                    >
                      ŚREDNIO DZIENNIE
                    </div>
                    <div
                      style={{
                        fontSize: '24px',
                        fontWeight: '800',
                        color: '#1e293b',
                      }}
                    >
                      {advancedStats.avgDailyCost} zł
                    </div>
                  </div>
                  <div style={{ ...statBoxS, marginBottom: 0 }}>
                    <div
                      style={{
                        color: '#64748b',
                        fontSize: '12px',
                        fontWeight: 'bold',
                      }}
                    >
                      ZAPLANOWANE POSIŁKI
                    </div>
                    <div
                      style={{
                        fontSize: '24px',
                        fontWeight: '800',
                        color: '#1e293b',
                      }}
                    >
                      {advancedStats.plannedMealsCount}
                    </div>
                  </div>
                </div>
              </>
            )}

            {statTab === 'expenses' && (
              <>
                <div style={statBoxS}>
                  <h4 style={statLabelS}>Koszt na typ posiłku</h4>
                  {advancedStats.mealTypeCosts.map(([type, cost]) => {
                    const widthPct =
                      advancedStats.maxMealType > 0
                        ? (cost / advancedStats.maxMealType) * 100
                        : 0;
                    return (
                      <div key={type} style={{ marginBottom: '12px' }}>
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            fontSize: '12px',
                            marginBottom: '4px',
                            fontWeight: 'bold',
                            color: '#475569',
                          }}
                        >
                          <span>{type}</span>
                          <span>{cost.toFixed(2)} zł</span>
                        </div>
                        <div
                          style={{
                            width: '100%',
                            height: '12px',
                            background: '#f1f5f9',
                            borderRadius: '6px',
                            overflow: 'hidden',
                          }}
                        >
                          <div
                            style={{
                              width: `${widthPct}%`,
                              height: '100%',
                              background:
                                'linear-gradient(90deg, #34d399 0%, #059669 100%)',
                              borderRadius: '6px',
                              transition: 'width 0.5s ease-out',
                            }}
                          ></div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div style={statBoxS}>
                  <h4 style={statLabelS}>Historia miesięcy</h4>
                  {advancedStats.monthly.map(([label, total]) => {
                    const widthPct =
                      advancedStats.maxMonthly > 0
                        ? (total / advancedStats.maxMonthly) * 100
                        : 0;
                    return (
                      <div key={label} style={{ marginBottom: '12px' }}>
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            fontSize: '12px',
                            marginBottom: '4px',
                            fontWeight: 'bold',
                            color: '#475569',
                          }}
                        >
                          <span>{label}</span>
                          <span>{total.toFixed(2)} zł</span>
                        </div>
                        <div
                          style={{
                            width: '100%',
                            height: '12px',
                            background: '#f1f5f9',
                            borderRadius: '6px',
                            overflow: 'hidden',
                          }}
                        >
                          <div
                            style={{
                              width: `${widthPct}%`,
                              height: '100%',
                              background: '#3b82f6',
                              borderRadius: '6px',
                              transition: 'width 0.5s ease-out',
                            }}
                          ></div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {statTab === 'products' && (
              <>
                <div style={statBoxS}>
                  <h4 style={statLabelS}>💸 Najdroższe składniki (Suma)</h4>
                  {advancedStats.topByCost.map(([name, data]) => {
                    const widthPct =
                      advancedStats.maxIngCost > 0
                        ? (data.totalCost / advancedStats.maxIngCost) * 100
                        : 0;
                    return (
                      <div key={name} style={{ marginBottom: '12px' }}>
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            fontSize: '12px',
                            marginBottom: '4px',
                            fontWeight: 'bold',
                            color: '#475569',
                          }}
                        >
                          <span>{name}</span>
                          <span style={{ color: '#e11d48' }}>
                            {data.totalCost.toFixed(2)} zł
                          </span>
                        </div>
                        <div
                          style={{
                            width: '100%',
                            height: '8px',
                            background: '#f1f5f9',
                            borderRadius: '4px',
                            overflow: 'hidden',
                          }}
                        >
                          <div
                            style={{
                              width: `${widthPct}%`,
                              height: '100%',
                              background: '#fb7185',
                              borderRadius: '4px',
                            }}
                          ></div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div style={statBoxS}>
                  <h4 style={statLabelS}>⭐ Najczęściej kupowane</h4>
                  {advancedStats.topByCount.map(([name, data]) => (
                    <div key={name} style={statRowS}>
                      <span
                        style={{
                          fontSize: '13px',
                          fontWeight: 'bold',
                          color: '#1e293b',
                        }}
                      >
                        {name}
                      </span>
                      <div
                        style={{
                          background: '#fef3c7',
                          color: '#d97706',
                          padding: '2px 8px',
                          borderRadius: '10px',
                          fontSize: '12px',
                          fontWeight: 'bold',
                        }}
                      >
                        {data.count}x w planie
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </Modal>
      )}

      {/* MODAL: Dodaj do listy manualnie */}
      {activeModal === 'add-to-cart' && (
        <Modal
          title="🛒 Dodaj do listy"
          onClose={() => setActiveModal(null)}
          isMobile={isMobile}
          isLandscape={isLandscape}
        >
          <div
            style={{
              display: 'flex',
              gap: '8px',
              marginBottom: '15px',
              borderBottom: '2px solid #f1f5f9',
              paddingBottom: '10px',
            }}
          >
            <button
              style={cartModalTab === 'recipes' ? statTabActive : statTabBtn}
              onClick={() => setCartModalTab('recipes')}
            >
              Z przepisów
            </button>
            <button
              style={cartModalTab === 'products' ? statTabActive : statTabBtn}
              onClick={() => setCartModalTab('products')}
            >
              Pojedyncze produkty
            </button>
          </div>

          <div
            style={{
              maxHeight: isMobile && isLandscape ? '85vh' : '60vh',
              overflowY: 'auto',
              paddingRight: '5px',
            }}
          >
            {cartModalTab === 'recipes' && (
              <>
                {recipes
                  .sort((a, b) => b.is_favorite - a.is_favorite)
                  .map((r) => (
                    <div
                      key={r.id}
                      style={recipeListItem}
                      onClick={() => {
                        setManualCart((p) => [
                          ...p,
                          ...r.recipe_ingredients.map((ri) => ({
                            id: ri.products.id,
                            name: ri.products.name,
                            amount: ri.amount,
                            unit: ri.products.unit,
                            pricePU: ri.products.price_per_unit,
                          })),
                        ]);
                        setActiveModal(null);
                      }}
                    >
                      <span>
                        {r.is_favorite && '⭐ '}
                        {r.name}
                      </span>{' '}
                      <button style={btnCartAddSmall}>+ Składniki</button>
                    </div>
                  ))}
              </>
            )}

            {cartModalTab === 'products' && (
              <>
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
                    <button style={btnCartAddSmall}>Dodaj</button>
                  </div>
                ))}
              </>
            )}
          </div>
        </Modal>
      )}

      {/* MODAL: Przepisy (Lista + Formularz) */}
      {activeModal === 'recipe' && (
        <Modal
          title="👨‍🍳 Przepisy"
          onClose={() => {
            setActiveModal(null);
            setShowRecipeForm(false);
          }}
          isMobile={isMobile}
          isLandscape={isLandscape}
        >
          <div
            className="recipe-scroll-container"
            style={{
              maxHeight: isMobile && isLandscape ? '85vh' : '75vh',
              overflowY: 'auto',
              paddingRight: '5px',
              paddingBottom: '20px',
            }}
          >
            {!showRecipeForm ? (
              <>
                <button
                  style={{
                    ...btnSuccessFull,
                    marginBottom: '20px',
                    fontSize: '16px',
                    padding: '16px',
                  }}
                  onClick={() => {
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
                    setSearchQuery('');
                    setShowAiPanel(false);
                    setShowRecipeForm(true);
                  }}
                >
                  + Dodaj nowy przepis
                </button>

                <div style={filterBar}>
                  {['Wszystkie', ...MEAL_TYPES].map((cat) => (
                    <button
                      key={cat}
                      onClick={() =>
                        setRecipeListCategory(cat === 'Wszystkie' ? '' : cat)
                      }
                      style={
                        recipeListCategory === (cat === 'Wszystkie' ? '' : cat)
                          ? btnFilterActive
                          : btnFilter
                      }
                    >
                      {cat}
                    </button>
                  ))}
                </div>

                {recipes
                  .filter(
                    (r) =>
                      !recipeListCategory || r.category === recipeListCategory
                  )
                  .sort((a, b) => b.is_favorite - a.is_favorite)
                  .map((r) => (
                    <div key={r.id} style={productRowS}>
                      <span style={{ fontSize: '13px' }}>
                        {r.is_favorite && '⭐ '}
                        <b>{r.name}</b>{' '}
                        <span
                          style={{
                            color: '#059669',
                            fontWeight: 'bold',
                            marginLeft: '5px',
                          }}
                        >
                          ({parseFloat(r.total_cost).toFixed(2)} zł)
                        </span>
                      </span>
                      <div style={{ display: 'flex', gap: '10px' }}>
                        <button
                          onClick={() =>
                            handleToggleFavorite(r.id, r.is_favorite)
                          }
                          style={{ ...iconBtn, color: '#f59e0b' }}
                          title="Oznacz/Usuń jako ulubione"
                        >
                          {r.is_favorite ? '⭐' : '☆'}
                        </button>
                        <button
                          onClick={() => handleEditRecipeDirectly(r)}
                          style={iconBtn}
                          title="Edytuj"
                        >
                          ✏️
                        </button>
                        <button
                          onClick={async () => {
                            if (
                              confirm(
                                'Usunąć przepis z bazy? Zniknie on ze wszystkich dni w kalendarzu.'
                              )
                            ) {
                              await supabase
                                .from('meal_plan')
                                .delete()
                                .eq('recipe_id', r.id);
                              await supabase
                                .from('recipe_ingredients')
                                .delete()
                                .eq('recipe_id', r.id);
                              await supabase
                                .from('recipes')
                                .delete()
                                .eq('id', r.id);
                              fetchData();
                            }
                          }}
                          style={{ ...iconBtn, color: '#ef4444' }}
                          title="Usuń"
                        >
                          🗑️
                        </button>
                      </div>
                    </div>
                  ))}
              </>
            ) : (
              <>
                <button
                  onClick={() => setShowRecipeForm(false)}
                  style={{ ...btnSec, marginBottom: '15px' }}
                >
                  ⬅ Wróć do listy
                </button>

                {/* --- AKORDEON: ASYSTENT AI --- */}
                <div
                  style={{
                    ...formBoxS,
                    background: '#f5f3ff',
                    borderColor: '#c4b5fd',
                    marginBottom: '15px',
                  }}
                >
                  <div
                    onClick={() => setShowAiPanel(!showAiPanel)}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      cursor: 'pointer',
                    }}
                  >
                    <h4
                      style={{ margin: 0, color: '#6d28d9', fontSize: '14px' }}
                    >
                      ✨ Asystent AI
                    </h4>
                    <span style={{ color: '#6d28d9', fontWeight: 'bold' }}>
                      {showAiPanel ? '▲' : '▼'}
                    </span>
                  </div>

                  {showAiPanel && (
                    <div style={{ marginTop: '15px' }}>
                      <div
                        style={{
                          display: 'flex',
                          gap: '8px',
                          marginBottom: '10px',
                        }}
                      >
                        <input
                          style={{
                            ...inputS,
                            marginBottom: 0,
                            flex: 1,
                            borderColor: '#c4b5fd',
                          }}
                          placeholder="Wklej link do przepisu..."
                          value={aiUrl}
                          onChange={(e) => setAiUrl(e.target.value)}
                          disabled={isAiLoading}
                        />
                        <button
                          onClick={handleAiRecipeFromUrl}
                          style={{
                            ...btnPrim,
                            background: '#8b5cf6',
                            whiteSpace: 'nowrap',
                          }}
                          disabled={isAiLoading || !aiUrl}
                        >
                          {isAiLoading ? '⏳...' : 'Pobierz'}
                        </button>
                      </div>

                      <div
                        style={{
                          textAlign: 'center',
                          color: '#8b5cf6',
                          fontSize: '12px',
                          fontWeight: 'bold',
                          margin: '10px 0',
                        }}
                      >
                        LUB
                      </div>

                      <label
                        style={{
                          ...btnPrim,
                          display: 'block',
                          textAlign: 'center',
                          background: '#8b5cf6',
                          fontSize: '14px',
                          padding: '10px',
                          cursor: 'pointer',
                          opacity: isAiLoading ? 0.7 : 1,
                        }}
                      >
                        {isAiLoading
                          ? '⏳ Pracuję...'
                          : '📷 Wczytaj ze zdjęcia'}
                        <input
                          type="file"
                          accept="image/*"
                          onChange={handleAiRecipeScan}
                          style={{ display: 'none' }}
                          disabled={isAiLoading}
                        />
                      </label>
                    </div>
                  )}
                </div>

                <div style={formBoxS}>
                  <div
                    style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}
                  >
                    <input
                      style={{ ...inputS, marginBottom: 0, flex: 1 }}
                      placeholder="Nazwa dania"
                      value={newRecipe.name}
                      onChange={(e) =>
                        setNewRecipe({ ...newRecipe, name: e.target.value })
                      }
                    />
                    <select
                      style={{
                        ...inputS,
                        marginBottom: 0,
                        width: 'auto',
                        padding: '5px',
                      }}
                      value={newRecipe.category}
                      onChange={(e) =>
                        setNewRecipe({ ...newRecipe, category: e.target.value })
                      }
                    >
                      {MEAL_TYPES.map((cat) => (
                        <option key={cat} value={cat}>
                          {cat}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() =>
                        setNewRecipe({
                          ...newRecipe,
                          is_favorite: !newRecipe.is_favorite,
                        })
                      }
                      style={{ ...iconBtn, fontSize: '24px' }}
                    >
                      {newRecipe.is_favorite ? '⭐' : '☆'}
                    </button>
                  </div>
                  <label style={fileLabelS}>
                    {newRecipe.image_url
                      ? '✅ Zdjęcie wybrane'
                      : '📷 Wybierz zdjęcie'}
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleFileUpload}
                      style={{ display: 'none' }}
                    />
                  </label>
                  <textarea
                    style={{ ...inputS, minHeight: '80px' }}
                    placeholder="Opis..."
                    value={newRecipe.instructions}
                    onChange={(e) =>
                      setNewRecipe({
                        ...newRecipe,
                        instructions: e.target.value,
                      })
                    }
                  />
                  {newRecipe.steps.map((s, i) => (
                    <div
                      key={i}
                      style={{ display: 'flex', gap: '5px', marginTop: '5px' }}
                    >
                      <div style={stepCircleS}>{i + 1}</div>
                      <input
                        style={{ ...inputS, marginBottom: 0 }}
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
                            steps: newRecipe.steps.filter(
                              (_, idx) => idx !== i
                            ),
                          })
                        }
                        style={btnDelSmallStatic}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                  <button
                    style={{
                      ...btnSec,
                      width: '100%',
                      padding: '8px',
                      marginTop: '5px',
                      marginBottom: '15px',
                    }}
                    onClick={() =>
                      setNewRecipe({
                        ...newRecipe,
                        steps: [...newRecipe.steps, ''],
                      })
                    }
                  >
                    + Krok
                  </button>

                  {/* --- PŁYWAJĄCY SEARCH BAR DLA SKŁADNIKÓW --- */}
                  <div
                    ref={searchContainerRef}
                    style={{ position: 'relative', marginBottom: '15px' }}
                  >
                    <input
                      style={{
                        ...inputS,
                        marginBottom: 0,
                        borderColor: showSearchDropdown ? '#059669' : '#cbd5e1',
                      }}
                      placeholder="🔍 Szukaj składnika w bazie..."
                      value={searchQuery}
                      onChange={(e) => {
                        setSearchQuery(e.target.value);
                        setShowSearchDropdown(true);
                      }}
                      onFocus={() => setShowSearchDropdown(true)}
                    />
                    {showSearchDropdown && (
                      <div
                        style={{
                          ...searchResultsS,
                          position: 'absolute',
                          top: '100%',
                          left: 0,
                          right: 0,
                          zIndex: 1000,
                          maxHeight: '200px',
                          overflowY: 'auto',
                          boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1)',
                          border: '1px solid #cbd5e1',
                          marginTop: '5px',
                          borderRadius: '12px',
                        }}
                      >
                        {products
                          .filter(
                            (p) =>
                              !searchQuery ||
                              p.name
                                .toLowerCase()
                                .includes(searchQuery.toLowerCase())
                          )
                          .map((p) => (
                            <div
                              key={p.id}
                              style={{ ...searchItemS, fontSize: '13px' }}
                              onClick={() => {
                                setNewRecipe({
                                  ...newRecipe,
                                  ingredients: [
                                    ...newRecipe.ingredients,
                                    { ...p, amount: 100 },
                                  ],
                                });
                                setSearchQuery('');
                                setShowSearchDropdown(false);
                              }}
                            >
                              <b>{p.name}</b>{' '}
                              <span
                                style={{ color: '#64748b', marginLeft: '5px' }}
                              >
                                ({p.unit})
                              </span>
                            </div>
                          ))}
                        {products.filter(
                          (p) =>
                            !searchQuery ||
                            p.name
                              .toLowerCase()
                              .includes(searchQuery.toLowerCase())
                        ).length === 0 && (
                          <div
                            style={{
                              padding: '15px',
                              color: '#64748b',
                              fontSize: '13px',
                              textAlign: 'center',
                            }}
                          >
                            Brak wyników. Zmień nazwę lub dodaj jako nowy
                            produkt po wybraniu.
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* --- LISTA SKŁADNIKÓW --- */}
                  {newRecipe.ingredients.map((ing, idx) => (
                    <div
                      key={idx}
                      style={{
                        ...ingRowS,
                        flexDirection: 'column',
                        alignItems: 'stretch',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          width: '100%',
                        }}
                      >
                        <span
                          style={{
                            fontSize: '13px',
                            flex: 1,
                            color: ing.id ? '#1e293b' : '#ef4444',
                            fontWeight: ing.id ? 'normal' : 'bold',
                          }}
                        >
                          {ing.name}
                        </span>
                        <div style={{ display: 'flex', gap: '5px' }}>
                          <input
                            type="number"
                            style={{
                              ...inputS,
                              width: '60px',
                              padding: '8px',
                              marginBottom: 0,
                            }}
                            value={ing.amount}
                            onChange={(e) => {
                              const c = [...newRecipe.ingredients];
                              c[idx].amount = e.target.value;
                              setNewRecipe({ ...newRecipe, ingredients: c });
                            }}
                          />
                          <span
                            style={{
                              alignSelf: 'center',
                              fontSize: '13px',
                              width: '30px',
                            }}
                          >
                            {ing.unit}
                          </span>
                          <button
                            onClick={() =>
                              setNewRecipe({
                                ...newRecipe,
                                ingredients: newRecipe.ingredients.filter(
                                  (_, i) => i !== idx
                                ),
                              })
                            }
                            style={{
                              color: 'red',
                              border: 'none',
                              background: 'none',
                              cursor: 'pointer',
                              fontSize: '16px',
                            }}
                          >
                            ✕
                          </button>
                        </div>
                      </div>

                      {/* KOMUNIKAT BRAKU W BAZIE I SZYBKIE DODAWANIE */}
                      {!ing.id && (
                        <div
                          style={{
                            display: 'flex',
                            gap: '5px',
                            marginTop: '8px',
                            paddingLeft: '10px',
                            borderLeft: '2px solid #ef4444',
                          }}
                        >
                          <select
                            style={{
                              ...inputS,
                              padding: '6px',
                              fontSize: '12px',
                              marginBottom: 0,
                              flex: 1,
                              borderColor: '#fca5a5',
                              background: '#fff1f2',
                              color: '#991b1b',
                            }}
                            onChange={async (e) => {
                              const val = e.target.value;
                              if (val === 'ADD_NEW') {
                                let cleanName = ing.name
                                  .replace('⚠️ ', '')
                                  .trim();
                                const finalName = window.prompt(
                                  'Podaj nazwę dla nowego produktu:',
                                  cleanName
                                );
                                if (!finalName) {
                                  e.target.value = '';
                                  return;
                                }

                                const newProduct = {
                                  name: finalName,
                                  price_per_unit: 0,
                                  unit: ing.unit,
                                  last_input_quantity: 100,
                                };
                                const { data } = await supabase
                                  .from('products')
                                  .insert([newProduct])
                                  .select()
                                  .single();
                                if (data) {
                                  setProducts((prev) => [...prev, data]);
                                  const newIngs = [...newRecipe.ingredients];
                                  newIngs[idx] = {
                                    ...data,
                                    amount: ing.amount,
                                  };
                                  setNewRecipe({
                                    ...newRecipe,
                                    ingredients: newIngs,
                                  });
                                }
                              } else if (val !== '') {
                                const selectedDbProd = products.find(
                                  (p) => p.id === val
                                );
                                if (selectedDbProd) {
                                  const newIngs = [...newRecipe.ingredients];
                                  newIngs[idx] = {
                                    ...selectedDbProd,
                                    amount: ing.amount,
                                  };
                                  setNewRecipe({
                                    ...newRecipe,
                                    ingredients: newIngs,
                                  });
                                }
                              }
                            }}
                            value=""
                          >
                            <option value="" disabled>
                              Wybierz akcję (brak w bazie)...
                            </option>
                            <option value="ADD_NEW">
                              ➕ Dodaj "{ing.name.replace('⚠️ ', '')}" do bazy
                            </option>
                            <optgroup label="Lub powiąż z istniejącym:">
                              {products.map((p) => (
                                <option key={p.id} value={p.id}>
                                  🔗 {p.name}
                                </option>
                              ))}
                            </optgroup>
                          </select>
                        </div>
                      )}
                    </div>
                  ))}

                  <button style={btnSuccessFull} onClick={handleSaveRecipe}>
                    {newRecipe.id ? 'Zaktualizuj' : 'Zapisz'}
                  </button>
                </div>
              </>
            )}
          </div>
        </Modal>
      )}

      {/* MODAL: Baza Produktów (Lista + Formularz) */}
      {activeModal === 'product' && (
        <Modal
          title="📦 Baza Produktów"
          onClose={() => {
            setActiveModal(null);
            setShowProductForm(false);
          }}
          isMobile={isMobile}
          isLandscape={isLandscape}
        >
          <div
            style={{
              maxHeight: isMobile && isLandscape ? '85vh' : '70vh',
              overflowY: 'auto',
              paddingRight: '5px',
              paddingBottom: '20px',
            }}
          >
            {!showProductForm ? (
              <>
                <button
                  style={{
                    ...btnSuccessFull,
                    marginBottom: '20px',
                    fontSize: '16px',
                    padding: '16px',
                  }}
                  onClick={() => {
                    setNewProd({
                      id: null,
                      name: '',
                      price: '',
                      amount: '',
                      unit: 'g',
                    });
                    setShowProductForm(true);
                  }}
                >
                  + Dodaj nowy produkt
                </button>

                <div>
                  {products.map((p) => (
                    <div key={p.id} style={productRowS}>
                      <div style={{ fontSize: '13px' }}>
                        <b>{p.name}</b>{' '}
                        <span style={{ color: '#64748b', marginLeft: '5px' }}>
                          (
                          {parseFloat(
                            p.price_per_unit * p.last_input_quantity
                          ).toFixed(2)}{' '}
                          zł / {p.last_input_quantity}
                          {p.unit})
                        </span>
                      </div>
                      <div style={{ display: 'flex', gap: '10px' }}>
                        <button
                          onClick={() => {
                            setNewProd({
                              id: p.id,
                              name: p.name,
                              price: (
                                p.price_per_unit * p.last_input_quantity
                              ).toFixed(2),
                              amount: p.last_input_quantity,
                              unit: p.unit,
                            });
                            setShowProductForm(true);
                          }}
                          style={iconBtn}
                        >
                          ✏️
                        </button>
                        <button
                          onClick={async () => {
                            if (
                              confirm(
                                'Usunąć produkt z bazy? Zostanie on usunięty ze wszystkich Twoich przepisów.'
                              )
                            ) {
                              await supabase
                                .from('recipe_ingredients')
                                .delete()
                                .eq('product_id', p.id);
                              await supabase
                                .from('products')
                                .delete()
                                .eq('id', p.id);
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
              </>
            ) : (
              <>
                <button
                  onClick={() => setShowProductForm(false)}
                  style={{ ...btnSec, marginBottom: '15px' }}
                >
                  ⬅ Wróć do listy
                </button>
                <div style={formBoxS}>
                  <input
                    style={inputS}
                    placeholder="Nazwa produktu"
                    value={newProd.name}
                    onChange={(e) =>
                      setNewProd({ ...newProd, name: e.target.value })
                    }
                  />
                  <div style={{ display: 'flex', gap: '5px' }}>
                    <input
                      style={{ ...inputS, marginBottom: 0 }}
                      type="number"
                      placeholder="Cena"
                      value={newProd.price}
                      onChange={(e) =>
                        setNewProd({ ...newProd, price: e.target.value })
                      }
                    />
                    <input
                      style={{ ...inputS, marginBottom: 0 }}
                      type="number"
                      placeholder="Ilość"
                      value={newProd.amount}
                      onChange={(e) =>
                        setNewProd({ ...newProd, amount: e.target.value })
                      }
                    />
                    <select
                      style={{ ...inputS, marginBottom: 0 }}
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
                    {newProd.id ? 'Zaktualizuj' : 'Zapisz'}
                  </button>
                </div>
              </>
            )}
          </div>
        </Modal>
      )}

      {/* --- NORMALNY PODGLĄD PRZEPISU --- */}
      {activeModal === 'view-recipe' && viewingRecipe && (
        <Modal
          title={viewingRecipe.name}
          onClose={() => setActiveModal(null)}
          isMobile={isMobile}
          isLandscape={isLandscape}
        >
          <button
            style={{
              ...btnSuccessFull,
              marginBottom: '15px',
              display: 'flex',
              justifyContent: 'center',
              gap: '10px',
              alignItems: 'center',
            }}
            onClick={() => {
              setCookingStep(0);
              setIsVoiceActive(false);
              setActiveModal('cooking-mode');
            }}
          >
            <span style={{ fontSize: '20px' }}>👨‍🍳</span> ROZPOCZNIJ GOTOWANIE
          </button>

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
          <div
            style={{
              maxHeight: isMobile && isLandscape ? '85vh' : '50vh',
              overflowY: 'auto',
              paddingRight: '5px',
            }}
          >
            {viewMode === 'desc' ? (
              <>
                <div style={{ marginBottom: '15px' }}>
                  <h4 style={{ margin: '0 0 10px 0', color: '#1e293b' }}>
                    Składniki:
                  </h4>
                  <div
                    style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}
                  >
                    {viewingRecipe.recipe_ingredients?.map((ri, idx) => (
                      <div
                        key={idx}
                        style={{
                          background: '#f1f5f9',
                          padding: '6px 12px',
                          borderRadius: '8px',
                          fontSize: '13px',
                          color: '#475569',
                        }}
                      >
                        <b>{ri.products?.name}</b> - {ri.amount}{' '}
                        {ri.products?.unit}
                      </div>
                    ))}
                  </div>
                </div>
                <h4 style={{ margin: '0 0 10px 0', color: '#1e293b' }}>
                  Opis przygotowania:
                </h4>
                <p
                  style={{
                    whiteSpace: 'pre-wrap',
                    background: '#f8fafc',
                    padding: '15px',
                    borderRadius: '10px',
                    fontSize: '14px',
                    lineHeight: '1.6',
                    margin: 0,
                  }}
                >
                  {viewingRecipe.instructions || 'Brak opisu.'}
                </p>
              </>
            ) : viewingRecipe.steps?.length > 0 ? (
              viewingRecipe.steps.map((s, i) => (
                <div key={i} style={stepItemS}>
                  <div style={stepCircleS}>{i + 1}</div>
                  <div style={{ flex: 1, fontSize: '14px', lineHeight: '1.6' }}>
                    {renderStepWithIngredients(
                      s,
                      viewingRecipe.recipe_ingredients
                    )}
                  </div>
                </div>
              ))
            ) : (
              <p
                style={{
                  textAlign: 'center',
                  color: '#64748b',
                  margin: '20px 0',
                }}
              >
                Brak dodanych kroków.
              </p>
            )}
          </div>
        </Modal>
      )}

      {/* --- TRYB GOTOWANIA (PEŁNY EKRAN) --- */}
      {activeModal === 'cooking-mode' && viewingRecipe && (
        <div style={cookingOverlayS}>
          <div
            style={{
              ...cookingCardS,
              maxHeight: isMobile && isLandscape ? '90vh' : 'auto',
              overflowY: isMobile && isLandscape ? 'auto' : 'visible',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '15px',
              }}
            >
              <button
                onClick={() => {
                  setIsVoiceActive(false);
                  setActiveModal('view-recipe');
                }}
                style={{ ...btnSec, padding: '8px 16px' }}
              >
                ⬅ Powrót
              </button>

              <button
                onClick={() => setIsVoiceActive(!isVoiceActive)}
                style={{
                  ...btnSec,
                  background: isVoiceActive ? '#fee2e2' : '#f1f5f9',
                  color: isVoiceActive ? '#ef4444' : '#475569',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '8px 16px',
                }}
              >
                {isVoiceActive ? '🔴 Nasłuchuję...' : '🎙️ Sterowanie Głosem'}
              </button>
            </div>

            <div
              style={{
                color: '#059669',
                fontWeight: 'bold',
                marginBottom: '5px',
                textAlign: 'center',
              }}
            >
              KROK {cookingStep + 1} Z {viewingRecipe.steps?.length || 0}
            </div>

            {isVoiceActive && (
              <div
                style={{
                  fontSize: '12px',
                  color: '#64748b',
                  fontStyle: 'italic',
                  marginBottom: '10px',
                  textAlign: 'center',
                }}
              >
                Słyszę: {lastHeard ? `"${lastHeard}"` : 'Czekam na komendę...'}
              </div>
            )}

            <div
              style={{
                fontSize: isMobile ? '24px' : '36px',
                fontWeight: '500',
                color: '#1e293b',
                minHeight: isMobile && isLandscape ? '100px' : '200px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '20px 0',
                lineHeight: '1.6',
                textAlign: 'center',
                flexDirection: 'column',
                gap: '15px',
              }}
            >
              <div>
                {renderStepWithIngredients(
                  viewingRecipe.steps?.[cookingStep],
                  viewingRecipe.recipe_ingredients
                )}
              </div>
            </div>

            <div
              style={{
                display: 'flex',
                gap: '15px',
                marginTop: 'auto',
                paddingTop: '20px',
              }}
            >
              <button
                style={{
                  ...btnSuccessFull,
                  background: '#f1f5f9',
                  color: '#475569',
                  flex: 1,
                  fontSize: '18px',
                }}
                onClick={() => setCookingStep((prev) => Math.max(prev - 1, 0))}
                disabled={cookingStep === 0}
              >
                Wstecz
              </button>
              <button
                style={{ ...btnSuccessFull, flex: 1, fontSize: '18px' }}
                onClick={() => {
                  if (cookingStep === viewingRecipe.steps.length - 1) {
                    setActiveModal('view-recipe');
                    setIsVoiceActive(false);
                  } else {
                    setCookingStep((prev) =>
                      Math.min(prev + 1, viewingRecipe.steps.length - 1)
                    );
                  }
                }}
              >
                {cookingStep === viewingRecipe.steps?.length - 1
                  ? 'Zakończ 🎉'
                  : 'Dalej ➡'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- WYBÓR POSIŁKU --- */}
      {activeModal === 'cell' && (
        <Modal
          title={`Wybierz posiłek: ${selectedCell?.type}`}
          onClose={() => setActiveModal(null)}
          isMobile={isMobile}
          isLandscape={isLandscape}
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
          <div
            style={{
              maxHeight: isMobile && isLandscape ? '85vh' : '350px',
              overflowY: 'auto',
            }}
          >
            {recipes
              .filter((r) => !filterCategory || r.category === filterCategory)
              .sort((a, b) => b.is_favorite - a.is_favorite)
              .map((r) => (
                <div
                  key={r.id}
                  style={recipeListItem}
                  onClick={async () => {
                    await supabase
                      .from('meal_plan')
                      .insert([
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
                  <span>
                    {r.is_favorite && '⭐ '}
                    {r.name}
                  </span>{' '}
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
        <h2
          style={{
            color: '#059669',
            textAlign: 'center',
            fontSize: '20px',
            marginBottom: '20px',
          }}
        >
          Jedzonko Planer
        </h2>
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

function Modal({ title, children, onClose, isMobile, isLandscape }) {
  const mS = {
    background: 'white',
    padding: isMobile ? '15px' : '20px',
    borderRadius: '20px',
    width: isMobile ? '92%' : '500px',
    boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)',
    zIndex: 1100,
    position: 'relative',
    boxSizing: 'border-box',
    maxHeight: isMobile && isLandscape ? '95vh' : 'auto',
    display: 'flex',
    flexDirection: 'column',
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
            flexShrink: 0,
          }}
        >
          <h3 style={{ margin: 0, fontSize: '18px' }}>{title}</h3>
          <button
            onClick={onClose}
            style={{
              border: 'none',
              background: 'none',
              fontSize: '24px',
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
  padding: '10px',
  backgroundColor: '#f8fafc',
  minHeight: '100vh',
  fontFamily: '-apple-system, sans-serif',
  overflowX: 'hidden',
};
const headerStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: '15px',
  background: 'white',
  padding: '10px 15px',
  borderRadius: '15px',
  boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
};
const headerMobile = {
  ...headerStyle,
  flexDirection: 'column',
  gap: '10px',
  textAlign: 'center',
};
const logoTitleS = {
  margin: 0,
  color: '#059669',
  fontSize: '18px',
  fontWeight: '800',
};
const logoCircleS = {
  width: '35px',
  height: '35px',
  backgroundColor: '#ecfdf5',
  borderRadius: '10px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: '2px solid #059669',
  fontSize: '20px',
};
const navButtons = {
  display: 'flex',
  gap: '5px',
  flexWrap: 'wrap',
  justifyContent: 'center',
};
const btnTodayActive = {
  background: '#059669',
  color: 'white',
  border: 'none',
  padding: '8px 12px',
  borderRadius: '10px',
  fontWeight: 'bold',
  fontSize: '12px',
};
const btnSec = {
  background: '#f1f5f9',
  color: '#475569',
  border: 'none',
  padding: '8px 12px',
  borderRadius: '10px',
  cursor: 'pointer',
  fontWeight: 'bold',
  fontSize: '12px',
};
const btnPrim = {
  background: '#059669',
  color: 'white',
  border: 'none',
  padding: '8px 12px',
  borderRadius: '10px',
  fontWeight: '800',
  cursor: 'pointer',
  fontSize: '12px',
};
const btnPrimSmall = { ...btnPrim, padding: '6px 10px', fontSize: '11px' };
const btnStats = {
  background: '#3b82f6',
  color: 'white',
  border: 'none',
  padding: '8px 12px',
  borderRadius: '10px',
  fontWeight: 'bold',
  fontSize: '12px',
  cursor: 'pointer',
};
const btnDanger = {
  background: '#fef2f2',
  color: '#ef4444',
  border: 'none',
  padding: '8px 12px',
  borderRadius: '10px',
  fontWeight: 'bold',
  fontSize: '12px',
};
const gridStyle = {
  display: 'grid',
  gridTemplateColumns: '100px repeat(6, 1fr)',
  gap: '10px',
};
const layoutGrid = { display: 'grid', gridTemplateColumns: '1fr', gap: '15px' };
const mobileStack = { display: 'flex', flexDirection: 'column', gap: '10px' };

const dayCell = {
  background: 'white',
  padding: '10px 5px',
  borderRadius: '16px',
  textAlign: 'center',
  borderLeft: '4px solid #059669',
  boxShadow: '0 2px 4px rgba(0,0,0,0.02)',
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  alignItems: 'center',
};
const mobileDayLabel = {
  background: '#1e293b',
  color: 'white',
  padding: '12px',
  borderRadius: '16px',
  fontWeight: 'bold',
  textAlign: 'center',
};
const mealHeader = {
  textAlign: 'center',
  fontWeight: '800',
  color: '#94a3b8',
  fontSize: '11px',
  textTransform: 'uppercase',
};

const cellStyleEmpty = {
  minHeight: '100px',
  background: '#f8fafc',
  borderRadius: '16px',
  border: '2px dashed #cbd5e1',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  position: 'relative',
  overflow: 'hidden',
  transition: 'all 0.2s',
};
const cellStyleActive = {
  ...cellStyleEmpty,
  border: 'none',
  boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)',
};
const emptyCellPlus = {
  width: '32px',
  height: '32px',
  borderRadius: '50%',
  background: '#e2e8f0',
  color: '#64748b',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontWeight: 'bold',
  fontSize: '20px',
};
const mealContent = {
  width: '100%',
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'flex-end',
  alignItems: 'center',
  padding: '12px 6px',
};
const mealNameS = {
  fontWeight: '800',
  fontSize: '12px',
  textAlign: 'center',
  marginBottom: '4px',
};
const daySumCell = {
  background: '#f0fdf4',
  padding: '10px',
  borderRadius: '16px',
  textAlign: 'center',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: '1px dashed #059669',
};
const mobileSumLabel = {
  background: '#059669',
  color: 'white',
  padding: '12px',
  borderRadius: '16px',
  fontWeight: 'bold',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
};
const weekSummaryPanel = {
  margin: '20px 0',
  background: 'white',
  padding: '20px',
  borderRadius: '20px',
  boxShadow: '0 4px 6px rgba(0,0,0,0.05)',
  border: '2px solid #059669',
};

const btnActionSmall = {
  border: 'none',
  borderRadius: '10px',
  width: '28px',
  height: '28px',
  fontSize: '12px',
  cursor: 'pointer',
  backdropFilter: 'blur(4px)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};
const btnDelSmall = {
  ...btnActionSmall,
  background: 'rgba(239, 68, 68, 0.7)',
  color: 'white',
};
const btnDelSmallStatic = {
  background: '#ef4444',
  color: 'white',
  border: 'none',
  borderRadius: '8px',
  width: '24px',
  height: '24px',
  cursor: 'pointer',
};
const mobileMealTag = {
  position: 'absolute',
  top: '10px',
  left: '10px',
  fontSize: '10px',
  fontWeight: '900',
  textTransform: 'uppercase',
};

const shoppingPanel = {
  marginTop: '20px',
  background: 'white',
  padding: '20px',
  borderRadius: '20px',
  boxShadow: '0 4px 6px rgba(0,0,0,0.05)',
};
const shoppingGrid = {
  display: 'grid',
  gridTemplateColumns:
    window.innerWidth < 600 ? '1fr' : 'repeat(auto-fill, minmax(220px, 1fr))',
  gap: '10px',
};
const shoppingItem = {
  padding: '12px',
  borderRadius: '12px',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  boxShadow: '0 2px 4px rgba(0,0,0,0.02)',
};

const inputS = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '12px',
  marginBottom: '10px',
  borderRadius: '12px',
  border: '1px solid #cbd5e1',
  fontSize: '14px',
  fontFamily: 'inherit',
  backgroundColor: '#fff',
};
const btnSuccessFull = {
  background: '#059669',
  color: 'white',
  border: 'none',
  padding: '14px',
  borderRadius: '12px',
  width: '100%',
  fontWeight: '800',
  marginTop: '10px',
  cursor: 'pointer',
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
  paddingBottom: '5px',
};
const productRowS = {
  display: 'flex',
  justifyContent: 'space-between',
  padding: '12px 10px',
  borderBottom: '1px solid #f1f5f9',
  alignItems: 'center',
  flexShrink: 0,
};
const recipeListItem = {
  padding: '12px 10px',
  borderBottom: '1px solid #f1f5f9',
  cursor: 'pointer',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  flexShrink: 0,
};
const searchResultsS = {
  background: 'white',
  border: '1px solid #e2e8f0',
  borderRadius: '12px',
  marginBottom: '15px',
};
const searchItemS = {
  padding: '10px',
  borderBottom: '1px solid #f1f5f9',
  cursor: 'pointer',
};
const ingRowS = {
  display: 'flex',
  justifyContent: 'space-between',
  padding: '10px 0',
  alignItems: 'center',
  borderBottom: '1px dashed #e2e8f0',
};
const iconBtn = {
  border: 'none',
  background: 'none',
  cursor: 'pointer',
  fontSize: '18px',
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
  padding: '40px 30px',
  borderRadius: '25px',
  width: '90%',
  maxWidth: '350px',
  boxSizing: 'border-box',
  boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
};
const loadingStyle = {
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  height: '100vh',
  color: '#059669',
  fontSize: '18px',
  fontWeight: 'bold',
};
const formBoxS = {
  background: '#f8fafc',
  padding: '15px',
  borderRadius: '16px',
  marginBottom: '15px',
  border: '1px solid #e2e8f0',
  flexShrink: 0,
};
const stepItemS = {
  padding: '12px',
  background: '#f0fdf4',
  borderRadius: '12px',
  borderLeft: '4px solid #059669',
  marginBottom: '10px',
  display: 'flex',
  gap: '10px',
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
  fontSize: '13px',
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
  fontSize: '13px',
  marginBottom: '12px',
};
const btnCartAddSmall = {
  background: '#e0f2fe',
  color: '#0369a1',
  border: 'none',
  padding: '6px 10px',
  borderRadius: '8px',
  fontSize: '11px',
  fontWeight: 'bold',
  cursor: 'pointer',
};
const statBoxS = {
  background: '#f8fafc',
  padding: '15px',
  borderRadius: '16px',
  border: '1px solid #e2e8f0',
  marginBottom: '15px',
};
const statRowS = {
  display: 'flex',
  justifyContent: 'space-between',
  padding: '10px 0',
  borderBottom: '1px solid #f1f5f9',
};
const statLabelS = {
  margin: '0 0 12px 0',
  color: '#475569',
  fontSize: '15px',
  borderBottom: '2px solid #059669',
  display: 'inline-block',
  paddingBottom: '4px',
};

const cookingOverlayS = { ...overlayS, background: 'rgba(15, 23, 42, 0.98)' };
const cookingCardS = {
  background: 'white',
  padding: '30px',
  borderRadius: '30px',
  width: '95%',
  maxWidth: '800px',
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
};

const statTabBtn = {
  background: 'transparent',
  color: '#64748b',
  border: 'none',
  padding: '8px 12px',
  fontSize: '13px',
  fontWeight: 'bold',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};
const statTabActive = {
  ...statTabBtn,
  color: '#059669',
  borderBottom: '3px solid #059669',
  paddingBottom: '5px',
};
