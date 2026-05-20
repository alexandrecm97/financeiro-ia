import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, AreaChart, Area } from "recharts";

// ── Constants ────────────────────────────────────────────────────────────────
const CATEGORIES = {
  alimentacao: { label: "Alimentação", emoji: "🍽️", color: "#f97316" },
  transporte:  { label: "Transporte",  emoji: "🚗", color: "#3b82f6" },
  lazer:       { label: "Lazer",       emoji: "🎉", color: "#a855f7" },
  saude:       { label: "Saúde",       emoji: "💊", color: "#22c55e" },
  moradia:     { label: "Moradia",     emoji: "🏠", color: "#f59e0b" },
  roupas:      { label: "Roupas",      emoji: "👗", color: "#ec4899" },
  educacao:    { label: "Educação",    emoji: "📚", color: "#06b6d4" },
  assinaturas: { label: "Assinaturas",emoji: "📱", color: "#8b5cf6" },
  viagem:      { label: "Viagem",      emoji: "✈️", color: "#14b8a6" },
  outros:      { label: "Outros",      emoji: "📦", color: "#6b7280" },
  receita:     { label: "Receita",     emoji: "💰", color: "#10b981" },
};

const FIXED_BILL_TYPES = [
  { key:"aluguel",   label:"Aluguel",    emoji:"🏠", color:"#f59e0b" },
  { key:"internet",  label:"Internet",   emoji:"🌐", color:"#3b82f6" },
  { key:"agua",      label:"Água",       emoji:"💧", color:"#06b6d4" },
  { key:"luz",       label:"Luz/Energia",emoji:"⚡", color:"#eab308" },
  { key:"streaming", label:"Streaming",  emoji:"🎬", color:"#ef4444" },
  { key:"academia",  label:"Academia",   emoji:"🏋️", color:"#10b981" },
  { key:"salario",   label:"Salário/Pró-labore",emoji:"💼",color:"#8b5cf6"},
  { key:"seguro",    label:"Seguro",     emoji:"🛡️", color:"#64748b" },
  { key:"outros",    label:"Outros",     emoji:"📋", color:"#6b7280" },
];

const MONTHS = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
const DAYS   = ["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"];
const STORAGE_KEY = "financas_premium_v1";

// ── Backup reminder ──────────────────────────────────────────────────────────
const BACKUP_REMINDER_KEY = "fin_last_backup_reminder";
const BACKUP_DONE_KEY     = "fin_last_backup_done";
const BACKUP_INTERVAL_DAYS = 30;

function shouldShowBackupReminder() {
  try {
    const lastDone     = localStorage.getItem(BACKUP_DONE_KEY);
    const lastReminder = localStorage.getItem(BACKUP_REMINDER_KEY);
    const now = Date.now();
    // Only remind if user has been using the app for at least 3 days
    const firstUse = localStorage.getItem("fin_first_use");
    if (!firstUse) { localStorage.setItem("fin_first_use", String(now)); return false; }
    if (now - parseInt(firstUse) < 3 * 24 * 60 * 60 * 1000) return false;
    // Don't remind more than once per day
    if (lastReminder && now - parseInt(lastReminder) < 24 * 60 * 60 * 1000) return false;
    // Remind if no backup in 30 days
    if (!lastDone) return true;
    return now - parseInt(lastDone) > BACKUP_INTERVAL_DAYS * 24 * 60 * 60 * 1000;
  } catch { return false; }
}
function markBackupReminderSeen() {
  try { localStorage.setItem(BACKUP_REMINDER_KEY, String(Date.now())); } catch {}
}
function markBackupDone() {
  try { localStorage.setItem(BACKUP_DONE_KEY, String(Date.now())); } catch {}
}

// ── Storage ──────────────────────────────────────────────────────────────────
function loadData() {
  try {
    const r = localStorage.getItem(STORAGE_KEY);
    if (r) return JSON.parse(r);
  } catch {}
  // Migrate from old key
  try {
    const old = localStorage.getItem("financas_app_data_v4");
    if (old) {
      const d = JSON.parse(old);
      return { ...defaultData(), ...d, fixedBills: [], goals: [], notifications: [] };
    }
  } catch {}
  return defaultData();
}
function defaultData() {
  return {
    transactions: [], rides: [],
    uberSettings: { dailyGoal: 200, workDays: [1,2,3,4,5] },
    customCategories: {}, cards: [], debts: [], charges: [],
    fixedBills: [], goals: [], notifications: [],
    profile: { name: "", pin: "", avatar: "💰" },
  };
}
function saveData(d) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(d)); } catch {} }

// ── Helpers ──────────────────────────────────────────────────────────────────
const fmt = (n) => (n||0).toLocaleString("pt-BR", { style:"currency", currency:"BRL" });
const todayKey = (d = new Date()) => d.toISOString().slice(0,10);
const fmtShort = (n) => {
  if (Math.abs(n) >= 1000000) return `R$${(n/1000000).toFixed(1)}M`;
  if (Math.abs(n) >= 1000) return `R$${(n/1000).toFixed(1)}K`;
  return fmt(n);
};

// ── AI ───────────────────────────────────────────────────────────────────────
async function callAI(messages, system, maxTokens = 4000) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model:"claude-sonnet-4-20250514", max_tokens: maxTokens, system, messages }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.content?.find(b => b.type === "text")?.text || "";
}

function fileToBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result.split(",")[1]);
    r.onerror = () => rej(new Error("Falha ao ler arquivo"));
    r.readAsDataURL(file);
  });
}

const INVOICE_SYSTEM = `Você é especialista em faturas de cartão de crédito brasileiro (Itaú, Bradesco, BB e outros).
Analise o conteúdo e extraia TODOS os lançamentos de compras reais.
Ignore: totais, subtotais, pagamentos anteriores, encargos, juros, IOF, saldo devedor, limite, cabeçalhos.
Responda APENAS com JSON válido sem markdown:
{"items":[{"description":"nome do estabelecimento limpo","amount":number,"date":"YYYY-MM-DD ou null","category":"alimentacao"|"transporte"|"lazer"|"saude"|"moradia"|"roupas"|"educacao"|"assinaturas"|"viagem"|"outros","installment":"2/6 ou null"}]}
Datas sem ano: use 2025. Valores em reais como número.`;

// ── Radial Progress ──────────────────────────────────────────────────────────
function RadialProgress({ pct, size=140, stroke=10, color="#10b981", children }) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const filled = Math.min(pct / 100, 1) * circ;
  return (
    <div style={{ position:"relative", width:size, height:size, margin:"0 auto" }}>
      <svg width={size} height={size} style={{ transform:"rotate(-90deg)" }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#1a1a2e" strokeWidth={stroke}/>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeDasharray={`${filled} ${circ}`} strokeLinecap="round"
          style={{ transition:"stroke-dasharray .6s ease" }}/>
      </svg>
      <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center" }}>
        {children}
      </div>
    </div>
  );
}

// ── Skeleton ─────────────────────────────────────────────────────────────────
function Skeleton({ w="100%", h=16, r=8 }) {
  return <div style={{ width:w, height:h, borderRadius:r, background:"linear-gradient(90deg,#1e1e2a 25%,#2a2a3a 50%,#1e1e2a 75%)", backgroundSize:"200% 100%", animation:"shimmer 1.5s infinite" }}/>;
}

// ── Notification Badge ───────────────────────────────────────────────────────
function Badge({ count }) {
  if (!count) return null;
  return (
    <span style={{ position:"absolute", top:-4, right:-4, background:"#ef4444", color:"white", borderRadius:"50%", width:16, height:16, fontSize:9, display:"flex", alignItems:"center", justifyContent:"center", fontWeight:700 }}>
      {count > 9 ? "9+" : count}
    </span>
  );
}

// ── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const stored = loadData();

  // Core state
  const [tab, setTab] = useState("dashboard");
  const [transactions, setTransactions]       = useState(() => stored.transactions || []);
  const [rides, setRides]                     = useState(() => stored.rides || []);
  const [uberSettings, setUberSettings]       = useState(() => stored.uberSettings || { dailyGoal:200, workDays:[1,2,3,4,5] });
  const [customCategories, setCustomCategories] = useState(() => stored.customCategories || {});
  const [cards, setCards]                     = useState(() => stored.cards || []);
  const [debts, setDebts]                     = useState(() => stored.debts || []);
  const [charges, setCharges]                 = useState(() => stored.charges || []);
  const [fixedBills, setFixedBills]           = useState(() => stored.fixedBills || []);
  const [goals, setGoals]                     = useState(() => stored.goals || []);
  const [profile, setProfile]                 = useState(() => stored.profile || { name:"", pin:"", avatar:"💰" });

  // Filter
  const [filterMonth, setFilterMonth] = useState(new Date().getMonth());
  const [filterYear]                  = useState(new Date().getFullYear());

  // Theme
  const [darkMode, setDarkMode] = useState(() => { try { return localStorage.getItem("fin_theme") !== "light"; } catch { return true; } });
  useEffect(() => { try { localStorage.setItem("fin_theme", darkMode?"dark":"light"); } catch {} }, [darkMode]);

  const T = darkMode ? {
    bg:"#0a0a12", card:"#12121e", card2:"#16162a", border:"#22223a", text:"#e8e8f8",
    sub:"#4a4a6a", muted:"#1a1a2a", inp:"#1a1a2a", inpBorder:"#22223a",
    hover:"#1a1a2a", tabOn:"#22223a", tabOnText:"#e8e8f8", accent:"#7c3aed",
    success:"#10b981", danger:"#ef4444", warning:"#f59e0b",
  } : {
    bg:"#f0f0f8", card:"#ffffff", card2:"#f8f8ff", border:"#e0e0f0", text:"#0a0a1a",
    sub:"#888", muted:"#e8e8f8", inp:"#f5f5fd", inpBorder:"#e0e0f0",
    hover:"#f0f0fc", tabOn:"#e8e8f8", tabOnText:"#0a0a1a", accent:"#7c3aed",
    success:"#10b981", danger:"#ef4444", warning:"#f59e0b",
  };

  // All categories
  const allCategories = useMemo(() => ({ ...CATEGORIES, ...customCategories }), [customCategories]);

  // Category goals
  const [catGoals, setCatGoals]   = useState(() => { try { const r = localStorage.getItem("fin_catgoals"); return r?JSON.parse(r):{}; } catch { return {}; } });
  const [showCatGoals, setShowCatGoals] = useState(false);
  useEffect(() => { try { localStorage.setItem("fin_catgoals", JSON.stringify(catGoals)); } catch {} }, [catGoals]);

  // History filter
  const [histSearch, setHistSearch]       = useState("");
  const [histFilterCat, setHistFilterCat] = useState("");
  const [histFilterCard, setHistFilterCard] = useState("");

  // Uber weekly goal
  const [uberWeeklyGoal, setUberWeeklyGoal] = useState(() => { try { return parseFloat(localStorage.getItem("fin_weeklygoal"))||0; } catch { return 0; } });
  useEffect(() => { try { localStorage.setItem("fin_weeklygoal", String(uberWeeklyGoal)); } catch {} }, [uberWeeklyGoal]);
  const [weeklyGoalInput, setWeeklyGoalInput] = useState("");

  // Card modal
  const [showCardModal, setShowCardModal]   = useState(false);
  const [cardName, setCardName]             = useState("");
  const [cardBrand, setCardBrand]           = useState("visa");
  const [cardColor, setCardColor]           = useState("#7c3aed");
  const [cardClosingDay, setCardClosingDay] = useState(15);
  const [cardDueDay, setCardDueDay]         = useState(25);
  const [cardLimit, setCardLimit]           = useState("");
  const [editingCardId, setEditingCardId]   = useState(null);
  const CARD_BRANDS = { visa:"Visa", master:"Mastercard", elo:"Elo", amex:"Amex", hipercard:"Hipercard", outro:"Outro" };
  const CARD_COLORS = ["#7c3aed","#ef4444","#3b82f6","#10b981","#f59e0b","#ec4899","#06b6d4","#1a1a2e","#059669","#dc2626"];

  // Debt modal
  const [showDebtModal, setShowDebtModal] = useState(false);
  const [debtDesc, setDebtDesc]           = useState("");
  const [debtAmount, setDebtAmount]       = useState("");
  const [debtMonths, setDebtMonths]       = useState(12);
  const [debtStart, setDebtStart]         = useState(todayKey());
  const [debtMsg, setDebtMsg]             = useState("");

  // New category modal
  const [showNewCat, setShowNewCat]   = useState(false);
  const [newCatName, setNewCatName]   = useState("");
  const [newCatEmoji, setNewCatEmoji] = useState("🏷️");

  // Add tab
  const [addInput, setAddInput]   = useState("");
  const [addLoading, setAddLoading] = useState(false);
  const [addMsg, setAddMsg]       = useState(null);
  const [addMode, setAddMode]     = useState("manual");
  const [addType, setAddType]     = useState("expense");
  const [manDesc, setManDesc]     = useState("");
  const [manAmount, setManAmount] = useState("");
  const [manCategory, setManCategory] = useState("outros");
  const [manPayment, setManPayment]   = useState("debit");
  const [manCard, setManCard]     = useState("");
  const [manInstall, setManInstall] = useState(1);
  const [manDate, setManDate]     = useState(todayKey());
  const [manMsg, setManMsg]       = useState("");
  const [incDesc, setIncDesc]     = useState("");
  const [incAmount, setIncAmount] = useState("");
  const [incSource, setIncSource] = useState("salario");
  const [incMsg, setIncMsg]       = useState("");

  // Uber
  const [rideInput, setRideInput]     = useState("");
  const [rideMsg, setRideMsg]         = useState("");
  const [editingDate, setEditingDate] = useState(null);
  const [editInput, setEditInput]     = useState("");
  const [showUberSettings, setShowUberSettings] = useState(false);
  const [goalInput, setGoalInput]     = useState(String(uberSettings.dailyGoal));
  const [uberAI, setUberAI]           = useState("");
  const [uberAILoading, setUberAILoading] = useState(false);

  // Invoice
  const [invoiceMode, setInvoiceMode]     = useState("image");
  const [invoiceText, setInvoiceText]     = useState("");
  const [invoiceFile, setInvoiceFile]     = useState(null);
  const [invoiceImages, setInvoiceImages] = useState([]);
  const [invoiceLoading, setInvoiceLoading] = useState(false);
  const [invoiceItems, setInvoiceItems]   = useState(null);
  const [invoiceError, setInvoiceError]   = useState("");
  const [invoiceCardId, setInvoiceCardId] = useState("");
  const [selectedItems, setSelectedItems] = useState({});
  const [importDone, setImportDone]       = useState(false);
  const [dragOver, setDragOver]           = useState(false);
  const pdfRef = useRef(); const imgRef = useRef();

  // AI
  const [analysis, setAnalysis]             = useState("");
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [aiChat, setAiChat]                 = useState([]);
  const [aiChatInput, setAiChatInput]       = useState("");
  const [aiChatLoading, setAiChatLoading]   = useState(false);

  // Fixed bills
  const [showFixedBillForm, setShowFixedBillForm] = useState(false);
  const [fbDesc, setFbDesc]     = useState("");
  const [fbAmount, setFbAmount] = useState("");
  const [fbType, setFbType]     = useState("outros");
  const [fbDueDay, setFbDueDay] = useState(5);
  const [fbMsg, setFbMsg]       = useState("");

  // Goals
  const [showGoalForm, setShowGoalForm] = useState(false);
  const [goalDesc, setGoalDesc]     = useState("");
  const [goalTarget, setGoalTarget] = useState("");
  const [goalSaved, setGoalSaved]   = useState("");
  const [goalDeadline, setGoalDeadline] = useState("");
  const [goalEmoji, setGoalEmoji]   = useState("🎯");
  const [goalFormMsg, setGoalFormMsg] = useState("");

  // Edit transaction
  const [editTx, setEditTx] = useState(null);

  // Charges
  const [showChargeForm, setShowChargeForm] = useState(false);
  const [chargeDesc, setChargeDesc]     = useState("");
  const [chargeTotal, setChargeTotal]   = useState("");
  const [chargeInstall, setChargeInstall] = useState(1);
  const [chargePeople, setChargePeople] = useState([{ name:"", paid:[] }]);
  const [chargeMsg, setChargeMsg]       = useState("");

  // Backup reminder
  const [showBackupReminder, setShowBackupReminder] = useState(() => shouldShowBackupReminder());
  const [pwaPrompt, setPwaPrompt] = useState(null); // beforeinstallprompt event

  // PWA install prompt (Android/desktop)
  useEffect(() => {
    const handler = (e) => { e.preventDefault(); setPwaPrompt(e); };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  // Backup
  const [importMsg, setImportMsg] = useState("");
  const backupRef = useRef();

  // Profile modal
  const [showProfile, setShowProfile] = useState(false);
  const [profileName, setProfileName] = useState(profile.name);
  const [profileAvatar, setProfileAvatar] = useState(profile.avatar);

  // Notifications panel
  const [showNotifs, setShowNotifs] = useState(false);

  // ── Persist ──────────────────────────────────────────────────────────────
  useEffect(() => {
    saveData({ transactions, rides, uberSettings, customCategories, cards, debts, charges, fixedBills, goals, profile });
  }, [transactions, rides, uberSettings, customCategories, cards, debts, charges, fixedBills, goals, profile]);

  // ── Computed ─────────────────────────────────────────────────────────────
  const filtered = useMemo(() => transactions.filter(t => {
    const d = new Date(t.date);
    return d.getMonth() === filterMonth && d.getFullYear() === filterYear;
  }), [transactions, filterMonth, filterYear]);

  const totalIncome  = useMemo(() => filtered.filter(t=>t.type==="income").reduce((s,t)=>s+t.amount,0), [filtered]);
  const totalExpense = useMemo(() => filtered.filter(t=>t.type==="expense").reduce((s,t)=>s+t.amount,0), [filtered]);
  const balance      = totalIncome - totalExpense;

  // Daily avg & projection
  const today = new Date();
  const daysInMonth = new Date(filterYear, filterMonth+1, 0).getDate();
  const dayOfMonth = filterMonth === today.getMonth() && filterYear === today.getFullYear()
    ? today.getDate() : daysInMonth;
  const dailyAvg = dayOfMonth > 0 ? totalExpense / dayOfMonth : 0;
  const projected = dailyAvg * daysInMonth;

  const categoryData = useMemo(() =>
    Object.entries(
      filtered.filter(t=>t.type==="expense").reduce((acc,t) => { acc[t.category]=(acc[t.category]||0)+t.amount; return acc; }, {})
    ).map(([k,v]) => ({ name:allCategories[k]?.label||k, value:v, color:allCategories[k]?.color||"#888", emoji:allCategories[k]?.emoji, key:k }))
     .sort((a,b)=>b.value-a.value)
  , [filtered, allCategories]);

  const last6months = useMemo(() => Array.from({length:6},(_,i)=>{
    const d = new Date(filterYear, filterMonth-5+i, 1);
    const m = d.getMonth(), y = d.getFullYear();
    const ts = transactions.filter(t=>{ const td=new Date(t.date); return td.getMonth()===m&&td.getFullYear()===y; });
    return { name:MONTHS[m], receita:ts.filter(t=>t.type==="income").reduce((s,t)=>s+t.amount,0), gasto:ts.filter(t=>t.type==="expense").reduce((s,t)=>s+t.amount,0) };
  }), [transactions, filterMonth, filterYear]);

  // Card totals
  const getCardCurrentPeriod = useCallback((card) => {
    const closingDay = card.closingDay || 15;
    const now = new Date();
    let closingDate = new Date(now.getFullYear(), now.getMonth(), closingDay);
    if (now.getDate() > closingDay) closingDate.setMonth(closingDate.getMonth()+1);
    const startDate = new Date(closingDate.getFullYear(), closingDate.getMonth()-1, closingDay+1);
    const dueDay = card.dueDay || 25;
    const dueDate = new Date(closingDate.getFullYear(), closingDate.getMonth(), dueDay);
    if (dueDay <= closingDay) dueDate.setMonth(dueDate.getMonth()+1);
    const daysUntilDue = Math.ceil((dueDate - now)/(1000*60*60*24));
    const txs = transactions.filter(t=>t.cardId===card.id&&t.type==="expense"&&new Date(t.date)>=startDate&&new Date(t.date)<=closingDate);
    const total = txs.reduce((s,t)=>s+t.amount,0);
    const limit = card.limit || 0;
    const available = limit > 0 ? Math.max(0, limit - total) : null;
    return { total, txs, startDate, closingDate, dueDate, daysUntilDue, limit, available };
  }, [transactions]);

  // Uber
  const todayKey_ = todayKey();
  const todayEntry  = rides.find?.(r=>r.date===todayKey_);
  const todayTotal  = todayEntry?.amount || 0;
  const goalPct     = uberSettings.dailyGoal > 0 ? (todayTotal/uberSettings.dailyGoal)*100 : 0;
  const remaining   = Math.max(0, uberSettings.dailyGoal - todayTotal);

  const last14 = useMemo(() => Array.from({length:14},(_,i)=>{
    const d = new Date(); d.setDate(d.getDate()-(13-i));
    const key = todayKey(d);
    const entry = rides.find?.(r=>r.date===key);
    return { name:DAYS[d.getDay()], date:key, total:entry?.amount||0, isToday:key===todayKey_ };
  }), [rides, todayKey_]);

  const weekDays     = last14.slice(7);
  const weekTotal    = weekDays.reduce((s,d)=>s+d.total,0);
  const weekDaysWorked = weekDays.filter(d=>d.total>0).length;
  const weekAvg      = weekDaysWorked>0 ? weekTotal/weekDaysWorked : 0;
  const allTimeTotal = rides.reduce?.((s,r)=>s+r.amount,0) || 0;
  const allTimeDays  = rides.length||0;
  const goalColor    = goalPct>=100?"#10b981":goalPct>=60?"#f59e0b":"#7c3aed";

  // Fixed bills due this month
  const fixedBillsDue = useMemo(() => {
    const now = new Date();
    return fixedBills.filter(b=>{
      const paid = b.paidMonths?.includes(`${filterYear}-${String(filterMonth+1).padStart(2,"0")}`);
      return !paid;
    });
  }, [fixedBills, filterMonth, filterYear]);

  // Smart notifications
  const notifications = useMemo(() => {
    const notifs = [];
    const now = new Date();
    // Fixed bills due soon
    fixedBills.forEach(b => {
      const monthKey = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
      const paid = b.paidMonths?.includes(monthKey);
      if (!paid && b.dueDay) {
        const daysLeft = b.dueDay - now.getDate();
        if (daysLeft >= 0 && daysLeft <= 5) {
          notifs.push({ type:"warning", icon:"⚡", text:`${b.description} vence em ${daysLeft===0?"hoje":`${daysLeft} dias`}`, id:b.id+"_due" });
        } else if (daysLeft < 0) {
          notifs.push({ type:"danger", icon:"🔴", text:`${b.description} está ATRASADO`, id:b.id+"_late" });
        }
      }
    });
    // Card closing soon
    cards.forEach(c => {
      const { daysUntilDue } = getCardCurrentPeriod(c);
      if (daysUntilDue > 0 && daysUntilDue <= 3) {
        notifs.push({ type:"warning", icon:"💳", text:`Fatura do ${c.name} vence em ${daysUntilDue} dia${daysUntilDue!==1?"s":""}`, id:c.id+"_card" });
      }
    });
    // Overspending
    if (projected > totalIncome * 1.1 && totalIncome > 0) {
      notifs.push({ type:"danger", icon:"📉", text:`Projeção de gastos (${fmt(projected)}) ultrapassa receitas`, id:"overspend" });
    }
    // Goals at risk
    goals.forEach(g => {
      if (g.deadline) {
        const deadline = new Date(g.deadline);
        const daysLeft = Math.ceil((deadline - now)/(1000*60*60*24));
        const pct = Math.min((g.saved||0)/g.target*100, 100);
        if (daysLeft > 0 && daysLeft <= 30 && pct < 80) {
          notifs.push({ type:"warning", icon:"🎯", text:`Meta "${g.description}" em risco — faltam ${daysLeft} dias`, id:g.id+"_goal" });
        }
      }
    });
    return notifs;
  }, [fixedBills, cards, goals, projected, totalIncome]);

  // AI Insights (memoized strings)
  const aiInsights = useMemo(() => {
    const insights = [];
    if (totalExpense > 0) {
      const prev = new Date(filterYear, filterMonth-1, 1);
      const prevTxs = transactions.filter(t=>{ const d=new Date(t.date); return d.getMonth()===prev.getMonth()&&d.getFullYear()===prev.getFullYear()&&t.type==="expense"; });
      const prevTotal = prevTxs.reduce((s,t)=>s+t.amount,0);
      if (prevTotal > 0) {
        const diff = ((totalExpense - prevTotal) / prevTotal * 100);
        if (diff > 20) insights.push({ icon:"📈", text:`Gastos ${diff.toFixed(0)}% acima do mês anterior`, color:"#ef4444" });
        else if (diff < -20) insights.push({ icon:"📉", text:`Parabéns! Gastos ${Math.abs(diff).toFixed(0)}% abaixo do mês anterior`, color:"#10b981" });
      }
      // Top category
      if (categoryData[0]) {
        const topPct = (categoryData[0].value / totalExpense * 100);
        if (topPct > 40) insights.push({ icon:"⚠️", text:`${categoryData[0].emoji} ${categoryData[0].name} representa ${topPct.toFixed(0)}% dos gastos`, color:"#f59e0b" });
      }
      // Projection
      if (projected > totalIncome && totalIncome > 0) {
        insights.push({ icon:"🚨", text:`Projeção de ${fmt(projected)} pode ultrapassar receita de ${fmt(totalIncome)}`, color:"#ef4444" });
      } else if (balance > 0) {
        insights.push({ icon:"✅", text:`Economia de ${fmt(balance)} em ${MONTHS[filterMonth]}`, color:"#10b981" });
      }
    }
    if (fixedBillsDue.length > 0) {
      const totalFixed = fixedBillsDue.reduce((s,b)=>s+(b.amount||0),0);
      insights.push({ icon:"📋", text:`${fixedBillsDue.length} conta(s) fixa(s) em aberto — ${fmt(totalFixed)}`, color:"#f59e0b" });
    }
    return insights;
  }, [totalExpense, totalIncome, categoryData, projected, balance, filterMonth, filterYear, transactions, fixedBillsDue]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleAdd = useCallback(async () => {
    if (!addInput.trim()) return;
    setAddLoading(true); setAddMsg(null);
    const cardList = cards.length>0 ? `\nCartões: ${cards.map(c=>`"${c.name}"(id:${c.id})`).join(", ")}` : "";
    try {
      const text = await callAI(
        [{ role:"user", content:addInput }],
        `Assistente financeiro brasileiro. Extraia a transação e responda APENAS JSON válido sem markdown:
{"type":"expense"|"income","amount":number,"description":"string","category":"alimentacao"|"transporte"|"lazer"|"saude"|"moradia"|"roupas"|"educacao"|"assinaturas"|"viagem"|"outros"|"receita","payment":"credit"|"debit","installments":number,"cardId":number|null,"insight":"dica curta em português"}
Regras: crédito/cartão/parcelado → payment:credit; débito/pix/dinheiro → debit; installments:1 se não parcelado.${cardList}`
      );
      const result = JSON.parse(text.replace(/```json|```/g,"").trim());
      if (result.error) { setAddMsg({ type:"error", text:"Não entendi. Ex: 'blusa Renner 150 em 2x no Nubank'" }); }
      else {
        const matchedCard = cards.find(c=>c.id===result.cardId);
        const cardId = matchedCard ? result.cardId : null;
        const installTotal = result.payment==="credit" ? (result.installments||1) : 1;
        const toAdd = [];
        for (let k=0; k<installTotal; k++) {
          const d = new Date(); d.setMonth(d.getMonth()+k);
          toAdd.push({ id:Date.now()+k, type:result.type, amount:result.amount, description:result.description+(installTotal>1?` (${k+1}/${installTotal})`:""), category:result.category, payment:result.payment, cardId, date:d.toISOString(), raw:addInput });
        }
        setTransactions(p=>[...toAdd,...p]);
        setAddMsg({ type:"success", ...result, installTotal, cardId, matchedCard });
        setAddInput("");
      }
    } catch { setAddMsg({ type:"error", text:"Erro ao processar. Tente novamente." }); }
    setAddLoading(false);
  }, [addInput, cards]);

  const handleManualAdd = () => {
    const val = parseFloat(manAmount.replace(",","."));
    if (!manDesc.trim() || !val || val<=0) { setManMsg("err"); return; }
    const toAdd = [];
    const baseDate = manDate ? new Date(manDate+"T12:00:00") : new Date();
    const installTotal = manPayment==="credit" ? manInstall : 1;
    for (let k=0; k<installTotal; k++) {
      const d = new Date(baseDate); d.setMonth(d.getMonth()+k);
      toAdd.push({ id:Date.now()+k, type:"expense", amount:val, description:manDesc.trim()+(installTotal>1?` (${k+1}/${installTotal})`:""), category:manCategory, date:d.toISOString(), payment:manPayment, cardId:manPayment==="credit"?(manCard||null):null, raw:"manual" });
    }
    setTransactions(p=>[...toAdd,...p]);
    setManMsg("ok"); setManDesc(""); setManAmount(""); setManInstall(1); setManPayment("debit"); setManCategory("outros"); setManCard(""); setManDate(todayKey());
    setTimeout(()=>setManMsg(""), 2500);
  };

  const INCOME_SOURCES = {
    salario:{ label:"Salário", emoji:"💼" }, freelance:{ label:"Freelance", emoji:"💻" },
    uber:{ label:"Uber", emoji:"🚗" }, investimento:{ label:"Investimento", emoji:"📈" },
    aluguel:{ label:"Aluguel", emoji:"🏠" }, bonus:{ label:"Bônus/Extra", emoji:"🎁" },
    outros:{ label:"Outros", emoji:"💰" },
  };

  const handleIncomeAdd = () => {
    const val = parseFloat(incAmount.replace(",","."));
    if (!incDesc.trim() || !val || val<=0) { setIncMsg("err"); return; }
    setTransactions(p=>[{ id:Date.now(), type:"income", amount:val, description:incDesc.trim(), category:"receita", incomeSource:incSource, date:new Date().toISOString(), raw:"manual-income" },...p]);
    setIncMsg("ok"); setIncDesc(""); setIncAmount("");
    setTimeout(()=>setIncMsg(""), 2500);
  };

  const handleSaveDayEarnings = (dateKey, inputVal) => {
    const val = parseFloat((inputVal||"").replace(",","."));
    if (!val||val<=0) { setRideMsg("err"); return; }
    const rideId = Date.now(), txId = rideId+1;
    setRides(p=>{ const f=p.filter(r=>r.date!==dateKey); return [{ id:rideId, amount:val, date:dateKey, ts:new Date().toISOString(), txId },...f]; });
    setTransactions(p=>{ const f=p.filter(t=>!(t.uberDate===dateKey)); const iso=new Date(dateKey+"T12:00:00").toISOString(); return [{ id:txId, type:"income", amount:val, description:"Uber — ganho do dia", category:"receita", date:iso, uberDate:dateKey, raw:"uber" },...f]; });
    if (dateKey===todayKey_) setRideInput("");
    setEditingDate(null); setEditInput(""); setRideMsg("ok"); setTimeout(()=>setRideMsg(""),2000);
  };
  const deleteDay = (dateKey) => { setRides(p=>p.filter(r=>r.date!==dateKey)); setTransactions(p=>p.filter(t=>t.uberDate!==dateKey)); };

  const saveGoalUber = () => { const val=parseFloat(goalInput); if(val>0){setUberSettings(s=>({...s,dailyGoal:val}));} setShowUberSettings(false); };

  const handleUberAI = async () => {
    setUberAILoading(true);
    const summary = last14.map(d=>`${d.date}(${DAYS[new Date(d.date+"T12:00:00").getDay()]}):R$${d.total.toFixed(2)}`).join("\n");
    try {
      const text = await callAI([{ role:"user", content:`Meta diária: R$${uberSettings.dailyGoal}\nÚltimos 14 dias:\n${summary}\n\nDê análise e dicas para maximizar ganhos.` }],
        "Consultor de motoristas de app no Brasil. Analise os dados e dê 4-5 dicas práticas objetivas com emojis. Foque em horários, dias, estratégias para bater a meta."
      );
      setUberAI(text);
    } catch { setUberAI("Erro ao gerar análise."); }
    setUberAILoading(false);
  };

  const addImageFiles = async (files) => {
    const valid = Array.from(files).filter(f=>f.type.startsWith("image/"));
    if (!valid.length) return;
    const newImgs = await Promise.all(valid.map(async (file)=>{ const b64=await fileToBase64(file); return { file, preview:URL.createObjectURL(file), base64:b64, mediaType:file.type, id:Math.random() }; }));
    setInvoiceImages(p=>[...p,...newImgs]);
  };

  const handleParseInvoice = async () => {
    setInvoiceLoading(true); setInvoiceError(""); setInvoiceItems(null); setImportDone(false);
    try {
      let messages;
      if (invoiceMode==="image") {
        if (!invoiceImages.length) { setInvoiceError("Adicione pelo menos um print."); setInvoiceLoading(false); return; }
        messages = [{ role:"user", content:[ ...invoiceImages.map(img=>({ type:"image", source:{ type:"base64", media_type:img.mediaType, data:img.base64 } })), { type:"text", text:"Extraia todos os lançamentos desta fatura." } ]}];
      } else if (invoiceMode==="pdf") {
        if (!invoiceFile) { setInvoiceError("Selecione um PDF."); setInvoiceLoading(false); return; }
        const b64 = await fileToBase64(invoiceFile);
        messages = [{ role:"user", content:[{ type:"document", source:{ type:"base64", media_type:"application/pdf", data:b64 } },{ type:"text", text:"Extraia todos os lançamentos desta fatura." }]}];
      } else {
        if (!invoiceText.trim()) { setInvoiceError("Cole o texto da fatura."); setInvoiceLoading(false); return; }
        messages = [{ role:"user", content:`Fatura:\n${invoiceText}` }];
      }
      const rawText = await callAI(messages, INVOICE_SYSTEM);
      let parsed = null;
      const m = rawText.match(/\{[\s\S]*\}/);
      if (m) { try { parsed = JSON.parse(m[0]); } catch {} }
      if (!parsed) { try { parsed = JSON.parse(rawText.replace(/```json|```/g,"").trim()); } catch {} }
      if (!parsed || !parsed.items?.length) { setInvoiceError("Não encontrei lançamentos. Verifique o arquivo."); }
      else {
        const validCats = Object.keys(allCategories).filter(c=>c!=="receita");
        const items = parsed.items.map(item=>({ ...item, amount:typeof item.amount==="number"?item.amount:parseFloat(String(item.amount).replace(",","."))||0, category:validCats.includes(item.category)?item.category:"outros" })).filter(item=>item.amount>0);
        setInvoiceItems(items);
        setSelectedItems(Object.fromEntries(items.map((_,i)=>[i,true])));
      }
    } catch { setInvoiceError("Erro ao processar. Tente novamente."); }
    setInvoiceLoading(false);
  };

  const handleImportSelected = () => {
    const toAdd = [];
    invoiceItems.forEach((item,i)=>{
      if (!selectedItems[i]) return;
      toAdd.push({ id:Date.now()+i+Math.random(), type:"expense", amount:item.amount, description:item.description, category:item.category, date:item.date?new Date(item.date).toISOString():new Date().toISOString(), payment:"credit", cardId:invoiceCardId||null, installment:item.installment||null, raw:"invoice" });
    });
    setTransactions(p=>[...toAdd,...p]);
    setImportDone(true); setInvoiceItems(null); setInvoiceText(""); setInvoiceFile(null); setInvoiceImages([]); setInvoiceCardId("");
  };

  const deleteTransaction = (id) => setTransactions(p=>p.filter(t=>t.id!==id));
  const resetInvoice = () => { setInvoiceItems(null); setInvoiceError(""); setInvoiceImages([]); setInvoiceFile(null); setInvoiceText(""); };

  const saveEditTx = () => { if (!editTx) return; setTransactions(p=>p.map(t=>t.id===editTx.id?{...editTx}:t)); setEditTx(null); };

  // Categories
  const saveNewCategory = () => {
    if (!newCatName.trim()) return;
    const key = "custom_"+newCatName.toLowerCase().replace(/\s+/g,"_")+"_"+Date.now();
    const colors = ["#e11d48","#9333ea","#7c3aed","#4f46e5","#0891b2","#059669","#ca8a04","#ea580c"];
    setCustomCategories(p=>({ ...p, [key]:{ label:newCatName.trim(), emoji:newCatEmoji, color:colors[Object.keys(p).length%colors.length] } }));
    setManCategory(key); setNewCatName(""); setNewCatEmoji("🏷️"); setShowNewCat(false);
  };
  const deleteCustomCategory = (key) => setCustomCategories(p=>{ const n={...p}; delete n[key]; return n; });

  // Cards
  const saveCard = () => {
    if (!cardName.trim()) return;
    const limit = parseFloat(cardLimit) || 0;
    if (editingCardId) { setCards(p=>p.map(c=>c.id===editingCardId?{...c,name:cardName.trim(),brand:cardBrand,color:cardColor,closingDay:cardClosingDay,dueDay:cardDueDay,limit}:c)); }
    else { setCards(p=>[...p,{ id:Date.now(), name:cardName.trim(), brand:cardBrand, color:cardColor, closingDay:cardClosingDay, dueDay:cardDueDay, limit }]); }
    setCardName(""); setCardBrand("visa"); setCardColor("#7c3aed"); setCardClosingDay(15); setCardDueDay(25); setCardLimit(""); setEditingCardId(null); setShowCardModal(false);
  };
  const openEditCard = (c) => { setEditingCardId(c.id); setCardName(c.name); setCardBrand(c.brand||"visa"); setCardColor(c.color||"#7c3aed"); setCardClosingDay(c.closingDay||15); setCardDueDay(c.dueDay||25); setCardLimit(String(c.limit||"")); setShowCardModal(true); };
  const deleteCard = (id) => setCards(p=>p.filter(c=>c.id!==id));

  // Debts
  const saveDebt = () => {
    const val = parseFloat(debtAmount.replace(",","."));
    if (!debtDesc.trim()||!val||val<=0||debtMonths<1) { setDebtMsg("err"); return; }
    const installAmt = Math.round((val/debtMonths)*100)/100;
    const debtId = Date.now();
    setDebts(p=>[{ id:debtId, description:debtDesc.trim(), amount:installAmt, totalAmount:val, months:debtMonths, startDate:debtStart, createdAt:new Date().toISOString() },...p]);
    const toAdd = Array.from({length:debtMonths},(_,k)=>{ const d=new Date(debtStart+"T12:00:00"); d.setMonth(d.getMonth()+k); return { id:debtId+k+1, type:"expense", amount:installAmt, description:`${debtDesc.trim()} (${k+1}/${debtMonths})`, category:"outros", payment:"boleto", debtId, date:d.toISOString(), raw:"divida" }; });
    setTransactions(p=>[...toAdd,...p]);
    setDebtMsg("ok"); setDebtDesc(""); setDebtAmount(""); setDebtMonths(12); setDebtStart(todayKey());
    setTimeout(()=>{ setDebtMsg(""); setShowDebtModal(false); },2000);
  };
  const deleteDebt = (debtId) => { setDebts(p=>p.filter(d=>d.id!==debtId)); setTransactions(p=>p.filter(t=>t.debtId!==debtId)); };

  // Fixed bills
  const saveFixedBill = () => {
    const val = parseFloat(fbAmount.replace(",","."));
    if (!fbDesc.trim()||!val||val<=0) { setFbMsg("err"); return; }
    setFixedBills(p=>[...p,{ id:Date.now(), description:fbDesc.trim(), amount:val, type:fbType, dueDay:fbDueDay, paidMonths:[], active:true, createdAt:new Date().toISOString() }]);
    setFbMsg("ok"); setFbDesc(""); setFbAmount(""); setFbType("outros"); setFbDueDay(5);
    setTimeout(()=>{ setFbMsg(""); setShowFixedBillForm(false); },1500);
  };
  const markFixedBillPaid = (id, monthKey) => {
    setFixedBills(p=>p.map(b=>b.id===id?{ ...b, paidMonths:[...(b.paidMonths||[]).filter(m=>m!==monthKey),monthKey] }:b));
    // Add income or expense transaction
    const bill = fixedBills.find(b=>b.id===id);
    if (bill) {
      setTransactions(p=>[{ id:Date.now(), type:"expense", amount:bill.amount, description:bill.description, category:"moradia", date:new Date().toISOString(), payment:"debit", raw:"conta_fixa" },...p]);
    }
  };
  const unmarkFixedBillPaid = (id, monthKey) => setFixedBills(p=>p.map(b=>b.id===id?{ ...b, paidMonths:(b.paidMonths||[]).filter(m=>m!==monthKey) }:b));
  const deleteFixedBill = (id) => setFixedBills(p=>p.filter(b=>b.id!==id));

  // Goals
  const saveGoal = () => {
    const target = parseFloat(goalTarget.replace(",","."));
    const saved = parseFloat(goalSaved.replace(",","."))||0;
    if (!goalDesc.trim()||!target||target<=0) { setGoalFormMsg("err"); return; }
    setGoals(p=>[...p,{ id:Date.now(), description:goalDesc.trim(), target, saved, deadline:goalDeadline||null, emoji:goalEmoji, createdAt:new Date().toISOString() }]);
    setGoalFormMsg("ok"); setGoalDesc(""); setGoalTarget(""); setGoalSaved(""); setGoalDeadline(""); setGoalEmoji("🎯");
    setTimeout(()=>{ setGoalFormMsg(""); setShowGoalForm(false); },1500);
  };
  const updateGoalSaved = (id, amount) => setGoals(p=>p.map(g=>g.id===id?{...g,saved:amount}:g));
  const deleteGoal = (id) => setGoals(p=>p.filter(g=>g.id!==id));

  // Charges
  const addChargePerson = () => setChargePeople(p=>[...p,{ name:"", paid:[] }]);
  const removeChargePerson = (i) => setChargePeople(p=>p.filter((_,idx)=>idx!==i));
  const updatePersonName = (i, name) => setChargePeople(p=>p.map((x,idx)=>idx===i?{...x,name}:x));
  const saveCharge = () => {
    const total = parseFloat(chargeTotal.replace(",","."));
    if (!chargeDesc.trim()||!total||total<=0||chargePeople.some(p=>!p.name.trim())) { setChargeMsg("err"); return; }
    const perPerson = Math.round((total/chargePeople.length)*100)/100;
    const installAmt = Math.round((perPerson/chargeInstall)*100)/100;
    setCharges(prev=>[{ id:Date.now(), description:chargeDesc.trim(), total, perPerson, installments:chargeInstall, installAmt, people:chargePeople.map((p,i)=>({ id:Date.now()+i+1, name:p.name.trim(), paid:Array(chargeInstall).fill(false) })), date:new Date().toISOString() },...prev]);
    setChargeMsg("ok"); setChargeDesc(""); setChargeTotal(""); setChargeInstall(1); setChargePeople([{ name:"", paid:[] }]);
    setTimeout(()=>{ setChargeMsg(""); setShowChargeForm(false); },1500);
  };
  const toggleInstallPaid = (chargeId, personId, installIdx) => {
    const charge = charges.find(c=>c.id===chargeId);
    const person = charge?.people.find(p=>p.id===personId);
    if (charge&&person&&!person.paid[installIdx]) {
      setTransactions(prev=>[{ id:Date.now(), type:"income", amount:charge.installAmt, description:`${charge.description} — ${person.name}${charge.installments>1?` (${installIdx+1}/${charge.installments})`:""}`, category:"receita", date:new Date().toISOString(), raw:"cobranca" },...prev]);
    }
    setCharges(prev=>prev.map(c=>{ if(c.id!==chargeId)return c; const people=c.people.map(p=>{ if(p.id!==personId)return p; const paid=[...p.paid]; paid[installIdx]=!paid[installIdx]; return {...p,paid}; }); return {...c,people}; }));
  };
  const deleteCharge = (id) => setCharges(p=>p.filter(c=>c.id!==id));

  // AI Chat
  const handleAiChat = async () => {
    if (!aiChatInput.trim()) return;
    const userMsg = { role:"user", content:aiChatInput };
    const newChat = [...aiChat, userMsg];
    setAiChat(newChat); setAiChatInput(""); setAiChatLoading(true);
    const summary = `Receitas ${MONTHS[filterMonth]}: ${fmt(totalIncome)} | Gastos: ${fmt(totalExpense)} | Saldo: ${fmt(balance)} | Top categorias: ${categoryData.slice(0,3).map(c=>`${c.emoji}${c.name}:${fmt(c.value)}`).join(", ")} | Projeção: ${fmt(projected)} | Cartões: ${cards.length} | Contas fixas: ${fixedBills.length}`;
    try {
      const text = await callAI(newChat, `Você é um consultor financeiro pessoal inteligente e empático. Contexto do usuário: ${summary}. Responda em português, de forma concisa e prática.`);
      setAiChat(p=>[...p, { role:"assistant", content:text }]);
    } catch { setAiChat(p=>[...p, { role:"assistant", content:"Erro ao processar. Tente novamente." }]); }
    setAiChatLoading(false);
  };

  const handleAnalysis = async () => {
    setAnalysisLoading(true); setAnalysis("");
    const data = { totalIncome, totalExpense, balance, categories:categoryData.slice(0,5).map(c=>({ name:c.name, value:c.value, pct:(c.value/totalExpense*100).toFixed(0)+"%" })), projected, dailyAvg, fixedBills:fixedBills.length, goals:goals.length, cards:cards.length };
    try {
      const text = await callAI([{ role:"user", content:`Analise minhas finanças de ${MONTHS[filterMonth]}/${filterYear}:\n${JSON.stringify(data,null,2)}\n\nDê uma análise completa com insights, pontos de atenção e recomendações práticas.` }],
        "Você é um consultor financeiro pessoal especializado. Analise os dados e forneça insights valiosos, identifique problemas, sugira melhorias e dê recomendações práticas. Responda em português com formatação clara usando emojis e seções."
      );
      setAnalysis(text);
    } catch { setAnalysis("Erro ao gerar análise. Tente novamente."); }
    setAnalysisLoading(false);
  };

  // Backup
  const handleExport = () => {
    const data = { transactions, rides, uberSettings, customCategories, cards, debts, charges, fixedBills, goals, profile, exportedAt:new Date().toISOString(), version:STORAGE_KEY };
    const blob = new Blob([JSON.stringify(data,null,2)],{type:"application/json"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href=url; a.download=`financeiro-premium-${todayKey()}.json`; a.click(); URL.revokeObjectURL(url);
    markBackupDone();
    setShowBackupReminder(false);
  };
  const handleImportBackup = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (data.transactions) setTransactions(data.transactions);
        if (data.rides) setRides(data.rides);
        if (data.uberSettings) setUberSettings(data.uberSettings);
        if (data.customCategories) setCustomCategories(data.customCategories);
        if (data.cards) setCards(data.cards);
        if (data.debts) setDebts(data.debts);
        if (data.charges) setCharges(data.charges);
        if (data.fixedBills) setFixedBills(data.fixedBills);
        if (data.goals) setGoals(data.goals);
        setImportMsg("ok");
      } catch { setImportMsg("err"); }
      setTimeout(()=>setImportMsg(""),3000);
    };
    reader.readAsText(file); e.target.value="";
  };

  // Month key
  const currentMonthKey = `${filterYear}-${String(filterMonth+1).padStart(2,"0")}`;

  // Tabs
  const tabs = [
    ["dashboard","📊","Finanças"],["add","➕","Lançar"],["cards","💳","Cartões"],
    ["fixed","📋","Fixas"],["goals","🎯","Metas"],["uber","🚗","Uber"],
    ["invoice","📥","Importar"],["history","📋","Histórico"],["charges","💸","Cobranças"],
    ["ai","🤖","IA"],["backup","⚙️","Backup"],
  ];

  // ── RENDER ────────────────────────────────────────────────────────────────
  return (
    <div style={{ fontFamily:"'DM Sans',sans-serif", background:T.bg, minHeight:"100vh", color:T.text, transition:"background .3s,color .3s" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet"/>
      <style>{`
        *{box-sizing:border-box;margin:0;padding:0}
        ::-webkit-scrollbar{width:4px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:#333;border-radius:2px}
        .card{background:${T.card};border:1px solid ${T.border};border-radius:16px;transition:background .3s,border .3s}
        .card2{background:${T.card2};border:1px solid ${T.border};border-radius:16px;transition:background .3s,border .3s}
        .btn{background:linear-gradient(135deg,#7c3aed,#4f46e5);color:white;border:none;border-radius:12px;padding:12px 20px;font-family:'DM Sans',sans-serif;font-weight:600;cursor:pointer;transition:all .2s;font-size:14px}
        .btn:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 4px 20px rgba(124,58,237,.4)}
        .btn:disabled{opacity:.4;cursor:not-allowed}
        .btn-sm{background:linear-gradient(135deg,#7c3aed,#4f46e5);color:white;border:none;border-radius:10px;padding:8px 14px;font-family:'DM Sans',sans-serif;font-weight:600;cursor:pointer;font-size:12px;transition:all .2s}
        .btn-sm:hover:not(:disabled){transform:translateY(-1px)}
        .btn-uber{background:linear-gradient(135deg,#111,#1a1a1a);color:white;border:1px solid #333;border-radius:12px;padding:12px 20px;font-family:'DM Sans',sans-serif;font-weight:700;cursor:pointer;transition:all .2s;font-size:15px}
        .btn-uber:hover:not(:disabled){background:linear-gradient(135deg,#1a1a1a,#222);box-shadow:0 4px 20px rgba(0,0,0,.4)}
        .btn-uber:disabled{opacity:.5;cursor:not-allowed}
        .btn-g{background:none;border:1px solid ${T.border};color:${T.sub};border-radius:10px;padding:7px 13px;font-family:'DM Sans',sans-serif;font-size:12px;cursor:pointer;transition:all .15s}
        .btn-g:hover,.btn-g.on{background:${T.tabOn};color:${T.tabOnText};border-color:${T.border}}
        .btn-danger{background:linear-gradient(135deg,#ef4444,#dc2626);color:white;border:none;border-radius:12px;padding:12px 20px;font-family:'DM Sans',sans-serif;font-weight:600;cursor:pointer;transition:all .2s;font-size:14px}
        .btn-success{background:linear-gradient(135deg,#10b981,#059669);color:white;border:none;border-radius:12px;padding:12px 20px;font-family:'DM Sans',sans-serif;font-weight:600;cursor:pointer;transition:all .2s;font-size:14px}
        .inp{width:100%;background:${T.inp};border:1px solid ${T.inpBorder};border-radius:12px;padding:13px 15px;color:${T.text};font-family:'DM Sans',sans-serif;font-size:14px;outline:none;transition:border-color .2s,background .3s}
        .inp:focus{border-color:#7c3aed;box-shadow:0 0 0 3px rgba(124,58,237,.1)}
        .inp::placeholder{color:${T.sub}}
        .inp-uber{background:${T.inp};border:2px solid ${T.inpBorder};border-radius:14px;padding:16px 18px;color:${T.text};font-family:'DM Mono',monospace;font-size:22px;font-weight:500;outline:none;transition:border-color .2s;text-align:center}
        .inp-uber:focus{border-color:#555}
        .row{display:flex;align-items:center;gap:10px;padding:11px 13px;border-radius:10px;transition:background .15s}
        .row:hover{background:${T.hover}}
        .del{background:none;border:none;color:${T.sub};cursor:pointer;font-size:14px;padding:4px 6px;border-radius:6px;transition:color .15s;margin-left:auto;flex-shrink:0}
        .del:hover{color:#ef4444}
        .mp{background:none;border:1px solid ${T.muted};color:${T.sub};border-radius:20px;padding:3px 9px;font-size:11px;cursor:pointer;font-family:'DM Sans',sans-serif;white-space:nowrap;transition:all .15s}
        .mp.on{background:${T.tabOn};color:${T.tabOnText};border-color:${T.border}}
        .drop{border:2px dashed ${T.border};border-radius:14px;padding:28px 16px;text-align:center;cursor:pointer;transition:all .2s;background:${T.card}}
        .drop:hover,.drop.drag{border-color:#7c3aed;background:${T.hover}}
        .chi{display:flex;align-items:flex-start;gap:10px;padding:9px 12px;border-radius:10px;cursor:pointer;transition:background .15s}
        .chi:hover{background:${T.hover}}
        .tag{display:inline-block;background:${T.inp};border:1px solid ${T.inpBorder};border-radius:5px;padding:1px 7px;font-size:10px;color:${T.sub}}
        .img-thumb{position:relative;border-radius:10px;overflow:hidden;border:1px solid ${T.border}}
        .img-rm{position:absolute;top:5px;right:5px;background:rgba(0,0,0,.7);border:none;color:white;border-radius:50%;width:20px;height:20px;font-size:11px;cursor:pointer;display:flex;align-items:center;justify-content:center}
        .img-rm:hover{background:#ef4444}
        .day-bar{display:flex;flex-direction:column;align-items:center;gap:4px;flex:1}
        .day-fill{border-radius:4px 4px 0 0;width:100%;min-height:3px;transition:height .4s ease}
        @keyframes fi{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
        .fi{animation:fi .25s ease}
        @keyframes sp{to{transform:rotate(360deg)}}
        .sp{animation:sp 1s linear infinite;display:inline-block}
        @keyframes pop{0%{transform:scale(.85);opacity:0}60%{transform:scale(1.03)}100%{transform:scale(1);opacity:1}}
        .pop{animation:pop .3s ease}
        @keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}
        .pulse{animation:pulse 2s infinite}
        .glass{backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}
        input[type=date]{color-scheme:${darkMode?"dark":"light"}}
        input[type=number]{color-scheme:${darkMode?"dark":"light"}}
        textarea{resize:none}
        .nav-tab{display:flex;flex-direction:column;align-items:center;gap:3px;padding:8px 10px;border:none;background:none;cursor:pointer;transition:all .2s;border-radius:12px;font-family:'DM Sans',sans-serif;min-width:52px}
        .nav-tab.active{background:${T.tabOn}}
        .nav-tab .icon{font-size:18px}
        .nav-tab .label{font-size:9px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:${T.sub}}
        .nav-tab.active .label{color:${T.accent}}
        .notif-dot{width:6px;height:6px;border-radius:50%;background:#ef4444;display:inline-block;margin-left:4px;animation:pulse 2s infinite}
        .card-premium{border-radius:18px;padding:20px;position:relative;overflow:hidden;cursor:pointer;transition:transform .2s}
        .card-premium:hover{transform:translateY(-2px)}
        .insight-card{border-left:3px solid;border-radius:0 12px 12px 0;padding:10px 14px;margin-bottom:8px}
        select{background:${T.inp};border:1px solid ${T.inpBorder};border-radius:12px;padding:13px 15px;color:${T.text};font-family:'DM Sans',sans-serif;font-size:14px;outline:none;width:100%;cursor:pointer}
        select:focus{border-color:#7c3aed}
      `}</style>

      {/* ── TOP BAR ──────────────────────────────────────────────────────── */}
      <div style={{ padding:"16px 16px 0", maxWidth:520, margin:"0 auto" }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16 }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <button onClick={()=>setShowProfile(true)} style={{ width:38, height:38, borderRadius:12, background:T.card2, border:`1px solid ${T.border}`, fontSize:20, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer" }}>
              {profile.avatar}
            </button>
            <div>
              <div style={{ fontSize:9, color:T.sub, letterSpacing:".12em", textTransform:"uppercase" }}>Olá{profile.name?`, ${profile.name}`:""} 👋</div>
              <div style={{ fontSize:18, fontWeight:700, letterSpacing:"-.02em" }}>Financeiro <span style={{ color:"#7c3aed" }}>IA</span></div>
            </div>
          </div>
          <div style={{ display:"flex", gap:8, alignItems:"center" }}>
            <div style={{ position:"relative" }}>
              <button onClick={()=>setShowNotifs(v=>!v)} style={{ background:T.card2, border:`1px solid ${T.border}`, borderRadius:10, padding:"8px 10px", cursor:"pointer", fontSize:16 }}>
                🔔
              </button>
              {notifications.length > 0 && <Badge count={notifications.length}/>}
            </div>
            <button onClick={()=>setDarkMode(d=>!d)} style={{ background:T.card2, border:`1px solid ${T.border}`, borderRadius:10, padding:"8px 10px", cursor:"pointer", fontSize:16 }}>
              {darkMode?"☀️":"🌙"}
            </button>
          </div>
        </div>

        {/* Balance hero */}
        <div className="card" style={{ padding:20, marginBottom:14, background:darkMode?"linear-gradient(135deg,#12121e,#1a1a2e)":"linear-gradient(135deg,#f8f0ff,#ede9fe)" }}>
          <div style={{ fontSize:10, color:T.sub, letterSpacing:".1em", textTransform:"uppercase", marginBottom:4 }}>Saldo em {MONTHS[filterMonth]}</div>
          <div style={{ fontSize:32, fontWeight:700, fontFamily:"'DM Mono',monospace", color:balance>=0?"#10b981":"#ef4444", letterSpacing:"-.02em" }}>{fmt(balance)}</div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:12, marginTop:16 }}>
            {[["Receitas",totalIncome,"#10b981","📥"],["Gastos",totalExpense,"#ef4444","📤"],["Projeção",projected,projected>totalIncome?"#ef4444":"#f59e0b","📊"]].map(([label,val,color,ico])=>(
              <div key={label}>
                <div style={{ fontSize:9, color:T.sub, marginBottom:4 }}>{ico} {label.toUpperCase()}</div>
                <div style={{ fontSize:14, fontWeight:700, fontFamily:"'DM Mono',monospace", color }}>{fmtShort(val)}</div>
              </div>
            ))}
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginTop:12 }}>
            {[["Média/dia",dailyAvg,T.text],["Dias p/ fim",daysInMonth-dayOfMonth,T.sub]].map(([label,val,color])=>(
              <div key={label}>
                <div style={{ fontSize:9, color:T.sub, marginBottom:4 }}>{label.toUpperCase()}</div>
                <div style={{ fontSize:13, fontWeight:600, fontFamily:"'DM Mono',monospace", color }}>{typeof val==="number"&&label!=="Dias p/ fim"?fmt(val):val}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Month selector */}
        <div style={{ display:"flex", gap:4, marginBottom:14, overflowX:"auto", paddingBottom:2 }}>
          {MONTHS.map((m,i)=><button key={i} className={`mp ${filterMonth===i?"on":""}`} onClick={()=>setFilterMonth(i)}>{m}</button>)}
        </div>
      </div>

      {/* ── CONTENT ──────────────────────────────────────────────────────── */}
      <div style={{ padding:"0 16px 120px", maxWidth:520, margin:"0 auto" }}>

        {/* PWA Install Banner (Android/desktop) */}
        {pwaPrompt && (
          <div className="fi card" style={{ marginBottom:14, padding:16, borderLeft:"3px solid #7c3aed", display:"flex", alignItems:"center", gap:12 }}>
            <div style={{ fontSize:28 }}>📲</div>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:13, fontWeight:700 }}>Instalar como app</div>
              <div style={{ fontSize:12, color:T.sub }}>Acesse direto da tela inicial, sem abrir o navegador</div>
            </div>
            <div style={{ display:"flex", gap:6 }}>
              <button onClick={()=>setPwaPrompt(null)} style={{ background:"none", border:"none", color:T.sub, cursor:"pointer", fontSize:18 }}>✕</button>
              <button className="btn-sm" onClick={async()=>{ pwaPrompt.prompt(); const r=await pwaPrompt.userChoice; if(r.outcome==="accepted")setPwaPrompt(null); }}>Instalar</button>
            </div>
          </div>
        )}

        {/* Backup Reminder Banner */}
        {showBackupReminder && (
          <div className="fi card" style={{ marginBottom:14, padding:16, borderLeft:"3px solid #f59e0b", background:"rgba(245,158,11,.06)" }}>
            <div style={{ display:"flex", alignItems:"flex-start", gap:12 }}>
              <div style={{ fontSize:28 }}>💾</div>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:13, fontWeight:700, color:"#f59e0b" }}>Lembrete de backup</div>
                <div style={{ fontSize:12, color:T.sub, marginTop:2, lineHeight:1.5 }}>
                  Faz mais de 30 dias sem backup. Se limpar o Safari, seus dados somem. Faça um backup agora!
                </div>
                <div style={{ display:"flex", gap:8, marginTop:10 }}>
                  <button className="btn-sm" onClick={handleExport} style={{ background:"linear-gradient(135deg,#f59e0b,#d97706)" }}>⬇ Fazer backup agora</button>
                  <button onClick={()=>{ markBackupReminderSeen(); setShowBackupReminder(false); }} style={{ background:"none", border:`1px solid ${T.border}`, borderRadius:8, padding:"6px 12px", fontSize:12, cursor:"pointer", color:T.sub, fontFamily:"'DM Sans',sans-serif" }}>Lembrar depois</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Notifications Panel */}
        {showNotifs && (
          <div className="fi card" style={{ marginBottom:14, padding:16, border:`1px solid ${T.border}` }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12 }}>
              <div style={{ fontSize:13, fontWeight:700 }}>🔔 Notificações</div>
              <button onClick={()=>setShowNotifs(false)} style={{ background:"none", border:"none", color:T.sub, cursor:"pointer", fontSize:16 }}>✕</button>
            </div>
            {notifications.length === 0 ? (
              <div style={{ textAlign:"center", color:T.sub, fontSize:13, padding:"8px 0" }}>✅ Tudo em dia!</div>
            ) : notifications.map((n,i)=>(
              <div key={i} className="insight-card" style={{ borderLeftColor:n.type==="danger"?"#ef4444":"#f59e0b", background:n.type==="danger"?"rgba(239,68,68,.05)":"rgba(245,158,11,.05)" }}>
                <div style={{ fontSize:13, color:n.type==="danger"?"#ef4444":"#f59e0b" }}>{n.icon} {n.text}</div>
              </div>
            ))}
          </div>
        )}

        {/* ── DASHBOARD ─────────────────────────────────────────────────── */}
        {tab==="dashboard" && <div className="fi">
          {/* AI Insights */}
          {aiInsights.length > 0 && (
            <div style={{ marginBottom:14 }}>
              {aiInsights.map((ins,i)=>(
                <div key={i} className="insight-card fi" style={{ borderLeftColor:ins.color, background:ins.color+"0d", animationDelay:`${i*0.05}s` }}>
                  <div style={{ fontSize:12, color:ins.color, fontWeight:500 }}>{ins.icon} {ins.text}</div>
                </div>
              ))}
            </div>
          )}

          {/* Category chart */}
          {categoryData.length > 0 ? (
            <div className="card" style={{ padding:18, marginBottom:12 }}>
              <div style={{ fontSize:12, fontWeight:700, color:T.sub, marginBottom:14, letterSpacing:".06em", textTransform:"uppercase" }}>Gastos por Categoria</div>
              <ResponsiveContainer width="100%" height={160}>
                <PieChart>
                  <Pie data={categoryData} cx="50%" cy="50%" innerRadius={48} outerRadius={72} dataKey="value" paddingAngle={3}>
                    {categoryData.map((e,i)=><Cell key={i} fill={e.color}/>)}
                  </Pie>
                  <Tooltip formatter={v=>fmt(v)} contentStyle={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:10, fontSize:12, color:T.text }}/>
                </PieChart>
              </ResponsiveContainer>
              <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                {categoryData.map((c,i)=>{
                  const pct = totalExpense?Math.round(c.value/totalExpense*100):0;
                  const goal = catGoals[c.key];
                  const over = goal && c.value > goal;
                  return (
                    <div key={i}>
                      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4 }}>
                        <div style={{ width:8, height:8, borderRadius:"50%", background:c.color, flexShrink:0 }}/>
                        <span style={{ fontSize:13, color:T.text, flex:1 }}>{c.emoji} {c.name}</span>
                        <span style={{ fontSize:13, fontFamily:"'DM Mono',monospace", color:over?"#ef4444":T.text }}>{fmt(c.value)}</span>
                        <span style={{ fontSize:11, color:T.sub, width:30, textAlign:"right" }}>{pct}%</span>
                      </div>
                      {goal && (
                        <div style={{ height:3, background:T.muted, borderRadius:2, overflow:"hidden", marginLeft:16 }}>
                          <div style={{ height:"100%", width:`${Math.min(c.value/goal*100,100)}%`, background:over?"#ef4444":pct>80?"#f59e0b":c.color, borderRadius:2, transition:"width .4s" }}/>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {Object.keys(catGoals).length===0 && (
                <button onClick={()=>setShowCatGoals(true)} style={{ width:"100%", marginTop:12, background:"none", border:`1px dashed ${T.border}`, borderRadius:10, padding:8, color:"#7c3aed", fontSize:12, cursor:"pointer", fontFamily:"'DM Sans',sans-serif" }}>🎯 Definir metas por categoria</button>
              )}
            </div>
          ) : (
            <div className="card" style={{ padding:40, textAlign:"center", color:T.sub, marginBottom:12 }}>
              <div style={{ fontSize:36, marginBottom:8 }}>📊</div>
              <div style={{ fontSize:14, fontWeight:600, color:T.text, marginBottom:4 }}>Nenhum gasto em {MONTHS[filterMonth]}</div>
              <div style={{ fontSize:12 }}>Comece lançando suas transações</div>
              <button className="btn" onClick={()=>setTab("add")} style={{ marginTop:16, padding:"10px 20px", fontSize:13 }}>+ Lançar transação</button>
            </div>
          )}

          {/* 6-month chart */}
          <div className="card" style={{ padding:18, marginBottom:12 }}>
            <div style={{ fontSize:12, fontWeight:700, color:T.sub, marginBottom:14, letterSpacing:".06em", textTransform:"uppercase" }}>Últimos 6 Meses</div>
            <ResponsiveContainer width="100%" height={140}>
              <BarChart data={last6months} barGap={3}>
                <XAxis dataKey="name" tick={{ fontSize:10, fill:T.sub }} axisLine={false} tickLine={false}/>
                <YAxis hide/>
                <Tooltip formatter={v=>fmt(v)} contentStyle={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:10, fontSize:12, color:T.text }}/>
                <Bar dataKey="receita" fill="#10b981" radius={[4,4,0,0]} name="Receita"/>
                <Bar dataKey="gasto"   fill="#ef4444" radius={[4,4,0,0]} name="Gasto"/>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Monthly comparison */}
          {(() => {
            const pm = filterMonth===0?11:filterMonth-1;
            const py = filterMonth===0?filterYear-1:filterYear;
            const prevTotal = transactions.filter(t=>{ const d=new Date(t.date); return d.getMonth()===pm&&d.getFullYear()===py&&t.type==="expense"; }).reduce((s,t)=>s+t.amount,0);
            const diff = totalExpense - prevTotal;
            const diffPct = prevTotal>0?Math.round((diff/prevTotal)*100):null;
            if (prevTotal===0&&totalExpense===0) return null;
            return (
              <div className="card" style={{ padding:16, marginBottom:12, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                <div>
                  <div style={{ fontSize:12, color:T.sub }}>vs. {MONTHS[pm]}</div>
                  <div style={{ fontSize:11, color:T.sub, marginTop:2 }}>{fmt(prevTotal)} → {fmt(totalExpense)}</div>
                </div>
                {diffPct!==null && <div style={{ fontSize:18, fontWeight:700, color:diff>0?"#ef4444":"#10b981" }}>{diff>0?"▲":"▼"} {Math.abs(diffPct)}%</div>}
              </div>
            );
          })()}

          {/* Fixed bills summary */}
          {fixedBillsDue.length > 0 && (
            <div className="card" style={{ padding:16, marginBottom:12, borderLeft:`3px solid #f59e0b` }}>
              <div style={{ fontSize:12, fontWeight:700, color:"#f59e0b", marginBottom:10 }}>📋 Contas Fixas em Aberto</div>
              {fixedBillsDue.slice(0,3).map(b=>(
                <div key={b.id} style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6 }}>
                  <span style={{ fontSize:13 }}>{FIXED_BILL_TYPES.find(t=>t.key===b.type)?.emoji||"📋"}</span>
                  <span style={{ fontSize:13, flex:1, color:T.text }}>{b.description}</span>
                  <span style={{ fontSize:13, fontFamily:"'DM Mono',monospace", color:"#f59e0b" }}>{fmt(b.amount)}</span>
                  <button onClick={()=>markFixedBillPaid(b.id, currentMonthKey)} style={{ background:"#10b98120", border:"1px solid #10b981", borderRadius:8, padding:"3px 8px", fontSize:11, cursor:"pointer", color:"#10b981", fontFamily:"'DM Sans',sans-serif" }}>Pagar</button>
                </div>
              ))}
              {fixedBillsDue.length > 3 && <div style={{ fontSize:11, color:T.sub, marginTop:4 }}>+{fixedBillsDue.length-3} mais — <button onClick={()=>setTab("fixed")} style={{ background:"none", border:"none", color:"#7c3aed", cursor:"pointer", fontSize:11, fontFamily:"'DM Sans',sans-serif" }}>ver tudo</button></div>}
            </div>
          )}

          {/* Goals summary */}
          {goals.length > 0 && (
            <div className="card" style={{ padding:16, marginBottom:12 }}>
              <div style={{ fontSize:12, fontWeight:700, color:T.sub, marginBottom:12, letterSpacing:".06em", textTransform:"uppercase" }}>🎯 Metas</div>
              {goals.slice(0,2).map(g=>{
                const pct = Math.min((g.saved||0)/g.target*100,100);
                const daysLeft = g.deadline ? Math.ceil((new Date(g.deadline)-new Date())/(1000*60*60*24)) : null;
                return (
                  <div key={g.id} style={{ marginBottom:12 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:4 }}>
                      <span>{g.emoji}</span>
                      <span style={{ fontSize:13, fontWeight:500, flex:1 }}>{g.description}</span>
                      <span style={{ fontSize:12, fontFamily:"'DM Mono',monospace", color:"#10b981" }}>{pct.toFixed(0)}%</span>
                    </div>
                    <div style={{ height:6, background:T.muted, borderRadius:3, overflow:"hidden" }}>
                      <div style={{ height:"100%", width:`${pct}%`, background:"linear-gradient(90deg,#7c3aed,#10b981)", borderRadius:3, transition:"width .5s" }}/>
                    </div>
                    <div style={{ display:"flex", justifyContent:"space-between", fontSize:10, color:T.sub, marginTop:3 }}>
                      <span>{fmt(g.saved||0)} de {fmt(g.target)}</span>
                      {daysLeft!==null && <span>{daysLeft>0?`${daysLeft} dias restantes`:"Prazo encerrado"}</span>}
                    </div>
                  </div>
                );
              })}
              {goals.length > 2 && <button onClick={()=>setTab("goals")} style={{ background:"none", border:"none", color:"#7c3aed", cursor:"pointer", fontSize:12, fontFamily:"'DM Sans',sans-serif" }}>Ver todas as metas →</button>}
            </div>
          )}

          {/* Category goals editor */}
          {showCatGoals && (
            <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.75)", display:"flex", alignItems:"flex-end", zIndex:200 }} onClick={()=>setShowCatGoals(false)}>
              <div className="card fi" style={{ width:"100%", maxWidth:520, margin:"0 auto", borderRadius:"20px 20px 0 0", padding:24, maxHeight:"80vh", overflowY:"auto" }} onClick={e=>e.stopPropagation()}>
                <div style={{ fontSize:15, fontWeight:700, marginBottom:18 }}>🎯 Metas por Categoria</div>
                {Object.entries(allCategories).filter(([k])=>k!=="receita").map(([key,cat])=>(
                  <div key={key} style={{ marginBottom:14 }}>
                    <div style={{ fontSize:12, color:T.sub, marginBottom:6 }}>{cat.emoji} {cat.label}</div>
                    <div style={{ display:"flex", gap:8 }}>
                      <input className="inp" type="number" value={catGoals[key]||""} onChange={e=>setCatGoals(p=>({ ...p, [key]:parseFloat(e.target.value)||0 }))} placeholder="Limite mensal (R$)" inputMode="decimal" style={{ fontFamily:"'DM Mono',monospace" }}/>
                      {catGoals[key] && <button onClick={()=>setCatGoals(p=>{ const n={...p}; delete n[key]; return n; })} style={{ background:"none", border:`1px solid ${T.border}`, borderRadius:10, padding:"0 12px", color:T.sub, cursor:"pointer" }}>✕</button>}
                    </div>
                  </div>
                ))}
                <button className="btn" onClick={()=>setShowCatGoals(false)} style={{ width:"100%", marginTop:8 }}>✅ Salvar metas</button>
              </div>
            </div>
          )}
        </div>}

        {/* ── ADD ──────────────────────────────────────────────────────────── */}
        {tab==="add" && <div className="fi">
          <div style={{ display:"flex", gap:6, marginBottom:14 }}>
            {[["expense","📤 Despesa","#ef4444","#dc2626"],["income","📥 Receita","#10b981","#059669"],["debt","📋 Parcelado","#f59e0b","#d97706"]].map(([key,label,c1,c2])=>(
              <button key={key} onClick={()=>setAddType(key)} style={{ flex:1, border:"none", borderRadius:12, padding:"12px 0", fontFamily:"'DM Sans',sans-serif", fontWeight:700, fontSize:12, cursor:"pointer", transition:"all .2s", background:addType===key?`linear-gradient(135deg,${c1},${c2})`:T.card, color:addType===key?"white":T.sub, boxShadow:addType===key?`0 4px 16px ${c1}55`:"none" }}>
                {label}
              </button>
            ))}
          </div>

          {addType==="expense" && <>
            <div style={{ display:"flex", gap:6, marginBottom:14 }}>
              <button className={`btn-g ${addMode==="manual"?"on":""}`} onClick={()=>setAddMode("manual")} style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", gap:4 }}>✏️ Manual</button>
              <button className={`btn-g ${addMode==="ai"?"on":""}`} onClick={()=>setAddMode("ai")} style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", gap:4 }}>✨ Linguagem Natural</button>
            </div>

            {addMode==="manual" && (
              <div className="card" style={{ padding:18 }}>
                <div style={{ fontSize:12, color:T.sub, marginBottom:6 }}>Descrição</div>
                <input className="inp" value={manDesc} onChange={e=>setManDesc(e.target.value)} placeholder="Ex: Mercado, Netflix, Academia..." style={{ marginBottom:14 }}/>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:14 }}>
                  <div>
                    <div style={{ fontSize:12, color:T.sub, marginBottom:6 }}>Valor (R$)</div>
                    <input className="inp" value={manAmount} onChange={e=>setManAmount(e.target.value.replace(/[^0-9,.]/g,""))} placeholder="0,00" inputMode="decimal" style={{ fontFamily:"'DM Mono',monospace", fontSize:18 }}/>
                  </div>
                  <div>
                    <div style={{ fontSize:12, color:T.sub, marginBottom:6 }}>Data</div>
                    <input className="inp" type="date" value={manDate} onChange={e=>setManDate(e.target.value)}/>
                  </div>
                </div>
                <div style={{ fontSize:12, color:T.sub, marginBottom:8 }}>Categoria</div>
                <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:14 }}>
                  {Object.entries(allCategories).filter(([k])=>k!=="receita").map(([key,cat])=>(
                    <button key={key} onClick={()=>setManCategory(key)} style={{ background:manCategory===key?cat.color+"22":T.inp, border:`1px solid ${manCategory===key?cat.color:T.inpBorder}`, borderRadius:8, padding:"6px 10px", fontSize:12, cursor:"pointer", color:manCategory===key?T.text:T.sub, transition:"all .15s", fontFamily:"'DM Sans',sans-serif" }}>{cat.emoji} {cat.label}</button>
                  ))}
                  <button onClick={()=>setShowNewCat(true)} style={{ background:T.inp, border:`1px dashed ${T.inpBorder}`, borderRadius:8, padding:"6px 10px", fontSize:12, cursor:"pointer", color:T.sub, fontFamily:"'DM Sans',sans-serif" }}>+ Nova</button>
                </div>
                <div style={{ fontSize:12, color:T.sub, marginBottom:8 }}>Pagamento</div>
                <div style={{ display:"flex", gap:6, marginBottom:manPayment==="credit"?14:20 }}>
                  {[["debit","💵","Débito/Dinheiro"],["credit","💳","Crédito"]].map(([key,icon,label])=>(
                    <button key={key} className={`btn-g ${manPayment===key?"on":""}`} onClick={()=>{ setManPayment(key); if(key==="debit")setManInstall(1); }} style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", gap:5 }}>
                      {icon} {label}
                    </button>
                  ))}
                </div>
                {manPayment==="credit" && <>
                  {cards.length > 0 && (
                    <div style={{ marginBottom:14 }}>
                      <div style={{ fontSize:12, color:T.sub, marginBottom:8 }}>Qual cartão?</div>
                      <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                        {cards.map(c=>(
                          <button key={c.id} onClick={()=>setManCard(c.id)} style={{ background:manCard===c.id?c.color+"33":T.inp, border:`1px solid ${manCard===c.id?c.color:T.inpBorder}`, borderRadius:8, padding:"7px 12px", fontSize:12, cursor:"pointer", color:manCard===c.id?T.text:T.sub, transition:"all .15s", fontFamily:"'DM Sans',sans-serif", display:"flex", alignItems:"center", gap:6 }}>
                            <span style={{ width:8, height:8, borderRadius:"50%", background:c.color, flexShrink:0 }}/>{c.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <div style={{ marginBottom:20 }}>
                    <div style={{ fontSize:12, color:T.sub, marginBottom:6 }}>Parcelas</div>
                    <input className="inp" type="number" min="1" value={manInstall||""} onChange={e=>setManInstall(Math.max(1,parseInt(e.target.value)||1))} placeholder="1" inputMode="numeric" style={{ fontFamily:"'DM Mono',monospace", fontSize:18, textAlign:"center" }}/>
                    {manInstall>1 && manAmount && (
                      <div style={{ fontSize:12, color:"#10b981", background:"#0e2018", padding:"8px 12px", borderRadius:8, marginTop:8 }}>💡 {manInstall}x de {fmt(parseFloat(manAmount.replace(",","."))||0)}</div>
                    )}
                  </div>
                </>}
                <button className="btn-danger" onClick={handleManualAdd} disabled={!manDesc.trim()||!manAmount.trim()} style={{ width:"100%" }}>
                  {manPayment==="credit"&&manInstall>1?`💳 Lançar ${manInstall}x`:"📤 Lançar Despesa"}
                </button>
                {manMsg==="ok" && <div className="fi" style={{ textAlign:"center", fontSize:13, color:"#10b981", marginTop:10 }}>✓ Lançado com sucesso!</div>}
                {manMsg==="err" && <div className="fi" style={{ textAlign:"center", fontSize:13, color:"#ef4444", marginTop:10 }}>Preencha descrição e valor.</div>}
              </div>
            )}

            {addMode==="ai" && (
              <div className="card" style={{ padding:18 }}>
                <div style={{ fontSize:13, color:T.sub, marginBottom:12 }}>💬 Descreva o gasto em linguagem natural:</div>
                <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:14 }}>
                  {["gastei 45 no mercado","blusa Renner 150 em 2x","academia 120 débito","jantar 80 no crédito"].map(ex=>(
                    <button key={ex} onClick={()=>setAddInput(ex)} style={{ background:T.inp, border:`1px solid ${T.inpBorder}`, borderRadius:8, padding:"5px 10px", color:T.sub, fontSize:11, cursor:"pointer", fontFamily:"'DM Sans',sans-serif" }}>"{ex}"</button>
                  ))}
                </div>
                <textarea className="inp" value={addInput} onChange={e=>setAddInput(e.target.value)} onKeyDown={e=>{ if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();handleAdd()} }} placeholder="Ex: paguei 120 de academia..." rows={3} style={{ resize:"none", marginBottom:12 }}/>
                <button className="btn-danger" onClick={handleAdd} disabled={addLoading||!addInput.trim()} style={{ width:"100%" }}>
                  {addLoading?<><span className="sp">⟳</span> Processando...</>:"✨ Processar com IA"}
                </button>
                {addMsg && (
                  <div className="fi" style={{ marginTop:14, padding:14, background:T.inp, borderRadius:12, borderLeft:`3px solid ${addMsg.type==="success"?"#10b981":"#ef4444"}` }}>
                    {addMsg.type==="success" ? (
                      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                        <span style={{ fontSize:20 }}>{allCategories[addMsg.category]?.emoji}</span>
                        <div style={{ flex:1 }}>
                          <div style={{ fontSize:13, fontWeight:600, color:"#ef4444" }}>-{fmt(addMsg.amount)}</div>
                          <div style={{ fontSize:11, color:T.sub }}>{addMsg.description} · {allCategories[addMsg.category]?.label}</div>
                        </div>
                        {addMsg.installTotal>1 && <span className="tag">{addMsg.installTotal}x</span>}
                      </div>
                    ) : <div style={{ fontSize:13, color:"#ef4444" }}>{addMsg.text}</div>}
                    {addMsg.insight && <div style={{ fontSize:12, color:T.sub, marginTop:8, borderTop:`1px solid ${T.border}`, paddingTop:8 }}>💡 {addMsg.insight}</div>}
                  </div>
                )}
              </div>
            )}
          </>}

          {addType==="income" && (
            <div className="card" style={{ padding:18 }}>
              <div style={{ fontSize:12, color:T.sub, marginBottom:6 }}>Descrição</div>
              <input className="inp" value={incDesc} onChange={e=>setIncDesc(e.target.value)} placeholder="Ex: Salário, Freelance..." style={{ marginBottom:14 }}/>
              <div style={{ fontSize:12, color:T.sub, marginBottom:6 }}>Valor (R$)</div>
              <input className="inp" value={incAmount} onChange={e=>setIncAmount(e.target.value.replace(/[^0-9,.]/g,""))} placeholder="0,00" inputMode="decimal" style={{ marginBottom:14, fontFamily:"'DM Mono',monospace", fontSize:20 }}/>
              <div style={{ fontSize:12, color:T.sub, marginBottom:8 }}>Fonte</div>
              <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:20 }}>
                {Object.entries(INCOME_SOURCES).map(([key,src])=>(
                  <button key={key} onClick={()=>setIncSource(key)} style={{ background:incSource===key?"#10b98122":T.inp, border:`1px solid ${incSource===key?"#10b981":T.inpBorder}`, borderRadius:8, padding:"6px 10px", fontSize:12, cursor:"pointer", color:incSource===key?T.text:T.sub, fontFamily:"'DM Sans',sans-serif" }}>{src.emoji} {src.label}</button>
                ))}
              </div>
              <button className="btn-success" onClick={handleIncomeAdd} disabled={!incDesc.trim()||!incAmount.trim()} style={{ width:"100%" }}>📥 Registrar Receita</button>
              {incMsg==="ok" && <div className="fi" style={{ textAlign:"center", fontSize:13, color:"#10b981", marginTop:10 }}>✓ Receita registrada!</div>}
              {incMsg==="err" && <div className="fi" style={{ textAlign:"center", fontSize:13, color:"#ef4444", marginTop:10 }}>Preencha descrição e valor.</div>}
            </div>
          )}

          {addType==="debt" && (
            <div className="card" style={{ padding:18 }}>
              <div style={{ fontSize:13, color:T.sub, marginBottom:14 }}>Registre uma dívida ou compra parcelada para controlar todas as parcelas.</div>
              <div style={{ fontSize:12, color:T.sub, marginBottom:6 }}>Descrição</div>
              <input className="inp" value={debtDesc} onChange={e=>setDebtDesc(e.target.value)} placeholder="Ex: Geladeira, Empréstimo..." style={{ marginBottom:14 }}/>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:14 }}>
                <div>
                  <div style={{ fontSize:12, color:T.sub, marginBottom:6 }}>Valor total (R$)</div>
                  <input className="inp" value={debtAmount} onChange={e=>setDebtAmount(e.target.value.replace(/[^0-9,.]/g,""))} placeholder="0,00" inputMode="decimal" style={{ fontFamily:"'DM Mono',monospace" }}/>
                </div>
                <div>
                  <div style={{ fontSize:12, color:T.sub, marginBottom:6 }}>Nº de parcelas</div>
                  <input className="inp" type="number" min="1" value={debtMonths} onChange={e=>setDebtMonths(Math.max(1,parseInt(e.target.value)||1))} style={{ fontFamily:"'DM Mono',monospace", textAlign:"center" }}/>
                </div>
              </div>
              <div style={{ fontSize:12, color:T.sub, marginBottom:6 }}>Início</div>
              <input className="inp" type="date" value={debtStart} onChange={e=>setDebtStart(e.target.value)} style={{ marginBottom:14 }}/>
              {debtAmount && debtMonths>0 && (
                <div style={{ background:"#1a1a2e", borderRadius:10, padding:"10px 14px", marginBottom:14, fontSize:12, color:T.sub }}>
                  💡 <strong style={{ color:T.text }}>{debtMonths}x</strong> de <strong style={{ color:T.text }}>{fmt((parseFloat(debtAmount.replace(",","."))||0)/debtMonths)}</strong>
                </div>
              )}
              <button className="btn" onClick={saveDebt} disabled={!debtDesc.trim()||!debtAmount.trim()} style={{ width:"100%" }}>📋 Cadastrar Parcelamento</button>
              {debtMsg==="ok" && <div className="fi" style={{ textAlign:"center", fontSize:13, color:"#10b981", marginTop:10 }}>✓ Cadastrado! Parcelas criadas.</div>}
              {debtMsg==="err" && <div className="fi" style={{ textAlign:"center", fontSize:13, color:"#ef4444", marginTop:10 }}>Preencha todos os campos.</div>}
              {debts.length>0 && (
                <div style={{ marginTop:20 }}>
                  <div style={{ fontSize:12, color:T.sub, marginBottom:10 }}>Parcelamentos ativos</div>
                  {debts.map(d=>(
                    <div key={d.id} className="card2" style={{ padding:"12px 14px", marginBottom:8, display:"flex", alignItems:"center", gap:10 }}>
                      <div style={{ flex:1 }}>
                        <div style={{ fontSize:13, fontWeight:600 }}>{d.description}</div>
                        <div style={{ fontSize:11, color:T.sub, marginTop:2 }}>{d.months}x de {fmt(d.amount)} · Total: {fmt(d.totalAmount)}</div>
                      </div>
                      <button className="del" onClick={()=>deleteDebt(d.id)}>✕</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>}

        {/* ── CARDS ─────────────────────────────────────────────────────────── */}
        {tab==="cards" && <div className="fi">
          <button onClick={()=>setShowCardModal(true)} className="btn" style={{ width:"100%", marginBottom:16 }}>💳 + Adicionar Cartão</button>

          {cards.length===0 ? (
            <div className="card" style={{ padding:48, textAlign:"center", color:T.sub }}>
              <div style={{ fontSize:44, marginBottom:12 }}>💳</div>
              <div style={{ fontSize:14, fontWeight:600, color:T.text, marginBottom:6 }}>Nenhum cartão cadastrado</div>
              <div style={{ fontSize:12 }}>Adicione seus cartões para controlar faturas e limites</div>
            </div>
          ) : (
            <>
              {/* Card overview */}
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:16 }}>
                {[
                  ["Limite Total", cards.reduce((s,c)=>s+(c.limit||0),0), "#7c3aed"],
                  ["Fatura Total", cards.reduce((s,c)=>s+getCardCurrentPeriod(c).total,0), "#ef4444"],
                ].map(([label,val,color])=>(
                  <div key={label} className="card" style={{ padding:14 }}>
                    <div style={{ fontSize:10, color:T.sub, marginBottom:4 }}>{label.toUpperCase()}</div>
                    <div style={{ fontSize:18, fontWeight:700, fontFamily:"'DM Mono',monospace", color }}>{fmt(val)}</div>
                  </div>
                ))}
              </div>

              {cards.map(card => {
                const { total, closingDate, dueDate, daysUntilDue, limit, available } = getCardCurrentPeriod(card);
                const usedPct = limit>0?(total/limit*100):0;
                const bestDay = card.closingDay ? ((card.closingDay+1)%31+1) : null;
                return (
                  <div key={card.id} style={{ marginBottom:16 }}>
                    {/* Visual Card */}
                    <div className="card-premium" style={{ background:`linear-gradient(135deg,${card.color},${card.color}bb)`, color:"white", marginBottom:8 }}>
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:16 }}>
                        <div>
                          <div style={{ fontSize:10, opacity:.7, marginBottom:2 }}>{CARD_BRANDS[card.brand]||card.brand}</div>
                          <div style={{ fontSize:18, fontWeight:700 }}>{card.name}</div>
                        </div>
                        <div style={{ display:"flex", gap:6 }}>
                          <button onClick={()=>openEditCard(card)} style={{ background:"rgba(255,255,255,.15)", border:"none", borderRadius:8, padding:"5px 8px", color:"white", cursor:"pointer", fontSize:12 }}>✏️</button>
                          <button onClick={()=>deleteCard(card.id)} style={{ background:"rgba(255,255,255,.15)", border:"none", borderRadius:8, padding:"5px 8px", color:"white", cursor:"pointer", fontSize:12 }}>✕</button>
                        </div>
                      </div>
                      <div style={{ display:"flex", gap:20, marginBottom:12 }}>
                        <div>
                          <div style={{ fontSize:9, opacity:.6 }}>FATURA ATUAL</div>
                          <div style={{ fontSize:22, fontWeight:700, fontFamily:"'DM Mono',monospace" }}>{fmt(total)}</div>
                        </div>
                        {limit > 0 && (
                          <div>
                            <div style={{ fontSize:9, opacity:.6 }}>DISPONÍVEL</div>
                            <div style={{ fontSize:22, fontWeight:700, fontFamily:"'DM Mono',monospace" }}>{fmt(available)}</div>
                          </div>
                        )}
                      </div>
                      {limit > 0 && (
                        <div style={{ height:4, background:"rgba(255,255,255,.2)", borderRadius:2, overflow:"hidden", marginBottom:12 }}>
                          <div style={{ height:"100%", width:`${Math.min(usedPct,100)}%`, background:"rgba(255,255,255,.8)", borderRadius:2, transition:"width .5s" }}/>
                        </div>
                      )}
                      <div style={{ display:"flex", gap:16 }}>
                        <div><div style={{ fontSize:9, opacity:.6 }}>FECHA</div><div style={{ fontSize:12, fontWeight:600 }}>dia {card.closingDay||15}</div></div>
                        <div><div style={{ fontSize:9, opacity:.6 }}>VENCE</div><div style={{ fontSize:12, fontWeight:600 }}>dia {card.dueDay||25}</div></div>
                        <div><div style={{ fontSize:9, opacity:.6 }}>FATURA EM</div><div style={{ fontSize:12, fontWeight:600 }}>{daysUntilDue>0?`${daysUntilDue}d`:"Hoje"}</div></div>
                        {bestDay && <div><div style={{ fontSize:9, opacity:.6 }}>MELHOR DIA</div><div style={{ fontSize:12, fontWeight:600 }}>dia {bestDay}</div></div>}
                      </div>
                    </div>
                    {/* Transactions */}
                    {(() => {
                      const txs = transactions.filter(t=>t.cardId===card.id&&t.type==="expense").slice(0,4);
                      if (!txs.length) return null;
                      return (
                        <div className="card" style={{ padding:8 }}>
                          <div style={{ fontSize:11, color:T.sub, padding:"4px 8px 8px" }}>Últimas transações</div>
                          {txs.map(tx=>(
                            <div key={tx.id} className="row">
                              <div style={{ fontSize:16 }}>{allCategories[tx.category]?.emoji||"📦"}</div>
                              <div style={{ flex:1, minWidth:0 }}>
                                <div style={{ fontSize:12, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{tx.description}</div>
                                <div style={{ fontSize:10, color:T.sub }}>{new Date(tx.date).toLocaleDateString("pt-BR")}</div>
                              </div>
                              <div style={{ fontSize:13, fontWeight:600, fontFamily:"'DM Mono',monospace", color:"#ef4444" }}>-{fmt(tx.amount)}</div>
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                  </div>
                );
              })}
            </>
          )}
        </div>}

        {/* ── FIXED BILLS ──────────────────────────────────────────────────── */}
        {tab==="fixed" && <div className="fi">
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16 }}>
            <div>
              <div style={{ fontSize:16, fontWeight:700 }}>📋 Contas Fixas</div>
              <div style={{ fontSize:12, color:T.sub, marginTop:2 }}>Total: {fmt(fixedBills.reduce((s,b)=>s+(b.amount||0),0))}/mês</div>
            </div>
            <button className="btn-sm" onClick={()=>setShowFixedBillForm(v=>!v)}>+ Nova Conta</button>
          </div>

          {showFixedBillForm && (
            <div className="card fi" style={{ padding:18, marginBottom:16 }}>
              <div style={{ fontSize:12, color:T.sub, marginBottom:6 }}>Descrição</div>
              <input className="inp" value={fbDesc} onChange={e=>setFbDesc(e.target.value)} placeholder="Ex: Netflix, Aluguel..." style={{ marginBottom:12 }}/>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:12 }}>
                <div>
                  <div style={{ fontSize:12, color:T.sub, marginBottom:6 }}>Valor (R$)</div>
                  <input className="inp" value={fbAmount} onChange={e=>setFbAmount(e.target.value.replace(/[^0-9,.]/g,""))} placeholder="0,00" inputMode="decimal" style={{ fontFamily:"'DM Mono',monospace" }}/>
                </div>
                <div>
                  <div style={{ fontSize:12, color:T.sub, marginBottom:6 }}>Vence dia</div>
                  <input className="inp" type="number" min="1" max="31" value={fbDueDay} onChange={e=>setFbDueDay(Math.min(31,Math.max(1,parseInt(e.target.value)||1)))} style={{ fontFamily:"'DM Mono',monospace", textAlign:"center" }}/>
                </div>
              </div>
              <div style={{ fontSize:12, color:T.sub, marginBottom:8 }}>Tipo</div>
              <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:16 }}>
                {FIXED_BILL_TYPES.map(t=>(
                  <button key={t.key} onClick={()=>setFbType(t.key)} style={{ background:fbType===t.key?t.color+"22":T.inp, border:`1px solid ${fbType===t.key?t.color:T.inpBorder}`, borderRadius:8, padding:"5px 10px", fontSize:12, cursor:"pointer", color:fbType===t.key?T.text:T.sub, fontFamily:"'DM Sans',sans-serif" }}>{t.emoji} {t.label}</button>
                ))}
              </div>
              <div style={{ display:"flex", gap:8 }}>
                <button className="btn-g" onClick={()=>setShowFixedBillForm(false)} style={{ flex:1 }}>Cancelar</button>
                <button className="btn" onClick={saveFixedBill} disabled={!fbDesc.trim()||!fbAmount.trim()} style={{ flex:2 }}>✅ Adicionar</button>
              </div>
              {fbMsg==="ok" && <div className="fi" style={{ textAlign:"center", fontSize:13, color:"#10b981", marginTop:10 }}>✓ Conta adicionada!</div>}
              {fbMsg==="err" && <div className="fi" style={{ textAlign:"center", fontSize:13, color:"#ef4444", marginTop:10 }}>Preencha todos os campos.</div>}
            </div>
          )}

          {fixedBills.length===0 ? (
            <div className="card" style={{ padding:48, textAlign:"center", color:T.sub }}>
              <div style={{ fontSize:44, marginBottom:12 }}>📋</div>
              <div style={{ fontSize:14, fontWeight:600, color:T.text, marginBottom:6 }}>Nenhuma conta fixa</div>
              <div style={{ fontSize:12 }}>Adicione aluguel, internet, streaming e outras contas recorrentes</div>
            </div>
          ) : fixedBills.map(bill=>{
            const paidKey = currentMonthKey;
            const isPaid = (bill.paidMonths||[]).includes(paidKey);
            const billType = FIXED_BILL_TYPES.find(t=>t.key===bill.type)||FIXED_BILL_TYPES[FIXED_BILL_TYPES.length-1];
            const daysLeft = bill.dueDay ? bill.dueDay - new Date().getDate() : null;
            const isLate = daysLeft !== null && daysLeft < 0 && !isPaid;
            return (
              <div key={bill.id} className="card" style={{ padding:16, marginBottom:10, borderLeft:`3px solid ${isPaid?"#10b981":isLate?"#ef4444":"#f59e0b"}` }}>
                <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                  <div style={{ width:40, height:40, borderRadius:12, background:billType.color+"22", display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, flexShrink:0 }}>
                    {billType.emoji}
                  </div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:14, fontWeight:600 }}>{bill.description}</div>
                    <div style={{ fontSize:11, color:T.sub, marginTop:2 }}>
                      {bill.dueDay?`Vence dia ${bill.dueDay}`:""}{daysLeft!==null&&!isPaid?` · ${isLate?`Atrasado ${Math.abs(daysLeft)}d`:`${daysLeft}d restantes`}`:""}
                    </div>
                  </div>
                  <div style={{ textAlign:"right" }}>
                    <div style={{ fontSize:16, fontWeight:700, fontFamily:"'DM Mono',monospace", color:isLate&&!isPaid?"#ef4444":T.text }}>{fmt(bill.amount)}</div>
                    <div style={{ fontSize:10, color:isPaid?"#10b981":isLate?"#ef4444":"#f59e0b", marginTop:2 }}>{isPaid?"✅ Pago":isLate?"🔴 Atrasado":"⏳ Pendente"}</div>
                  </div>
                </div>
                <div style={{ display:"flex", gap:8, marginTop:12 }}>
                  {!isPaid ? (
                    <button onClick={()=>markFixedBillPaid(bill.id, paidKey)} style={{ flex:2, background:"#10b98122", border:"1px solid #10b981", borderRadius:10, padding:"8px", fontSize:12, cursor:"pointer", color:"#10b981", fontFamily:"'DM Sans',sans-serif", fontWeight:600 }}>✅ Marcar como pago</button>
                  ) : (
                    <button onClick={()=>unmarkFixedBillPaid(bill.id, paidKey)} style={{ flex:2, background:T.inp, border:`1px solid ${T.inpBorder}`, borderRadius:10, padding:"8px", fontSize:12, cursor:"pointer", color:T.sub, fontFamily:"'DM Sans',sans-serif" }}>↩ Desmarcar</button>
                  )}
                  <button onClick={()=>deleteFixedBill(bill.id)} style={{ background:"none", border:`1px solid ${T.border}`, borderRadius:10, padding:"8px 12px", fontSize:13, cursor:"pointer", color:T.sub }}>✕</button>
                </div>
              </div>
            );
          })}
        </div>}

        {/* ── GOALS ────────────────────────────────────────────────────────── */}
        {tab==="goals" && <div className="fi">
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16 }}>
            <div style={{ fontSize:16, fontWeight:700 }}>🎯 Metas Financeiras</div>
            <button className="btn-sm" onClick={()=>setShowGoalForm(v=>!v)}>+ Nova Meta</button>
          </div>

          {showGoalForm && (
            <div className="card fi" style={{ padding:18, marginBottom:16 }}>
              <div style={{ display:"grid", gridTemplateColumns:"60px 1fr", gap:12, marginBottom:12 }}>
                <div>
                  <div style={{ fontSize:12, color:T.sub, marginBottom:6 }}>Emoji</div>
                  <input className="inp" value={goalEmoji} onChange={e=>setGoalEmoji(e.target.value)} style={{ textAlign:"center", fontSize:22 }} maxLength={4}/>
                </div>
                <div>
                  <div style={{ fontSize:12, color:T.sub, marginBottom:6 }}>Descrição</div>
                  <input className="inp" value={goalDesc} onChange={e=>setGoalDesc(e.target.value)} placeholder="Ex: Viagem, Carro, Reserva..."/>
                </div>
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:12 }}>
                <div>
                  <div style={{ fontSize:12, color:T.sub, marginBottom:6 }}>Meta (R$)</div>
                  <input className="inp" value={goalTarget} onChange={e=>setGoalTarget(e.target.value.replace(/[^0-9,.]/g,""))} placeholder="0,00" inputMode="decimal" style={{ fontFamily:"'DM Mono',monospace" }}/>
                </div>
                <div>
                  <div style={{ fontSize:12, color:T.sub, marginBottom:6 }}>Já guardou (R$)</div>
                  <input className="inp" value={goalSaved} onChange={e=>setGoalSaved(e.target.value.replace(/[^0-9,.]/g,""))} placeholder="0,00" inputMode="decimal" style={{ fontFamily:"'DM Mono',monospace" }}/>
                </div>
              </div>
              <div style={{ fontSize:12, color:T.sub, marginBottom:6 }}>Prazo (opcional)</div>
              <input className="inp" type="date" value={goalDeadline} onChange={e=>setGoalDeadline(e.target.value)} style={{ marginBottom:16 }}/>
              <div style={{ display:"flex", gap:8 }}>
                <button className="btn-g" onClick={()=>setShowGoalForm(false)} style={{ flex:1 }}>Cancelar</button>
                <button className="btn" onClick={saveGoal} disabled={!goalDesc.trim()||!goalTarget.trim()} style={{ flex:2 }}>🎯 Criar Meta</button>
              </div>
              {goalFormMsg==="ok" && <div className="fi" style={{ textAlign:"center", fontSize:13, color:"#10b981", marginTop:10 }}>✓ Meta criada!</div>}
            </div>
          )}

          {goals.length===0 ? (
            <div className="card" style={{ padding:48, textAlign:"center", color:T.sub }}>
              <div style={{ fontSize:44, marginBottom:12 }}>🎯</div>
              <div style={{ fontSize:14, fontWeight:600, color:T.text, marginBottom:6 }}>Nenhuma meta definida</div>
              <div style={{ fontSize:12 }}>Defina metas para viagens, reservas, compras e mais</div>
            </div>
          ) : goals.map(g=>{
            const pct = Math.min((g.saved||0)/g.target*100, 100);
            const remaining = Math.max(0, g.target-(g.saved||0));
            const daysLeft = g.deadline ? Math.ceil((new Date(g.deadline)-new Date())/(1000*60*60*24)) : null;
            const monthlyNeeded = daysLeft && daysLeft>0 ? remaining/(daysLeft/30) : null;
            return (
              <div key={g.id} className="card" style={{ padding:20, marginBottom:12 }}>
                <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom:16 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                    <div style={{ fontSize:32 }}>{g.emoji}</div>
                    <div>
                      <div style={{ fontSize:15, fontWeight:700 }}>{g.description}</div>
                      {daysLeft !== null && <div style={{ fontSize:11, color:daysLeft<0?"#ef4444":daysLeft<30?"#f59e0b":T.sub, marginTop:2 }}>{daysLeft>0?`${daysLeft} dias restantes`:daysLeft===0?"Prazo hoje":"Prazo encerrado"}</div>}
                    </div>
                  </div>
                  <button className="del" onClick={()=>deleteGoal(g.id)}>✕</button>
                </div>
                <RadialProgress pct={pct} size={90} stroke={8} color={pct>=100?"#10b981":pct>50?"#7c3aed":"#f59e0b"}>
                  <div style={{ fontFamily:"'DM Mono',monospace", fontSize:14, fontWeight:700, color:T.text }}>{pct.toFixed(0)}%</div>
                </RadialProgress>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginTop:16 }}>
                  <div>
                    <div style={{ fontSize:10, color:T.sub }}>GUARDADO</div>
                    <div style={{ fontSize:15, fontWeight:700, color:"#10b981", fontFamily:"'DM Mono',monospace" }}>{fmt(g.saved||0)}</div>
                  </div>
                  <div>
                    <div style={{ fontSize:10, color:T.sub }}>FALTAM</div>
                    <div style={{ fontSize:15, fontWeight:700, color:"#ef4444", fontFamily:"'DM Mono',monospace" }}>{fmt(remaining)}</div>
                  </div>
                  {monthlyNeeded && (
                    <div style={{ gridColumn:"span 2" }}>
                      <div style={{ fontSize:10, color:T.sub }}>ECONOMIA MENSAL SUGERIDA</div>
                      <div style={{ fontSize:14, fontWeight:600, color:"#7c3aed", fontFamily:"'DM Mono',monospace" }}>{fmt(monthlyNeeded)}/mês</div>
                    </div>
                  )}
                </div>
                <div style={{ marginTop:14 }}>
                  <div style={{ fontSize:11, color:T.sub, marginBottom:6 }}>Atualizar valor guardado</div>
                  <div style={{ display:"flex", gap:8 }}>
                    <input className="inp" type="number" placeholder={`${g.saved||0}`} onBlur={e=>{ const v=parseFloat(e.target.value); if(!isNaN(v)&&v>=0){updateGoalSaved(g.id,v);e.target.value="";} }} style={{ fontFamily:"'DM Mono',monospace" }}/>
                  </div>
                </div>
              </div>
            );
          })}
        </div>}

        {/* ── UBER ─────────────────────────────────────────────────────────── */}
        {tab==="uber" && <div className="fi">
          <div className="card" style={{ padding:20, marginBottom:12, background:darkMode?"#0d0d12":"#f8f8ff", border:`1px solid ${darkMode?"#1a1a2e":"#e8e8ff"}` }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16 }}>
              <div>
                <div style={{ fontSize:11, color:T.sub, letterSpacing:".08em", textTransform:"uppercase" }}>Hoje · {new Date().toLocaleDateString("pt-BR",{weekday:"long"})}</div>
                <div style={{ fontSize:13, color:T.sub, marginTop:2 }}>Meta: <span style={{ fontFamily:"'DM Mono',monospace" }}>{fmt(uberSettings.dailyGoal)}</span></div>
              </div>
              <button onClick={()=>setShowUberSettings(v=>!v)} style={{ background:T.inp, border:`1px solid ${T.inpBorder}`, borderRadius:10, padding:"6px 10px", cursor:"pointer", fontSize:14, color:T.sub }}>⚙️</button>
            </div>
            {showUberSettings && (
              <div className="fi" style={{ marginBottom:16, padding:14, background:T.inp, borderRadius:12 }}>
                <div style={{ fontSize:12, color:T.sub, marginBottom:8 }}>Meta diária</div>
                <div style={{ display:"flex", gap:8 }}>
                  <input className="inp" value={goalInput} onChange={e=>setGoalInput(e.target.value.replace(/[^0-9,.]/g,""))} style={{ fontFamily:"'DM Mono',monospace", fontSize:18 }} inputMode="decimal"/>
                  <button className="btn" onClick={saveGoalUber} style={{ whiteSpace:"nowrap", padding:"12px 16px" }}>OK</button>
                </div>
              </div>
            )}
            <RadialProgress pct={goalPct} size={160} stroke={14} color={goalColor}>
              <div style={{ fontSize:24, fontWeight:700, fontFamily:"'DM Mono',monospace", color:goalColor }}>{fmt(todayTotal)}</div>
              {remaining>0&&<div style={{ fontSize:11, color:T.sub, marginTop:2 }}>faltam {fmt(remaining)}</div>}
              {goalPct>=100&&<div style={{ fontSize:12, color:"#10b981", marginTop:2 }}>🎉 Meta batida!</div>}
            </RadialProgress>
            <div style={{ display:"flex", gap:8, marginTop:20 }}>
              <input className="inp-uber" value={rideInput} onChange={e=>setRideInput(e.target.value.replace(/[^0-9,.]/g,""))} onKeyDown={e=>{ if(e.key==="Enter")handleSaveDayEarnings(todayKey_,rideInput); }} placeholder="0,00" inputMode="decimal" style={{ flex:1, textAlign:"center" }}/>
              <button className="btn-uber" onClick={()=>handleSaveDayEarnings(todayKey_,rideInput)} disabled={!rideInput.trim()} style={{ whiteSpace:"nowrap" }}>{todayEntry?"Atualizar":"Registrar"}</button>
            </div>
            {rideMsg==="ok" && <div className="fi" style={{ textAlign:"center", fontSize:13, color:"#10b981", marginTop:10 }}>✓ Registrado!</div>}
            {rideMsg==="err" && <div className="fi" style={{ textAlign:"center", fontSize:13, color:"#ef4444", marginTop:10 }}>Valor inválido.</div>}
          </div>

          {/* 14-day bar chart */}
          <div className="card" style={{ padding:18, marginBottom:12 }}>
            <div style={{ fontSize:12, fontWeight:700, color:T.sub, marginBottom:16, letterSpacing:".06em", textTransform:"uppercase" }}>Últimos 14 Dias</div>
            <div style={{ display:"flex", gap:3, height:80, alignItems:"flex-end" }}>
              {last14.map((d,i)=>{
                const max = Math.max(...last14.map(x=>x.total),1);
                const h = Math.max((d.total/max)*70, d.total>0?6:0);
                return (
                  <div key={i} className="day-bar" onClick={()=>{ if(editingDate===d.date){setEditingDate(null);}else{setEditingDate(d.date);setEditInput(String(d.total||""));} }}>
                    <div className="day-fill" style={{ height:h, background:d.isToday?"#7c3aed":d.total>=uberSettings.dailyGoal?"#10b981":"#2a2a3a", cursor:"pointer" }}/>
                    <div style={{ fontSize:8, color:d.isToday?"#7c3aed":T.sub, fontWeight:d.isToday?700:400 }}>{d.name}</div>
                  </div>
                );
              })}
            </div>
            {editingDate && (
              <div className="fi" style={{ marginTop:14, padding:12, background:T.inp, borderRadius:10 }}>
                <div style={{ fontSize:11, color:T.sub, marginBottom:8 }}>Editar {new Date(editingDate+"T12:00:00").toLocaleDateString("pt-BR",{weekday:"long",day:"numeric",month:"short"})}</div>
                <div style={{ display:"flex", gap:8 }}>
                  <input className="inp" value={editInput} onChange={e=>setEditInput(e.target.value.replace(/[^0-9,.]/g,""))} inputMode="decimal" style={{ fontFamily:"'DM Mono',monospace", fontSize:18 }}/>
                  <button className="btn" onClick={()=>handleSaveDayEarnings(editingDate,editInput)} style={{ whiteSpace:"nowrap" }}>✅</button>
                  <button onClick={()=>deleteDay(editingDate)} style={{ background:"#ef444422", border:"1px solid #ef4444", borderRadius:10, padding:"0 12px", color:"#ef4444", cursor:"pointer", fontSize:13 }}>🗑</button>
                </div>
              </div>
            )}
          </div>

          {/* Stats */}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10, marginBottom:12 }}>
            {[["Esta Semana",fmt(weekTotal),T.text],["Dias Trabalhados",weekDaysWorked,T.sub],["Média/dia",fmt(weekAvg),"#10b981"]].map(([label,val,color])=>(
              <div key={label} className="card" style={{ padding:14, textAlign:"center" }}>
                <div style={{ fontSize:15, fontWeight:700, fontFamily:"'DM Mono',monospace", color }}>{val}</div>
                <div style={{ fontSize:9, color:T.sub, marginTop:4, letterSpacing:".04em", textTransform:"uppercase" }}>{label}</div>
              </div>
            ))}
          </div>

          <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10, marginBottom:12 }}>
            {[["Total acumulado",fmt(allTimeTotal),"#10b981"],["Dias registrados",allTimeDays,T.sub],["Projeção/mês",fmt(weekAvg*20),"#f59e0b"]].map(([label,val,color])=>(
              <div key={label} className="card" style={{ padding:14, textAlign:"center" }}>
                <div style={{ fontSize:14, fontWeight:700, fontFamily:"'DM Mono',monospace", color }}>{val}</div>
                <div style={{ fontSize:9, color:T.sub, marginTop:4, letterSpacing:".04em", textTransform:"uppercase" }}>{label}</div>
              </div>
            ))}
          </div>

          {/* Weekly goal */}
          <div className="card" style={{ padding:16, marginBottom:12 }}>
            {uberWeeklyGoal > 0 ? (
              <>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
                  <span style={{ fontSize:12, color:T.sub }}>Meta semanal</span>
                  <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                    <span style={{ fontSize:13, fontFamily:"'DM Mono',monospace", color:weekTotal>=uberWeeklyGoal?"#10b981":T.text }}>{fmt(weekTotal)} / {fmt(uberWeeklyGoal)}</span>
                    <button onClick={()=>setUberWeeklyGoal(0)} style={{ background:"none", border:"none", color:T.sub, cursor:"pointer", fontSize:12 }}>✕</button>
                  </div>
                </div>
                <div style={{ height:6, background:T.muted, borderRadius:3, overflow:"hidden" }}>
                  <div style={{ height:"100%", width:`${Math.min((weekTotal/uberWeeklyGoal)*100,100)}%`, background:weekTotal>=uberWeeklyGoal?"#10b981":"#7c3aed", borderRadius:3, transition:"width .4s" }}/>
                </div>
                {weekTotal>=uberWeeklyGoal?<div style={{ fontSize:11, color:"#10b981", marginTop:4 }}>🎉 Meta semanal batida!</div>:<div style={{ fontSize:11, color:T.sub, marginTop:4 }}>Faltam {fmt(uberWeeklyGoal-weekTotal)}</div>}
              </>
            ) : (
              <div style={{ display:"flex", gap:8 }}>
                <input className="inp" value={weeklyGoalInput} onChange={e=>setWeeklyGoalInput(e.target.value.replace(/[^0-9,.]/g,""))} placeholder="Meta semanal (R$)" inputMode="decimal" style={{ fontSize:13 }}/>
                <button className="btn" onClick={()=>{ const v=parseFloat((weeklyGoalInput||"").replace(",",".")); if(v>0){setUberWeeklyGoal(v);setWeeklyGoalInput("");} }} style={{ whiteSpace:"nowrap", fontSize:13 }}>Definir</button>
              </div>
            )}
          </div>

          <div className="card" style={{ padding:16 }}>
            <button className="btn" onClick={handleUberAI} disabled={uberAILoading||rides.length===0} style={{ width:"100%", marginBottom:uberAI?14:0 }}>
              {uberAILoading?<><span className="sp">⟳</span> Analisando...</>:"✨ Análise IA de Ganhos"}
            </button>
            {rides.length===0&&<div style={{ fontSize:11, color:T.sub, textAlign:"center", marginTop:8 }}>Registre alguns dias primeiro</div>}
            {uberAI && <div className="fi" style={{ fontSize:13, color:T.sub, lineHeight:1.9, whiteSpace:"pre-line" }}>{uberAI}</div>}
          </div>
        </div>}

        {/* ── INVOICE ──────────────────────────────────────────────────────── */}
        {tab==="invoice" && <div className="fi">
          {!invoiceItems && !importDone && <>
            <div className="card" style={{ padding:18, marginBottom:14 }}>
              <div style={{ fontSize:15, fontWeight:700, marginBottom:4 }}>📥 Importar Fatura</div>
              <div style={{ fontSize:12, color:T.sub, marginBottom:16 }}>Itaú, Bradesco, BB e outros bancos</div>
              <div style={{ display:"flex", gap:5, marginBottom:16 }}>
                {[["image","📸","Print"],["pdf","📄","PDF"],["text","📋","Texto"]].map(([key,icon,label])=>(
                  <button key={key} className={`btn-g ${invoiceMode===key?"on":""}`} onClick={()=>setInvoiceMode(key)} style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", gap:4 }}>
                    {icon} {label}
                  </button>
                ))}
              </div>

              {invoiceMode==="image" && <>
                <div className={`drop ${dragOver?"drag":""}`} onClick={()=>imgRef.current?.click()} onDragOver={e=>{e.preventDefault();setDragOver(true)}} onDragLeave={()=>setDragOver(false)} onDrop={e=>{e.preventDefault();setDragOver(false);addImageFiles(e.dataTransfer.files)}} style={{ marginBottom:invoiceImages.length?12:0 }}>
                  <div style={{ fontSize:36, marginBottom:8 }}>📸</div>
                  <div style={{ fontSize:13, color:T.sub }}>Arraste prints ou clique para selecionar</div>
                  <div style={{ fontSize:11, color:T.sub, marginTop:4 }}>PNG, JPG, WEBP · Múltiplos prints</div>
                  <input ref={imgRef} type="file" accept="image/*" multiple style={{ display:"none" }} onChange={e=>addImageFiles(e.target.files)}/>
                </div>
                {invoiceImages.length > 0 && (
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8, marginBottom:12 }}>
                    {invoiceImages.map(img=>(
                      <div key={img.id} className="img-thumb" style={{ aspectRatio:"1/1" }}>
                        <img src={img.preview} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }}/>
                        <button className="img-rm" onClick={()=>setInvoiceImages(p=>p.filter(i=>i.id!==img.id))}>✕</button>
                      </div>
                    ))}
                    <div onClick={()=>imgRef.current?.click()} style={{ aspectRatio:"1/1", border:`2px dashed ${T.border}`, borderRadius:10, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", cursor:"pointer", color:T.sub, fontSize:11, gap:4 }}>
                      <span style={{ fontSize:20 }}>+</span><span>mais</span>
                    </div>
                  </div>
                )}
              </>}

              {invoiceMode==="pdf" && (
                <div className={`drop ${invoiceFile?"drag":""}`} onClick={()=>pdfRef.current?.click()} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();const f=e.dataTransfer.files[0];if(f?.type==="application/pdf")setInvoiceFile(f)}} style={{ marginBottom:12 }}>
                  {invoiceFile ? (
                    <div><div style={{ fontSize:36, marginBottom:6 }}>📄</div><div style={{ fontSize:13, color:T.text }}>{invoiceFile.name}</div><button onClick={e=>{e.stopPropagation();setInvoiceFile(null)}} style={{ background:"none", border:`1px solid ${T.border}`, color:T.sub, borderRadius:6, padding:"4px 10px", marginTop:8, fontSize:11, cursor:"pointer", fontFamily:"'DM Sans',sans-serif" }}>Remover</button></div>
                  ) : <><div style={{ fontSize:36, marginBottom:8 }}>📂</div><div style={{ fontSize:13, color:T.sub }}>Arraste o PDF ou clique</div></>}
                  <input ref={pdfRef} type="file" accept="application/pdf" style={{ display:"none" }} onChange={e=>{if(e.target.files[0])setInvoiceFile(e.target.files[0])}}/>
                </div>
              )}

              {invoiceMode==="text" && (
                <textarea className="inp" value={invoiceText} onChange={e=>setInvoiceText(e.target.value)} placeholder={"01/05 MERCADO EXTRA   87,50\n02/05 IFOOD*REST       45,00"} rows={9} style={{ resize:"vertical", marginBottom:12, fontSize:13, lineHeight:1.6 }}/>
              )}

              {invoiceError && <div style={{ fontSize:12, color:"#ef4444", marginBottom:10, background:"#1e1515", border:"1px solid #2a1a1a", padding:"8px 12px", borderRadius:8 }}>⚠️ {invoiceError}</div>}

              {cards.length > 0 && (
                <div style={{ marginBottom:14 }}>
                  <div style={{ fontSize:12, color:T.sub, marginBottom:8 }}>De qual cartão?</div>
                  <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                    <button onClick={()=>setInvoiceCardId("")} style={{ background:invoiceCardId===""?T.tabOn:T.inp, border:`1px solid ${invoiceCardId===""?T.border:T.inpBorder}`, borderRadius:8, padding:"6px 12px", fontSize:12, cursor:"pointer", color:invoiceCardId===""?T.text:T.sub, fontFamily:"'DM Sans',sans-serif" }}>Não informar</button>
                    {cards.map(c=>(
                      <button key={c.id} onClick={()=>setInvoiceCardId(c.id)} style={{ background:invoiceCardId===c.id?c.color+"22":T.inp, border:`1px solid ${invoiceCardId===c.id?c.color:T.inpBorder}`, borderRadius:8, padding:"6px 12px", fontSize:12, cursor:"pointer", color:invoiceCardId===c.id?T.text:T.sub, fontFamily:"'DM Sans',sans-serif", display:"flex", alignItems:"center", gap:6 }}>
                        <span style={{ width:8, height:8, borderRadius:"50%", background:c.color, flexShrink:0 }}/>{c.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <button className="btn" onClick={handleParseInvoice} disabled={invoiceLoading||(invoiceMode==="image"&&!invoiceImages.length)||(invoiceMode==="pdf"&&!invoiceFile)||(invoiceMode==="text"&&!invoiceText.trim())} style={{ width:"100%" }}>
                {invoiceLoading?<><span className="sp">⟳</span> Analisando com IA...</>:"🔍 Analisar com IA"}
              </button>
            </div>
          </>}

          {invoiceItems && !importDone && (
            <div className="fi">
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12 }}>
                <div>
                  <div style={{ fontSize:14, fontWeight:700 }}>Itens encontrados</div>
                  <div style={{ fontSize:12, color:T.sub, marginTop:2 }}>{Object.values(selectedItems).filter(Boolean).length}/{invoiceItems.length} selecionados</div>
                </div>
                <div style={{ display:"flex", gap:5 }}>
                  <button className="btn-g" style={{ fontSize:11, padding:"5px 10px" }} onClick={()=>setSelectedItems(Object.fromEntries(invoiceItems.map((_,i)=>[i,true])))}>Todos</button>
                  <button className="btn-g" style={{ fontSize:11, padding:"5px 10px" }} onClick={()=>setSelectedItems({})}>Nenhum</button>
                </div>
              </div>
              <div className="card" style={{ marginBottom:12, padding:4 }}>
                {invoiceItems.map((item,i)=>(
                  <div key={i} className="chi" onClick={()=>setSelectedItems(p=>({...p,[i]:!p[i]}))}>
                    <div style={{ width:17, height:17, borderRadius:5, border:`2px solid ${selectedItems[i]?"#7c3aed":T.border}`, background:selectedItems[i]?"#7c3aed":"transparent", flexShrink:0, marginTop:2, display:"flex", alignItems:"center", justifyContent:"center", transition:"all .15s" }}>
                      {selectedItems[i]&&<span style={{ color:"white", fontSize:10 }}>✓</span>}
                    </div>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:13, fontWeight:500, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{item.description}</div>
                      <div style={{ display:"flex", gap:5, marginTop:4, flexWrap:"wrap" }}>
                        <span className="tag">{allCategories[item.category]?.emoji} {allCategories[item.category]?.label||item.category}</span>
                        {item.date&&<span className="tag">{new Date(item.date).toLocaleDateString("pt-BR")}</span>}
                        {item.installment&&<span className="tag">📆 {item.installment}</span>}
                      </div>
                    </div>
                    <div style={{ fontSize:13, fontWeight:600, fontFamily:"'DM Mono',monospace", color:"#ef4444", flexShrink:0 }}>-{fmt(item.amount)}</div>
                  </div>
                ))}
              </div>
              <div className="card" style={{ padding:"11px 15px", marginBottom:12, display:"flex", justifyContent:"space-between" }}>
                <span style={{ fontSize:13, color:T.sub }}>Total selecionado</span>
                <span style={{ fontSize:16, fontWeight:700, fontFamily:"'DM Mono',monospace", color:"#ef4444" }}>-{fmt(invoiceItems.filter((_,i)=>selectedItems[i]).reduce((s,t)=>s+t.amount,0))}</span>
              </div>
              <div style={{ display:"flex", gap:8 }}>
                <button className="btn-g" onClick={resetInvoice} style={{ flex:1 }}>← Voltar</button>
                <button className="btn" onClick={handleImportSelected} disabled={!Object.values(selectedItems).some(Boolean)} style={{ flex:2 }}>✅ Importar {Object.values(selectedItems).filter(Boolean).length} itens</button>
              </div>
            </div>
          )}

          {importDone && (
            <div className="fi card" style={{ padding:40, textAlign:"center" }}>
              <div style={{ fontSize:56, marginBottom:12 }}>✅</div>
              <div style={{ fontSize:16, fontWeight:700, marginBottom:6 }}>Fatura importada!</div>
              <div style={{ fontSize:13, color:T.sub, marginBottom:20 }}>Os itens foram adicionados ao histórico.</div>
              <div style={{ display:"flex", gap:8 }}>
                <button className="btn-g" onClick={()=>setImportDone(false)} style={{ flex:1 }}>+ Nova fatura</button>
                <button className="btn" onClick={()=>{setImportDone(false);setTab("dashboard")}} style={{ flex:1 }}>Ver Dashboard</button>
              </div>
            </div>
          )}
        </div>}

        {/* ── HISTORY ──────────────────────────────────────────────────────── */}
        {tab==="history" && <div className="fi">
          <div style={{ marginBottom:12, display:"flex", flexDirection:"column", gap:8 }}>
            <input className="inp" value={histSearch} onChange={e=>setHistSearch(e.target.value)} placeholder="🔍 Buscar lançamento..."/>
            <div style={{ display:"flex", gap:5, overflowX:"auto", paddingBottom:2 }}>
              <button className={`btn-g ${histFilterCat===""?"on":""}`} onClick={()=>setHistFilterCat("")} style={{ fontSize:11, whiteSpace:"nowrap" }}>Todas</button>
              {Object.entries(allCategories).map(([k,c])=>(
                <button key={k} className={`btn-g ${histFilterCat===k?"on":""}`} onClick={()=>setHistFilterCat(histFilterCat===k?"":k)} style={{ fontSize:11, whiteSpace:"nowrap" }}>{c.emoji} {c.label}</button>
              ))}
            </div>
            {cards.length > 0 && (
              <div style={{ display:"flex", gap:5, overflowX:"auto" }}>
                <button className={`btn-g ${histFilterCard===""?"on":""}`} onClick={()=>setHistFilterCard("")} style={{ fontSize:11 }}>Todos cartões</button>
                {cards.map(c=>(
                  <button key={c.id} className={`btn-g ${histFilterCard===c.id?"on":""}`} onClick={()=>setHistFilterCard(histFilterCard===c.id?"":c.id)} style={{ fontSize:11, whiteSpace:"nowrap", display:"flex", alignItems:"center", gap:4 }}>
                    <span style={{ width:6, height:6, borderRadius:"50%", background:c.color, display:"inline-block" }}/>{c.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {(() => {
            const filteredTxs = filtered.filter(tx => {
              if (histSearch && !tx.description.toLowerCase().includes(histSearch.toLowerCase())) return false;
              if (histFilterCat && tx.category !== histFilterCat) return false;
              if (histFilterCard && tx.cardId !== histFilterCard) return false;
              return true;
            }).sort((a,b)=>new Date(b.date)-new Date(a.date));
            return filteredTxs.length===0 ? (
              <div className="card" style={{ padding:40, textAlign:"center", color:T.sub }}>
                <div style={{ fontSize:36, marginBottom:8 }}>📋</div>
                <div style={{ fontSize:13 }}>{histSearch||histFilterCat||histFilterCard?"Nenhum resultado encontrado":`Nenhuma transação em ${MONTHS[filterMonth]}`}</div>
              </div>
            ) : (
              <div className="card" style={{ padding:6 }}>
                <div style={{ fontSize:11, color:T.sub, padding:"8px 12px 4px" }}>{filteredTxs.length} lançamentos</div>
                {filteredTxs.map(tx=>(
                  <div key={tx.id} className="row" style={{ cursor:"pointer" }} onClick={()=>setEditTx({...tx})}>
                    <div style={{ fontSize:18 }}>{allCategories[tx.category]?.emoji||"📦"}</div>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:13, fontWeight:500, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{tx.description}</div>
                      <div style={{ fontSize:11, color:T.sub, marginTop:2 }}>
                        {allCategories[tx.category]?.label}
                        {tx.payment==="credit"&&tx.cardId&&cards.find(c=>c.id===tx.cardId)&&<span style={{ marginLeft:6, color:cards.find(c=>c.id===tx.cardId)?.color }}>· 💳 {cards.find(c=>c.id===tx.cardId)?.name}</span>}
                        {tx.payment==="boleto"&&<span style={{ marginLeft:6, color:"#f59e0b" }}>· 📋 Boleto</span>}
                        <span style={{ marginLeft:6 }}>{new Date(tx.date).toLocaleDateString("pt-BR")}</span>
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize:13, fontWeight:600, fontFamily:"'DM Mono',monospace", color:tx.type==="income"?"#10b981":"#ef4444" }}>
                        {tx.type==="income"?"+":"-"}{fmt(tx.amount)}
                      </div>
                    </div>
                    <button className="del" onClick={e=>{e.stopPropagation();deleteTransaction(tx.id)}}>✕</button>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>}

        {/* ── COBRANÇAS ────────────────────────────────────────────────────── */}
        {tab==="charges" && <div className="fi">
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16 }}>
            <div style={{ fontSize:16, fontWeight:700 }}>💸 Cobranças a Receber</div>
            <button className="btn-sm" onClick={()=>setShowChargeForm(v=>!v)}>+ Nova</button>
          </div>

          {showChargeForm && (
            <div className="card fi" style={{ padding:18, marginBottom:16 }}>
              <div style={{ fontSize:12, color:T.sub, marginBottom:6 }}>Descrição</div>
              <input className="inp" value={chargeDesc} onChange={e=>setChargeDesc(e.target.value)} placeholder="Ex: Churrasco, Viagem..." style={{ marginBottom:12 }}/>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:12 }}>
                <div>
                  <div style={{ fontSize:12, color:T.sub, marginBottom:6 }}>Valor total (R$)</div>
                  <input className="inp" value={chargeTotal} onChange={e=>setChargeTotal(e.target.value.replace(/[^0-9,.]/g,""))} placeholder="0,00" inputMode="decimal" style={{ fontFamily:"'DM Mono',monospace" }}/>
                </div>
                <div>
                  <div style={{ fontSize:12, color:T.sub, marginBottom:6 }}>Parcelas</div>
                  <input className="inp" type="number" min="1" value={chargeInstall} onChange={e=>setChargeInstall(Math.max(1,parseInt(e.target.value)||1))} style={{ fontFamily:"'DM Mono',monospace", textAlign:"center" }}/>
                </div>
              </div>
              <div style={{ fontSize:12, color:T.sub, marginBottom:8 }}>Pessoas</div>
              {chargePeople.map((p,i)=>(
                <div key={i} style={{ display:"flex", gap:8, marginBottom:8 }}>
                  <input className="inp" value={p.name} onChange={e=>updatePersonName(i,e.target.value)} placeholder={`Nome da pessoa ${i+1}`} style={{ flex:1 }}/>
                  {chargePeople.length > 1 && <button onClick={()=>removeChargePerson(i)} style={{ background:"none", border:`1px solid ${T.border}`, borderRadius:10, padding:"0 12px", color:T.sub, cursor:"pointer", fontSize:16 }}>✕</button>}
                </div>
              ))}
              <button onClick={addChargePerson} style={{ width:"100%", background:"none", border:`1px dashed ${T.border}`, borderRadius:10, padding:8, color:"#7c3aed", fontSize:12, cursor:"pointer", fontFamily:"'DM Sans',sans-serif", marginBottom:12 }}>+ Adicionar pessoa</button>
              {chargeTotal && chargePeople.length > 0 && (
                <div style={{ background:T.inp, borderRadius:10, padding:"10px 14px", marginBottom:12, fontSize:12, color:T.sub }}>
                  💡 Cada pessoa deve <strong style={{ color:T.text }}>{fmt(Math.round((parseFloat(chargeTotal.replace(",","."))||0)/chargePeople.length*100)/100)}</strong>
                  {chargeInstall>1&&<> em <strong style={{ color:T.text }}>{chargeInstall}x</strong></>}
                </div>
              )}
              {chargeMsg==="err"&&<div style={{ fontSize:12, color:"#ef4444", marginBottom:10 }}>Preencha todos os campos.</div>}
              <div style={{ display:"flex", gap:8 }}>
                <button className="btn-g" onClick={()=>setShowChargeForm(false)} style={{ flex:1 }}>Cancelar</button>
                <button className="btn" onClick={saveCharge} style={{ flex:2 }}>💸 Criar Cobrança</button>
              </div>
            </div>
          )}

          {charges.length===0&&!showChargeForm ? (
            <div className="card" style={{ padding:48, textAlign:"center", color:T.sub }}>
              <div style={{ fontSize:44, marginBottom:12 }}>💸</div>
              <div style={{ fontSize:14, fontWeight:600, color:T.text, marginBottom:6 }}>Nenhuma cobrança</div>
              <div style={{ fontSize:12 }}>Registre empréstimos e compras divididas</div>
            </div>
          ) : charges.map(charge=>{
            const totalPeople = charge.people.length;
            const totalPaid = charge.people.reduce((s,p)=>s+p.paid.filter(Boolean).length,0);
            const totalInstalls = totalPeople*charge.installments;
            const totalReceived = totalPaid*charge.installAmt;
            const allDone = totalPaid===totalInstalls;
            return (
              <div key={charge.id} className="card" style={{ marginBottom:14, overflow:"hidden" }}>
                <div style={{ padding:"14px 16px", borderBottom:`1px solid ${T.border}`, display:"flex", alignItems:"center", gap:10 }}>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:14, fontWeight:600 }}>{charge.description}</div>
                    <div style={{ fontSize:11, color:T.sub, marginTop:2 }}>{new Date(charge.date).toLocaleDateString("pt-BR")} · {totalPeople} pessoa{totalPeople!==1?"s":""}{charge.installments>1?` · ${charge.installments}x`:""}</div>
                  </div>
                  <div style={{ textAlign:"right" }}>
                    <div style={{ fontSize:15, fontWeight:700, fontFamily:"'DM Mono',monospace", color:allDone?"#10b981":"#f59e0b" }}>{fmt(totalReceived)} / {fmt(charge.perPerson*totalPeople)}</div>
                  </div>
                  <button className="del" onClick={()=>deleteCharge(charge.id)}>✕</button>
                </div>
                <div style={{ padding:"8px 16px 0", borderBottom:`1px solid ${T.border}` }}>
                  <div style={{ height:4, background:T.muted, borderRadius:2, overflow:"hidden", marginBottom:6 }}>
                    <div style={{ height:"100%", width:`${totalInstalls>0?(totalPaid/totalInstalls)*100:0}%`, background:allDone?"#10b981":"#7c3aed", borderRadius:2, transition:"width .4s" }}/>
                  </div>
                  <div style={{ fontSize:10, color:T.sub, paddingBottom:8 }}>{totalPaid}/{totalInstalls} parcela{totalInstalls!==1?"s":""} recebida{totalInstalls!==1?"s":""}</div>
                </div>
                {charge.people.map(person=>{
                  const personPaid = person.paid.filter(Boolean).length;
                  const personDone = personPaid===charge.installments;
                  return (
                    <div key={person.id} style={{ padding:"12px 16px", borderBottom:`1px solid ${T.border}` }}>
                      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:charge.installments>1?8:0 }}>
                        <div style={{ width:28, height:28, borderRadius:"50%", background:personDone?"#10b981":"#7c3aed", display:"flex", alignItems:"center", justifyContent:"center", color:"white", fontSize:12, fontWeight:700, flexShrink:0 }}>{person.name[0]?.toUpperCase()}</div>
                        <div style={{ flex:1 }}>
                          <div style={{ fontSize:13, fontWeight:500 }}>{person.name}</div>
                          <div style={{ fontSize:11, color:T.sub }}>{personDone?"✅ Quitado":`${fmt(charge.installAmt*personPaid)} de ${fmt(charge.perPerson)}`}</div>
                        </div>
                        {charge.installments===1&&(
                          <button onClick={()=>toggleInstallPaid(charge.id,person.id,0)} style={{ background:person.paid[0]?"#10b981":"none", border:`2px solid ${person.paid[0]?"#10b981":T.border}`, borderRadius:8, padding:"6px 14px", fontSize:12, cursor:"pointer", color:person.paid[0]?"white":T.sub, fontFamily:"'DM Sans',sans-serif", fontWeight:600, transition:"all .2s" }}>
                            {person.paid[0]?"✓ Pago":"Marcar pago"}
                          </button>
                        )}
                      </div>
                      {charge.installments>1&&(
                        <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                          {Array.from({length:charge.installments},(_,k)=>(
                            <button key={k} onClick={()=>toggleInstallPaid(charge.id,person.id,k)} style={{ background:person.paid[k]?"#10b981":"none", border:`1px solid ${person.paid[k]?"#10b981":T.border}`, borderRadius:8, padding:"5px 10px", fontSize:11, cursor:"pointer", color:person.paid[k]?"white":T.sub, fontFamily:"'DM Mono',monospace", transition:"all .2s" }}>
                              {k+1}ª
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>}

        {/* ── AI ───────────────────────────────────────────────────────────── */}
        {tab==="ai" && <div className="fi">
          {/* AI Chat */}
          <div className="card" style={{ marginBottom:14, overflow:"hidden" }}>
            <div style={{ padding:"14px 16px", borderBottom:`1px solid ${T.border}` }}>
              <div style={{ fontSize:14, fontWeight:700 }}>🤖 Consultor Financeiro IA</div>
              <div style={{ fontSize:12, color:T.sub, marginTop:2 }}>Chat inteligente sobre suas finanças</div>
            </div>
            <div style={{ maxHeight:280, overflowY:"auto", padding:12, display:"flex", flexDirection:"column", gap:8 }}>
              {aiChat.length===0 && (
                <div style={{ textAlign:"center", color:T.sub, fontSize:13, padding:"20px 0" }}>
                  <div style={{ fontSize:36, marginBottom:8 }}>🤖</div>
                  <div>Pergunte qualquer coisa sobre suas finanças</div>
                  <div style={{ display:"flex", flexWrap:"wrap", gap:6, justifyContent:"center", marginTop:12 }}>
                    {["Como estou gastando?","Onde posso economizar?","Minha meta está no prazo?","Análise dos meus gastos"].map(q=>(
                      <button key={q} onClick={()=>{ setAiChatInput(q); }} style={{ background:T.inp, border:`1px solid ${T.inpBorder}`, borderRadius:8, padding:"5px 10px", fontSize:11, cursor:"pointer", color:T.sub, fontFamily:"'DM Sans',sans-serif" }}>{q}</button>
                    ))}
                  </div>
                </div>
              )}
              {aiChat.map((msg,i)=>(
                <div key={i} className="fi" style={{ display:"flex", justifyContent:msg.role==="user"?"flex-end":"flex-start" }}>
                  <div style={{ maxWidth:"85%", padding:"10px 14px", borderRadius:msg.role==="user"?"16px 16px 4px 16px":"16px 16px 16px 4px", background:msg.role==="user"?"linear-gradient(135deg,#7c3aed,#4f46e5)":T.card2, color:msg.role==="user"?"white":T.text, fontSize:13, lineHeight:1.6, whiteSpace:"pre-line" }}>
                    {msg.content}
                  </div>
                </div>
              ))}
              {aiChatLoading && (
                <div style={{ display:"flex" }}>
                  <div style={{ padding:"10px 14px", background:T.card2, borderRadius:"16px 16px 16px 4px", fontSize:13, color:T.sub }}>
                    <span className="sp">⟳</span> Analisando...
                  </div>
                </div>
              )}
            </div>
            <div style={{ padding:"12px 12px", borderTop:`1px solid ${T.border}`, display:"flex", gap:8 }}>
              <input className="inp" value={aiChatInput} onChange={e=>setAiChatInput(e.target.value)} onKeyDown={e=>{ if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();handleAiChat();} }} placeholder="Pergunte sobre suas finanças..." style={{ flex:1, fontSize:13 }}/>
              <button className="btn" onClick={handleAiChat} disabled={aiChatLoading||!aiChatInput.trim()} style={{ whiteSpace:"nowrap", padding:"12px 14px" }}>➤</button>
            </div>
          </div>

          {/* Full analysis */}
          <div className="card" style={{ padding:18 }}>
            <div style={{ fontSize:14, fontWeight:700, marginBottom:4 }}>📊 Análise Completa do Mês</div>
            <div style={{ fontSize:12, color:T.sub, marginBottom:14 }}>Relatório detalhado de {MONTHS[filterMonth]}/{filterYear}</div>
            <button className="btn" onClick={handleAnalysis} disabled={analysisLoading||transactions.length===0} style={{ width:"100%", marginBottom:analysisLoading||analysis?14:0 }}>
              {analysisLoading?<><span className="sp">⟳</span> Gerando relatório...</>:"🔍 Gerar Análise Financeira"}
            </button>
            {transactions.length===0&&<div style={{ fontSize:11, color:T.sub, textAlign:"center", marginTop:8 }}>Adicione transações primeiro</div>}
            {analysis && (
              <div className="fi" style={{ fontSize:13, color:T.text, lineHeight:1.8, whiteSpace:"pre-line", background:T.inp, borderRadius:12, padding:16 }}>
                {analysis}
              </div>
            )}
          </div>
        </div>}

        {/* ── BACKUP ───────────────────────────────────────────────────────── */}
        {tab==="backup" && <div className="fi">
          <div style={{ fontSize:16, fontWeight:700, marginBottom:16 }}>⚙️ Configurações & Backup</div>

          <div className="card" style={{ padding:18, marginBottom:14 }}>
            <div style={{ fontSize:14, fontWeight:600, marginBottom:4 }}>📲 Instalar no iPhone</div>
            <div style={{ fontSize:12, color:T.sub, marginBottom:14 }}>Para usar como app nativo na tela inicial do iOS:</div>
            {[
              ["1", "Abra este app no Safari (não Chrome)"],
              ["2", 'Toque no ícone de compartilhar (□↑) na barra inferior'],
              ["3", 'Role e toque em "Adicionar à Tela de Início"'],
              ["4", 'Toque em "Adicionar" — pronto!'],
            ].map(([n, text]) => (
              <div key={n} style={{ display:"flex", gap:12, marginBottom:10, alignItems:"flex-start" }}>
                <div style={{ width:24, height:24, borderRadius:"50%", background:"#7c3aed22", border:"1px solid #7c3aed", display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:700, color:"#7c3aed", flexShrink:0 }}>{n}</div>
                <div style={{ fontSize:13, color:T.text, paddingTop:3 }}>{text}</div>
              </div>
            ))}
            <div style={{ fontSize:11, color:T.sub, background:T.inp, borderRadius:10, padding:"10px 12px", marginTop:4 }}>
              💡 Após instalar, o app abre em tela cheia sem barra do Safari, igual a um app nativo.
            </div>
          </div>

          <div className="card" style={{ padding:18, marginBottom:14 }}>
            <div style={{ fontSize:14, fontWeight:600, marginBottom:4 }}>💾 Backup de dados</div>
            <div style={{ fontSize:12, color:T.sub, marginBottom:14 }}>Exporte todos seus dados para um arquivo JSON seguro.</div>
            <button className="btn" onClick={handleExport} style={{ width:"100%", marginBottom:12 }}>⬇ Exportar backup</button>
            <button className="btn-g" onClick={()=>backupRef.current?.click()} style={{ width:"100%" }}>⬆ Restaurar backup</button>
            <input ref={backupRef} type="file" accept="application/json" style={{ display:"none" }} onChange={handleImportBackup}/>
            {importMsg==="ok"&&<div className="fi" style={{ textAlign:"center", fontSize:13, color:"#10b981", marginTop:10 }}>✅ Dados restaurados com sucesso!</div>}
            {importMsg==="err"&&<div className="fi" style={{ textAlign:"center", fontSize:13, color:"#ef4444", marginTop:10 }}>❌ Erro ao importar. Verifique o arquivo.</div>}
          </div>

          <div className="card" style={{ padding:18, marginBottom:14 }}>
            <div style={{ fontSize:14, fontWeight:600, marginBottom:14 }}>📊 Resumo dos dados</div>
            {[["Transações",transactions.length],["Dias Uber",rides.length],["Cartões",cards.length],["Contas fixas",fixedBills.length],["Metas",goals.length],["Cobranças",charges.length],["Parcelamentos",debts.length]].map(([label,val])=>(
              <div key={label} style={{ display:"flex", justifyContent:"space-between", padding:"8px 0", borderBottom:`1px solid ${T.border}` }}>
                <span style={{ fontSize:13, color:T.sub }}>{label}</span>
                <span style={{ fontSize:13, fontWeight:600, fontFamily:"'DM Mono',monospace" }}>{val}</span>
              </div>
            ))}
          </div>

          <div className="card" style={{ padding:18, marginBottom:14 }}>
            <div style={{ fontSize:14, fontWeight:600, marginBottom:4 }}>🎨 Aparência</div>
            <div style={{ fontSize:12, color:T.sub, marginBottom:14 }}>Tema atual: {darkMode?"Dark":"Light"}</div>
            <button className="btn-g" onClick={()=>setDarkMode(d=>!d)} style={{ width:"100%" }}>{darkMode?"☀️ Mudar para tema claro":"🌙 Mudar para tema escuro"}</button>
          </div>

          <div className="card" style={{ padding:18 }}>
            <div style={{ fontSize:14, fontWeight:600, marginBottom:4, color:"#ef4444" }}>🗑 Limpar dados</div>
            <div style={{ fontSize:12, color:T.sub, marginBottom:14 }}>Esta ação não pode ser desfeita. Faça um backup antes.</div>
            <button onClick={()=>{ if(window.confirm("Tem certeza? Todos os dados serão apagados.")){setTransactions([]);setRides([]);setCards([]);setDebts([]);setCharges([]);setFixedBills([]);setGoals([]);setCatGoals({}); }}} style={{ width:"100%", background:"none", border:"1px solid #ef4444", borderRadius:12, padding:"12px", color:"#ef4444", fontSize:13, cursor:"pointer", fontFamily:"'DM Sans',sans-serif", fontWeight:600 }}>
              🗑 Limpar todos os dados
            </button>
          </div>
        </div>}

      </div>

      {/* ── BOTTOM NAVIGATION ─────────────────────────────────────────────── */}
      <div style={{ position:"fixed", bottom:0, left:0, right:0, background:darkMode?"rgba(10,10,18,.95)":"rgba(248,248,255,.95)", borderTop:`1px solid ${T.border}`, backdropFilter:"blur(12px)", WebkitBackdropFilter:"blur(12px)", paddingBottom:"env(safe-area-inset-bottom,0px)", zIndex:100 }}>
        <div style={{ display:"flex", justifyContent:"space-around", padding:"6px 4px", maxWidth:520, margin:"0 auto", overflowX:"auto" }}>
          {[
            ["dashboard","📊","Início"],["add","➕","Lançar"],["cards","💳","Cartões"],
            ["fixed","📋","Fixas"],["goals","🎯","Metas"],["uber","🚗","Uber"],
            ["invoice","📥","Importar"],["history","🕐","Histórico"],["charges","💸","Cobranças"],
            ["ai","🤖","IA"],["backup","⚙️","Config"],
          ].map(([key,icon,label])=>(
            <button key={key} className={`nav-tab ${tab===key?"active":""}`} onClick={()=>setTab(key)} style={{ position:"relative" }}>
              <span className="icon">{icon}</span>
              <span className="label" style={{ color:tab===key?"#7c3aed":T.sub }}>{label}</span>
              {key==="backup"&&notifications.length>0&&<Badge count={notifications.length}/>}
            </button>
          ))}
        </div>
      </div>

      {/* ── MODALS ────────────────────────────────────────────────────────── */}

      {/* Edit transaction */}
      {editTx && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.75)", display:"flex", alignItems:"flex-end", zIndex:200 }} onClick={()=>setEditTx(null)}>
          <div className="card fi" style={{ width:"100%", maxWidth:520, margin:"0 auto", borderRadius:"20px 20px 0 0", padding:24 }} onClick={e=>e.stopPropagation()}>
            <div style={{ fontSize:15, fontWeight:700, marginBottom:18 }}>✏️ Editar Lançamento</div>
            <div style={{ fontSize:12, color:T.sub, marginBottom:6 }}>Descrição</div>
            <input className="inp" value={editTx.description} onChange={e=>setEditTx(t=>({...t,description:e.target.value}))} style={{ marginBottom:14 }}/>
            <div style={{ fontSize:12, color:T.sub, marginBottom:6 }}>Valor (R$)</div>
            <input className="inp" type="number" value={editTx.amount} onChange={e=>setEditTx(t=>({...t,amount:parseFloat(e.target.value)||0}))} style={{ marginBottom:14, fontFamily:"'DM Mono',monospace", fontSize:18 }}/>
            <div style={{ fontSize:12, color:T.sub, marginBottom:6 }}>Categoria</div>
            <select value={editTx.category} onChange={e=>setEditTx(t=>({...t,category:e.target.value}))} style={{ marginBottom:14 }}>
              {Object.entries(allCategories).map(([k,c])=><option key={k} value={k}>{c.emoji} {c.label}</option>)}
            </select>
            <div style={{ fontSize:12, color:T.sub, marginBottom:6 }}>Data</div>
            <input className="inp" type="date" value={editTx.date?.slice(0,10)} onChange={e=>setEditTx(t=>({...t,date:new Date(e.target.value+"T12:00:00").toISOString()}))} style={{ marginBottom:20 }}/>
            <div style={{ display:"flex", gap:8 }}>
              <button className="btn-g" onClick={()=>setEditTx(null)} style={{ flex:1 }}>Cancelar</button>
              <button className="btn" onClick={saveEditTx} style={{ flex:2 }}>✅ Salvar alterações</button>
            </div>
          </div>
        </div>
      )}

      {/* Card modal */}
      {showCardModal && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.75)", display:"flex", alignItems:"flex-end", zIndex:200 }} onClick={()=>{ setShowCardModal(false); setEditingCardId(null); }}>
          <div className="card fi" style={{ width:"100%", maxWidth:520, margin:"0 auto", borderRadius:"20px 20px 0 0", padding:24, maxHeight:"85vh", overflowY:"auto" }} onClick={e=>e.stopPropagation()}>
            <div style={{ fontSize:15, fontWeight:700, marginBottom:18 }}>{editingCardId?"✏️ Editar Cartão":"💳 Novo Cartão"}</div>

            <div style={{ fontSize:12, color:T.sub, marginBottom:6 }}>Nome do cartão</div>
            <input className="inp" value={cardName} onChange={e=>setCardName(e.target.value)} placeholder="Ex: Nubank, Itaú Platinum..." style={{ marginBottom:14 }} onKeyDown={e=>{if(e.key==="Enter")saveCard();}}/>

            <div style={{ fontSize:12, color:T.sub, marginBottom:6 }}>Limite (R$)</div>
            <input className="inp" value={cardLimit} onChange={e=>setCardLimit(e.target.value.replace(/[^0-9,.]/g,""))} placeholder="Opcional" inputMode="decimal" style={{ marginBottom:14, fontFamily:"'DM Mono',monospace" }}/>

            <div style={{ fontSize:12, color:T.sub, marginBottom:8 }}>Bandeira</div>
            <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:16 }}>
              {Object.entries(CARD_BRANDS).map(([key,label])=>(
                <button key={key} onClick={()=>setCardBrand(key)} style={{ background:cardBrand===key?"#2a2a48":T.inp, border:`1px solid ${cardBrand===key?"#7c3aed":T.inpBorder}`, borderRadius:8, padding:"6px 12px", fontSize:12, cursor:"pointer", color:cardBrand===key?T.text:T.sub, fontFamily:"'DM Sans',sans-serif" }}>{label}</button>
              ))}
            </div>

            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:16 }}>
              <div>
                <div style={{ fontSize:12, color:T.sub, marginBottom:6 }}>Dia de fechamento</div>
                <input className="inp" type="number" min="1" max="31" value={cardClosingDay} onChange={e=>setCardClosingDay(Math.min(31,Math.max(1,parseInt(e.target.value)||1)))} style={{ fontFamily:"'DM Mono',monospace", fontSize:18, textAlign:"center" }}/>
              </div>
              <div>
                <div style={{ fontSize:12, color:T.sub, marginBottom:6 }}>Dia de vencimento</div>
                <input className="inp" type="number" min="1" max="31" value={cardDueDay} onChange={e=>setCardDueDay(Math.min(31,Math.max(1,parseInt(e.target.value)||1)))} style={{ fontFamily:"'DM Mono',monospace", fontSize:18, textAlign:"center" }}/>
              </div>
            </div>

            <div style={{ fontSize:12, color:T.sub, marginBottom:8 }}>Cor</div>
            <div style={{ display:"flex", gap:8, marginBottom:20 }}>
              {CARD_COLORS.map(c=>(
                <button key={c} onClick={()=>setCardColor(c)} style={{ width:28, height:28, borderRadius:"50%", background:c, border:`3px solid ${cardColor===c?"white":"transparent"}`, cursor:"pointer", transition:"all .15s", outline:"none", boxShadow:cardColor===c?"0 0 0 1px "+c:""}}/>
              ))}
            </div>

            {/* Preview */}
            <div style={{ background:`linear-gradient(135deg,${cardColor},${cardColor}99)`, borderRadius:14, padding:"18px 20px", marginBottom:20 }}>
              <div style={{ fontSize:11, color:"rgba(255,255,255,.6)", marginBottom:4 }}>{CARD_BRANDS[cardBrand]||cardBrand}</div>
              <div style={{ fontSize:17, fontWeight:700, color:"white" }}>{cardName||"Meu Cartão"}</div>
              {cardLimit && <div style={{ fontSize:12, color:"rgba(255,255,255,.8)", marginTop:8 }}>Limite: {fmt(parseFloat(cardLimit)||0)}</div>}
              <div style={{ display:"flex", gap:16, marginTop:10 }}>
                <div><div style={{ fontSize:9, color:"rgba(255,255,255,.5)" }}>FECHA</div><div style={{ fontSize:12, fontWeight:600, color:"white" }}>dia {cardClosingDay}</div></div>
                <div><div style={{ fontSize:9, color:"rgba(255,255,255,.5)" }}>VENCE</div><div style={{ fontSize:12, fontWeight:600, color:"white" }}>dia {cardDueDay}</div></div>
              </div>
            </div>

            {!editingCardId && cards.length > 0 && (
              <div style={{ marginBottom:16 }}>
                <div style={{ fontSize:12, color:T.sub, marginBottom:8 }}>Cartões cadastrados</div>
                {cards.map(c=>(
                  <div key={c.id} style={{ display:"flex", alignItems:"center", gap:10, background:T.inp, borderRadius:8, padding:"8px 12px", marginBottom:6 }}>
                    <span style={{ width:10, height:10, borderRadius:"50%", background:c.color, flexShrink:0 }}/>
                    <span style={{ fontSize:13, flex:1 }}>{c.name}</span>
                    <span style={{ fontSize:11, color:T.sub }}>fecha {c.closingDay||15} · vence {c.dueDay||25}</span>
                    <button onClick={()=>openEditCard(c)} style={{ background:"none", border:"none", color:T.sub, cursor:"pointer", fontSize:12 }}>✏️</button>
                    <button className="del" onClick={()=>deleteCard(c.id)}>✕</button>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display:"flex", gap:8 }}>
              <button className="btn-g" onClick={()=>{ setShowCardModal(false); setEditingCardId(null); }} style={{ flex:1 }}>Cancelar</button>
              <button className="btn" onClick={saveCard} disabled={!cardName.trim()} style={{ flex:2 }}>✅ {editingCardId?"Salvar alterações":"Salvar Cartão"}</button>
            </div>
          </div>
        </div>
      )}

      {/* New category modal */}
      {showNewCat && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.75)", display:"flex", alignItems:"flex-end", zIndex:200 }} onClick={()=>setShowNewCat(false)}>
          <div className="card fi" style={{ width:"100%", maxWidth:520, margin:"0 auto", borderRadius:"20px 20px 0 0", padding:24 }} onClick={e=>e.stopPropagation()}>
            <div style={{ fontSize:15, fontWeight:700, marginBottom:18 }}>🏷️ Nova Categoria</div>
            <div style={{ fontSize:12, color:T.sub, marginBottom:6 }}>Nome</div>
            <input className="inp" value={newCatName} onChange={e=>setNewCatName(e.target.value)} placeholder="Ex: Pet, Academia, Farmácia..." style={{ marginBottom:14 }} onKeyDown={e=>{if(e.key==="Enter")saveNewCategory();}}/>
            <div style={{ fontSize:12, color:T.sub, marginBottom:8 }}>Emoji</div>
            <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:20 }}>
              <div style={{ fontSize:36, width:52, height:52, background:T.inp, border:`1px solid ${T.inpBorder}`, borderRadius:12, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>{newCatEmoji||"🏷️"}</div>
              <input className="inp" value={newCatEmoji} onChange={e=>setNewCatEmoji(e.target.value)} placeholder="Cole um emoji 😊" style={{ fontSize:22, textAlign:"center", letterSpacing:4 }} maxLength={4}/>
            </div>
            {Object.keys(customCategories).length > 0 && (
              <>
                <div style={{ fontSize:12, color:T.sub, marginBottom:8 }}>Categorias criadas</div>
                <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:16 }}>
                  {Object.entries(customCategories).map(([key,cat])=>(
                    <div key={key} style={{ display:"flex", alignItems:"center", gap:4, background:T.inp, border:`1px solid ${T.inpBorder}`, borderRadius:8, padding:"5px 10px" }}>
                      <span style={{ fontSize:13 }}>{cat.emoji} {cat.label}</span>
                      <button onClick={()=>deleteCustomCategory(key)} style={{ background:"none", border:"none", color:T.sub, cursor:"pointer", fontSize:13 }}>✕</button>
                    </div>
                  ))}
                </div>
              </>
            )}
            <div style={{ display:"flex", gap:8 }}>
              <button className="btn-g" onClick={()=>setShowNewCat(false)} style={{ flex:1 }}>Cancelar</button>
              <button className="btn" onClick={saveNewCategory} disabled={!newCatName.trim()} style={{ flex:2 }}>✅ Criar Categoria</button>
            </div>
          </div>
        </div>
      )}

      {/* Profile modal */}
      {showProfile && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.75)", display:"flex", alignItems:"flex-end", zIndex:200 }} onClick={()=>setShowProfile(false)}>
          <div className="card fi" style={{ width:"100%", maxWidth:520, margin:"0 auto", borderRadius:"20px 20px 0 0", padding:24 }} onClick={e=>e.stopPropagation()}>
            <div style={{ fontSize:15, fontWeight:700, marginBottom:18 }}>👤 Perfil</div>
            <div style={{ textAlign:"center", marginBottom:20 }}>
              <div style={{ fontSize:56, marginBottom:8 }}>{profileAvatar}</div>
              <div style={{ display:"flex", gap:8, justifyContent:"center", flexWrap:"wrap" }}>
                {["💰","🏦","💎","🚀","🎯","🌟","💼","🏠","🚗","🍀"].map(e=>(
                  <button key={e} onClick={()=>setProfileAvatar(e)} style={{ background:profileAvatar===e?"#7c3aed22":T.inp, border:`1px solid ${profileAvatar===e?"#7c3aed":T.inpBorder}`, borderRadius:8, padding:"6px", fontSize:22, cursor:"pointer" }}>{e}</button>
                ))}
              </div>
            </div>
            <div style={{ fontSize:12, color:T.sub, marginBottom:6 }}>Seu nome</div>
            <input className="inp" value={profileName} onChange={e=>setProfileName(e.target.value)} placeholder="Como quer ser chamado?" style={{ marginBottom:20 }}/>
            <div style={{ display:"flex", gap:8 }}>
              <button className="btn-g" onClick={()=>setShowProfile(false)} style={{ flex:1 }}>Cancelar</button>
              <button className="btn" onClick={()=>{ setProfile(p=>({...p,name:profileName,avatar:profileAvatar})); setShowProfile(false); }} style={{ flex:2 }}>✅ Salvar perfil</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
