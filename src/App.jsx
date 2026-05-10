import { useState, useEffect, useCallback, useMemo, useRef, Fragment } from "react";
import { createPortal } from "react-dom";
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, CartesianGrid, Legend } from "recharts";

// ─── SUPABASE CONFIG ──────────────────────────────────────────────────────────
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "";

// Access token lives only in memory — never persisted to localStorage in production.
// In dev, localStorage is used for convenience (no Vercel API routes available).
let _authToken = import.meta.env.DEV ? (localStorage.getItem("sb_token") || null) : null;
let _refreshToken = import.meta.env.DEV ? (localStorage.getItem("sb_refresh") || null) : null;

function setAuthToken(token, refreshToken = null) {
  _authToken = token;
  if (import.meta.env.DEV) {
    // Dev: persist to localStorage for convenience
    if (token) localStorage.setItem("sb_token", token);
    else localStorage.removeItem("sb_token");
    if (refreshToken) {
      _refreshToken = refreshToken;
      localStorage.setItem("sb_refresh", refreshToken);
    } else if (!token) {
      _refreshToken = null;
      localStorage.removeItem("sb_refresh");
    }
  }
  // Production: tokens stay in memory only; refresh token is in HttpOnly cookie (set by /api/auth/*)
}

// Silently refresh the access token
async function refreshAccessToken() {
  if (import.meta.env.DEV) {
    // Dev: use localStorage refresh token directly
    const rt = _refreshToken || localStorage.getItem("sb_refresh");
    if (!rt) return false;
    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
        method: "POST",
        headers: { "apikey": SUPABASE_ANON_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: rt }),
      });
      if (!res.ok) return false;
      const data = await res.json();
      if (!data.access_token) return false;
      setAuthToken(data.access_token, data.refresh_token);
      return true;
    } catch { return false; }
  }
  // Production: HttpOnly cookie is sent automatically by the browser
  try {
    const res = await fetch("/api/auth/refresh", { method: "POST" });
    if (!res.ok) return false;
    const data = await res.json();
    if (!data.access_token) return false;
    _authToken = data.access_token;
    return true;
  } catch { return false; }
}

async function supabaseFetch(path, options = {}, _retry = true) {
  const token = _authToken;
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...options,
    headers: {
      "apikey": SUPABASE_ANON_KEY,
      "Authorization": `Bearer ${token || SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
      "Prefer": "return=representation",
      ...(options.headers || {}),
    },
  });
  // Token expired — try to refresh once and retry the request
  if (res.status === 401 && _retry) {
    const refreshed = await refreshAccessToken();
    if (refreshed) return supabaseFetch(path, options, false);
    // Refresh failed — token truly invalid, trigger re-login
    setAuthToken(null);
    window.dispatchEvent(new CustomEvent("sb-session-expired"));
    throw new Error("Sessão expirada. Por favor, faça login novamente.");
  }
  if (!res.ok && res.status !== 204) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `HTTP ${res.status}`);
  }
  if (res.status === 204) return null;
  const text = await res.text();
  if (!text || text.trim() === "") return null;
  try { return JSON.parse(text); } catch { return null; }
}

async function supabaseAuth(action, email, password) {
  if (import.meta.env.DEV) {
    // Dev: call Supabase directly (Vercel API routes not available in dev server)
    const res = await fetch(`${SUPABASE_URL}/auth/v1/${action}`, {
      method: "POST",
      headers: { "apikey": SUPABASE_ANON_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error_description || data.error);
    return data;
  }
  // Production: proxy through Vercel API route, which sets the HttpOnly cookie
  const endpoint = action.startsWith("token") ? "/api/auth/login" : "/api/auth/signup";
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ─── FAMILY HELPERS (via Supabase RPC — bypasses RLS safely) ─────────────────
function genCode() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => chars[b % chars.length]).join("");
}

async function supabaseRpc(fn, params = {}) {
  const token = _authToken;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      "apikey": SUPABASE_ANON_KEY,
      "Authorization": `Bearer ${token || SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || err.hint || `RPC error ${res.status}`);
  }
  return res.json();
}

async function getOrCreateFamily(userId) {
  const data = await supabaseRpc("get_my_family");
  return data || null;
}

async function createFamily(userId, familyName) {
  const data = await supabaseRpc("create_family_for_user", {
    p_user_id: userId,
    p_family_name: familyName,
    p_invite_code: genCode(),
  });
  return data;
}

async function joinFamily(userId, inviteCode) {
  const data = await supabaseRpc("join_family_by_code", {
    p_user_id: userId,
    p_invite_code: inviteCode.toUpperCase(),
  });
  return data;
}

async function regenerateInviteCode(familyId) {
  const code = genCode();
  await supabaseRpc("regenerate_invite_code", {
    p_family_id: familyId,
    p_new_code: code,
  });
  return code;
}

// ─── THEME ────────────────────────────────────────────────────────────────────
const themes = {
  dark: {
    bg: "#0a0a0f",
    surface: "rgba(255,255,255,0.04)",
    surfaceHover: "rgba(255,255,255,0.07)",
    glass: "#16151f",
    glassModal: "#1c1a2e",
    glassBorder: "rgba(255,255,255,0.10)",
    text: "#f0f0f5",
    textMuted: "rgba(240,240,245,0.45)",
    textSecondary: "rgba(240,240,245,0.65)",
    accent: "#7c6af7",
    accentGlow: "rgba(124,106,247,0.35)",
    accentSoft: "rgba(124,106,247,0.18)",
    success: "#34d399",
    successSoft: "rgba(52,211,153,0.15)",
    danger: "#f87171",
    dangerSoft: "rgba(248,113,113,0.15)",
    warning: "#fbbf24",
    warningSoft: "rgba(251,191,36,0.12)",
    border: "rgba(255,255,255,0.08)",
    shadow: "0 20px 60px rgba(0,0,0,0.8)",
    shadowSm: "0 2px 12px rgba(0,0,0,0.4)",
    inputBg: "rgba(255,255,255,0.07)",
    tooltipBg: "#1e1c2e",
    chartColors: ["#7c6af7","#34d399","#f87171","#fbbf24","#60a5fa","#f472b6","#a78bfa","#4ade80"],
    chartCursorFill: "rgba(124,106,247,0.08)",
    innerGlow: "inset 0 1px 0 rgba(255,255,255,0.07)",
  },
  light: {
    bg: "#f4f3ff",
    surface: "rgba(255,255,255,0.7)",
    surfaceHover: "rgba(255,255,255,0.9)",
    glass: "rgba(255,255,255,0.55)",
    glassModal: "rgba(255,255,255,0.97)",
    glassBorder: "rgba(124,106,247,0.15)",
    text: "#1a1830",
    textMuted: "rgba(26,24,48,0.4)",
    textSecondary: "rgba(26,24,48,0.6)",
    accent: "#6c5ce7",
    accentGlow: "rgba(108,92,231,0.25)",
    accentSoft: "rgba(108,92,231,0.10)",
    success: "#059669",
    successSoft: "rgba(5,150,105,0.10)",
    danger: "#dc2626",
    dangerSoft: "rgba(220,38,38,0.10)",
    warning: "#d97706",
    warningSoft: "rgba(217,119,6,0.10)",
    border: "rgba(124,106,247,0.12)",
    shadow: "0 20px 60px rgba(108,92,231,0.18)",
    shadowSm: "0 2px 12px rgba(108,92,231,0.08)",
    inputBg: "rgba(255,255,255,0.9)",
    tooltipBg: "#ffffff",
    chartColors: ["#6c5ce7","#059669","#dc2626","#d97706","#2563eb","#db2777","#7c3aed","#16a34a"],
    chartCursorFill: "rgba(108,92,231,0.06)",
    innerGlow: "inset 0 1px 0 rgba(255,255,255,0.8)",
  },
};

// ─── ICON SYSTEM ──────────────────────────────────────────────────────────────
const ICON_PATHS = {
  home:         ["M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z","M9 22V12h6v10"],
  calendar:     "M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z",
  chart:        "M18 20V10M12 20V4M6 20v-6",
  pieChart:     ["M21.21 15.89A10 10 0 118 2.83","M22 12A10 10 0 0012 2v10z"],
  list:         "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  target:       ["M12 22a10 10 0 100-20 10 10 0 000 20z","M12 18a6 6 0 100-12 6 6 0 000 12z","M12 14a2 2 0 100-4 2 2 0 000 4z"],
  repeat:       ["M17 1l4 4-4 4","M3 11V9a4 4 0 014-4h14","M7 23l-4-4 4-4","M21 13v2a4 4 0 01-4 4H3"],
  upload:       ["M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4","M17 8l-5-5-5 5","M12 3v12"],
  download:     ["M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4","M7 10l5 5 5-5","M12 15V3"],
  plus:         "M12 5v14M5 12h14",
  minus:        "M5 12h14",
  more:         ["M12 13a1 1 0 100-2 1 1 0 000 2z","M19 13a1 1 0 100-2 1 1 0 000 2z","M5 13a1 1 0 100-2 1 1 0 000 2z"],
  search:       "M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z",
  x:            "M18 6L6 18M6 6l12 12",
  trash:        ["M3 6h18","M8 6V4h8v2","M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"],
  edit:         ["M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7","M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"],
  check:        "M20 6L9 17l-5-5",
  filter:       "M22 3H2l8 9.46V19l4 2v-8.54L22 3z",
  sun:          ["M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42","M12 17a5 5 0 100-10 5 5 0 000 10z"],
  moon:         "M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z",
  user:         ["M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2","M12 11a4 4 0 100-8 4 4 0 000 8z"],
  users:        ["M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2","M9 11a4 4 0 100-8 4 4 0 000 8z","M23 21v-2a4 4 0 00-3-3.87","M16 3.13a4 4 0 010 7.75"],
  card:         ["M1 4h22v16H1z","M1 10h22"],
  logout:       ["M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4","M16 17l5-5-5-5","M21 12H9"],
  chevronLeft:  "M15 18l-6-6 6-6",
  chevronRight: "M9 18l6-6-6-6",
  chevronDown:  "M6 9l6 6 6-6",
  arrowUp:      ["M12 19V5","M5 12l7-7 7 7"],
  arrowDown:    ["M12 5v14","M19 12l-7 7-7-7"],
  wallet:       ["M21 12V7H5a2 2 0 010-4h14v4","M3 5v14a2 2 0 002 2h16v-5","M21 12a2 2 0 000 4h0"],
  bell:         ["M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9","M13.73 21a2 2 0 01-3.46 0"],
  menuLines:    "M3 12h18M3 6h18M3 18h18",
};

function Icon({ name, size = 20, color = "currentColor", style: extraStyle }) {
  const d = ICON_PATHS[name];
  if (!d) return null;
  const paths = Array.isArray(d) ? d : [d];
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
      style={{ display:"inline-block", flexShrink:0, verticalAlign:"middle", ...extraStyle }}>
      {paths.map((p, i) => <path key={i} d={p} />)}
    </svg>
  );
}

const CATEGORIES = [
  { id: "alimentacao", label: "Alimentação", emoji: "🍽️" },
  { id: "supermercado", label: "Supermercado", emoji: "🛒" },
  { id: "moradia", label: "Moradia", emoji: "🏠" },
  { id: "transporte", label: "Transporte", emoji: "🚗" },
  { id: "saude", label: "Saúde", emoji: "💊" },
  { id: "farmacia", label: "Farmácia", emoji: "💉" },
  { id: "filho", label: "Filho", emoji: "👶" },
  { id: "educacao", label: "Educação", emoji: "📚" },
  { id: "beleza", label: "Beleza", emoji: "💅" },
  { id: "vestuario", label: "Vestuário", emoji: "👕" },
  { id: "lazer", label: "Lazer", emoji: "🎬" },
  { id: "assinaturas", label: "Assinaturas", emoji: "📱" },
  { id: "presentes", label: "Presentes", emoji: "🎁" },
  { id: "tecnologia", label: "Tecnologia", emoji: "💻" },
  { id: "outros", label: "Outros", emoji: "📦" },
];

const INCOME_SOURCES = [
  { id: "salario", label: "Salário", emoji: "💼" },
  { id: "freelance", label: "Freelance", emoji: "💡" },
  { id: "investimento", label: "Investimento", emoji: "📈" },
  { id: "aluguel", label: "Aluguel", emoji: "🏘️" },
  { id: "outros", label: "Outros", emoji: "💰" },
];

const MONTHS = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
const MONTH_FULL = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];

function autoCategory(description) {
  const d = description.toLowerCase();
  if (/ifood|restaurante|lanche|pizza|burger|sushi|café|padaria|mercado|supermercado|extra|pão de açúcar|carrefour/.test(d)) return "alimentacao";
  if (/uber|99|combustível|gasolina|ônibus|metro|estacionamento|pedágio|posto/.test(d)) return "transporte";
  if (/aluguel|condomínio|luz|água|internet|energia|gas/.test(d)) return "moradia";
  if (/farmácia|médico|hospital|plano de saúde|consulta|exame/.test(d)) return "saude";
  if (/netflix|spotify|cinema|show|teatro|jogo|game|amazon prime/.test(d)) return "lazer";
  if (/roupa|calçado|tênis|camisa|zara|renner|c&a/.test(d)) return "vestuario";
  if (/escola|faculdade|curso|livro|udemy/.test(d)) return "educacao";
  if (/apple|samsung|amazon|shopee|notebook|celular/.test(d)) return "tecnologia";
  if (/mercado|supermercado|atacadão/.test(d)) return "supermercado";
  return "outros";
}

// ─── BILLING MONTH UTILITY ───────────────────────────────────────────────────
// Primário: busca período exato na tabela billing_periods (period_start ≤ dateStr ≤ period_end)
// Fallback: dia > closingDay → próximo mês de fechamento → +1 mês de vencimento (padrão BR)
// PIX e Débito: NUNCA passam por esta função — usar sempre e.date original
function getBillingMonth(dateStr, billingPeriods = [], closingDay = 28) {
  if (!dateStr) return null;
  if (billingPeriods.length > 0) {
    const period = billingPeriods.find(p => dateStr >= p.period_start && dateStr <= p.period_end);
    if (period) return { month: period.fatura_month, year: period.fatura_year, fromPeriod: true };
  }
  const d = new Date(dateStr + "T12:00:00");
  const day = d.getDate(), month = d.getMonth() + 1, year = d.getFullYear();
  let closeMonth = month, closeYear = year;
  if (day > closingDay) {
    closeMonth = month === 12 ? 1 : month + 1;
    closeYear  = month === 12 ? year + 1 : year;
  }
  const dueMonth = closeMonth === 12 ? 1 : closeMonth + 1;
  const dueYear  = closeMonth === 12 ? closeYear + 1 : closeYear;
  return { month: dueMonth, year: dueYear, fromPeriod: false };
}

// ─── DEMO DATA ────────────────────────────────────────────────────────────────
const today = new Date();
const y = today.getFullYear();
const m = today.getMonth();

function makeDemoData() {
  const expenses = [], incomes = [];
  let id = 1;
  const tpl = [
    { desc: "iFood - Jantar", cat: "alimentacao", type: "pix", amount: 45.90 },
    { desc: "Uber", cat: "transporte", type: "credito", amount: 28.50, parcelas: 1 },
    { desc: "Netflix", cat: "lazer", type: "credito", amount: 39.90, parcelas: 1 },
    { desc: "Supermercado Extra", cat: "supermercado", type: "debito", amount: 312.00 },
    { desc: "Farmácia", cat: "saude", type: "debito", amount: 67.80 },
    { desc: "Conta de Luz", cat: "moradia", type: "debito", amount: 180.00 },
    { desc: "Aluguel", cat: "moradia", type: "pix", amount: 1800.00 },
    { desc: "Curso Udemy", cat: "educacao", type: "credito", amount: 89.90, parcelas: 1 },
    { desc: "Restaurante", cat: "alimentacao", type: "credito", amount: 156.00, parcelas: 1 },
    { desc: "Gasolina", cat: "transporte", type: "debito", amount: 220.00 },
    { desc: "Shopee - Roupas", cat: "vestuario", type: "credito", amount: 245.00, parcelas: 3 },
    { desc: "Spotify", cat: "lazer", type: "credito", amount: 21.90, parcelas: 1 },
    { desc: "Médico", cat: "saude", type: "pix", amount: 300.00 },
    { desc: "Internet", cat: "moradia", type: "debito", amount: 120.00 },
    { desc: "Notebook Apple", cat: "tecnologia", type: "credito", amount: 6499.00, parcelas: 12 },
  ];
  for (let mo = -5; mo <= 0; mo++) {
    const d = new Date(y, m + mo, 1);
    const yr = d.getFullYear(), mn = d.getMonth();
    const days = new Date(yr, mn + 1, 0).getDate();
    tpl.forEach((t) => {
      const day = Math.floor(Math.random() * days) + 1;
      expenses.push({ id: id++, description: t.desc, amount: t.amount + (Math.random()-0.5)*20, date: `${yr}-${String(mn+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`, category: t.cat, type: t.type, parcelas: t.parcelas || 1, user_label: Math.random() > 0.5 ? "Você" : "Esposa" });
    });
    incomes.push({ id: id++, description: "Salário", amount: 6500+(Math.random()-0.5)*200, date: `${yr}-${String(mn+1).padStart(2,"0")}-05`, source: "salario", user_label: "Você" });
    incomes.push({ id: id++, description: "Salário", amount: 4800+(Math.random()-0.5)*150, date: `${yr}-${String(mn+1).padStart(2,"0")}-05`, source: "salario", user_label: "Esposa" });
    if (Math.random() > 0.6) incomes.push({ id: id++, description: "Freelance", amount: 800+Math.random()*1200, date: `${yr}-${String(mn+1).padStart(2,"0")}-${Math.floor(Math.random()*28)+1}`, source: "freelance", user_label: "Você" });
  }
  return { expenses, incomes };
}

const DEMO = makeDemoData();
const fmt = (v) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
const fmtShort = (v) => v >= 1000 ? `R$${(v/1000).toFixed(1)}k` : `R$${v.toFixed(0)}`;

// Returns the effective monthly amount for an expense:
// - Credit with 1 installment: full amount
// - Credit with N installments: installment value (amount already stored as installment)
// - Other types: full amount
function monthlyAmount(e) {
  const amt = parseFloat(e.amount) || 0;
  const parcelas = parseInt(e.parcelas) || 1;
  // If credit with multiple parcelas, amount is already the installment value
  // (saved that way since the form fix). For older records saved as total, divide.
  if (e.type === "credito" && parcelas > 1) {
    // Heuristic: if amount looks like it's the total (amount > installAmount hint),
    // we check if parcelas > 1 and amount seems like total by being large
    // Safe: just return amount as-is (new records store installment, old records store total/parcelas)
    return amt;
  }
  return amt;
}

// ─── TOAST ────────────────────────────────────────────────────────────────────
function Toast({ toasts, remove }) {
  return (
    <div style={{ position: "fixed", bottom: 24, right: 24, zIndex: 9999, display: "flex", flexDirection: "column", gap: 10 }}>
      {toasts.map((t) => (
        <div key={t.id} onClick={() => remove(t.id)} style={{
          padding: "12px 20px", borderRadius: 14, cursor: "pointer", fontSize: 14, fontWeight: 500,
          backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
          background: t.type === "success" ? "rgba(52,211,153,0.92)" : t.type === "error" ? "rgba(248,113,113,0.92)" : "rgba(124,106,247,0.92)",
          color: "#fff", boxShadow: "0 4px 20px rgba(0,0,0,0.3)", animation: "slideInRight 0.3s ease",
          display: "flex", alignItems: "center", gap: 8, maxWidth: 320,
        }}>
          {t.type === "success" ? "✓" : t.type === "error" ? "✕" : "ℹ"} {t.message}
        </div>
      ))}
    </div>
  );
}

// ─── MODAL ────────────────────────────────────────────────────────────────────
function Modal({ open, onClose, title, children, t, darkMode, size = 'form', footer, sheetOnMobile = true }) {
  const touchStartY = useRef(null);
  const handleTouchStart = (e) => { touchStartY.current = e.touches[0].clientY; };
  const handleTouchMove = (e) => {
    if (touchStartY.current === null) return;
    const dy = e.touches[0].clientY - touchStartY.current;
    if (dy > 120) { touchStartY.current = null; onClose(); }
  };

  if (!open) return null;
  const maxW = size === 'list' ? 640 : size === 'wide' ? 760 : 480;

  return createPortal(
    <div onClick={(e)=>{ if(e.target===e.currentTarget) onClose(); }} style={{
      position:"fixed", inset:0, zIndex:500,
      background:"rgba(0,0,0,0.65)", backdropFilter:"blur(10px)", WebkitBackdropFilter:"blur(10px)",
      display:"flex",
      alignItems: sheetOnMobile ? undefined : "center",
      justifyContent: sheetOnMobile ? undefined : "center",
      padding: sheetOnMobile ? 0 : 20,
    }}>
      <div
        onTouchStart={sheetOnMobile ? handleTouchStart : undefined}
        onTouchMove={sheetOnMobile ? handleTouchMove : undefined}
        onClick={e=>e.stopPropagation()}
        className={sheetOnMobile ? "modal-sheet" : "modal-centered"}
        style={{
          background: t.glassModal,
          border: `1.5px solid ${t.glassBorder}`,
          backdropFilter: "blur(40px)", WebkitBackdropFilter: "blur(40px)",
          display: "flex", flexDirection: "column",
          boxShadow: `${t.shadow}, ${t.innerGlow}`,
          borderRadius: 24, width: "100%", maxWidth: maxW,
          maxHeight: "90vh",
          animation: "modalIn 0.25s ease",
        }}
      >
        {/* Handle bar (mobile sheet only) */}
        <div className="modal-handle-wrap" style={{ display:"none", justifyContent:"center", padding:"10px 0 0" }}>
          <div style={{ width:36, height:4, borderRadius:2, background:t.border }} />
        </div>
        {/* Header */}
        <div style={{
          display:"flex", justifyContent:"space-between", alignItems:"center",
          height:56, minHeight:56, padding:"0 20px",
          borderBottom:`1px solid ${t.border}`, flexShrink:0,
        }}>
          <h3 style={{ margin:0, color:t.text, fontSize:18, fontWeight:700, letterSpacing:"-0.02em" }}>{title}</h3>
          <button onClick={onClose} style={{
            background:t.surfaceHover, border:`1px solid ${t.border}`, borderRadius:10,
            width:34, height:34, cursor:"pointer", color:t.textSecondary, fontSize:18,
            display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0,
          }}
            onMouseEnter={(e)=>{ e.currentTarget.style.background=t.danger+"22"; e.currentTarget.style.color=t.danger; }}
            onMouseLeave={(e)=>{ e.currentTarget.style.background=t.surfaceHover; e.currentTarget.style.color=t.textSecondary; }}
          ><Icon name="x" size={16} /></button>
        </div>
        {/* Body */}
        <div style={{ padding:"20px", overflowY:"auto", flex:1 }}>
          {children}
        </div>
        {/* Footer */}
        {footer && (
          <div style={{
            padding:"12px 20px", borderTop:`1px solid ${t.border}`,
            display:"flex", gap:10, justifyContent:"flex-end", flexShrink:0,
          }}>
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

// ─── CONFIRM MODAL ────────────────────────────────────────────────────────────
function ConfirmModal({ open, title, message, onConfirm, onCancel, confirmLabel = "Excluir", t }) {
  if (!open) return null;
  return createPortal(
    <div
      onClick={onCancel}
      style={{
        position: "fixed", inset: 0, zIndex: 600,
        background: "rgba(0,0,0,0.72)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "24px 20px",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: t.glassModal, border: `1.5px solid ${t.glassBorder}`,
          backdropFilter: "blur(40px)", WebkitBackdropFilter: "blur(40px)",
          borderRadius: 20, padding: "24px 24px 20px", width: "100%", maxWidth: 320,
          boxShadow: t.shadow, animation: "modalIn 0.2s ease",
        }}
      >
        <div style={{ marginBottom: 12, lineHeight: 1 }}><Icon name="trash" size={28} color={t.danger} /></div>
        <h3 style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 700, color: t.text, letterSpacing: "-0.02em" }}>
          {title}
        </h3>
        <p style={{ margin: "0 0 20px", fontSize: 13, color: t.textSecondary, lineHeight: 1.55 }}>
          {message}
        </p>
        <div style={{ display: "flex", gap: 10 }}>
          <button
            onClick={onCancel}
            style={{
              flex: 1, height: 42, borderRadius: 12, cursor: "pointer",
              border: `1px solid ${t.border}`, background: t.surface,
              color: t.text, fontSize: 14, fontWeight: 600,
            }}
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            style={{
              flex: 1, height: 42, borderRadius: 12, cursor: "pointer",
              border: `1px solid ${t.danger}55`, background: `${t.danger}20`,
              color: t.danger, fontSize: 14, fontWeight: 700,
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ─── INPUT / SELECT / BTN ─────────────────────────────────────────────────────
function Input({ label, t, ...props }) {
  const defaultMaxLength = props.type === "email" ? 254
    : props.type === "password" ? 128
    : props.type === "number" ? undefined
    : 200;
  return (
    <div style={{ marginBottom: 16, minWidth: 0 }}>
      {label && <label style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 600, color: t.textSecondary, letterSpacing: "0.02em", textAlign: "left" }}>{label}</label>}
      <input maxLength={defaultMaxLength} {...props} style={{ width: "100%", maxWidth: "100%", padding: "11px 14px", borderRadius: 12, fontSize: 14, fontFamily: "'DM Sans', sans-serif", background: t.inputBg, border: `1px solid ${t.border}`, color: t.text, outline: "none", transition: "border-color 0.2s", boxSizing: "border-box", minWidth: 0, ...(props.style||{}) }}
        onFocus={(e) => { e.target.style.borderColor = t.accent; }}
        onBlur={(e) => { e.target.style.borderColor = t.border; }}
      />
    </div>
  );
}

// ─── CALENDAR PICKER MODAL ───────────────────────────────────────────────────
function CalendarPickerModal({ value, onChange, onClose, t }) {
  const parseISO = (iso) => {
    if (iso && iso.length >= 10) {
      const [y, m, d] = iso.split("-").map(Number);
      if (y && m && d) return { yr: y, mo: m - 1, day: d };
    }
    return { yr: today.getFullYear(), mo: today.getMonth(), day: null };
  };
  const init = parseISO(value);
  const [viewYr, setViewYr] = useState(init.yr);
  const [viewMo, setViewMo] = useState(init.mo);

  const selParsed = parseISO(value);
  const isSelected = (d) =>
    selParsed.day === d && selParsed.mo === viewMo && selParsed.yr === viewYr;
  const isToday = (d) =>
    today.getFullYear() === viewYr && today.getMonth() === viewMo && today.getDate() === d;

  // Pure arithmetic — no Date objects, no timezone issues
  const firstDayOfWeek = (() => {
    const tbl = [0,3,2,5,0,3,5,1,4,6,2,4];
    let y = viewYr; const m = viewMo + 1;
    if (m < 3) y--;
    return (y + Math.floor(y/4) - Math.floor(y/100) + Math.floor(y/400) + tbl[m-1] + 1) % 7;
  })();
  const daysInMonth = (() => {
    const days = [31,28,31,30,31,30,31,31,30,31,30,31];
    const isLeap = (viewYr % 4 === 0 && viewYr % 100 !== 0) || viewYr % 400 === 0;
    return viewMo === 1 && isLeap ? 29 : days[viewMo];
  })();

  const prevMonth = () => {
    if (viewMo === 0) { setViewYr(y => y - 1); setViewMo(11); }
    else setViewMo(m => m - 1);
  };
  const nextMonth = () => {
    if (viewMo === 11) { setViewYr(y => y + 1); setViewMo(0); }
    else setViewMo(m => m + 1);
  };

  const pickDay = (d) => {
    const iso = `${viewYr}-${String(viewMo+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
    onChange({ target: { value: iso } });
    onClose();
  };

  const days = [];
  for (let d = 1; d <= daysInMonth; d++) days.push(d);

  return (
    <div onClick={e=>{ if(e.target===e.currentTarget) onClose(); }}
      style={{ position:"fixed",inset:0,zIndex:700,background:"rgba(0,0,0,0.55)",backdropFilter:"blur(10px)",display:"flex",alignItems:"center",justifyContent:"center",padding:20 }}>
      <div onClick={e=>e.stopPropagation()}
        style={{ background:t.glassModal,border:`1.5px solid ${t.glassBorder}`,borderRadius:24,padding:"20px 16px 24px",width:"100%",maxWidth:340,boxShadow:t.shadow,animation:"modalIn 0.2s ease" }}>
        {/* Header */}
        <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16 }}>
          <button onClick={prevMonth}
            style={{ background:t.surfaceHover,border:`1px solid ${t.border}`,borderRadius:10,width:34,height:34,cursor:"pointer",color:t.text,fontSize:16,display:"flex",alignItems:"center",justifyContent:"center" }}>‹</button>
          <span style={{ fontWeight:700,fontSize:15,color:t.text }}>{MONTH_FULL[viewMo]} {viewYr}</span>
          <div style={{ display:"flex",gap:6 }}>
            <button onClick={nextMonth}
              style={{ background:t.surfaceHover,border:`1px solid ${t.border}`,borderRadius:10,width:34,height:34,cursor:"pointer",color:t.text,fontSize:16,display:"flex",alignItems:"center",justifyContent:"center" }}>›</button>
            <button onClick={onClose}
              style={{ background:"transparent",border:"none",cursor:"pointer",color:t.textMuted,fontSize:22,lineHeight:1,padding:"4px 6px",borderRadius:8 }}>×</button>
          </div>
        </div>
        {/* Day-of-week headers */}
        <div style={{ display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:4,marginBottom:6 }}>
          {["D","S","T","Q","Q","S","S"].map((d,i)=>(
            <div key={i} style={{ textAlign:"center",fontSize:11,fontWeight:700,color:t.textMuted,padding:"4px 0" }}>{d}</div>
          ))}
        </div>
        {/* Days grid */}
        <div style={{ display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:4 }}>
          {days.map((d, i) => {
            const sel = isSelected(d);
            const tod = isToday(d);
            const gridStyle = d === 1 ? { gridColumn: firstDayOfWeek + 1 } : {};
            return (
              <button key={d} onClick={()=>pickDay(d)}
                style={{ ...gridStyle,borderRadius:10,height:38,border:"none",cursor:"pointer",fontWeight:sel||tod?700:500,fontSize:13,
                  background: sel ? t.accent : tod ? t.accentSoft : "transparent",
                  color: sel ? "#fff" : tod ? t.accent : t.text,
                  transition:"background 0.15s",fontFamily:"'DM Sans',sans-serif" }}
                onMouseEnter={e=>{ if(!sel) e.currentTarget.style.background=t.surfaceHover; }}
                onMouseLeave={e=>{ if(!sel) e.currentTarget.style.background=tod?t.accentSoft:"transparent"; }}>
                {d}
              </button>
            );
          })}
        </div>
        {/* Today shortcut */}
        <div style={{ marginTop:16,textAlign:"center" }}>
          <button onClick={()=>{
            setViewYr(today.getFullYear());
            setViewMo(today.getMonth());
            // pickDay uses viewYr/viewMo from state — use direct values here
            const iso = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`;
            onChange({ target: { value: iso } });
            onClose();
          }}
            style={{ background:"transparent",border:`1px solid ${t.border}`,borderRadius:10,padding:"6px 18px",fontSize:12,color:t.accent,cursor:"pointer",fontWeight:600 }}
            onMouseEnter={e=>e.currentTarget.style.background=t.accentSoft}
            onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
            Hoje
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── DATE INPUT ───────────────────────────────────────────────────────────────
function DateInput({ label, t, value, onChange, placeholder }) {
  const [open, setOpen] = useState(false);

  const toDisplay = (iso) => {
    if (!iso || iso.length < 10) return iso || "";
    const [y, m, d] = iso.split("-");
    return y && m && d ? `${d}/${m}/${y}` : iso;
  };

  return (
    <div style={{ marginBottom:16, minWidth:0 }}>
      {label && <label style={{ display:"block",marginBottom:6,fontSize:13,fontWeight:600,color:t.textSecondary,letterSpacing:"0.02em",textAlign:"left" }}>{label}</label>}
      <div style={{ position:"relative", cursor:"pointer" }} onClick={()=>setOpen(true)}>
        <input type="text" readOnly placeholder={placeholder||"DD/MM/AAAA"}
          value={toDisplay(value)}
          style={{ width:"100%",maxWidth:"100%",padding:"11px 44px 11px 14px",borderRadius:12,fontSize:14,fontFamily:"'DM Sans', sans-serif",background:t.inputBg,border:`1px solid ${t.border}`,color:value?t.text:t.textMuted,outline:"none",boxSizing:"border-box",minWidth:0,cursor:"pointer",caretColor:"transparent" }}
        />
        <span style={{ position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",fontSize:16,pointerEvents:"none",color:t.textMuted }}>📅</span>
      </div>
      {open && createPortal(
        <CalendarPickerModal value={value} t={t}
          onChange={e=>{ onChange(e); setOpen(false); }}
          onClose={()=>setOpen(false)} />,
        document.body
      )}
    </div>
  );
}

function Select({ label, t, children, ...props }) {
  return (
    <div style={{ marginBottom: 16 }}>
      {label && <label style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 600, color: t.textSecondary, letterSpacing: "0.02em", textAlign: "left" }}>{label}</label>}
      <select {...props} style={{ width: "100%", padding: "11px 14px", borderRadius: 12, fontSize: 14, fontFamily: "'DM Sans', sans-serif", background: t.inputBg, border: `1px solid ${t.border}`, color: t.text, outline: "none", cursor: "pointer", boxSizing: "border-box", ...(props.style||{}) }}>
        {children}
      </select>
    </div>
  );
}

function Btn({ children, variant = "primary", t, ...props }) {
  const styles = {
    primary: { background: t.accent, color: "#fff", border: "none", boxShadow: `0 4px 16px ${t.accentGlow}` },
    ghost: { background: t.surfaceHover, color: t.text, border: `1px solid ${t.border}` },
    danger: { background: t.dangerSoft, color: t.danger, border: `1px solid ${t.danger}33` },
    success: { background: t.success, color: "#fff", border: "none", boxShadow: `0 4px 16px ${t.success}44` },
  };
  return (
    <button {...props} style={{ padding: "12px 22px", borderRadius: 12, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans', sans-serif", transition: "all 0.2s", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 44, ...styles[variant], ...(props.style||{}) }}
      onMouseEnter={(e) => { e.currentTarget.style.opacity = "0.85"; e.currentTarget.style.transform = "translateY(-1px)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.opacity = "1"; e.currentTarget.style.transform = "translateY(0)"; }}
    >
      {children}
    </button>
  );
}

// ─── LOGIN SUBCOMPONENTS (defined outside to prevent remount on keystroke) ────
function LoginCard({ children, t }) {
  return (
    <div style={{ background: t.glassModal, border: `1.5px solid ${t.glassBorder}`, backdropFilter: "blur(40px)", WebkitBackdropFilter: "blur(40px)", borderRadius: 28, padding: "44px 40px", width: "100%", maxWidth: 420, boxShadow: t.shadow, animation: "fadeInUp 0.5s ease" }}>
      {children}
    </div>
  );
}

function LoginLogo({ t }) {
  return (
    <div style={{ textAlign: "center", marginBottom: 32 }}>
      <div style={{ width: 64, height: 64, borderRadius: 20, background: t.accent, margin: "0 auto 16px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, boxShadow: `0 8px 24px ${t.accentGlow}` }}>💎</div>
      <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, color: t.text, fontFamily: "'Sora', sans-serif", letterSpacing: "-0.02em" }}>Finanças do Casal</h1>
    </div>
  );
}

// ─── LOGIN + PROFILE + FAMILY SETUP ─────────────────────────────────────────
const DEMO_EMAIL    = "demo@financacasal.app";
const DEMO_PASSWORD = "demo1234";
const DEMO_FAMILY   = { family_id:"demo-family", family_name:"Família Demonstração", role:"admin", invite_code:"DEMO01" };
const DEMO_USER     = { id:"demo", email: DEMO_EMAIL };

function LoginPage({ t, darkMode, onLogin, addToast }) {
  const [step, setStep] = useState("auth"); // auth | profile | family_setup
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [familyName, setFamilyName] = useState("Nossa Família");
  const [inviteCode, setInviteCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [pendingUser, setPendingUser] = useState(null);
  const [loginCooldown, setLoginCooldown] = useState(0);
  const failedAttemptsRef = useRef(0);
  const cooldownTimerRef = useRef(null);

  const startCooldown = (seconds) => {
    setLoginCooldown(seconds);
    cooldownTimerRef.current = setInterval(() => {
      setLoginCooldown(prev => {
        if (prev <= 1) { clearInterval(cooldownTimerRef.current); return 0; }
        return prev - 1;
      });
    }, 1000);
  };

  const enterDemo = () => onLogin(DEMO_USER, null, DEMO_FAMILY);

  const handleAuth = async () => {
    if (loginCooldown > 0) return;
    // Intercepta credenciais demo — sem tocar no Supabase
    if (email.trim().toLowerCase() === DEMO_EMAIL && password === DEMO_PASSWORD) {
      enterDemo();
      return;
    }
    if (!email || !password) { addToast("Preencha e-mail e senha", "error"); return; }
    setLoading(true);
    try {
      const data = await supabaseAuth(
        mode === "login" ? "token?grant_type=password" : "signup",
        email, password
      );
      if (mode === "signup" && !data.user?.id) {
        addToast("Conta criada! Verifique seu e-mail antes de entrar.", "info");
        setMode("login"); setLoading(false); return;
      }
      setAuthToken(data.access_token, data.refresh_token);
      const user = data.user;
      if (!user?.id) {
        addToast("Erro ao obter dados do usuário. Tente fazer login.", "error");
        setMode("login"); setLoading(false); return;
      }
      const family = await getOrCreateFamily(user.id).catch(() => null);
      if (family) {
        addToast("Bem-vindo de volta!", "success");
        onLogin(user, data.access_token, family);
      } else {
        // New user: collect profile first, then family setup
        setPendingUser({ user, token: data.access_token });
        setStep(mode === "signup" ? "profile" : "family_setup");
      }
    } catch (err) {
      failedAttemptsRef.current += 1;
      if (failedAttemptsRef.current >= 3) {
        failedAttemptsRef.current = 0;
        startCooldown(30);
      }
      addToast(err.message, "error");
    }
    finally { setLoading(false); }
  };

  const handleSaveProfile = async () => {
    if (!firstName.trim()) { addToast("Informe seu nome", "error"); return; }
    setLoading(true);
    try {
      await supabaseRpc("upsert_profile", {
        p_first_name: firstName.trim(),
        p_last_name: lastName.trim(),
        p_phone: phone.trim(),
      });
      setStep("family_setup");
    } catch(err) { addToast(err.message, "error"); }
    finally { setLoading(false); }
  };

  // phone state in signup holds "DDI localNumber"

  const handleCreateFamily = async () => {
    if (!familyName.trim()) return;
    setLoading(true);
    try {
      const family = await createFamily(pendingUser.user.id, familyName.trim());
      addToast("Família criada! Compartilhe o código com seu cônjuge 💑", "success");
      onLogin(pendingUser.user, pendingUser.token, family);
    } catch (err) { addToast(err.message, "error"); }
    finally { setLoading(false); }
  };

  const handleJoinFamily = async () => {
    if (!inviteCode.trim()) return;
    setLoading(true);
    try {
      const family = await joinFamily(pendingUser.user.id, inviteCode.trim());
      addToast("Entrou na família! 🎉", "success");
      onLogin(pendingUser.user, pendingUser.token, family);
    } catch (err) { addToast(err.message, "error"); }
    finally { setLoading(false); }
  };

  const Bg = () => (
    <>
      <div style={{ position:"absolute",width:600,height:600,borderRadius:"50%",background:`radial-gradient(circle, ${t.accentGlow} 0%, transparent 70%)`,top:-200,right:-200,pointerEvents:"none" }} />
      <div style={{ position:"absolute",width:400,height:400,borderRadius:"50%",background:`radial-gradient(circle, ${t.successSoft} 0%, transparent 70%)`,bottom:-100,left:-100,pointerEvents:"none" }} />
    </>
  );

  const wrap = (children) => (
    <div style={{ minHeight:"100vh",background:t.bg,display:"flex",alignItems:"center",justifyContent:"center",padding:20,position:"relative",overflow:"hidden" }}>
      <Bg/><LoginCard t={t}>{children}</LoginCard>
    </div>
  );

  // ── Step auth ──
  if (step === "auth") return wrap(<>
    <LoginLogo t={t} />
    <p style={{ textAlign:"center",color:t.textMuted,fontSize:14,marginBottom:28,marginTop:-16 }}>Gerencie juntos, cresçam juntos</p>
    <Input label="E-mail" t={t} type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="seu@email.com" onKeyDown={e=>e.key==="Enter"&&handleAuth()} />
    <Input label="Senha" t={t} type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="••••••••" onKeyDown={e=>e.key==="Enter"&&handleAuth()} />
    <Btn t={t} type="button" onClick={handleAuth} style={{ width:"100%",marginTop:4 }} disabled={loading || loginCooldown > 0}>
      {loginCooldown > 0 ? `⏳ Aguarde ${loginCooldown}s` : loading ? "Aguarde..." : mode==="login" ? "🔐 Entrar" : "✨ Criar conta"}
    </Btn>
    <p style={{ textAlign:"center",marginTop:18,fontSize:14,color:t.textMuted }}>
      {mode==="login"?"Não tem conta? ":"Já tem conta? "}
      <span onClick={()=>setMode(mode==="login"?"signup":"login")} style={{ color:t.accent,cursor:"pointer",fontWeight:600 }}>{mode==="login"?"Criar agora":"Entrar"}</span>
    </p>
    <div style={{ display:"flex",alignItems:"center",gap:12,margin:"20px 0 4px" }}>
      <div style={{ flex:1,height:1,background:t.border }} />
      <span style={{ fontSize:12,color:t.textMuted }}>ou</span>
      <div style={{ flex:1,height:1,background:t.border }} />
    </div>
    <button onClick={enterDemo}
      style={{ width:"100%",padding:"11px",borderRadius:12,border:`1px solid ${t.border}`,
        background:"transparent",color:t.textMuted,fontSize:14,fontWeight:600,cursor:"pointer" }}>
      👀 Ver demonstração
    </button>
  </>);

  // ── Step profile (new signup) ──
  if (step === "profile") return wrap(<>
    <LoginLogo t={t} />
    <p style={{ textAlign:"center",color:t.textMuted,fontSize:14,marginBottom:24,marginTop:-16 }}>Conte um pouco sobre você 😊</p>
    <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:16 }}>
      <Input label="Nome *" t={t} value={firstName} onChange={e=>setFirstName(e.target.value)} placeholder="João" />
      <Input label="Sobrenome" t={t} value={lastName} onChange={e=>setLastName(e.target.value)} placeholder="Silva" />
    </div>
    <Input label="E-mail" t={t} type="email" value={email} readOnly style={{ opacity:0.6,cursor:"default" }} />
    <div style={{ marginBottom:16 }}>
      <label style={{ display:"block",marginBottom:6,fontSize:13,fontWeight:600,color:t.textSecondary,letterSpacing:"0.02em" }}>Telefone</label>
      <div style={{ display:"flex",gap:8 }}>
        <select value={phone.split(" ")[0]||"+55"} onChange={e=>setPhone(e.target.value+" ")} style={{ padding:"11px 10px",borderRadius:12,fontSize:13,fontFamily:"'DM Sans', sans-serif",background:t.inputBg,border:`1px solid ${t.border}`,color:t.text,outline:"none",cursor:"pointer",flexShrink:0,minWidth:90 }}>
          {DDI_LIST.map(d=><option key={d.code} value={d.code}>{d.flag} {d.code}</option>)}
        </select>
        <input type="tel" value={phone.includes(" ")?phone.slice(phone.indexOf(" ")+1):""} onChange={e=>setPhone((phone.split(" ")[0]||"+55")+" "+e.target.value)} placeholder="(11) 99999-9999" style={{ flex:1,padding:"11px 14px",borderRadius:12,fontSize:14,fontFamily:"'DM Sans', sans-serif",background:t.inputBg,border:`1px solid ${t.border}`,color:t.text,outline:"none",boxSizing:"border-box" }}
          onFocus={e=>e.target.style.borderColor=t.accent} onBlur={e=>e.target.style.borderColor=t.border} />
      </div>
    </div>
    <Btn t={t} type="button" onClick={handleSaveProfile} style={{ width:"100%",marginTop:4 }} disabled={loading}>
      {loading?"Salvando...":"Continuar →"}
    </Btn>
  </>);

  // ── Step family_setup ──
  if (step === "family_setup") return wrap(<>
    <LoginLogo t={t} />
    <p style={{ textAlign:"center",color:t.textMuted,fontSize:14,marginBottom:24,marginTop:-16 }}>Agora configure sua família 💑</p>
    <div style={{ background:t.accentSoft,border:`1.5px solid ${t.accent}33`,borderRadius:16,padding:20,marginBottom:16 }}>
      <div style={{ fontSize:15,fontWeight:700,color:t.text,marginBottom:4 }}>👑 Criar nova família</div>
      <div style={{ fontSize:13,color:t.textMuted,marginBottom:14 }}>Você será o administrador e poderá convidar seu cônjuge com um código.</div>
      <Input label="Nome da família" t={t} value={familyName} onChange={e=>setFamilyName(e.target.value)} placeholder="Ex: Família Silva" />
      <Btn t={t} type="button" onClick={handleCreateFamily} style={{ width:"100%" }} disabled={loading}>{loading?"Criando...":"🏠 Criar família"}</Btn>
    </div>
    <div style={{ display:"flex",alignItems:"center",gap:12,marginBottom:16 }}>
      <div style={{ flex:1,height:1,background:t.border }} /><span style={{ fontSize:12,color:t.textMuted,fontWeight:600 }}>OU</span><div style={{ flex:1,height:1,background:t.border }} />
    </div>
    <div style={{ background:t.successSoft,border:`1.5px solid ${t.success}33`,borderRadius:16,padding:20 }}>
      <div style={{ fontSize:15,fontWeight:700,color:t.text,marginBottom:4 }}>🔗 Entrar em uma família</div>
      <div style={{ fontSize:13,color:t.textMuted,marginBottom:14 }}>Peça o código de convite para quem criou a família.</div>
      <Input label="Código de convite (6 dígitos)" t={t} value={inviteCode} onChange={e=>setInviteCode(e.target.value.toUpperCase())} placeholder="Ex: AB12CD" maxLength={6} style={{ letterSpacing:"0.2em",fontWeight:700 }} />
      <Btn t={t} variant="success" type="button" onClick={handleJoinFamily} style={{ width:"100%" }} disabled={loading}>{loading?"Entrando...":"🔗 Entrar com código"}</Btn>
    </div>
  </>);

  return null;
}

// ─── CALENDAR ────────────────────────────────────────────────────────────────
function CalendarView({ expenses, incomes, t, onDeleteExpense, onDeleteIncome, onEditExpense, onEditIncome, familyMembers, onDaySelect, family, isDemo }) {
  // Store year/month as plain integers — completely avoids ALL timezone bugs
  const [viewYr, setViewYr] = useState(() => {
    const now = new Date();
    return now.getFullYear();
  });
  const [viewMo, setViewMo] = useState(() => {
    const now = new Date();
    return now.getMonth();
  });
  const yr = viewYr, mo = viewMo;
  const [selectedDay, setSelectedDay] = useState(null);
  const [editItem, setEditItem] = useState(null);
  const [recurringRules, setRecurringRules] = useState([]);
  const [calSelMode, setCalSelMode] = useState(false);
  const [calSelectedIds, setCalSelectedIds] = useState(new Set());
  const [calConfirmOpts, setCalConfirmOpts] = useState(null);
  const { pressingId: calLpId, start: calStartLp, cancel: calCancelLp } = useLongPress(
    useCallback((id) => { if (!calSelMode) { setCalSelMode(true); setCalSelectedIds(new Set([id])); } }, [calSelMode]),
    500
  );
  const calToggleSel = (id) => setCalSelectedIds(p => { const n = new Set(p); n.has(id)?n.delete(id):n.add(id); return n; });
  const calExitSel = () => { setCalSelMode(false); setCalSelectedIds(new Set()); };
  const calDeleteSelected = () => {
    const arr = Array.from(calSelectedIds);
    setCalConfirmOpts({
      title: "Remover lançamentos",
      message: `Remover ${arr.length} lançamento(s) selecionado(s)? Esta ação não pode ser desfeita.`,
      onConfirm: async () => {
        await Promise.all(arr.map(id => { const isInc = incomes.some(i=>i.id===id); return isInc?onDeleteIncome(id):onDeleteExpense(id); }));
        calExitSel();
      },
    });
  };

  useEffect(() => {
    if (isDemo || !family?.family_id) return;
    supabaseFetch(`/recurring_expenses?family_id=eq.${family.family_id}&active=eq.true&select=*`)
      .then(data => setRecurringRules(data || []))
      .catch(() => {});
  }, [family?.family_id, isDemo]);

  // For the viewed month, compute which recurring rules are pending (no matching expense yet)
  const recurByDay = useMemo(() => {
    const map = {};
    const prefix = `${yr}-${String(mo+1).padStart(2,"0")}`;
    const nowPrefix = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}`;
    // Only show recurring overlay from current month onward (past months already show as expenses)
    if (prefix < nowPrefix) return map;
    recurringRules.forEach(rule => {
      if (!rule.active) return;
      // Skip if end_date is before this month
      if (rule.end_date && rule.end_date < `${prefix}-01`) return;
      // Yearly rules: only show in their specific month
      if (rule.frequency === "yearly") {
        if (rule.month_of_year !== mo + 1) return;
      }
      const day = parseInt(rule.day_of_month) || 1;
      // Check if already paid this month (expense with same description exists)
      const alreadyPaid = expenses.some(e =>
        e.description === rule.description &&
        e.date?.startsWith(prefix)
      );
      if (!alreadyPaid) {
        if (!map[day]) map[day] = [];
        map[day].push(rule);
      }
    });
    return map;
  }, [recurringRules, expenses, yr, mo]);
  // Pure arithmetic using Tomohiko Sakamoto algorithm — zero Date objects, zero timezone bugs
  const firstDay = (() => {
    // Returns day of week (0=Sun, 1=Mon, ..., 6=Sat) for the 1st of yr/mo
    // Works correctly in ALL browsers, ALL timezones, ALL times of day
    const t = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
    let y = yr;
    const m = mo + 1; // 1-12
    if (m < 3) y--;
    return (y + Math.floor(y/4) - Math.floor(y/100) + Math.floor(y/400) + t[m-1] + 1) % 7;
  })();
  const daysInMonth = (() => {
    // Days in month using pure arithmetic — no Date objects
    const days = [31,28,31,30,31,30,31,31,30,31,30,31];
    const isLeap = (yr % 4 === 0 && yr % 100 !== 0) || yr % 400 === 0;
    return mo === 1 && isLeap ? 29 : days[mo];
  })();

  const expByDay = useMemo(() => {
    const map = {};
    const prefix = `${yr}-${String(mo+1).padStart(2,"0")}`;
    expenses.forEach((e) => {
      const baseDate = e.date?.slice(0,10);
      if (!baseDate) return;
      const p = parseInt(e.parcelas) || 1;
      if (e.type === "credito" && p > 1) {
        // Propagar cada parcela no mês em que cai
        const [bYr, bMoStr] = baseDate.slice(0,7).split("-");
        const bYrN = parseInt(bYr), bMoN = parseInt(bMoStr) - 1;
        for (let i = 0; i < p; i++) {
          const pMo = (bMoN + i) % 12;
          const pYr = bYrN + Math.floor((bMoN + i) / 12);
          if (`${pYr}-${String(pMo+1).padStart(2,"0")}` === prefix) {
            const day = parseInt(baseDate.slice(8));
            if (!map[day]) map[day] = [];
            map[day].push({ ...e, _installNum: i+1, _installTotal: p });
          }
        }
      } else {
        if (baseDate.startsWith(prefix)) {
          const day = parseInt(baseDate.slice(8));
          if (!map[day]) map[day] = [];
          map[day].push(e);
        }
      }
    });
    return map;
  }, [expenses, yr, mo]);

  const incByDay = useMemo(() => {
    const map = {};
    incomes.forEach((i) => {
      const d = i.date?.slice(0,10);
      if (d?.startsWith(`${yr}-${String(mo+1).padStart(2,"0")}`)) { const day = parseInt(d.slice(8)); if (!map[day]) map[day]=[]; map[day].push(i); }
    });
    return map;
  }, [incomes, yr, mo]);

  const sExp = selectedDay ? (expByDay[selectedDay]||[]) : [];
  const sInc = selectedDay ? (incByDay[selectedDay]||[]) : [];
  // Build day numbers only — CSS grid handles positioning via gridColumn on day 1
  const dayCells = [];
  for (let d = 1; d <= daysInMonth; d++) dayCells.push(d);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <button onClick={() => { if(mo===0){setViewYr(y=>y-1);setViewMo(11);}else{setViewMo(m=>m-1);} setSelectedDay(null); }} style={{ background: t.surfaceHover, border: `1px solid ${t.border}`, borderRadius: 10, width: 36, height: 36, cursor: "pointer", color: t.text, fontSize: 16 }}>‹</button>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: t.text, letterSpacing:"-0.02em" }}>{MONTH_FULL[mo]} {yr}</h2>
        <button onClick={() => { if(mo===11){setViewYr(y=>y+1);setViewMo(0);}else{setViewMo(m=>m+1);} setSelectedDay(null); }} style={{ background: t.surfaceHover, border: `1px solid ${t.border}`, borderRadius: 10, width: 36, height: 36, cursor: "pointer", color: t.text, fontSize: 16 }}>›</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 6, marginBottom: 8 }}>
        {["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"].map((d) => <div key={d} style={{ textAlign: "center", fontSize: 12, fontWeight: 700, color: t.textMuted, padding: "6px 0" }}>{d}</div>)}
      </div>
      <div style={{ display:"flex",gap:16,marginBottom:10,justifyContent:"flex-end",flexWrap:"wrap" }}>
        <div style={{ display:"flex",alignItems:"center",gap:5,fontSize:11,color:t.textMuted }}>
          <span style={{ width:7,height:7,borderRadius:"50%",background:t.danger,display:"inline-block" }}/>Gastos
        </div>
        <div style={{ display:"flex",alignItems:"center",gap:5,fontSize:11,color:t.textMuted }}>
          <span style={{ width:7,height:7,borderRadius:"50%",background:t.accent,display:"inline-block" }}/>Parcelas
        </div>
        <div style={{ display:"flex",alignItems:"center",gap:5,fontSize:11,color:t.textMuted }}>
          <span style={{ width:7,height:7,borderRadius:"50%",background:t.success,display:"inline-block" }}/>Receitas
        </div>
        <div style={{ display:"flex",alignItems:"center",gap:5,fontSize:11,color:t.textMuted }}>
          <span style={{ width:7,height:7,borderRadius:"50%",background:"#f59e0b",display:"inline-block" }}/>Recorrentes
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 6 }}>
        {dayCells.map((day, i) => {
          const hasExp = expByDay[day]?.length > 0, hasInc = incByDay[day]?.length > 0;
          const isToday = yr===today.getFullYear()&&mo===today.getMonth()&&day===today.getDate();
          const isSel = selectedDay === day;
          const totalDay = (expByDay[day]||[]).reduce((s,e)=>s+(parseFloat(e.amount)||0),0);
          // On day 1, use gridColumn to place it in the correct weekday column
          const gridStyle = day === 1 ? { gridColumn: firstDay + 1 } : {};
          return (
            <div key={day} onClick={() => { const next = isSel?null:day; setSelectedDay(next); if(onDaySelect) { if(next) { const dateStr = `${yr}-${String(mo+1).padStart(2,"0")}-${String(next).padStart(2,"0")}`; onDaySelect(dateStr); } else { onDaySelect(null); } } }} style={{ ...gridStyle, borderRadius: 14, padding: "8px 4px", minHeight: 60, cursor: "pointer", background: isSel?t.accentSoft:isToday?t.accentSoft:t.surface, border: `1.5px solid ${isSel?t.accent:isToday?t.accent+"66":t.border}`, transition: "all 0.2s", display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}
              onMouseEnter={(e) => { if (!isSel) e.currentTarget.style.background=t.surfaceHover; }}
              onMouseLeave={(e) => { if (!isSel) e.currentTarget.style.background=isToday?t.accentSoft:t.surface; }}
            >
              <span style={{ fontSize: 14, fontWeight: isToday?800:600, color: isSel||isToday?t.accent:t.text }}>{day}</span>
              <div style={{ display: "flex", gap: 3, flexWrap:"wrap", justifyContent:"center" }}>
                {(expByDay[day]||[]).some(e=>!e._installNum||e._installNum===1)&&<span style={{ width:6,height:6,borderRadius:"50%",background:t.danger }}/>}
                {(expByDay[day]||[]).some(e=>e._installNum>1)&&<span style={{ width:6,height:6,borderRadius:"50%",background:t.accent }}/>}
                {hasInc&&<span style={{ width:6,height:6,borderRadius:"50%",background:t.success }}/>}
                {(recurByDay[day]||[]).length>0&&<span style={{ width:6,height:6,borderRadius:"50%",background:"#f59e0b" }}/>}
              </div>
              {totalDay>0&&<span style={{ fontSize:9,color:t.danger,fontWeight:700 }}>{fmtShort(totalDay)}</span>}
              {(incByDay[day]||[]).reduce((s,i)=>s+(parseFloat(i.amount)||0),0)>0&&<span style={{ fontSize:9,color:t.success,fontWeight:700 }}>{fmtShort((incByDay[day]||[]).reduce((s,i)=>s+(parseFloat(i.amount)||0),0))}</span>}
            </div>
          );
        })}
      </div>
      {selectedDay && (
        <div style={{ marginTop: 24, background: t.glassModal, border: `1px solid ${t.glassBorder}`, backdropFilter: "blur(16px)", borderRadius: 20, padding: 24, animation: "fadeInUp 0.25s ease" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h3 style={{ margin: 0, color: t.text, fontSize: 16, fontWeight: 700, letterSpacing:"-0.02em" }}>{selectedDay} de {MONTH_FULL[mo]}</h3>
            <div style={{ display: "flex", gap: 12 }}>
              {sInc.length>0&&<span style={{ fontSize:13,fontWeight:700,color:t.success }}>{fmt(sInc.reduce((s,i)=>s+(parseFloat(i.amount)||0),0))}</span>}
              {sExp.length>0&&<span style={{ fontSize:13,fontWeight:700,color:t.danger }}>{fmt(sExp.reduce((s,e)=>s+(parseFloat(e.amount)||0),0))}</span>}
            </div>
          </div>
          {sExp.length===0&&sInc.length===0&&(recurByDay[selectedDay]||[]).length===0 ? <p style={{ color:t.textMuted,fontSize:14,margin:0,textAlign:"center" }}>Nenhum lançamento neste dia</p> : (
            <div style={{ display:"flex",flexDirection:"column",gap:8 }}>
              {(recurByDay[selectedDay]||[]).map((rule) => {
                const cat = CATEGORIES.find(c=>c.id===rule.category);
                return (
                  <div key={rule.id} style={{
                    display:"flex",alignItems:"center",justifyContent:"space-between",
                    padding:"12px 16px",borderRadius:14,
                    background:"#f59e0b18", border:"1px solid #f59e0b44",
                  }}>
                    <div style={{ display:"flex",alignItems:"center",gap:10,minWidth:0,flex:1 }}>
                      <span style={{ fontSize:22,flexShrink:0 }}>{cat?.emoji||"🔁"}</span>
                      <div style={{ minWidth:0,flex:1,textAlign:"left" }}>
                        <div style={{ fontSize:13,fontWeight:600,color:t.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{rule.description}</div>
                        <div style={{ fontSize:11,color:"#f59e0b",marginTop:1 }}>🔁 Recorrente · {cat?.label||"Outros"}{rule.amount?` · ${fmt(rule.amount)}`:""}</div>
                      </div>
                    </div>
                    <span style={{ fontWeight:700,fontSize:14,color:"#f59e0b",flexShrink:0 }}>{rule.amount?fmt(parseFloat(rule.amount)||0):"—"}</span>
                  </div>
                );
              })}
              {sInc.map((inc) => {
                const incCat = INCOME_SOURCES.find(s=>s.id===(inc.source||inc.category));
                const calIsSel = calSelectedIds.has(inc.id);
                const calIsLp = calLpId === inc.id;
                return (
                  <div key={inc.id}
                    onClick={() => { if(calSelMode) calToggleSel(inc.id); }}
                    onMouseDown={() => calStartLp(inc.id)}
                    onMouseUp={calCancelLp} onMouseLeave={calCancelLp}
                    onTouchStart={() => calStartLp(inc.id)} onTouchEnd={calCancelLp} onTouchCancel={calCancelLp}
                    style={{
                      display:"flex",alignItems:"center",gap:10,
                      padding:"12px 16px",borderRadius:14,transition:"all 0.2s",cursor:"pointer",userSelect:"none",
                      background: calIsSel ? "rgba(124,92,255,0.12)" : t.successSoft,
                      border: `1px solid ${calIsSel?"rgba(124,92,255,0.4)":t.success+"22"}`,
                      transform: calIsLp ? "scale(1.015)" : "none",
                      boxShadow: calIsLp ? "0 8px 24px rgba(124,92,255,0.3)" : "none",
                    }}>
                    {calSelMode && (
                      <div style={{ width:22,height:22,borderRadius:999,flexShrink:0,border:calIsSel?"none":"1.8px solid rgba(255,255,255,0.35)",background:calIsSel?"#7c6af7":"transparent",display:"flex",alignItems:"center",justifyContent:"center" }}>
                        {calIsSel && <Icon name="check" size={12} color="#fff" />}
                      </div>
                    )}
                    <span style={{ fontSize:22,flexShrink:0 }}>{incCat?.emoji||"💰"}</span>
                    <div style={{ minWidth:0,flex:1,textAlign:"center" }}>
                      <div style={{ fontSize:13,fontWeight:600,color:t.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{inc.description}</div>
                      <div style={{ fontSize:11,color:t.textMuted,marginTop:1 }}>
                        {inc.user_label} · {(inc.date||"").slice(8,10)+"/"+(inc.date||"").slice(5,7)+"/"+(inc.date||"").slice(2,4)}{incCat ? ` · ${incCat.label}` : ""}
                      </div>
                    </div>
                    <div style={{ display:"flex",alignItems:"center",gap:6,flexShrink:0 }}>
                      <span style={{ fontWeight:700,fontSize:14,color:t.success }}>{fmt(parseFloat(inc.amount)||0)}</span>
                      {!calSelMode && <button onClick={e=>{ e.stopPropagation(); setEditItem({...inc,_type:"income"}); }} title="Editar"
                        style={{ background:"transparent",border:"none",cursor:"pointer",color:t.textMuted,fontSize:13,padding:"4px 6px",borderRadius:6,transition:"color 0.2s" }}
                        onMouseEnter={e=>e.currentTarget.style.color=t.accent}
                        onMouseLeave={e=>e.currentTarget.style.color=t.textMuted}>✏️</button>}
                    </div>
                  </div>
                );
              })}
              {sExp.map((exp) => {
                const cat = CATEGORIES.find(c=>c.id===exp.category);
                const p = parseInt(exp.parcelas)||1;
                const typeLabel = exp.type==="pix"?"PIX":exp.type==="debito"?"Débito":"Crédito";
                let subtitleExtra = "";
                if(exp.type==="credito" && p>1){
                  const nth = exp._installNum || 1;
                  subtitleExtra = ` · Crédito ${nth} de ${p}`;
                } else {
                  subtitleExtra = ` · ${typeLabel}`;
                }
                if(cat?.label) subtitleExtra += ` · ${cat.label}`;
                const calIsSelExp = calSelectedIds.has(exp.id);
                const calIsLpExp = calLpId === exp.id;
                return (
                  <div key={exp.id}
                    onClick={() => { if(calSelMode) calToggleSel(exp.id); }}
                    onMouseDown={() => calStartLp(exp.id)}
                    onMouseUp={calCancelLp} onMouseLeave={calCancelLp}
                    onTouchStart={() => calStartLp(exp.id)} onTouchEnd={calCancelLp} onTouchCancel={calCancelLp}
                    style={{
                      display:"flex",alignItems:"center",gap:10,
                      padding:"12px 16px",borderRadius:14,transition:"all 0.2s",cursor:"pointer",userSelect:"none",
                      background: calIsSelExp ? "rgba(124,92,255,0.12)" : t.dangerSoft,
                      border: `1px solid ${calIsSelExp?"rgba(124,92,255,0.4)":t.danger+"22"}`,
                      transform: calIsLpExp ? "scale(1.015)" : "none",
                      boxShadow: calIsLpExp ? "0 8px 24px rgba(124,92,255,0.3)" : "none",
                    }}>
                    {calSelMode && (
                      <div style={{ width:22,height:22,borderRadius:999,flexShrink:0,border:calIsSelExp?"none":"1.8px solid rgba(255,255,255,0.35)",background:calIsSelExp?"#7c6af7":"transparent",display:"flex",alignItems:"center",justifyContent:"center" }}>
                        {calIsSelExp && <Icon name="check" size={12} color="#fff" />}
                      </div>
                    )}
                    <span style={{ fontSize:22,flexShrink:0 }}>{cat?.emoji||"📦"}</span>
                    <div style={{ minWidth:0,flex:1,textAlign:"center" }}>
                      <div style={{ fontSize:13,fontWeight:600,color:t.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{exp.description}</div>
                      <div style={{ fontSize:11,color:t.textMuted,marginTop:1 }}>
                        {exp.user_label} · {(exp.date||"").slice(8,10)+"/"+(exp.date||"").slice(5,7)+"/"+(exp.date||"").slice(2,4)}{subtitleExtra}
                      </div>
                    </div>
                    <div style={{ display:"flex",alignItems:"center",gap:6,flexShrink:0 }}>
                      <span style={{ fontWeight:700,fontSize:14,color:t.danger }}>{fmt(parseFloat(exp.amount)||0)}</span>
                      {!calSelMode && <button onClick={e=>{ e.stopPropagation(); setEditItem({...exp,_type:"expense"}); }} title="Editar"
                        style={{ background:"transparent",border:"none",cursor:"pointer",color:t.textMuted,fontSize:13,padding:"4px 6px",borderRadius:6,transition:"color 0.2s" }}
                        onMouseEnter={e=>e.currentTarget.style.color=t.accent}
                        onMouseLeave={e=>e.currentTarget.style.color=t.textMuted}>✏️</button>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Floating delete bar — CalendarView */}
      {calSelMode && calSelectedIds.size > 0 && (
        <div style={{ position:"fixed",bottom:"calc(64px + env(safe-area-inset-bottom) + 10px)",left:20,right:20,zIndex:200,padding:"10px 12px",borderRadius:18,background:"rgba(20,14,36,0.92)",backdropFilter:"blur(22px)",border:`1px solid rgba(255,255,255,0.1)`,display:"flex",alignItems:"center",gap:10,boxShadow:"0 20px 40px rgba(0,0,0,0.5)" }}>
          <button onClick={calExitSel} style={{ padding:"0 14px",height:40,borderRadius:12,background:"transparent",border:"1px solid rgba(255,255,255,0.15)",color:"rgba(255,255,255,0.7)",fontSize:13,fontWeight:600,cursor:"pointer" }}>Cancelar</button>
          <button onClick={calDeleteSelected} style={{ flex:1,height:40,borderRadius:12,background:"rgba(255,107,107,0.18)",border:"1px solid rgba(255,107,107,0.35)",color:"#FF9B9B",fontSize:13.5,fontWeight:700,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:6 }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 4h10M6 4V3a1 1 0 011-1h2a1 1 0 011 1v1M5 4l.5 9a1 1 0 001 1h3a1 1 0 001-1L11 4" stroke="#FF9B9B" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
            Excluir {calSelectedIds.size}
          </button>
        </div>
      )}

      {/* Edit modal — inside CalendarView */}
      {editItem && (
        <div onClick={e=>{ if(e.target===e.currentTarget) setEditItem(null); }}
          style={{ position:"fixed",inset:0,zIndex:500,background:"rgba(0,0,0,0.65)",backdropFilter:"blur(10px)",display:"flex",alignItems:"center",justifyContent:"center",padding:20 }}>
          <div onClick={e=>e.stopPropagation()}
            style={{ background:t.glassModal,border:`1.5px solid ${t.glassBorder}`,borderRadius:24,padding:"24px 20px 20px",width:"100%",maxWidth:460,maxHeight:"90vh",overflowY:"auto",boxShadow:t.shadow,animation:"modalIn 0.25s ease" }}>
            <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20 }}>
              <h3 style={{ margin:0,fontSize:17,fontWeight:800,color:t.text,letterSpacing:"-0.02em" }}>✏️ Editar Lançamento</h3>
              <button onClick={()=>setEditItem(null)} style={{ background:"transparent",border:"none",cursor:"pointer",color:t.textMuted,fontSize:22,lineHeight:1,padding:"2px 8px",borderRadius:8 }}>×</button>
            </div>
            <EditModal t={t} item={editItem} onClose={()=>setEditItem(null)} familyMembers={familyMembers}
              onSave={async(payload)=>{ if(payload._type==="expense") await onEditExpense(payload); else await onEditIncome(payload); setEditItem(null); }} />
          </div>
        </div>
      )}

      <ConfirmModal
        open={!!calConfirmOpts}
        title={calConfirmOpts?.title}
        message={calConfirmOpts?.message}
        onConfirm={() => { calConfirmOpts?.onConfirm(); setCalConfirmOpts(null); }}
        onCancel={() => setCalConfirmOpts(null)}
        t={t}
      />
    </div>
  );
}

// ─── CHARTS ──────────────────────────────────────────────────────────────────
function ChartsView({ expenses, incomes, t, onEditExpense, onDeleteExpense, familyMembers, cards = [], recurringRules = [], billingPeriods = [] }) {
  const [selectedMonth, setSelectedMonth] = useState(today.getMonth());
  const [selectedYear, setSelectedYear] = useState(today.getFullYear());
  const period = "month";
  const [selectedCreditMonth, setSelectedCreditMonth] = useState(null);
  const [selectedBillingMonth, setSelectedBillingMonth] = useState(null);
  const [selectedPieCategory, setSelectedPieCategory] = useState(null);
  const [editItem, setEditItem] = useState(null);
  const [selectedCatIds, setSelectedCatIds] = useState(new Set());
  const [chartTab, setChartTab] = useState("categories");
  const TAB_DEFS = [
    {id:"categories",   icon:"pieChart", label:"Categorias"},
    {id:"incomeExpense",icon:"chart",    label:"Receitas × Gastos"},
    {id:"installments", icon:"card",     label:"Parcelas"},
  ];
  const TAB_ORDER = ["categories","incomeExpense","installments"];
  const swipeRef = useRef({});

  const handleTouchStart = (e) => { swipeRef.current.startX = e.touches[0].clientX; };
  const handleTouchEnd = (e) => {
    const dx = e.changedTouches[0].clientX - (swipeRef.current.startX || 0);
    if (Math.abs(dx) < 60) return;
    const idx = TAB_ORDER.indexOf(chartTab);
    if (dx < 0 && idx < TAB_ORDER.length - 1) setChartTab(TAB_ORDER[idx + 1]);
    if (dx > 0 && idx > 0) setChartTab(TAB_ORDER[idx - 1]);
  };

  const availableYears = useMemo(() => {
    const yrs = new Set([today.getFullYear()]);
    [...expenses,...incomes].forEach((item) => { const y = item.date?.slice(0,4); if (y) yrs.add(parseInt(y)); });
    return Array.from(yrs).sort((a,b) => b-a);
  }, [expenses, incomes]);

  // Reference point: when period=month use selectedMonth/Year, when period=year use Dec of selectedYear
  const refYear = selectedYear;
  const refMonth = period === "month" ? selectedMonth : 11;
  // Credit chart starts from the selected month/year
  const creditRefYear = selectedYear;
  const creditRefMonth = selectedMonth;

  // ── Bar chart: 6 months ending at the reference month (always by purchase date) ──
  const barData = useMemo(() => Array.from({length:6},(_,i) => {
    const d = new Date(refYear, refMonth - 5 + i, 1);
    const yr=d.getFullYear(), mn=d.getMonth();
    const prefix=`${yr}-${String(mn+1).padStart(2,"0")}`;
    const inc = incomes.filter(i=>i.date?.startsWith(prefix)).reduce((s,i)=>s+(parseFloat(i.amount)||0),0);
    const exp = expenses.filter(e=>e.date?.startsWith(prefix)).reduce((s,e)=>s+(parseFloat(e.amount)||0),0);
    return { name:MONTHS[mn], Receitas:Math.round(inc), Gastos:Math.round(exp), Saldo:Math.round(inc-exp) };
  }), [expenses, incomes, refYear, refMonth]);

  // ── Category evolution: all categories available in the 6-month window ──
  const availableCatsEvolution = useMemo(() => {
    const prefixes = Array.from({length:6}, (_,i) => {
      const d = new Date(refYear, refMonth - 5 + i, 1);
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
    });
    const totals = {};
    expenses.forEach(e => {
      if (!e.category || !e.date) return;
      if (!prefixes.some(p => e.date.startsWith(p))) return;
      totals[e.category] = (totals[e.category] || 0) + (parseFloat(e.amount) || 0);
    });
    return Object.entries(totals)
      .sort((a,b) => b[1] - a[1])
      .map(([id, total]) => {
        const cat = CATEGORIES.find(c => c.id === id);
        return { id, label:`${cat?.emoji||""} ${cat?.label||id}`.trim(), total };
      });
  }, [expenses, refYear, refMonth]);

  const activeCatIdsForEvolution = useMemo(() => {
    const valid = availableCatsEvolution.map(c => c.id);
    const filtered = [...selectedCatIds].filter(id => valid.includes(id));
    return filtered.length > 0 ? filtered : valid.slice(0, 2);
  }, [selectedCatIds, availableCatsEvolution]);

  const catEvolutionData = useMemo(() => {
    const months6 = Array.from({length:6}, (_,i) => {
      const d = new Date(refYear, refMonth - 5 + i, 1);
      const yr = d.getFullYear(), mn = d.getMonth();
      return { prefix:`${yr}-${String(mn+1).padStart(2,"0")}`, label:MONTHS[mn] };
    });
    return months6.map(({prefix, label}) => {
      const row = { name: label };
      activeCatIdsForEvolution.forEach(id => {
        const cat = availableCatsEvolution.find(c => c.id === id);
        if (!cat) return;
        row[cat.label] = Math.round(
          expenses.filter(e => e.category===id && e.date?.startsWith(prefix))
            .reduce((s,e) => s + (parseFloat(e.amount)||0), 0)
        );
      });
      return row;
    });
  }, [expenses, activeCatIdsForEvolution, availableCatsEvolution, refYear, refMonth]);

  const toggleCatEvolution = (id) => setSelectedCatIds(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const catColorEvolution = (id) => t.chartColors[CATEGORIES.findIndex(c => c.id === id) % t.chartColors.length];

  // ── Pie: filtered by selected period (always by purchase date) ──
  const pieData = useMemo(() => {
    const filtered = period==="month"
      ? expenses.filter(e=>e.date?.startsWith(`${selectedYear}-${String(selectedMonth+1).padStart(2,"0")}`))
      : expenses.filter(e=>e.date?.startsWith(`${selectedYear}`));
    const map = {};
    filtered.forEach(e=>{ map[e.category]=(map[e.category]||0)+e.amount; });
    return Object.entries(map).map(([id,value]) => { const cat=CATEGORIES.find(c=>c.id===id); return { id, name:cat?.label||id, value:Math.round(value), emoji:cat?.emoji||"📦" }; }).sort((a,b)=>b.value-a.value);
  }, [expenses, period, selectedMonth, selectedYear]);

  // ── Credit installments: 12 months from reference (always by purchase date) ──
  const creditData = useMemo(() => {
    const result = {};
    for (let i=0;i<12;i++) {
      const d=new Date(creditRefYear, creditRefMonth+i, 1);
      result[`${d.getFullYear()}-${d.getMonth()}`]={ name:`${MONTHS[d.getMonth()]}/${String(d.getFullYear()).slice(2)}`, value:0, items:[], yr:d.getFullYear(), mo:d.getMonth() };
    }
    expenses.forEach(e => {
      const p = parseInt(e.parcelas) || 1;
      if (e.type!=="credito" || p <= 1 || !e.date) return;
      const iv = parseFloat(e.amount) || 0;
      const [dYr, dMoStr] = e.date.slice(0,7).split("-");
      const baseYr = parseInt(dYr), baseMo = parseInt(dMoStr) - 1;
      for (let i=0; i<p; i++) {
        const mo = (baseMo + i) % 12;
        const yr = baseYr + Math.floor((baseMo + i) / 12);
        const k = `${yr}-${mo}`;
        if (result[k]) { result[k].value += iv; result[k].items.push({ ...e, _installNum: i+1, _installTotal: p }); }
      }
    });
    return Object.values(result).map(r=>({...r,value:Math.round(r.value)}));
  }, [expenses, selectedYear, selectedMonth]);

  // ── Billing chart: crédito (compras + parcelas + recorrentes) → mês de VENCIMENTO via billing_periods ou fallback ──
  const billingChartData = useMemo(() => {
    const result = {};
    for (let i=0;i<12;i++) {
      const d=new Date(selectedYear, selectedMonth+i, 1);
      result[`${d.getFullYear()}-${d.getMonth()}`]={ name:`${MONTHS[d.getMonth()]}/${String(d.getFullYear()).slice(2)}`, value:0, items:[], yr:d.getFullYear(), mo:d.getMonth() };
    }
    // Compras e parcelas confirmadas — cada parcela tem sua própria data e billing month
    expenses.forEach(e => {
      if (e.type !== "credito" || !e.date) return;
      const p = parseInt(e.parcelas) || 1;
      const iv = parseFloat(e.amount) || 0;
      const card = cards.find(c => c.id === e.card_id);
      const closingDay = card?.closing_day ?? 28;
      const cardPeriods = billingPeriods.filter(bp => bp.card_id === e.card_id);
      const [dYr, dMoStr, dDayStr] = e.date.slice(0,10).split("-");
      const purYr = parseInt(dYr), purMo = parseInt(dMoStr) - 1, purDay = parseInt(dDayStr) || 1;
      for (let i=0; i<p; i++) {
        const totalMo = purMo + i;
        const instMo  = totalMo % 12;
        const instYr  = purYr + Math.floor(totalMo / 12);
        const maxDay  = new Date(instYr, instMo + 1, 0).getDate();
        const instDay = Math.min(purDay, maxDay);
        const instDate = `${instYr}-${String(instMo+1).padStart(2,"0")}-${String(instDay).padStart(2,"0")}`;
        const bm = getBillingMonth(instDate, cardPeriods, closingDay);
        if (!bm) continue;
        const k = `${bm.year}-${bm.month - 1}`;
        if (result[k]) { result[k].value += iv; result[k].items.push({ ...e, _installNum: i+1, _installTotal: p }); }
      }
    });
    // Recorrentes no crédito ainda não confirmadas como gasto naquele mês
    // Projeção é suprimida para billing_periods já fechados (period_end < hoje)
    const todayMidnight = new Date(); todayMidnight.setHours(0,0,0,0);
    recurringRules.forEach(rule => {
      if (rule.type !== "credito" || !rule.active || rule.amount_type === "variable") return;
      const ruleAmt = parseFloat(rule.amount) || 0;
      if (ruleAmt <= 0) return;
      for (let i=0; i<12; i++) {
        const d = new Date(selectedYear, selectedMonth+i, 1);
        const targetYr = d.getFullYear(), targetMo = d.getMonth() + 1;
        if (rule.frequency === "yearly" && rule.month_of_year !== targetMo) continue;
        if (rule.end_date && new Date(rule.end_date + "T12:00:00") < d) continue;
        const mPrefix = `${targetYr}-${String(targetMo).padStart(2,"0")}`;
        const alreadyConfirmed = expenses.some(e =>
          e.type === "credito" &&
          e.description?.toLowerCase().trim() === rule.description?.toLowerCase().trim() &&
          e.date?.startsWith(mPrefix)
        );
        if (alreadyConfirmed) continue;
        const day = rule.day_of_month || 1;
        const dateStr = `${targetYr}-${String(targetMo).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
        const bm = getBillingMonth(dateStr, [], 28);
        if (!bm) continue;
        // Não projetar em períodos já fechados (billing_period cadastrado com period_end < hoje)
        const matchingPeriod = billingPeriods.find(bp =>
          bp.fatura_month === bm.month && bp.fatura_year === bm.year
        );
        if (matchingPeriod && new Date(matchingPeriod.period_end + "T23:59:59") < todayMidnight) continue;
        const k = `${bm.year}-${bm.month - 1}`;
        if (result[k]) {
          result[k].value += ruleAmt;
          result[k].items.push({ description:rule.description, amount:ruleAmt, date:dateStr, category:rule.category, type:"credito", parcelas:1, user_label:rule.user_label||"", _installNum:1, _installTotal:1, _isRecurring:true });
        }
      }
    });
    return Object.values(result).map(r=>({...r,value:Math.round(r.value)}));
  }, [expenses, cards, recurringRules, billingPeriods, selectedMonth, selectedYear]);

  const CTip = ({ active, payload, label }) => {
    if (!active||!payload?.length) return null;
    return <div style={{ background:t.tooltipBg, border:`1px solid ${t.glassBorder}`, borderRadius:14, padding:"12px 16px", boxShadow:t.shadowSm }}><p style={{ margin:"0 0 8px",fontWeight:700,color:t.text,fontSize:13 }}>{label}</p>{payload.map(p=><p key={p.name} style={{ margin:"3px 0",color:p.color,fontSize:12,fontWeight:600 }}>{p.name}: {fmt(p.value)}</p>)}</div>;
  };
  const PTip = ({ active, payload }) => {
    if (!active||!payload?.length) return null;
    const d=payload[0].payload;
    return <div style={{ background:t.tooltipBg, border:`1px solid ${t.glassBorder}`, borderRadius:14, padding:"10px 14px", boxShadow:t.shadowSm }}><p style={{ margin:0,fontWeight:700,color:t.text,fontSize:13 }}>{d.emoji} {d.name}</p><p style={{ margin:"4px 0 0",color:t.accent,fontSize:13,fontWeight:700 }}>{fmt(d.value)}</p></div>;
  };

  const Card = ({ children, title }) => (
    <div style={{ background:t.glassModal, border:`1px solid ${t.glassBorder}`, backdropFilter:"blur(16px)", borderRadius:20, padding:24 }}>
      {title&&<h3 style={{ margin:"0 0 20px",fontSize:16,fontWeight:700,color:t.text,letterSpacing:"-0.02em" }}>{title}</h3>}
      {children}
    </div>
  );

  return (
    <div style={{ display:"flex",flexDirection:"column",gap:24 }}>
      <div style={{ display:"flex",gap:8,alignItems:"center",flexWrap:"wrap" }}>
        <select value={selectedMonth} onChange={e=>setSelectedMonth(Number(e.target.value))} style={{ padding:"8px 14px",borderRadius:12,border:`1px solid ${t.border}`,background:t.inputBg,color:t.text,fontSize:13,fontWeight:600,cursor:"pointer",outline:"none" }}>
          {MONTH_FULL.map((mn,i)=><option key={i} value={i}>{mn}</option>)}
        </select>
        <select value={selectedYear} onChange={e=>setSelectedYear(Number(e.target.value))} style={{ padding:"8px 14px",borderRadius:12,border:`1px solid ${t.border}`,background:t.inputBg,color:t.text,fontSize:13,fontWeight:600,cursor:"pointer",outline:"none" }}>
          {availableYears.map(yr=><option key={yr} value={yr}>{yr}</option>)}
        </select>
      </div>

      {/* Chart tab strip */}
      <div style={{ display:"flex", padding:4, borderRadius:12, background:t.surface, border:`1px solid ${t.border}`, gap:4 }}>
        {TAB_DEFS.map(tab => (
          <button key={tab.id} onClick={()=>setChartTab(tab.id)} style={{
            flex:1, height:36, borderRadius:9, border:"none", cursor:"pointer",
            display:"flex", alignItems:"center", justifyContent:"center", gap:6,
            background: chartTab===tab.id ? t.accentSoft : "transparent",
            color: chartTab===tab.id ? t.accent : t.textSecondary,
            fontSize: 12, fontWeight: chartTab===tab.id ? 700 : 500,
            transition:"all 0.15s",
          }}>
            <Icon name={tab.icon} size={14} color={chartTab===tab.id?t.accent:t.textSecondary} />
            <span className="chart-tab-label">{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Swipe area */}
      <div onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd} key={chartTab} style={{ display:"flex",flexDirection:"column",gap:24,animation:"fadeInUp 0.22s ease" }}>

      {chartTab === "categories" && <>
      <Card title={`🥧 Gastos por categoria — ${period==="month" ? MONTH_FULL[selectedMonth] : "Ano"} ${selectedYear}`}>
        <p style={{ fontSize:12,color:t.textMuted,marginTop:-12,marginBottom:16 }}>Toque em uma fatia ou categoria para ver os lançamentos.</p>
        <div style={{ display:"flex",flexWrap:"wrap",gap:24,alignItems:"center" }}>
          <ResponsiveContainer width="100%" height={220} style={{ minWidth:200 }}>
            <PieChart>
              <Pie data={pieData} cx="50%" cy="50%" innerRadius={55} outerRadius={90} paddingAngle={3} dataKey="value"
                onClick={(data) => setSelectedPieCategory(prev => prev===data.id ? null : data.id)}
                style={{ cursor:"pointer" }}>
                {pieData.map((d,i)=>(
                  <Cell key={i} fill={t.chartColors[i%t.chartColors.length]}
                    opacity={selectedPieCategory && selectedPieCategory!==d.id ? 0.35 : 1} />
                ))}
              </Pie>
              <Tooltip content={<PTip/>} />
            </PieChart>
          </ResponsiveContainer>
          <div style={{ flex:1,minWidth:180,alignSelf:"flex-start" }}>
            <div style={{ display:"grid",gridTemplateColumns: pieData.length > 4 ? "1fr 1fr" : "1fr",gap:"4px 8px" }}>
              {pieData.map((d,i)=>{
                const isActive = selectedPieCategory===d.id;
                const color = t.chartColors[i%t.chartColors.length];
                return (
                  <div key={d.name} onClick={()=>setSelectedPieCategory(prev=>prev===d.id?null:d.id)}
                    style={{ display:"flex",alignItems:"center",gap:6,padding:"5px 8px",minWidth:0,cursor:"pointer",borderRadius:8,background:isActive?color+"22":"transparent",border:`1px solid ${isActive?color+"55":"transparent"}`,transition:"all 0.15s" }}>
                    <div style={{ width:9,height:9,borderRadius:2,background:color,flexShrink:0 }} />
                    <span style={{ fontSize:11,color:isActive?color:t.textSecondary,flex:1,textAlign:"left",lineHeight:1.3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontWeight:isActive?700:400 }}>{d.emoji} {d.name}</span>
                    <span style={{ fontSize:11,fontWeight:700,color:isActive?color:t.text,flexShrink:0,marginLeft:4 }}>{fmt(d.value)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        {selectedPieCategory && (() => {
          const prefix = period==="month"
            ? `${selectedYear}-${String(selectedMonth+1).padStart(2,"0")}`
            : `${selectedYear}`;
          const catExpenses = expenses
            .filter(e => e.category===selectedPieCategory && e.date?.startsWith(prefix))
            .sort((a,b)=> (b.date||"").localeCompare(a.date||""));
          const catObj = CATEGORIES.find(c=>c.id===selectedPieCategory);
          const total = catExpenses.reduce((s,e)=>s+(parseFloat(e.amount)||0),0);
          const colorIdx = pieData.findIndex(d=>d.id===selectedPieCategory);
          const color = t.chartColors[colorIdx>=0 ? colorIdx%t.chartColors.length : 0];
          if (!catExpenses.length) return <div style={{ marginTop:16,textAlign:"center",fontSize:13,color:t.textMuted }}>Nenhum lançamento encontrado.</div>;
          return (
            <div style={{ marginTop:20,borderTop:`1px solid ${t.border}`,paddingTop:16,animation:"fadeInUp 0.2s ease" }}>
              <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,flexWrap:"wrap",gap:8 }}>
                <h4 style={{ margin:0,fontSize:14,fontWeight:700,color:t.text }}>
                  {catObj?.emoji} {catObj?.label} — {period==="month"?MONTH_FULL[selectedMonth]:selectedYear}
                </h4>
                <div style={{ display:"flex",alignItems:"center",gap:12 }}>
                  <span style={{ fontSize:15,fontWeight:800,color }}>{fmt(total)}</span>
                  <button onClick={()=>setSelectedPieCategory(null)} style={{ background:"transparent",border:"none",cursor:"pointer",color:t.textMuted,fontSize:20,lineHeight:1,padding:"0 4px" }}>×</button>
                </div>
              </div>
              <div style={{ display:"flex",flexDirection:"column",gap:6 }}>
                {catExpenses.map((e,i)=>{
                  const typeLabel = e.type==="pix"?"PIX":e.type==="debito"?"Débito":"Crédito";
                  return (
                    <div key={e.id||i} style={{ display:"flex",alignItems:"center",gap:12,padding:"10px 14px",borderRadius:12,background:t.surface,border:`1px solid ${color}22` }}>
                      <span style={{ fontSize:18,flexShrink:0 }}>{catObj?.emoji||"📦"}</span>
                      <div style={{ flex:1,minWidth:0 }}>
                        <div style={{ fontSize:13,fontWeight:600,color:t.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{e.description}</div>
                        <div style={{ fontSize:11,color:t.textMuted,marginTop:2 }}>
                          {e.user_label} · {typeLabel} · {e.date?.slice(8,10)}/{e.date?.slice(5,7)}
                          {e.type==="credito"&&parseInt(e.parcelas)>1&&` · ${e.parcelas}x`}
                        </div>
                      </div>
                      <div style={{ display:"flex",alignItems:"center",gap:8,flexShrink:0 }}>
                        <span style={{ fontSize:14,fontWeight:700,color }}>{fmt(parseFloat(e.amount)||0)}</span>
                        {onEditExpense && (
                          <button onClick={()=>setEditItem({...e,_type:"expense"})} title="Editar"
                            style={{ background:"transparent",border:"none",cursor:"pointer",color:t.textMuted,fontSize:13,padding:"4px 6px",borderRadius:6 }}
                            onMouseEnter={ev=>ev.currentTarget.style.color=t.accent}
                            onMouseLeave={ev=>ev.currentTarget.style.color=t.textMuted}>✏️</button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}
      </Card>

      <Card title="📈 Gastos por Categoria — Últimos 6 meses">
        <p style={{ fontSize:12, color:t.textMuted, marginTop:-12, marginBottom:10 }}>Selecione as categorias que deseja visualizar:</p>
        <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:20 }}>
          {availableCatsEvolution.map(cat => {
            const isActive = activeCatIdsForEvolution.includes(cat.id);
            const color = catColorEvolution(cat.id);
            return (
              <button key={cat.id} onClick={() => toggleCatEvolution(cat.id)}
                style={{ padding:"5px 13px", borderRadius:20,
                  border:`1.5px solid ${isActive ? color : t.glassBorder}`,
                  background: isActive ? color+"28" : t.inputBg,
                  color: isActive ? color : t.textSecondary,
                  fontSize:12, fontWeight: isActive ? 700 : 500,
                  cursor:"pointer", transition:"all 0.15s", whiteSpace:"nowrap", lineHeight:"1.6",
                  boxShadow: isActive ? `0 0 0 1px ${color}44` : "none" }}>
                {cat.label}
              </button>
            );
          })}
        </div>
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={catEvolutionData}>
            <CartesianGrid strokeDasharray="3 3" stroke={t.border} vertical={false} />
            <XAxis dataKey="name" tick={{ fill:t.textMuted, fontSize:12 }} axisLine={false} tickLine={false} />
            <YAxis tickFormatter={fmtShort} tick={{ fill:t.textMuted, fontSize:11 }} axisLine={false} tickLine={false} />
            <Tooltip content={<CTip/>} cursor={{ stroke:t.accent, strokeWidth:1, strokeDasharray:"4 4" }} />
            <Legend wrapperStyle={{ fontSize:13, color:t.textSecondary }} />
            {activeCatIdsForEvolution.map(id => {
              const cat = availableCatsEvolution.find(c => c.id === id);
              if (!cat) return null;
              const color = catColorEvolution(id);
              return (
                <Line key={id} type="monotone" dataKey={cat.label}
                  stroke={color} strokeWidth={2.5}
                  dot={{ fill:color, r:4 }} activeDot={{ r:6 }} />
              );
            })}
          </LineChart>
        </ResponsiveContainer>
      </Card>
      </>}

      {chartTab === "incomeExpense" && <>
      <Card title="📊 Receitas × Gastos — Últimos 6 meses">
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={barData} barGap={4} barCategoryGap="25%">
            <CartesianGrid strokeDasharray="3 3" stroke={t.border} vertical={false} />
            <XAxis dataKey="name" tick={{ fill:t.textMuted,fontSize:12 }} axisLine={false} tickLine={false} />
            <YAxis tickFormatter={fmtShort} tick={{ fill:t.textMuted,fontSize:11 }} axisLine={false} tickLine={false} />
            <Tooltip content={<CTip/>} cursor={{ fill:t.chartCursorFill }} />
            <Legend wrapperStyle={{ fontSize:13,color:t.textSecondary }} />
            <Bar dataKey="Receitas" fill={t.success} radius={[6,6,0,0]} />
            <Bar dataKey="Gastos" fill={t.danger} radius={[6,6,0,0]} />
            <Bar dataKey="Saldo" fill={t.accent} radius={[6,6,0,0]} />
          </BarChart>
        </ResponsiveContainer>
      </Card>
      </>}

      {chartTab === "installments" && <>
      <Card title="💳 Parcelas de Crédito — Próximos 12 meses">
        <p style={{ fontSize:12,color:t.textMuted,marginTop:-12,marginBottom:16 }}>Toque em um ponto para ver e editar as parcelas daquele mês.</p>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={creditData}>
            <CartesianGrid strokeDasharray="3 3" stroke={t.border} vertical={false} />
            <XAxis dataKey="name" tick={{ fill:t.textMuted,fontSize:11 }} axisLine={false} tickLine={false} />
            <YAxis tickFormatter={fmtShort} tick={{ fill:t.textMuted,fontSize:11 }} axisLine={false} tickLine={false} />
            <Tooltip content={<CTip/>} cursor={{ stroke:t.accent,strokeWidth:1,strokeDasharray:"4 4" }} />
            <Line type="monotone" dataKey="value" stroke={t.accent} strokeWidth={2.5}
              name="Parcelas" activeDot={false}
              dot={(props) => {
                const { cx, cy, payload } = props;
                const k = `${payload.yr}-${payload.mo}`;
                const isSel = selectedCreditMonth === k;
                return (
                  <g key={k} onClick={()=>setSelectedCreditMonth(prev=>prev===k?null:k)} style={{ cursor:"pointer" }}>
                    <circle cx={cx} cy={cy} r={20} fill="transparent" />
                    <circle cx={cx} cy={cy} r={isSel?9:5} fill={isSel?"#fff":t.accent} stroke={t.accent} strokeWidth={isSel?3:0} />
                  </g>
                );
              }}
            />
          </LineChart>
        </ResponsiveContainer>
        {selectedCreditMonth && (() => {
          const md = creditData.find(d=>`${d.yr}-${d.mo}`===selectedCreditMonth);
          if (!md?.items?.length) return null;
          return (
            <div style={{ marginTop:20,borderTop:`1px solid ${t.border}`,paddingTop:16,animation:"fadeInUp 0.2s ease" }}>
              <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12 }}>
                <h4 style={{ margin:0,fontSize:14,fontWeight:700,color:t.text }}>💳 Parcelas em {md.name}</h4>
                <div style={{ display:"flex",alignItems:"center",gap:12 }}>
                  <span style={{ fontSize:15,fontWeight:800,color:t.accent }}>{fmt(md.value)}</span>
                  <button onClick={()=>setSelectedCreditMonth(null)} style={{ background:"transparent",border:"none",cursor:"pointer",color:t.textMuted,fontSize:20,lineHeight:1,padding:"0 4px" }}>×</button>
                </div>
              </div>
              <div style={{ display:"flex",flexDirection:"column",gap:8 }}>
                {md.items.map((e,i) => {
                  const cat = CATEGORIES.find(c=>c.id===e.category);
                  return (
                    <div key={i} style={{ display:"flex",alignItems:"center",gap:12,padding:"10px 14px",borderRadius:12,background:t.dangerSoft,border:`1px solid ${t.danger}22` }}>
                      <span style={{ fontSize:20,flexShrink:0 }}>{cat?.emoji||"💳"}</span>
                      <div style={{ flex:1,minWidth:0 }}>
                        <div style={{ fontSize:13,fontWeight:600,color:t.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{e.description}</div>
                        <div style={{ fontSize:11,color:t.textMuted,marginTop:2 }}>{e.user_label} · Parcela {e._installNum} de {e._installTotal} · dia {e.date?.slice(8,10)}</div>
                      </div>
                      <div style={{ display:"flex",alignItems:"center",gap:8,flexShrink:0 }}>
                        <span style={{ fontSize:14,fontWeight:700,color:t.danger }}>{fmt(parseFloat(e.amount)||0)}</span>
                        {onEditExpense && (
                          <button onClick={()=>setEditItem({...e,_type:"expense"})} title="Editar"
                            style={{ background:"transparent",border:"none",cursor:"pointer",color:t.textMuted,fontSize:13,padding:"4px 6px",borderRadius:6 }}
                            onMouseEnter={ev=>ev.currentTarget.style.color=t.accent}
                            onMouseLeave={ev=>ev.currentTarget.style.color=t.textMuted}>✏️</button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}
      </Card>

      <Card title="💳 Gráfico de Faturas — Próximos 12 meses">
          <p style={{ fontSize:12,color:t.textMuted,marginTop:-12,marginBottom:16 }}>Toque em uma barra para ver os lançamentos daquela fatura.</p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={billingChartData} barCategoryGap="30%"
              onClick={d=>{ if(d?.activePayload?.[0]) { const p=d.activePayload[0].payload; const k=`${p.yr}-${p.mo}`; setSelectedBillingMonth(prev=>prev===k?null:k); } }}>
              <CartesianGrid strokeDasharray="3 3" stroke={t.border} vertical={false} />
              <XAxis dataKey="name" tick={{ fill:t.textMuted,fontSize:11 }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={fmtShort} tick={{ fill:t.textMuted,fontSize:11 }} axisLine={false} tickLine={false} />
              <Tooltip content={<CTip/>} cursor={{ fill:t.chartCursorFill }} />
              <Bar dataKey="value" name="Fatura" fill={t.accent} radius={[6,6,0,0]}
                onClick={d=>{ const k=`${d.yr}-${d.mo}`; setSelectedBillingMonth(prev=>prev===k?null:k); }}
                style={{ cursor:"pointer" }}
              />
            </BarChart>
          </ResponsiveContainer>
          {selectedBillingMonth && (() => {
            const md = billingChartData.find(d=>`${d.yr}-${d.mo}`===selectedBillingMonth);
            if (!md?.items?.length) return null;
            return (
              <div style={{ marginTop:20,borderTop:`1px solid ${t.border}`,paddingTop:16,animation:"fadeInUp 0.2s ease" }}>
                <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12 }}>
                  <h4 style={{ margin:0,fontSize:14,fontWeight:700,color:t.text }}>💳 Fatura de {md.name}</h4>
                  <div style={{ display:"flex",alignItems:"center",gap:12 }}>
                    <span style={{ fontSize:15,fontWeight:800,color:t.accent }}>{fmt(md.value)}</span>
                    <button onClick={()=>setSelectedBillingMonth(null)} style={{ background:"transparent",border:"none",cursor:"pointer",color:t.textMuted,fontSize:20,lineHeight:1,padding:"0 4px" }}>×</button>
                  </div>
                </div>
                <div style={{ display:"flex",flexDirection:"column",gap:8 }}>
                  {md.items.map((e,i) => {
                    const cat = CATEGORIES.find(c=>c.id===e.category);
                    return (
                      <div key={i} style={{ display:"flex",alignItems:"center",gap:12,padding:"10px 14px",borderRadius:12,background:e._isRecurring?t.warningSoft:t.accentSoft,border:`1px solid ${e._isRecurring?t.warning+"33":t.accent+"22"}` }}>
                        <span style={{ fontSize:20,flexShrink:0 }}>{cat?.emoji||"💳"}</span>
                        <div style={{ flex:1,minWidth:0 }}>
                          <div style={{ fontSize:13,fontWeight:600,color:t.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{e.description}</div>
                          <div style={{ fontSize:11,color:t.textMuted,marginTop:2 }}>
                            {e._isRecurring ? "🔁 Recorrente" : e.user_label}
                            {!e._isRecurring && (e._installTotal>1?` · Parcela ${e._installNum} de ${e._installTotal}`:"")}
                            {` · compra dia ${e.date?.slice(8,10)}`}
                          </div>
                        </div>
                        <div style={{ display:"flex",alignItems:"center",gap:8,flexShrink:0 }}>
                          <span style={{ fontSize:14,fontWeight:700,color:e._isRecurring?t.warning:t.accent }}>{fmt(parseFloat(e.amount)||0)}</span>
                          {!e._isRecurring && onEditExpense && (
                            <button onClick={()=>setEditItem({...e,_type:"expense"})} title="Editar"
                              style={{ background:"transparent",border:"none",cursor:"pointer",color:t.textMuted,fontSize:13,padding:"4px 6px",borderRadius:6 }}
                              onMouseEnter={ev=>ev.currentTarget.style.color=t.accent}
                              onMouseLeave={ev=>ev.currentTarget.style.color=t.textMuted}>✏️</button>
                          )}

                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}
        </Card>
      </>}

      </div>{/* end swipe area */}

      {/* Page dots */}
      <div style={{ display:"flex", justifyContent:"center", gap:6 }}>
        {TAB_ORDER.map(id => (
          <div key={id} style={{ height:6, width:chartTab===id?18:6, borderRadius:3, background:chartTab===id?t.accent:t.border, transition:"all 0.2s" }} />
        ))}
      </div>

      {editItem && (
        <div onClick={e=>{ if(e.target===e.currentTarget) setEditItem(null); }}
          style={{ position:"fixed",inset:0,zIndex:500,background:"rgba(0,0,0,0.65)",backdropFilter:"blur(10px)",display:"flex",alignItems:"center",justifyContent:"center",padding:20 }}>
          <div onClick={e=>e.stopPropagation()}
            style={{ background:t.glassModal,border:`1.5px solid ${t.glassBorder}`,borderRadius:24,padding:"24px 20px 20px",width:"100%",maxWidth:460,maxHeight:"90vh",overflowY:"auto",boxShadow:t.shadow,animation:"modalIn 0.25s ease" }}>
            <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20 }}>
              <h3 style={{ margin:0,fontSize:17,fontWeight:800,color:t.text,letterSpacing:"-0.02em" }}>✏️ Editar Lançamento</h3>
              <button onClick={()=>setEditItem(null)} style={{ background:"transparent",border:"none",cursor:"pointer",color:t.textMuted,fontSize:22,lineHeight:1,padding:"2px 8px",borderRadius:8 }}>×</button>
            </div>
            <EditModal t={t} item={editItem} onClose={()=>setEditItem(null)} familyMembers={familyMembers||[]} cards={cards}
              onSave={async(payload)=>{ if(onEditExpense) await onEditExpense(payload); setEditItem(null); }} />
          </div>
        </div>
      )}
    </div>
  );
}


// ─── MEMBER SELECT — shows family members by name or email ───────────────────
function MemberSelect({ label, t, value, onChange, familyMembers }) {
  const members = familyMembers && familyMembers.length > 0
    ? familyMembers
    : [{ user_id: "you", first_name: "", last_name: "", email: "Você" }];

  const displayName = (m) => {
    const name = [m.first_name, m.last_name].filter(Boolean).join(" ").trim();
    return name || m.email || "Membro";
  };

  return (
    <Select label={label} t={t} value={value} onChange={onChange}>
      {members.map(m => (
        <option key={m.user_id || m.email} value={displayName(m)}>
          👤 {displayName(m)}
        </option>
      ))}
    </Select>
  );
}

// ─── EXPENSE FORM ─────────────────────────────────────────────────────────────
function ExpenseForm({ t, onSave, onClose, familyMembers, initialDate, cards = [], currentUserLabel = "Você" }) {
  const [form, setForm] = useState({ description:"", amount:"", installAmount:"", date:initialDate || today.toISOString().slice(0,10), category:"", type:"pix", parcelas:1, user_label:currentUserLabel, card_id:"" });
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurringForm, setRecurringForm] = useState({ frequency:"monthly", day_of_month:today.getDate(), amount_type:"fixed", end_date:"" });
  const [saving, setSaving] = useState(false);
  const setR = (k, v) => setRecurringForm(p => ({ ...p, [k]: v }));

  const set = (k, v) => {
    let next = { ...form, [k]: v };
    if (k === "description" && !form.category) next.category = autoCategory(v);
    if (k === "installAmount") {
      const inst = parseFloat(v) || 0;
      const n = parseInt(next.parcelas) || 1;
      next.amount = n > 1 ? (inst * n).toFixed(2) : v;
    }
    if (k === "amount") {
      const total = parseFloat(v) || 0;
      const n = parseInt(next.parcelas) || 1;
      if (total > 0 && n > 1) next.installAmount = (total / n).toFixed(2);
      else next.installAmount = "";
    }
    if (k === "parcelas") {
      const n = parseInt(v) || 0;
      if (n > 1) {
        if (parseFloat(form.installAmount) > 0) next.amount = (parseFloat(form.installAmount) * n).toFixed(2);
        else if (parseFloat(form.amount) > 0) next.installAmount = (parseFloat(form.amount) / n).toFixed(2);
      } else if (n === 1) {
        next.installAmount = "";
        if (!next.amount) next.amount = form.installAmount;
      }
    }
    setForm(next);
  };

  const handle = () => {
    if (saving) return;
    if (!form.description) return;
    const isCredit = form.type === "credito";
    const parcelas = parseInt(form.parcelas) || 1;
    const effectiveAmount = isCredit && parcelas > 1
      ? (parseFloat(form.installAmount) || parseFloat(form.amount) / parcelas)
      : parseFloat(form.amount);
    if (!effectiveAmount) return;
    setSaving(true);
    onSave({
      ...form, amount: effectiveAmount, parcelas, id: Date.now(),
      _recurring: isRecurring ? recurringForm : null,
    });
  };

  const isCredit = form.type === "credito";
  const parcelas = parseInt(form.parcelas) || 1;
  const totalValue = parseFloat(form.amount) || 0;

  const creditInfo = isCredit && parcelas > 1 && form.date ? (() => {
    const d = new Date(form.date + "T12:00:00");
    const last = new Date(d);
    last.setMonth(last.getMonth() + parcelas - 1);
    return `Propagado de ${MONTHS[d.getMonth()]}/${d.getFullYear()} até ${MONTHS[last.getMonth()]}/${last.getFullYear()} · Total: ${fmt(totalValue)}`;
  })() : null;

  return (
    <div>
      {/* Field order: Descrição, Quem pagou, Tipo, then value fields */}
      <Input label="Descrição / Estabelecimento" t={t} value={form.description} onChange={e=>set("description",e.target.value)} placeholder="Ex: iFood, Uber, Supermercado..." />
      <MemberSelect label="Quem pagou?" t={t} value={form.user_label} onChange={e=>set("user_label",e.target.value)} familyMembers={familyMembers} />
      <Select label="Tipo de pagamento" t={t} value={form.type} onChange={e=>set("type",e.target.value)}>
        <option value="pix">💸 PIX</option>
        <option value="debito">🏦 Débito</option>
        <option value="credito">💳 Crédito</option>
      </Select>
      {isCredit && cards.length > 0 && (
        <Select label="Cartão" t={t} value={form.card_id} onChange={e=>set("card_id",e.target.value)}>
          <option value="">Sem cartão específico</option>
          {cards.map(c=><option key={c.id} value={c.id}>{c.name}{c.holder ? ` — ${c.holder}` : ""}</option>)}
        </Select>
      )}
      <Select label="Categoria" t={t} value={form.category} onChange={e=>set("category",e.target.value)}>
        <option value="">Selecione...</option>
        {CATEGORIES.map(c=><option key={c.id} value={c.id}>{c.emoji} {c.label}</option>)}
      </Select>
      {isCredit ? (
        <>
          {/* Credit: parcelas + date row, then installAmount ↔ total row */}
          <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:12 }}>
            <div>
              <Input label="Nº de parcelas" t={t} type="number" min={1} max={48} value={form.parcelas} onChange={e=>set("parcelas",e.target.value)} placeholder="Ex: 12" />
              {(form.parcelas===""||parseInt(form.parcelas)<1)&&<div style={{ fontSize:11,color:t.danger,marginTop:-12,marginBottom:8 }}>Informe um valor maior que zero.</div>}
            </div>
            <DateInput label="Data" t={t} value={form.date} onChange={e=>set("date",e.target.value)} />
          </div>
          <div style={{ fontSize:11,color:t.warning,marginTop:-10,marginBottom:12,lineHeight:1.5 }}>⚠️ Informe quando a <strong>1ª parcela cai na fatura</strong>, não a data da compra.</div>
          <div style={{ display:"grid",gridTemplateColumns:"1fr auto 1fr",gap:8,alignItems:"center",minWidth:0 }}>
            <Input label="Parcela (R$)" t={t} type="number" step="0.01" value={form.installAmount} onChange={e=>set("installAmount",e.target.value)} placeholder="0,00" />
            <div style={{ paddingTop:18,color:t.textMuted,fontSize:16,textAlign:"center",userSelect:"none" }}>↔</div>
            <Input label="Total (R$)" t={t} type="number" step="0.01" value={form.amount} onChange={e=>set("amount",e.target.value)} placeholder="0,00" />
          </div>
          {creditInfo && (
            <div style={{ marginBottom:16,padding:"10px 14px",borderRadius:12,background:"rgba(124,106,247,0.08)",fontSize:12,color:"#7c6af7",fontWeight:600,border:"1px solid rgba(124,106,247,0.2)",display:"flex",alignItems:"center",gap:8 }}>
              💳 {creditInfo}
            </div>
          )}
        </>
      ) : (
        <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,minWidth:0,overflow:"hidden" }}>
          <Input label="Valor (R$)" t={t} type="number" step="0.01" value={form.amount} onChange={e=>set("amount",e.target.value)} placeholder="0,00" />
          <DateInput label="Data" t={t} value={form.date} onChange={e=>set("date",e.target.value)} />
        </div>
      )}
      {form.category && (
        <div style={{ marginBottom:16,padding:"10px 14px",borderRadius:12,background:t.accentSoft,fontSize:13,color:t.accent,fontWeight:600,border:`1px solid ${t.accent}33`,display:"flex",alignItems:"center",gap:8 }}>
          ✨ {CATEGORIES.find(c=>c.id===form.category)?.emoji} {CATEGORIES.find(c=>c.id===form.category)?.label}
        </div>
      )}

      {/* ── Recurring toggle ── */}
      <div style={{ marginBottom:16 }}>
        <button type="button" onClick={()=>setIsRecurring(v=>!v)}
          style={{ width:"100%",padding:"10px 14px",borderRadius:12,border:`1.5px solid ${isRecurring?t.accent:t.border}`,background:isRecurring?t.accentSoft:"transparent",color:isRecurring?t.accent:t.textMuted,fontSize:13,fontWeight:600,cursor:"pointer",display:"flex",alignItems:"center",gap:8,transition:"all 0.2s",textAlign:"left" }}>
          <span style={{ fontSize:16 }}>{isRecurring?"🔁":"🔁"}</span>
          {isRecurring ? "Gasto recorrente ativado" : "Tornar recorrente?"}
          <span style={{ marginLeft:"auto",fontSize:11,opacity:0.7 }}>{isRecurring?"▲ ocultar":"▼ configurar"}</span>
        </button>
        {isRecurring && (
          <div style={{ marginTop:12,padding:"14px 14px 2px",borderRadius:12,background:t.surface,border:`1px solid ${t.accent}33` }}>
            <Select label="Frequência" t={t} value={recurringForm.frequency} onChange={e=>setR("frequency",e.target.value)}>
              <option value="monthly">📅 Mensal</option>
              <option value="weekly">📅 Semanal</option>
              <option value="yearly">📅 Anual</option>
            </Select>
            <Input label="Dia de vencimento" t={t} type="number" min={1} max={31} value={recurringForm.day_of_month} onChange={e=>setR("day_of_month",e.target.value)} />
            <div style={{ marginBottom:16 }}>
              <label style={{ display:"block",marginBottom:8,fontSize:13,fontWeight:600,color:t.textSecondary }}>Tipo de valor</label>
              <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:8 }}>
                {[{v:"fixed",label:"💰 Fixo"},{v:"variable",label:"🔔 Variável"}].map(opt=>(
                  <button key={opt.v} type="button" onClick={()=>setR("amount_type",opt.v)}
                    style={{ padding:"9px 10px",borderRadius:10,border:`1.5px solid ${recurringForm.amount_type===opt.v?t.accent:t.border}`,background:recurringForm.amount_type===opt.v?t.accentSoft:"transparent",color:recurringForm.amount_type===opt.v?t.accent:t.textMuted,fontSize:12,fontWeight:700,cursor:"pointer",transition:"all 0.2s" }}>
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <DateInput label="Data de término (opcional)" t={t} value={recurringForm.end_date} onChange={e=>setR("end_date",e.target.value)} />
          </div>
        )}
      </div>

      <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginTop:8 }}>
        <Btn t={t} variant="ghost" type="button" onClick={onClose}>Cancelar</Btn>
        <Btn t={t} type="button" onClick={handle} disabled={saving}
          style={{ opacity: saving ? 0.7 : 1 }}>
          {saving ? "Salvando..." : "💾 Salvar"}
        </Btn>
      </div>
    </div>
  );
}

// ─── INCOME FORM ──────────────────────────────────────────────────────────────
function IncomeForm({ t, onSave, onClose, familyMembers, initialDate, currentUserLabel = "Você" }) {
  const [form, setForm] = useState({ description:"Salário", amount:"", date:initialDate || today.toISOString().slice(0,10), source:"salario", category:"salario", user_label:currentUserLabel });
  const [saving, setSaving] = useState(false);

  const handle = () => {
    if (saving || !form.amount) return;
    setSaving(true);
    onSave({ ...form, source: form.category, amount:parseFloat(form.amount), id:Date.now() });
  };

  return (
    <div>
      <Input label="Descrição" t={t} value={form.description} onChange={e=>setForm({...form,description:e.target.value})} placeholder="Ex: Salário, Freelance..." />
      <MemberSelect label="Quem recebeu?" t={t} value={form.user_label} onChange={e=>setForm({...form,user_label:e.target.value})} familyMembers={familyMembers} />
      <Select label="Categoria" t={t} value={form.category} onChange={e=>setForm({...form,category:e.target.value,source:e.target.value})}>
        {INCOME_SOURCES.map(s=><option key={s.id} value={s.id}>{s.emoji} {s.label}</option>)}
      </Select>
      <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,minWidth:0,overflow:"hidden" }}>
        <Input label="Valor (R$)" t={t} type="number" step="0.01" value={form.amount} onChange={e=>setForm({...form,amount:e.target.value})} placeholder="0,00" />
        <DateInput label="Data" t={t} value={form.date} onChange={e=>setForm({...form,date:e.target.value})} />
      </div>
      <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginTop:8 }}>
        <Btn t={t} variant="ghost" type="button" onClick={onClose}>Cancelar</Btn>
        <Btn t={t} variant="success" type="button" onClick={handle} disabled={saving}
          style={{ opacity: saving ? 0.7 : 1 }}>
          {saving ? "Salvando..." : "💾 Salvar"}
        </Btn>
      </div>
    </div>
  );
}


// ─── EDIT MODAL ───────────────────────────────────────────────────────────────
function EditModal({ t, item, onSave, onClose, familyMembers, cards = [] }) {
  const isExp = item._type === "expense";
  const initParc = item.parcelas || 1;
  const isCredit = isExp && (item.type || "pix") === "credito";
  // amount in DB is already the installment value for multi-installment credit
  const initInst = isCredit && initParc > 1 ? String(parseFloat(item.amount || 0).toFixed(2)) : "";
  // For display: the "total" field shows installment * parcelas
  const initTotal = isCredit && initParc > 1 ? String((parseFloat(item.amount || 0) * initParc).toFixed(2)) : String(item.amount || "");
  const [form, setForm] = useState({
    description:   item.description || "",
    amount:        initTotal,      // shown as total (display only for credit)
    installAmount: initInst,       // the actual stored value per month
    date:          item.date?.slice(0,10) || new Date().toISOString().slice(0,10),
    category:      item.category || (isExp ? "outros" : "salario"),
    type:          item.type || "pix",
    parcelas:      initParc,
    user_label:    item.user_label || "Você",
    source:        item.source || item.category || "salario",
    card_id:       item.card_id || "",
  });
  const [loading, setLoading] = useState(false);

  const set = (k, v) => {
    setForm(p => {
      const next = { ...p, [k]: v };
      const n = parseInt(next.parcelas) || 1;
      const isCredit = next.type === "credito";
      if (k === "installAmount" && isCredit && n > 1) {
        // installAmount → recalc total display
        next.amount = (parseFloat(v) * n).toFixed(2);
      }
      if (k === "amount" && isCredit && n > 1) {
        // total typed → recalc installAmount
        next.installAmount = (parseFloat(v) / n).toFixed(2);
      }
      if (k === "parcelas") {
        const newN = parseInt(v) || 0;
        const inst = parseFloat(p.installAmount) || 0;
        const total = parseFloat(p.amount) || 0;
        if (newN > 1) {
          if (inst > 0) next.amount = (inst * newN).toFixed(2);
          else if (total > 0) next.installAmount = (total / newN).toFixed(2);
        } else if (newN === 1) {
          next.installAmount = "";
          if (!next.amount) next.amount = p.installAmount || p.amount;
        }
      }
      return next;
    });
  };

  const handle = async () => {
    if (!form.description.trim()) return;
    setLoading(true);
    const parcelas = parseInt(form.parcelas) || 1;
    const isCreditMulti = isExp && form.type === "credito" && parcelas > 1;
    // installAmount holds the per-month value for credit; amount holds the total (display only)
    const effectiveAmount = isCreditMulti
      ? (parseFloat(form.installAmount) || 0)
      : parseFloat(form.amount) || 0;
    if (!effectiveAmount) { setLoading(false); return; }
    const payload = {
      ...item,
      description: form.description.trim(),
      amount:      effectiveAmount,
      date:        form.date,
      category:    isExp ? form.category : form.source,
      user_label:  form.user_label,
      ...(isExp ? { type: form.type, parcelas, card_id: form.card_id || null } : { source: form.category, category: form.category }),
    };
    await onSave(payload);
    setLoading(false);
  };

  return (
    <div>
      <div style={{ display:"flex",alignItems:"center",gap:10,marginBottom:20,padding:"10px 14px",borderRadius:12,
        background: isExp ? "rgba(248,113,113,0.08)" : "rgba(52,211,153,0.08)",
        border: `1px solid ${isExp ? "rgba(248,113,113,0.2)" : "rgba(52,211,153,0.2)"}` }}>
        <span style={{ fontSize:22 }}>{isExp ? "💸" : "💰"}</span>
        <span style={{ fontSize:13,fontWeight:700,color: isExp ? "#f87171" : "#34d399" }}>
          {isExp ? "Editar Gasto" : "Editar Receita"}
        </span>
      </div>

      <Input label="Descrição" t={t} value={form.description}
        onChange={e=>set("description",e.target.value)} placeholder="Ex: iFood, Salário..." />

      {isExp ? (<>
        {/* Same layout as ExpenseForm: Quem pagou → Tipo → Categoria → values */}
        <MemberSelect label="Quem pagou?" t={t} value={form.user_label} onChange={e=>set("user_label",e.target.value)} familyMembers={familyMembers} />
        <Select label="Tipo de pagamento" t={t} value={form.type} onChange={e=>set("type",e.target.value)}>
          <option value="pix">💸 PIX</option>
          <option value="debito">🏦 Débito</option>
          <option value="credito">💳 Crédito</option>
        </Select>
        {form.type === "credito" && cards.length > 0 && (
          <Select label="Cartão" t={t} value={form.card_id} onChange={e=>set("card_id",e.target.value)}>
            <option value="">Sem cartão específico</option>
            {cards.map(c=><option key={c.id} value={c.id}>{c.name}{c.holder ? ` — ${c.holder}` : ""}</option>)}
          </Select>
        )}
        <Select label="Categoria" t={t} value={form.category} onChange={e=>set("category",e.target.value)}>
          {CATEGORIES.map(c=><option key={c.id} value={c.id}>{c.emoji} {c.label}</option>)}
        </Select>
        {form.type === "credito" ? (() => {
          const parcelas = parseInt(form.parcelas) || 1;
          const instAmt = parseFloat(form.installAmount) || 0;
          const totalVal = parcelas > 1 ? instAmt * parcelas : parseFloat(form.amount) || 0;
          const creditInfo = parcelas > 1 && form.date ? (() => {
            const d = new Date(form.date + "T12:00:00");
            const last = new Date(d);
            last.setMonth(last.getMonth() + parcelas - 1);
            return `Propagado de ${MONTHS[d.getMonth()]}/${d.getFullYear()} até ${MONTHS[last.getMonth()]}/${last.getFullYear()} · Total: ${fmt(totalVal)}`;
          })() : null;
          return (<>
            <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:12 }}>
              <div>
                <Input label="Nº de parcelas" t={t} type="number" min={1} max={48}
                  value={form.parcelas} onChange={e=>set("parcelas",e.target.value)} placeholder="Ex: 12" />
                {(form.parcelas===""||parseInt(form.parcelas)<1)&&<div style={{ fontSize:11,color:t.danger,marginTop:-12,marginBottom:8 }}>Informe um valor maior que zero.</div>}
              </div>
              <DateInput label="Data" t={t} value={form.date} onChange={e=>set("date",e.target.value)} />
            </div>
            <div style={{ fontSize:11,color:t.warning,marginTop:-10,marginBottom:12,lineHeight:1.5 }}>⚠️ Informe quando a <strong>1ª parcela cai na fatura</strong>, não a data da compra.</div>
            <div style={{ display:"grid",gridTemplateColumns:"1fr auto 1fr",gap:8,alignItems:"center",minWidth:0 }}>
              <Input label="Parcela (R$)" t={t} type="number" step="0.01"
                value={form.installAmount} onChange={e=>set("installAmount",e.target.value)} placeholder="0,00" />
              <div style={{ paddingTop:18,color:t.textMuted,fontSize:16,textAlign:"center",userSelect:"none" }}>↔</div>
              <Input label="Total (R$)" t={t} type="number" step="0.01"
                value={form.amount} onChange={e=>set("amount",e.target.value)} placeholder="0,00" />
            </div>
            {creditInfo && (
              <div style={{ marginBottom:16,padding:"10px 14px",borderRadius:12,background:"rgba(124,106,247,0.08)",fontSize:12,color:"#7c6af7",fontWeight:600,border:"1px solid rgba(124,106,247,0.2)",display:"flex",alignItems:"center",gap:8 }}>
                💳 {creditInfo}
              </div>
            )}
          </>);
        })() : (
          <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,minWidth:0,overflow:"hidden" }}>
            <Input label="Valor (R$)" t={t} type="number" step="0.01" value={form.amount}
              onChange={e=>set("amount",e.target.value)} placeholder="0,00" />
            <DateInput label="Data" t={t} value={form.date} onChange={e=>set("date",e.target.value)} />
          </div>
        )}
      </>) : (<>
        {/* Income: Quem recebeu → Categoria → Valor + Data */}
        <MemberSelect label="Quem recebeu?" t={t} value={form.user_label} onChange={e=>set("user_label",e.target.value)} familyMembers={familyMembers} />
        <Select label="Categoria" t={t} value={form.category} onChange={e=>set("category",e.target.value,set("source",e.target.value))}>
          {INCOME_SOURCES.map(s=><option key={s.id} value={s.id}>{s.emoji} {s.label}</option>)}
        </Select>
        <Input label="Valor (R$)" t={t} type="number" step="0.01" value={form.amount}
          onChange={e=>set("amount",e.target.value)} placeholder="0,00" />
        <DateInput label="Data" t={t} value={form.date} onChange={e=>set("date",e.target.value)} />
      </>)}

      <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginTop:8 }}>
        <Btn t={t} variant="ghost" type="button" onClick={onClose}>Cancelar</Btn>
        <Btn t={t} type="button" onClick={handle} disabled={loading}>
          {loading ? "Salvando..." : "💾 Salvar"}
        </Btn>
      </div>
    </div>
  );
}

// ─── DATE GROUPING HELPERS ────────────────────────────────────────────────────
const WEEK_DAYS = ["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"];

function formatDateHeader(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0,10).split("-").map(Number);
  const date = new Date(y, m-1, d);
  const now = new Date();
  const todayD = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((date - todayD) / 86400000);
  if (diff === 0) return "Hoje";
  if (diff === -1) return "Ontem";
  if (diff === 1) return "Amanhã";
  return `${WEEK_DAYS[date.getDay()]}, ${d} de ${MONTH_FULL[m-1]}`;
}

function groupByDate(items) {
  const map = new Map();
  items.forEach(item => {
    const key = (item.date||"").slice(0,10);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  });
  return Array.from(map.entries())
    .sort((a,b) => b[0].localeCompare(a[0]))
    .map(([date, its]) => ({
      date,
      label: formatDateHeader(date),
      items: its,
      net: its.reduce((s,i) => s + (i._type==="income"?1:-1)*(parseFloat(i.amount)||0), 0),
    }));
}

// ─── USE DEBOUNCE ─────────────────────────────────────────────────────────────
function useDebounce(value, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

// ─── HIGHLIGHT ────────────────────────────────────────────────────────────────
function Highlight({ text = "", term = "", t }) {
  if (!term.trim()) return <span>{text}</span>;
  const idx = text.toLowerCase().indexOf(term.toLowerCase());
  if (idx === -1) return <span>{text}</span>;
  return (
    <span>
      {text.slice(0, idx)}
      <mark style={{ background: t.accentSoft, color: t.accent, borderRadius: 3, padding: "0 2px" }}>
        {text.slice(idx, idx + term.length)}
      </mark>
      {text.slice(idx + term.length)}
    </span>
  );
}

// ─── USE LONG PRESS HOOK ──────────────────────────────────────────────────────
function useLongPress(onTrigger, ms = 500) {
  const [pressingId, setPressingId] = useState(null);
  const timerRef = useRef(null);

  const start = useCallback((id) => {
    setPressingId(id);
    timerRef.current = setTimeout(() => {
      setPressingId(null);
      navigator.vibrate?.(30);
      onTrigger(id);
    }, ms);
  }, [onTrigger, ms]);

  const cancel = useCallback(() => {
    clearTimeout(timerRef.current);
    setPressingId(null);
  }, []);

  return { pressingId, start, cancel };
}

// ─── TRANSACTIONS ─────────────────────────────────────────────────────────────
function TransactionsList({ expenses, incomes, t, onDeleteExpense, onDeleteIncome, onDeleteAllExpenses, onDeleteAllIncomes, onEditExpense, onEditIncome, familyMembers, cards = [], currentUserLabel = "Você", billingPeriods = [] }) {
  // ── Period / window state ──
  // anchorMonth/anchorYear = the reference month shown in the period header
  const [anchorMonth, setAnchorMonth] = useState(today.getMonth());
  const [anchorYear, setAnchorYear] = useState(today.getFullYear());
  // window: '1m' | '3m' | '6m' | '9m' | '1y'
  const [win, setWin] = useState("1m");

  // ── Filter state ──
  const [filter, setFilter] = useState("all"); // 'all' | 'expense' | 'income'
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const [paymentFilter, setPaymentFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [memberFilter, setMemberFilter] = useState("all");
  const [billingMode, setBillingMode] = useState("purchase"); // 'purchase' | 'billing'
  const [showDupsOnly, setShowDupsOnly] = useState(false);
  const [showActionSheet, setShowActionSheet] = useState(false);

  // ── Selection mode state ──
  const [selMode, setSelMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [confirmOpts, setConfirmOpts] = useState(null);
  const openConfirm = (title, message, onConfirm) => setConfirmOpts({ title, message, onConfirm });
  const closeConfirm = () => setConfirmOpts(null);

  // ── Edit modal state ──
  const [editItem, setEditItem] = useState(null);

  // ── Window definitions ──
  const WINDOWS = [
    { id: "1m",  label: "1 mês"   },
    { id: "3m",  label: "3 meses" },
    { id: "6m",  label: "6 meses" },
    { id: "9m",  label: "9 meses" },
    { id: "1y",  label: "1 ano"   },
  ];

  // Period header title & subtitle
  const periodTitle = useMemo(() => {
    const shortYr = String(anchorYear).slice(2);
    const curShortYr = String(today.getFullYear()).slice(2);
    if (win === "1m") return `${MONTH_FULL[anchorMonth]} ${anchorYear}`;
    const winMonths = win==="3m"?3:win==="6m"?6:win==="9m"?9:12;
    // start = (anchorMonth - winMonths + 1) months from anchor
    const startTotal = anchorMonth - winMonths + 1;
    const startMo = ((startTotal % 12) + 12) % 12;
    const startYr = anchorYear + Math.floor(startTotal / 12);
    const sShort = String(startYr).slice(2);
    const eShort = String(anchorYear).slice(2);
    if (startYr === anchorYear) {
      return `${MONTHS[startMo]} – ${MONTHS[anchorMonth]} ${anchorYear}`;
    }
    return `${MONTHS[startMo]}/${sShort} – ${MONTHS[anchorMonth]}/${eShort}`;
  }, [anchorMonth, anchorYear, win]);

  const periodSubtitle = useMemo(() => {
    if (win === "1m") return null; // will show count
    const winMonths = win==="3m"?3:win==="6m"?6:win==="9m"?9:12;
    return `ÚLTIMOS ${winMonths} MESES`;
  }, [win]);

  // Navigate anchor month
  const prevMonth = () => {
    if (anchorMonth === 0) { setAnchorMonth(11); setAnchorYear(y => y - 1); }
    else setAnchorMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (anchorMonth === 11) { setAnchorMonth(0); setAnchorYear(y => y + 1); }
    else setAnchorMonth(m => m + 1);
  };

  // Derive unique member labels — "Você" é substituído pelo nome real do usuário logado no display
  const memberOptions = useMemo(() => {
    const labels = new Set();
    [...expenses, ...incomes].forEach(item => {
      const lbl = item.user_label?.trim();
      if (!lbl) return;
      // Exibe o nome real em vez de "Você" para o usuário atual
      if (lbl === "Você" && currentUserLabel !== "Você") {
        labels.add(currentUserLabel);
      } else {
        labels.add(lbl);
      }
    });
    return Array.from(labels).sort();
  }, [expenses, incomes, currentUserLabel]);

  // ── "all" — items in the selected window ──
  const all = useMemo(() => {
    // Compute date range from anchor + window
    let fromStr, toStr;
    if (win === "1m") {
      fromStr = `${anchorYear}-${String(anchorMonth+1).padStart(2,"0")}-01`;
      // last day of anchor month
      const lastDay = new Date(anchorYear, anchorMonth+1, 0).getDate();
      toStr = `${anchorYear}-${String(anchorMonth+1).padStart(2,"0")}-${lastDay}`;
    } else {
      const winMonths = win==="3m"?3:win==="6m"?6:win==="9m"?9:12;
      const startTotal = anchorMonth - winMonths + 1;
      const startMo = ((startTotal % 12) + 12) % 12;
      const startYr = anchorYear + Math.floor(startTotal / 12);
      fromStr = `${startYr}-${String(startMo+1).padStart(2,"0")}-01`;
      const lastDay = new Date(anchorYear, anchorMonth+1, 0).getDate();
      toStr = `${anchorYear}-${String(anchorMonth+1).padStart(2,"0")}-${lastDay}`;
    }

    const matchesExpPeriod = (e) => {
      if (billingMode === "billing" && e.type === "credito") {
        const card = cards.find(c => c.id === e.card_id);
        const cardPeriods = billingPeriods.filter(p => p.card_id === e.card_id);
        const bm = getBillingMonth(e.date, cardPeriods, card?.closing_day ?? 28);
        if (!bm) return false;
        const bmStr = `${bm.year}-${String(bm.month).padStart(2,"0")}-01`;
        return bmStr >= fromStr && bmStr <= toStr;
      }
      return e.date >= fromStr && e.date <= toStr;
    };

    return [
      ...expenses.filter(e => matchesExpPeriod(e)).map(e => ({...e, _type:"expense"})),
      ...incomes.filter(i => i.date >= fromStr && i.date <= toStr).map(i => ({...i, _type:"income"}))
    ].sort((a,b) => b.date?.localeCompare(a.date));
  }, [expenses, incomes, anchorMonth, anchorYear, win, billingMode, cards]);

  // ── Duplicate detection ──
  const dupIds = useMemo(() => {
    const seen = new Map();
    const dups = new Set();
    const sorted = [...all].sort((a,b) => a.date?.localeCompare(b.date) || 0);
    sorted.forEach(item => {
      const key = [
        item.date?.slice(0,10),
        (item.description||"").toLowerCase().trim().replace(/\s+/g," "),
        String(Math.round((item.amount||0)*100)),
        item.category || item.source || "",
        item._type
      ].join("|");
      if (seen.has(key)) dups.add(item.id);
      else seen.set(key, item.id);
    });
    return dups;
  }, [all]);

  const filtered = useMemo(() => all.filter(item => {
    if (filter==="expense" && item._type!=="expense") return false;
    if (filter==="income"  && item._type!=="income")  return false;
    if (debouncedSearch && !item.description?.toLowerCase().includes(debouncedSearch.toLowerCase())) return false;
    if (showDupsOnly && !dupIds.has(item.id)) return false;
    if (paymentFilter!=="all" && item._type==="expense" && item.type!==paymentFilter) return false;
    if (categoryFilter!=="all" && item._type==="expense" && item.category!==categoryFilter) return false;
    if (memberFilter !== "all") {
      const lbl = item.user_label?.trim() || "";
      const matchExact = lbl === memberFilter;
      // "Você" salvo = usuário que estava logado; bate com o nome atual desse usuário
      const matchVoce = lbl === "Você" && memberFilter === currentUserLabel;
      if (!matchExact && !matchVoce) return false;
    }
    return true;
  }), [all, filter, debouncedSearch, showDupsOnly, dupIds, paymentFilter, categoryFilter, memberFilter]);

  const totalExp = filtered.filter(i=>i._type==="expense").reduce((s,i)=>s+(parseFloat(i.amount)||0),0);
  const totalInc = filtered.filter(i=>i._type==="income").reduce((s,i)=>s+(parseFloat(i.amount)||0),0);
  const dupCount = dupIds.size;
  const dupIdsArray = Array.from(dupIds);

  const grouped = useMemo(() => groupByDate(filtered), [filtered]);

  const hasActiveChipFilters = paymentFilter!=="all" || categoryFilter!=="all" || memberFilter!=="all";

  // ── Selection helpers ──
  const enterSelMode = (id) => { setSelMode(true); setSelectedIds(new Set([id])); };
  const exitSelMode  = () => { setSelMode(false); setSelectedIds(new Set()); };
  const toggleSel    = (id) => setSelectedIds(p => { const n = new Set(p); n.has(id)?n.delete(id):n.add(id); return n; });
  const selectAll    = () => setSelectedIds(new Set(filtered.map(r=>r.id)));
  const isAllSel     = filtered.length > 0 && filtered.every(r => selectedIds.has(r.id));

  // Long-press via hook
  const { pressingId: longPressingId, start: startLongPress, cancel: cancelLongPress } = useLongPress(
    useCallback((id) => { if (!selMode) enterSelMode(id); }, [selMode]),
    500
  );

  // Delete selected
  const handleDeleteSelected = () => {
    const selArr = Array.from(selectedIds);
    if (!selArr.length) return;
    const expIds = selArr.filter(id => all.find(i=>i.id===id&&i._type==="expense"));
    const incIds = selArr.filter(id => all.find(i=>i.id===id&&i._type==="income"));
    openConfirm(
      "Remover lançamentos",
      `Remover ${selArr.length} lançamento(s) selecionado(s)?`,
      () => {
        if (expIds.length) onDeleteAllExpenses(expIds);
        if (incIds.length) onDeleteAllIncomes(incIds);
        exitSelMode();
      }
    );
  };

  // Delete filtered (from action sheet)
  const handleDeleteFiltered = () => {
    setShowActionSheet(false);
    const expIds = filtered.filter(i=>i._type==="expense").map(i=>i.id);
    const incIds = filtered.filter(i=>i._type==="income").map(i=>i.id);
    if (!filtered.length) return;
    openConfirm(
      "Remover lançamentos filtrados",
      `Remover ${filtered.length} lançamento(s) filtrado(s)?`,
      () => {
        if (expIds.length) onDeleteAllExpenses(expIds);
        if (incIds.length) onDeleteAllIncomes(incIds);
      }
    );
  };

  // Glass tokens (matching design reference)
  const G = {
    glass:   "rgba(255,255,255,0.055)",
    border:  "rgba(255,255,255,0.09)",
    muted:   "rgba(255,255,255,0.55)",
    purple:  "#7C5CFF",
    purpleA: "rgba(124,92,255,0.22)",
    purpleB: "rgba(124,92,255,0.4)",
    chip:    "rgba(124,92,255,0.14)",
    chipTxt: "#C4B3FF",
  };
  // In light mode fall back to theme tokens
  const isDark = t.bg === "#0f0c1a" || t.bg?.startsWith("#0") || t.bg?.startsWith("rgb(5") || t.bg?.includes("0f0");

  const btnIcon = {
    width:28, height:28, borderRadius:999,
    border:`1px solid ${t.border}`,
    background:t.surface, color:t.text,
    fontSize:16, lineHeight:1, cursor:"pointer",
    display:"inline-flex", alignItems:"center", justifyContent:"center", padding:0,
    flexShrink:0,
  };

  return (
    <div style={{ position:"relative" }}>

      {/* ══ SELECTION BAR (replaces filter block while in selection mode) ══ */}
      {selMode ? (
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"0 0 14px", gap:10 }}>
          <button onClick={exitSelMode}
            style={{ background:"none", border:"none", color:t.accent, fontSize:14, fontWeight:600, padding:"4px 0", cursor:"pointer" }}>
            Cancelar
          </button>
          <div style={{ textAlign:"center" }}>
            <div style={{ fontSize:15, fontWeight:700, color:t.text }}>{selectedIds.size} selecionado{selectedIds.size!==1?"s":""}</div>
            <div style={{ fontSize:10, color:t.textMuted, letterSpacing:"0.04em", textTransform:"uppercase" }}>de {filtered.length}</div>
          </div>
          <button onClick={isAllSel?exitSelMode:selectAll}
            style={{ background:"none", border:"none", color:t.accent, fontSize:14, fontWeight:600, padding:"4px 0", cursor:"pointer" }}>
            {isAllSel ? "Nenhum" : "Todos"}
          </button>
        </div>
      ) : (
        <>
          {/* ══ ROW 1: Period header (‹ / title / ›) — centered, no ••• ══ */}
          <div style={{ display:"grid", gridTemplateColumns:"28px 1fr 28px", alignItems:"center", gap:8, marginBottom:10 }}>
            <button style={btnIcon} onClick={prevMonth}>‹</button>
            <div style={{ textAlign:"center", minWidth:0 }}>
              <div style={{ fontSize:17, fontWeight:700, letterSpacing:-0.3, color:t.text, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
                {periodTitle}
              </div>
              <div style={{ fontSize:10, color:t.textMuted, marginTop:1, letterSpacing:"0.04em", textTransform:"uppercase" }}>
                {periodSubtitle || `${filtered.length} lançamento${filtered.length!==1?"s":""}`}
              </div>
            </div>
            <button style={btnIcon} onClick={nextMonth}>›</button>
          </div>

          {/* ══ ROW 2: Window segmented control ══ */}
          <div style={{ display:"flex", padding:3, borderRadius:999, background:"rgba(255,255,255,0.035)", border:`1px solid ${t.border}`, marginBottom:10 }}>
            {WINDOWS.map(w => (
              <button key={w.id} onClick={()=>setWin(w.id)}
                style={{ flex:1, height:26, borderRadius:999, border: win===w.id?"1px solid rgba(124,92,255,0.35)":"1px solid transparent",
                  background: win===w.id?"rgba(124,92,255,0.22)":"transparent",
                  color: win===w.id?"#D6CAFF":t.textMuted,
                  fontSize:11.5, fontWeight:600, cursor:"pointer" }}>
                {w.label}
              </button>
            ))}
          </div>

          {/* ══ ROW 3: Search + ••• ══ */}
          <div style={{ display:"flex", gap:8, alignItems:"center", marginBottom:10 }}>
            <div style={{ flex:1, height:36, borderRadius:999, background:t.surface, border:`1px solid ${t.border}`,
              display:"flex", alignItems:"center", gap:8, padding:"0 14px", color:t.textMuted, fontSize:13, position:"relative" }}>
              <Icon name="search" size={14} color={t.textMuted} />
              <input value={search} onChange={e=>setSearch(e.target.value)}
                placeholder="Buscar lançamento…"
                style={{ flex:1, background:"transparent", border:"none", outline:"none", color:t.text, fontSize:13 }} />
              {search && (
                <button onClick={()=>setSearch("")}
                  style={{ background:"none", border:"none", color:t.textMuted, cursor:"pointer", padding:0, display:"flex", alignItems:"center" }}>
                  <Icon name="x" size={14} color={t.textMuted} />
                </button>
              )}
            </div>
            {/* ••• menu */}
            <div style={{ position:"relative", flexShrink:0 }}>
              <button
                onClick={e=>{ e.stopPropagation(); setShowActionSheet(v=>!v); }}
                style={{ width:36, height:36, borderRadius:10,
                  background: showActionSheet ? "rgba(124,92,255,0.22)" : t.surface,
                  border:`1px solid ${showActionSheet?"rgba(124,92,255,0.4)":t.border}`,
                  display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer" }}>
                <svg width="16" height="4" viewBox="0 0 16 4" fill="none">
                  <circle cx="2" cy="2" r="1.6" fill={t.text}/>
                  <circle cx="8" cy="2" r="1.6" fill={t.text}/>
                  <circle cx="14" cy="2" r="1.6" fill={t.text}/>
                </svg>
              </button>
              {showActionSheet && (
                <div onClick={()=>setShowActionSheet(false)}
                  style={{ position:"fixed", inset:0, zIndex:299 }} />
              )}
              {showActionSheet && (
                <div onClick={e=>e.stopPropagation()}
                  style={{ position:"absolute", top:"calc(100% + 8px)", right:0, zIndex:300,
                    width:230, padding:4, borderRadius:14,
                    background:t.glassModal, backdropFilter:"blur(22px)",
                    border:`1px solid ${t.glassBorder}`,
                    boxShadow:t.shadow }}>
                  <div style={{ position:"absolute", top:-6, right:12, width:12, height:12,
                    background:t.glassModal,
                    borderLeft:`1px solid ${t.glassBorder}`,
                    borderTop:`1px solid ${t.glassBorder}`,
                    transform:"rotate(45deg)" }} />
                  <button onClick={()=>{ setShowActionSheet(false); setSelMode(true); setSelectedIds(new Set()); }}
                    style={{ width:"100%", display:"flex", alignItems:"center", gap:10, padding:"9px 12px", borderRadius:10,
                      background:"rgba(124,92,255,0.14)", color:t.text, border:"none", cursor:"pointer", fontSize:13.5, fontWeight:500 }}>
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <rect x="2" y="2" width="12" height="12" rx="3" stroke={t.text} strokeWidth="1.3"/>
                      <path d="M5 8.2l2.2 2.2L11.2 6" stroke={t.text} strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    Selecionar lançamentos
                  </button>
                  <div style={{ height:0.5, background:t.border, margin:"4px 10px" }} />
                  <button onClick={handleDeleteFiltered}
                    style={{ width:"100%", display:"flex", alignItems:"center", gap:10, padding:"9px 12px", borderRadius:10,
                      background:"transparent", color:"#FF6B6B", border:"none", cursor:"pointer", fontSize:13.5, fontWeight:500 }}>
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <path d="M3 4h10M6 4V3a1 1 0 011-1h2a1 1 0 011 1v1M5 4l.5 9a1 1 0 001 1h3a1 1 0 001-1L11 4" stroke="#FF6B6B" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    Apagar filtrados…
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* ══ ROW 4: Todos/Gastos/Receitas segmented ══ */}
          <div style={{ display:"flex", padding:3, borderRadius:999, background:"rgba(255,255,255,0.04)", border:`1px solid ${t.border}`, marginBottom:10 }}>
            {[["all","Todos"],["expense","Gastos"],["income","Receitas"]].map(([v,l])=>(
              <button key={v} onClick={()=>{ setFilter(v); if(v!=="expense"){ setPaymentFilter("all"); setCategoryFilter("all"); } }}
                style={{ flex:1, height:30, borderRadius:999, border:"none",
                  background: filter===v?t.accent:"transparent",
                  color: filter===v?"#fff":t.textMuted,
                  fontSize:12.5, fontWeight:600, cursor:"pointer",
                  boxShadow: filter===v?`0 2px 8px ${t.accentGlow}`:"none" }}>
                {l}
              </button>
            ))}
          </div>

          {/* ══ ROW 5: Chip rail — Por compra/fatura + Tipo + Categoria + Pessoa ══ */}
          <div style={{ display:"flex", gap:6, overflowX:"auto", margin:"0 -20px", padding:"0 20px 2px", scrollbarWidth:"none", marginBottom:16 }}>
            {/* Por compra / Por fatura */}
            <select value={billingMode} onChange={e=>setBillingMode(e.target.value)}
              style={{ display:"inline-flex", alignItems:"center", height:30, padding:"0 8px", borderRadius:999,
                fontSize:12, fontWeight:500, cursor:"pointer", whiteSpace:"nowrap",
                background: billingMode!=="purchase"?"rgba(124,92,255,0.14)":t.surface,
                border: `1px solid ${billingMode!=="purchase"?"rgba(124,92,255,0.4)":t.border}`,
                color: billingMode!=="purchase"?"#C4B3FF":t.text, outline:"none" }}>
              <option value="purchase">📅 Por compra</option>
              <option value="billing">💳 Por fatura</option>
            </select>
            {/* Tipo */}
            {filter !== "income" && (
              <select value={paymentFilter} onChange={e=>setPaymentFilter(e.target.value)}
                style={{ display:"inline-flex", alignItems:"center", height:30, padding:"0 8px", borderRadius:999,
                  fontSize:12, fontWeight:500, cursor:"pointer", whiteSpace:"nowrap",
                  background: paymentFilter!=="all"?"rgba(124,92,255,0.14)":t.surface,
                  border: `1px solid ${paymentFilter!=="all"?"rgba(124,92,255,0.4)":t.border}`,
                  color: paymentFilter!=="all"?"#C4B3FF":t.text, outline:"none" }}>
                <option value="all">📁 Tipo</option>
                <option value="pix">💸 PIX</option>
                <option value="debito">🏦 Débito</option>
                <option value="credito">💳 Crédito</option>
              </select>
            )}
            {/* Categoria */}
            {filter !== "income" && (
              <select value={categoryFilter} onChange={e=>setCategoryFilter(e.target.value)}
                style={{ display:"inline-flex", alignItems:"center", height:30, padding:"0 8px", borderRadius:999,
                  fontSize:12, fontWeight:500, cursor:"pointer", whiteSpace:"nowrap",
                  background: categoryFilter!=="all"?"rgba(124,92,255,0.14)":t.surface,
                  border: `1px solid ${categoryFilter!=="all"?"rgba(124,92,255,0.4)":t.border}`,
                  color: categoryFilter!=="all"?"#C4B3FF":t.text, outline:"none" }}>
                <option value="all">📂 Categoria</option>
                {CATEGORIES.map(c=><option key={c.id} value={c.id}>{c.emoji} {c.label}</option>)}
              </select>
            )}
            {/* Pessoa */}
            {memberOptions.length > 1 && (
              <select value={memberFilter} onChange={e=>setMemberFilter(e.target.value)}
                style={{ display:"inline-flex", alignItems:"center", height:30, padding:"0 8px", borderRadius:999,
                  fontSize:12, fontWeight:500, cursor:"pointer", whiteSpace:"nowrap",
                  background: memberFilter!=="all"?"rgba(124,92,255,0.14)":t.surface,
                  border: `1px solid ${memberFilter!=="all"?"rgba(124,92,255,0.4)":t.border}`,
                  color: memberFilter!=="all"?"#C4B3FF":t.text, outline:"none" }}>
                <option value="all">👤 Pessoa</option>
                {memberOptions.map(m=><option key={m} value={m}>{m}</option>)}
              </select>
            )}
            {/* Clear chip filters */}
            {hasActiveChipFilters && (
              <button onClick={()=>{ setPaymentFilter("all"); setCategoryFilter("all"); setMemberFilter("all"); }}
                style={{ display:"inline-flex", alignItems:"center", height:30, padding:"0 11px", borderRadius:999,
                  fontSize:12, fontWeight:500, cursor:"pointer", whiteSpace:"nowrap",
                  background:"rgba(255,107,107,0.12)", border:"1px solid rgba(255,107,107,0.35)", color:"#FF9B9B" }}>
                ✕ Limpar
              </button>
            )}
          </div>
        </>
      )}

      {/* ══ DUPLICATE ALERT ══ */}
      {dupCount > 0 && (
        <div style={{ marginBottom:16,padding:"14px 16px",borderRadius:14,background:"rgba(217,119,6,0.10)",border:"1px solid rgba(217,119,6,0.3)",display:"flex",alignItems:"flex-start",gap:12,flexWrap:"wrap" }}>
          <span style={{ fontSize:20,flexShrink:0,marginTop:1 }}>⚠️</span>
          <div style={{ flex:1,minWidth:200 }}>
            <div style={{ fontSize:13,fontWeight:700,color:t.warning,marginBottom:3 }}>
              {dupCount} lançamento{dupCount>1?"s":""} duplicado{dupCount>1?"s":""} detectado{dupCount>1?"s":""}
            </div>
            <div style={{ fontSize:12,color:t.textMuted,lineHeight:1.5 }}>
              Itens com mesmo nome, categoria e valor no mesmo dia. Os mais recentes estão marcados com 🔁.
            </div>
          </div>
          <div style={{ display:"flex",gap:8,flexShrink:0,flexWrap:"wrap" }}>
            <button onClick={()=>setShowDupsOnly(v=>!v)}
              style={{ padding:"7px 14px",borderRadius:10,border:"1px solid rgba(217,119,6,0.4)",background:showDupsOnly?"rgba(217,119,6,0.15)":"transparent",color:t.warning,fontSize:12,fontWeight:700,cursor:"pointer" }}>
              {showDupsOnly ? "Ver todos" : "Ver duplicatas"}
            </button>
            <button onClick={()=>{
              const expDups = dupIdsArray.filter(id=>all.find(i=>i.id===id&&i._type==="expense"));
              const incDups = dupIdsArray.filter(id=>all.find(i=>i.id===id&&i._type==="income"));
              openConfirm(
                "Remover duplicatas",
                `Remover ${dupCount} lançamento(s) duplicado(s)? Esta ação não pode ser desfeita.`,
                () => {
                  if(expDups.length) onDeleteAllExpenses(expDups);
                  if(incDups.length) onDeleteAllIncomes(incDups);
                  setShowDupsOnly(false);
                }
              );
            }}
              style={{ padding:"7px 14px",borderRadius:10,border:"1px solid rgba(217,119,6,0.4)",background:"rgba(217,119,6,0.12)",color:t.warning,fontSize:12,fontWeight:700,cursor:"pointer" }}>
              🗑 Remover todos
            </button>
          </div>
        </div>
      )}

      {/* ══ SUMMARY CARDS ══ */}
      <div style={{ display:"grid", gridTemplateColumns: filter==="income"?"1fr":filter==="expense"?"1fr":"1fr 1fr", gap:10, marginBottom:20 }}>
        {filter !== "income" && (
          <div style={{ background:t.dangerSoft, border:`1px solid ${t.danger}33`, borderRadius:14, padding:"14px 18px" }}>
            <div style={{ fontSize:11,color:t.textMuted,fontWeight:600,marginBottom:4,letterSpacing:"0.04em" }}>GASTOS</div>
            <div style={{ fontSize:20,fontWeight:800,color:t.danger }}>{fmt(totalExp)}</div>
            <div style={{ fontSize:11,color:t.textMuted,marginTop:3 }}>{filtered.filter(i=>i._type==="expense").length} lançamento{filtered.filter(i=>i._type==="expense").length!==1?"s":""}</div>
          </div>
        )}
        {filter !== "expense" && (
          <div style={{ background:t.successSoft, border:`1px solid ${t.success}33`, borderRadius:14, padding:"14px 18px" }}>
            <div style={{ fontSize:11,color:t.textMuted,fontWeight:600,marginBottom:4,letterSpacing:"0.04em" }}>RECEITAS</div>
            <div style={{ fontSize:20,fontWeight:800,color:t.success }}>{fmt(totalInc)}</div>
            <div style={{ fontSize:11,color:t.textMuted,marginTop:3 }}>{filtered.filter(i=>i._type==="income").length} lançamento{filtered.filter(i=>i._type==="income").length!==1?"s":""}</div>
          </div>
        )}
      </div>

      {/* ══ LIST ══ */}
      <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
        {filtered.length === 0 ? (
          debouncedSearch ? (
            <div style={{ textAlign:"center", padding:"48px 20px", color:t.textMuted }}>
              <Icon name="search" size={40} color={t.border} style={{ marginBottom:12 }} />
              <div style={{ fontSize:15, fontWeight:600, color:t.textSecondary, marginBottom:4 }}>Nenhum resultado</div>
              <div style={{ fontSize:13, marginBottom:16 }}>Nada encontrado para "{debouncedSearch}"</div>
              <button onClick={()=>setSearch("")} style={{ padding:"8px 20px", borderRadius:10, border:`1px solid ${t.border}`, background:t.surface, color:t.text, fontSize:13, fontWeight:600, cursor:"pointer" }}>Limpar busca</button>
            </div>
          ) : (
            <div style={{ textAlign:"center", padding:"40px 0", color:t.textMuted, fontSize:14 }}>
              {showDupsOnly ? "Nenhuma duplicata encontrada neste período" : "Nenhum lançamento encontrado"}
            </div>
          )
        ) : grouped.map(group => (
          <Fragment key={group.date}>
            {/* Sticky date header */}
            <div style={{
              position:"sticky", top:0, zIndex:10,
              background:`${t.bg}cc`, backdropFilter:"blur(12px)", WebkitBackdropFilter:"blur(12px)",
              borderBottom:`1px solid ${t.border}`,
              display:"flex", justifyContent:"space-between", alignItems:"center",
              padding:"6px 4px", marginBottom:4, marginTop:8,
            }}>
              <span style={{ fontSize:11, fontWeight:700, color:t.textSecondary, textTransform:"uppercase", letterSpacing:"0.06em" }}>
                {group.label}
              </span>
              <span style={{ fontSize:12, fontWeight:700, color: group.net >= 0 ? t.success : t.danger }}>
                {group.net >= 0 ? "+" : ""}{fmt(Math.abs(group.net))}
              </span>
            </div>
            {group.items.map(item => {
          const isExp  = item._type === "expense";
          const isDup  = dupIds.has(item.id);
          const isSel  = selectedIds.has(item.id);
          const isLong = longPressingId === item.id;
          const cat    = isExp ? CATEGORIES.find(c=>c.id===item.category) : INCOME_SOURCES.find(s=>s.id===item.source);

          return (
            <div key={item.id}
              style={{
                position:"relative",
                display:"flex", alignItems:"center", gap:12,
                padding:"12px 14px", borderRadius:16,
                transition:"transform 120ms, box-shadow 120ms, background 150ms, border-color 150ms",
                background: isSel ? "rgba(124,92,255,0.1)" : isDup ? "rgba(217,119,6,0.08)" : t.surface,
                border: `1px solid ${isSel?"rgba(124,92,255,0.4)":isDup?"rgba(217,119,6,0.35)":t.border}`,
                transform: isLong ? "scale(1.015)" : "none",
                boxShadow: isLong ? "0 8px 24px rgba(124,92,255,0.35), 0 0 0 2px rgba(124,92,255,0.5)" : "none",
                cursor: "pointer",
                userSelect:"none",
              }}
              onClick={() => {
                if (selMode) { toggleSel(item.id); return; }
              }}
              onMouseDown={() => startLongPress(item.id)}
              onMouseUp={cancelLongPress}
              onMouseLeave={cancelLongPress}
              onTouchStart={() => startLongPress(item.id)}
              onTouchEnd={cancelLongPress}
              onTouchCancel={cancelLongPress}
            >
              {/* Checkbox (selection mode) or category placeholder */}
              {selMode ? (
                <div style={{
                  width:22, height:22, borderRadius:999, flexShrink:0,
                  border: isSel?"none":"1.8px solid rgba(255,255,255,0.35)",
                  background: isSel?t.accent:"transparent",
                  display:"flex", alignItems:"center", justifyContent:"center",
                }}>
                  {isSel && <Icon name="check" size={12} color="#fff" />}
                </div>
              ) : null}

              {/* Emoji */}
              <div style={{ fontSize:20, width:28, textAlign:"center", flexShrink:0 }}>
                {cat?.emoji || (isExp?"📦":"💰")}
              </div>

              {/* Text */}
              <div style={{ flex:1, minWidth:0, textAlign:"center" }}>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:6, flexWrap:"wrap" }}>
                  <span style={{ fontWeight:700, fontSize:14, color:t.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", letterSpacing:0.2 }}>
                    <Highlight text={item.description||""} term={debouncedSearch} t={t} />
                  </span>
                  {isDup && (
                    <span style={{ fontSize:10,fontWeight:700,padding:"2px 7px",borderRadius:6,background:"rgba(217,119,6,0.15)",color:t.warning,border:"1px solid rgba(217,119,6,0.3)",flexShrink:0 }}>
                      🔁 duplicata
                    </span>
                  )}
                </div>
                <div style={{ fontSize:11, color:t.textMuted, marginTop:2, lineHeight:1.4 }}>
                  {item.user_label} · {(item.date||"").slice(8,10)+"/"+(item.date||"").slice(5,7)+"/"+(item.date||"").slice(2,4)}
                  {isExp && (() => {
                    const typeLabel = item.type==="pix"?"PIX":item.type==="debito"?"Débito":"Crédito";
                    const p = parseInt(item.parcelas)||1;
                    const catLabel = cat?.label || "";
                    if (item.type==="credito" && p>1) {
                      const startKey = item.description?.toLowerCase().trim();
                      const allSameItem = expenses.filter(e=>e.description?.toLowerCase().trim()===startKey&&e.type==="credito"&&parseInt(e.parcelas)===p).sort((a,b)=>a.date?.localeCompare(b.date));
                      const startDate = allSameItem[0]?.date || item.date;
                      const startD = new Date((startDate||item.date).slice(0,10)+"T12:00:00");
                      const thisD  = new Date((item.date||"").slice(0,10)+"T12:00:00");
                      const diffM  = (thisD.getFullYear()-startD.getFullYear())*12+(thisD.getMonth()-startD.getMonth());
                      const nthInstall = Math.max(1, Math.min(p, diffM+1));
                      return ` · Crédito ${nthInstall} de ${p}${catLabel?" · "+catLabel:""}`;
                    }
                    return ` · ${typeLabel}${catLabel?" · "+catLabel:""}`;
                  })()}
                  {isDup && <span style={{ color:t.warning, fontWeight:600 }}> · sugerido para remoção</span>}
                  {billingMode==="billing" && isExp && item.type==="credito" && (() => {
                    const card = cards.find(c=>c.id===item.card_id);
                    const cardPeriods = billingPeriods.filter(p=>p.card_id===item.card_id);
                    const bm = getBillingMonth(item.date, cardPeriods, card?.closing_day??28);
                    if (!bm) return null;
                    return <span style={{ color:bm.fromPeriod?t.accent:t.textMuted, fontWeight:bm.fromPeriod?700:500, borderBottom:bm.fromPeriod?"none":`1px dashed ${t.textMuted}` }}> · → Fatura {MONTH_FULL[bm.month-1]}/{bm.year}</span>;
                  })()}
                </div>
              </div>

              {/* Amount + actions */}
              <div style={{ display:"flex", alignItems:"center", gap:6, flexShrink:0 }}>
                <span style={{ fontWeight:700, fontSize:14, color:isDup?t.warning:isExp?t.danger:t.success, whiteSpace:"nowrap" }}>
                  {fmt(item.amount)}
                </span>
                {!selMode && <>
                  <button
                    onClick={e=>{ e.stopPropagation(); setEditItem(item); }}
                    title="Editar"
                    style={{ background:"transparent",border:"none",cursor:"pointer",color:t.textMuted,fontSize:13,padding:"4px 6px",borderRadius:6 }}
                    onMouseEnter={e=>e.currentTarget.style.color=t.accent}
                    onMouseLeave={e=>e.currentTarget.style.color=t.textMuted}>
                    ✏️
                  </button>

                </>}
              </div>

              {/* Long-press progress ring */}
              {isLong && (
                <svg className="lp-ring-svg" viewBox="0 0 100 100" fill="none">
                  <rect className="lp-ring-path" x="1" y="1" width="98" height="98" rx="15"
                    stroke={t.accent} strokeWidth="2.5" />
                </svg>
              )}
            </div>
          );})}
          </Fragment>
        ))}
      </div>

      {/* ══ FLOATING SELECTION ACTION BAR ══ */}
      {selMode && selectedIds.size > 0 && (
        <div style={{
          position:"fixed", bottom:"calc(64px + env(safe-area-inset-bottom) + 10px)", left:20, right:20, zIndex:200,
          padding:"10px 12px", borderRadius:18,
          background:"rgba(20,14,36,0.92)", backdropFilter:"blur(22px)",
          border:`1px solid ${t.glassBorder}`,
          display:"flex", alignItems:"center", gap:10,
          boxShadow:"0 20px 40px rgba(0,0,0,0.5)",
        }}>
          <button onClick={handleDeleteSelected}
            style={{ flex:1, height:40, borderRadius:12,
              background:"rgba(255,107,107,0.18)", border:"1px solid rgba(255,107,107,0.35)",
              color:"#FF9B9B", fontSize:13.5, fontWeight:700, cursor:"pointer",
              display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M3 4h10M6 4V3a1 1 0 011-1h2a1 1 0 011 1v1M5 4l.5 9a1 1 0 001 1h3a1 1 0 001-1L11 4" stroke="#FF9B9B" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Excluir {selectedIds.size}
          </button>
        </div>
      )}

      {/* ══ EDIT MODAL ══ */}
      {editItem && (
        <div onClick={e=>{ if(e.target===e.currentTarget) setEditItem(null); }}
          style={{ position:"fixed",inset:0,zIndex:500,background:"rgba(0,0,0,0.65)",backdropFilter:"blur(10px)",display:"flex",alignItems:"center",justifyContent:"center",padding:20 }}>
          <div onClick={e=>e.stopPropagation()}
            style={{ background:t.glassModal,border:`1.5px solid ${t.glassBorder}`,borderRadius:24,padding:"24px 20px 20px",width:"100%",maxWidth:460,maxHeight:"90vh",overflowY:"auto",boxShadow:t.shadow,animation:"modalIn 0.25s ease" }}>
            <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20 }}>
              <h3 style={{ margin:0,fontSize:17,fontWeight:800,color:t.text,letterSpacing:"-0.02em" }}>✏️ Editar Lançamento</h3>
              <button onClick={()=>setEditItem(null)} style={{ background:"transparent",border:"none",cursor:"pointer",color:t.textMuted,fontSize:22,lineHeight:1,padding:"2px 8px",borderRadius:8 }}>×</button>
            </div>
            <EditModal t={t} item={editItem} onClose={()=>setEditItem(null)} familyMembers={familyMembers} cards={cards}
              onSave={async(payload)=>{ if(payload._type==="expense") await onEditExpense(payload); else await onEditIncome(payload); setEditItem(null); }} />
          </div>
        </div>
      )}

      <ConfirmModal
        open={!!confirmOpts}
        title={confirmOpts?.title}
        message={confirmOpts?.message}
        onConfirm={() => { confirmOpts?.onConfirm(); closeConfirm(); }}
        onCancel={closeConfirm}
        t={t}
      />
    </div>
  );
}



// ─── BUDGET ALERT CARD (shown in Dashboard) ───────────────────────────────────
function BudgetAlertCard({ expenses, t, family, isDemo, onGoToBudget }) {
  const [budgets, setBudgets] = useState([]);
  const prefix = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}`;

  useEffect(() => {
    if (isDemo || !family) return;
    supabaseFetch(`/budgets?family_id=eq.${family.family_id}&month=eq.${today.getMonth()+1}&year=eq.${today.getFullYear()}&select=*`)
      .then(rows => setBudgets(rows || []))
      .catch(() => {});
  }, [family, isDemo]);

  if (!budgets.length) return null;

  const alerts = budgets.map(b => {
    const cat = CATEGORIES.find(c => c.id === b.category);
    const spent = expenses.filter(e => e.date?.startsWith(prefix) && e.category === b.category)
                          .reduce((s, e) => s + (parseFloat(e.amount)||0), 0);
    const pct = (spent / parseFloat(b.amount)) * 100;
    return { ...b, cat, spent, pct };
  }).filter(a => a.pct >= 80).sort((a,b) => b.pct - a.pct);

  if (!alerts.length) return null;

  return (
    <div style={{ background:t.warningSoft,border:`1px solid ${t.warning}44`,borderRadius:16,padding:"14px 18px" }}>
      <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10 }}>
        <span style={{ fontSize:13,fontWeight:700,color:t.warning }}>⚡ Alertas de Orçamento</span>
        <button onClick={onGoToBudget}
          style={{ background:"transparent",border:"none",cursor:"pointer",color:t.accent,fontSize:12,fontWeight:700 }}>
          Ver todos →
        </button>
      </div>
      <div style={{ display:"flex",flexDirection:"column",gap:6 }}>
        {alerts.slice(0,3).map(a => (
          <div key={a.category} style={{ display:"flex",alignItems:"center",gap:10 }}>
            <span style={{ fontSize:16 }}>{a.cat?.emoji || "📦"}</span>
            <div style={{ flex:1,minWidth:0 }}>
              <div style={{ display:"flex",justifyContent:"space-between",marginBottom:3 }}>
                <span style={{ fontSize:12,fontWeight:600,color:t.text }}>{a.cat?.label}</span>
                <span style={{ fontSize:12,fontWeight:700,color:a.pct>=100?t.danger:t.warning }}>
                  {a.pct.toFixed(0)}%
                </span>
              </div>
              <div style={{ height:5,borderRadius:3,background:t.surfaceHover,overflow:"hidden" }}>
                <div style={{ height:"100%",borderRadius:3,width:`${Math.min(100,a.pct)}%`,background:a.pct>=100?t.danger:t.warning }} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}


// ─── RECURRING EXPENSES ───────────────────────────────────────────────────────
function RecurringView({ t, family, user, isDemo, addToast, expenses, setExpenses, familyMembers }) {
  const [rules, setRules]         = useState([]);
  const [reminders, setReminders] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [showForm, setShowForm]   = useState(false);
  const [editRule, setEditRule]   = useState(null);      // rule being edited
  const [pendingAmt, setPendingAmt] = useState({});      // { reminderId: "210" }
  const [confirmingId, setConfirmingId] = useState(null);
  const [rSelMode, setRSelMode] = useState(false);
  const [rSelectedIds, setRSelectedIds] = useState(new Set());
  const [rConfirmOpts, setRConfirmOpts] = useState(null);
  const { pressingId: rLpId, start: rStartLp, cancel: rCancelLp } = useLongPress(
    useCallback((id) => { if (!rSelMode) { setRSelMode(true); setRSelectedIds(new Set([id])); } }, [rSelMode]),
    500
  );
  const rToggleSel = (id) => setRSelectedIds(p => { const n = new Set(p); n.has(id)?n.delete(id):n.add(id); return n; });
  const rExitSel = () => { setRSelMode(false); setRSelectedIds(new Set()); };
  const rDeleteSelected = () => {
    const arr = Array.from(rSelectedIds);
    setRConfirmOpts({
      title: "Remover recorrentes",
      message: `Remover ${arr.length} regra(s) recorrente(s)? Os lançamentos já feitos não serão afetados.`,
      onConfirm: async () => {
        await Promise.all(arr.map(id => { const rule = rules.find(r=>r.id===id); return rule ? deleteRule(rule) : Promise.resolve(); }));
        rExitSel();
      },
    });
  };

  const curMonth = today.getMonth() + 1;
  const curYear  = today.getFullYear();

  // ── Load rules + reminders ──────────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    if (isDemo || !family) { setLoading(false); return; }
    setLoading(true);
    try {
      const [r, rem] = await Promise.all([
        supabaseFetch(`/recurring_expenses?family_id=eq.${family.family_id}&order=created_at.asc`),
        supabaseFetch(`/recurring_reminders?family_id=eq.${family.family_id}&month=eq.${curMonth}&year=eq.${curYear}&select=*`),
      ]);
      setRules(r || []);
      setReminders(rem || []);
    } catch (e) { addToast("Erro ao carregar: " + e.message, "error"); }
    finally { setLoading(false); }
  }, [family, isDemo, curMonth, curYear, addToast]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // ── Generate reminders for rules that don't have one this month ─────────────
  useEffect(() => {
    if (!rules.length || isDemo || !family) return;
    const generate = async () => {
      const toCreate = [];
      for (const rule of rules) {
        if (!rule.active) continue;
        const alreadyExists = reminders.some(r => r.recurring_id === rule.id);
        if (alreadyExists) continue;
        // Check if rule applies this month
        if (rule.frequency === "yearly" && rule.month_of_year !== curMonth) continue;
        if (rule.end_date && rule.end_date < `${curYear}-${String(curMonth).padStart(2,"0")}-01`) continue;
        toCreate.push({
          family_id: family.family_id,
          recurring_id: rule.id,
          month: curMonth,
          year: curYear,
          amount: rule.amount_type === "fixed" ? rule.amount : null,
          status: rule.amount_type === "fixed" ? "pending" : "pending",
        });
      }
      if (!toCreate.length) return;
      try {
        const created = await supabaseFetch("/recurring_reminders", {
          method: "POST",
          body: JSON.stringify(toCreate),
          headers: { "Prefer": "return=representation" },
        });
        if (created) setReminders(p => [...p, ...created]);
      } catch {}
    };
    generate();
  }, [rules, reminders, family, isDemo, curMonth, curYear]);

  // ── Confirm a rule for this month (create expense + upsert reminder) ─────────
  const confirmRule = async (rule) => {
    const rem = reminders.find(r => r.recurring_id === rule.id);
    const amt = parseFloat(pendingAmt[rule.id] ?? rem?.amount ?? (rule.amount_type === "fixed" ? rule.amount : ""));
    if (!amt || amt <= 0) { addToast("Informe um valor válido", "error"); return; }
    setConfirmingId(rule.id);
    const day = rule.day_of_month || 1;
    const dateStr = `${curYear}-${String(curMonth).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
    try {
      const mPrefix = `${curYear}-${String(curMonth).padStart(2,"0")}`;
      const existing = expenses.find(e =>
        e.description?.toLowerCase().trim() === rule.description?.toLowerCase().trim() &&
        e.date?.startsWith(mPrefix)
      );
      let exp = existing || null;
      if (!existing) {
        const expRows = await supabaseFetch("/expenses", {
          method: "POST",
          body: JSON.stringify({
            family_id: family.family_id,
            user_id: user?.id,
            description: rule.description,
            amount: amt,
            date: dateStr,
            category: rule.category,
            type: rule.type,
            parcelas: 1,
            user_label: rule.user_label,
          }),
          headers: { "Prefer": "return=representation,resolution=ignore-duplicates" },
        });
        exp = expRows?.[0] || null;
        if (exp) setExpenses(p => [exp, ...p]);
      }
      if (rem) {
        await supabaseFetch(`/recurring_reminders?id=eq.${rem.id}`, {
          method: "PATCH",
          body: JSON.stringify({ status: "confirmed", expense_id: exp?.id, amount: amt }),
          headers: { "Prefer": "return=minimal" },
        });
        setReminders(p => p.map(r => r.id === rem.id ? { ...r, status: "confirmed", expense_id: exp?.id, amount: amt } : r));
      } else {
        const created = await supabaseFetch("/recurring_reminders", {
          method: "POST",
          body: JSON.stringify({ family_id: family.family_id, recurring_id: rule.id, month: curMonth, year: curYear, amount: amt, status: "confirmed", expense_id: exp?.id }),
          headers: { "Prefer": "return=representation" },
        });
        if (created?.[0]) setReminders(p => [...p, created[0]]);
      }
      addToast(existing ? `${rule.description} — já registrado ✓` : `${rule.description} — ${fmt(amt)} lançado!`, "success");
    } catch (e) { addToast("Erro: " + e.message, "error"); }
    finally { setConfirmingId(null); }
  };

  const skipRule = async (rule) => {
    const rem = reminders.find(r => r.recurring_id === rule.id);
    try {
      if (rem) {
        await supabaseFetch(`/recurring_reminders?id=eq.${rem.id}`, {
          method: "PATCH",
          body: JSON.stringify({ status: "skipped" }),
          headers: { "Prefer": "return=minimal" },
        });
        setReminders(p => p.map(r => r.id === rem.id ? { ...r, status: "skipped" } : r));
      } else {
        const created = await supabaseFetch("/recurring_reminders", {
          method: "POST",
          body: JSON.stringify({ family_id: family.family_id, recurring_id: rule.id, month: curMonth, year: curYear, amount: rule.amount_type === "fixed" ? rule.amount : null, status: "skipped" }),
          headers: { "Prefer": "return=representation" },
        });
        if (created?.[0]) setReminders(p => [...p, created[0]]);
      }
      addToast("Lembrete ignorado para este mês", "info");
    } catch (e) { addToast("Erro: " + e.message, "error"); }
  };

  const toggleActive = async (rule) => {
    try {
      await supabaseFetch(`/recurring_expenses?id=eq.${rule.id}`, {
        method: "PATCH",
        body: JSON.stringify({ active: !rule.active, updated_at: new Date().toISOString() }),
        headers: { "Prefer": "return=minimal" },
      });
      setRules(p => p.map(r => r.id === rule.id ? { ...r, active: !r.active } : r));
      addToast(rule.active ? "Recorrente pausado" : "Recorrente reativado", "info");
    } catch (e) { addToast("Erro: " + e.message, "error"); }
  };

  const deleteRule = async (rule) => {
    try {
      await supabaseFetch(`/recurring_expenses?id=eq.${rule.id}`, { method: "DELETE" });
      setRules(p => p.filter(r => r.id !== rule.id));
      setReminders(p => p.filter(r => r.recurring_id !== rule.id));
      addToast("Recorrente removido", "info");
    } catch (e) { addToast("Erro: " + e.message, "error"); }
  };


  const curMonthPrefix = `${curYear}-${String(curMonth).padStart(2,"0")}`;
  // Derive pending from rules directly — never depends on reminder rows existing.
  // We do NOT exclude rules that already have a matching expense: the user still
  // needs to explicitly confirm (✓) or skip (✕) each item so the reminder is
  // recorded. confirmRule() handles the "expense already exists" case gracefully.
  const pending = rules.filter(rule => {
    if (!rule.active) return false;
    if (rule.frequency === "yearly" && rule.month_of_year !== curMonth) return false;
    if (rule.end_date && rule.end_date < `${curMonthPrefix}-01`) return false;
    const rem = reminders.find(r => r.recurring_id === rule.id);
    return !rem || rem.status === "pending"; // hide only if confirmed or skipped
  });
  const confirmed = reminders.filter(r => r.status === "confirmed");

  if (loading) return <div style={{ textAlign:"center",padding:"48px 0",color:t.textMuted,fontSize:14 }}>Carregando...</div>;

  return (
    <div style={{ display:"flex",flexDirection:"column",gap:24 }}>

      {/* ── Pending reminders ── */}
      {pending.length > 0 && (
        <div style={{ background:t.warningSoft,border:`1px solid ${t.warning}44`,borderRadius:20,padding:20 }}>
          <div style={{ fontSize:14,fontWeight:700,color:t.warning,marginBottom:14,display:"flex",alignItems:"center",gap:8 }}>
            🔔 {pending.length} lembrete{pending.length>1?"s":""} aguardando valor — {MONTH_FULL[today.getMonth()]}
          </div>
          <div style={{ display:"flex",flexDirection:"column",gap:10 }}>
            {pending.map(rule => {
              const cat = CATEGORIES.find(c => c.id === rule.category);
              const isFixed = rule.amount_type === "fixed";
              const isConfirming = confirmingId === rule.id;
              return (
                <div key={rule.id} style={{ background:t.glassModal,border:`1px solid ${t.border}`,borderRadius:14,padding:"14px 16px" }}>
                  <div style={{ display:"flex",alignItems:"center",gap:10,marginBottom:10 }}>
                    <span style={{ fontSize:20 }}>{cat?.emoji || "📦"}</span>
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:13,fontWeight:700,color:t.text }}>{rule.description}</div>
                      <div style={{ fontSize:11,color:t.textMuted }}>
                        {cat?.label} · dia {rule.day_of_month} · {rule.user_label}
                        {isFixed && <span style={{ color:t.accent,fontWeight:600 }}> · {fmt(rule.amount)}</span>}
                        {!isFixed && <span style={{ color:t.warning,fontWeight:600 }}> · valor variável</span>}
                      </div>
                    </div>
                  </div>
                  <div style={{ display:"flex",gap:8,alignItems:"center" }}>
                    <input
                      type="number" step="0.01" min="0" placeholder={isFixed ? String(rule.amount) : "Quanto foi?"}
                      value={pendingAmt[rule.id] ?? (isFixed ? String(rule.amount) : "")}
                      onChange={e => setPendingAmt(p => ({ ...p, [rule.id]: e.target.value }))}
                      style={{ flex:1,padding:"9px 12px",borderRadius:10,border:`1px solid ${t.border}`,background:t.inputBg,color:t.text,fontSize:13,outline:"none",boxSizing:"border-box" }}
                    />
                    <button onClick={() => confirmRule(rule)} disabled={isConfirming}
                      style={{ background:t.success,border:"none",borderRadius:10,padding:"9px 16px",cursor:"pointer",color:"#fff",fontSize:12,fontWeight:700,whiteSpace:"nowrap",opacity:isConfirming?0.7:1 }}>
                      {isConfirming ? "..." : "✓"}
                    </button>
                    <button onClick={() => skipRule(rule)} title="Ignorar este mês"
                      style={{ background:t.surfaceHover,border:`1px solid ${t.border}`,borderRadius:10,padding:"9px 10px",cursor:"pointer",color:t.textMuted,fontSize:12 }}>
                      ✕
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Confirmed this month ── */}
      {confirmed.length > 0 && (
        <div style={{ background:t.successSoft,border:`1px solid ${t.success}33`,borderRadius:16,padding:"14px 18px" }}>
          <div style={{ fontSize:13,fontWeight:700,color:t.success,marginBottom:10 }}>
            ✅ {confirmed.length} lançado{confirmed.length>1?"s":""} em {MONTH_FULL[today.getMonth()]}
          </div>
          <div style={{ display:"flex",flexDirection:"column",gap:6 }}>
            {confirmed.map(rem => {
              const rule = rules.find(r => r.id === rem.recurring_id);
              if (!rule) return null;
              const cat = CATEGORIES.find(c => c.id === rule.category);
              return (
                <div key={rem.id} style={{ display:"flex",alignItems:"center",gap:10 }}>
                  <span style={{ fontSize:16 }}>{cat?.emoji || "📦"}</span>
                  <span style={{ fontSize:13,color:t.text,flex:1 }}>{rule.description}</span>
                  <span style={{ fontSize:13,fontWeight:700,color:t.success }}>{fmt(parseFloat(rem.amount)||0)}</span>
                </div>
              );
            })}
          </div>
          <div style={{ marginTop:12,paddingTop:10,borderTop:`1px solid ${t.success}44`,display:"flex",justifyContent:"space-between",alignItems:"center" }}>
            <span style={{ fontSize:13,fontWeight:700,color:t.success }}>Total lançado</span>
            <span style={{ fontSize:16,fontWeight:800,color:t.success }}>
              {fmt(confirmed.reduce((s,r)=>s+(parseFloat(r.amount)||0),0))}
            </span>
          </div>
        </div>
      )}

      {/* ── Rules list ── */}
      <div style={{ background:t.glassModal,border:`1px solid ${t.glassBorder}`,borderRadius:20,padding:20 }}>
        <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16 }}>
          <span style={{ fontSize:14,fontWeight:700,color:t.text }}>📋 Gastos recorrentes cadastrados</span>
          {!isDemo && (
            <button onClick={() => { setEditRule(null); setShowForm(true); }}
              style={{ background:t.accent,border:"none",borderRadius:10,padding:"7px 14px",cursor:"pointer",color:"#fff",fontSize:12,fontWeight:700,display:"flex",alignItems:"center",gap:6 }}>
              + Novo
            </button>
          )}
        </div>

        {rules.length === 0 ? (
          <div style={{ textAlign:"center",padding:"32px 0",color:t.textMuted,fontSize:13,lineHeight:1.8 }}>
            Nenhum gasto recorrente cadastrado ainda.<br/>
            Clique em <strong style={{ color:t.accent }}>+ Novo</strong> para adicionar aluguel, contas fixas, assinaturas...
          </div>
        ) : (
          <div style={{ display:"flex",flexDirection:"column",gap:8 }}>
            {rules.map(rule => {
              const cat = CATEGORIES.find(c => c.id === rule.category);
              const hasReminder = reminders.find(r => r.recurring_id === rule.id);
              const freqLabel = rule.frequency==="monthly" ? "Mensal" : rule.frequency==="weekly" ? "Semanal" : "Anual";
              const typeLabel = rule.type==="pix" ? "PIX" : rule.type==="debito" ? "Débito" : "Crédito";
              const rIsSel = rSelectedIds.has(rule.id);
              const rIsLp = rLpId === rule.id;
              return (
                <div key={rule.id}
                  onClick={() => { if(rSelMode) rToggleSel(rule.id); }}
                  onMouseDown={() => rStartLp(rule.id)}
                  onMouseUp={rCancelLp} onMouseLeave={rCancelLp}
                  onTouchStart={() => rStartLp(rule.id)} onTouchEnd={rCancelLp} onTouchCancel={rCancelLp}
                  style={{
                    display:"flex",alignItems:"center",gap:12,padding:"12px 14px",
                    borderRadius:14,background:rIsSel?"rgba(124,92,255,0.1)":t.surface,
                    border:`1px solid ${rIsSel?"rgba(124,92,255,0.4)":t.border}`,
                    opacity: rule.active ? 1 : 0.55,
                    cursor:"pointer",userSelect:"none",
                    transform: rIsLp?"scale(1.015)":"none",
                    boxShadow: rIsLp?"0 8px 24px rgba(124,92,255,0.3)":"none",
                    transition:"all 0.15s",
                  }}>
                  {rSelMode && (
                    <div style={{ width:22,height:22,borderRadius:999,flexShrink:0,border:rIsSel?"none":"1.8px solid rgba(255,255,255,0.35)",background:rIsSel?"#7c6af7":"transparent",display:"flex",alignItems:"center",justifyContent:"center" }}>
                      {rIsSel && <Icon name="check" size={12} color="#fff" />}
                    </div>
                  )}
                  <span style={{ fontSize:20,flexShrink:0 }}>{rule.active ? (cat?.emoji || "📦") : "⏸️"}</span>
                  <div style={{ flex:1,minWidth:0 }}>
                    <div style={{ fontSize:13,fontWeight:600,color:t.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>
                      {rule.description}
                    </div>
                    <div style={{ fontSize:11,color:t.textMuted,marginTop:2 }}>
                      {freqLabel} · dia {rule.day_of_month}
                      {rule.frequency==="yearly" && ` de ${MONTHS[rule.month_of_year-1]}`}
                      {" · "}{cat?.label}{" · "}{typeLabel}{" · "}{rule.user_label}
                    </div>
                  </div>
                  <div style={{ flexShrink:0,textAlign:"right" }}>
                    {rule.amount_type === "fixed"
                      ? <div style={{ fontSize:13,fontWeight:700,color:t.danger }}>{fmt(rule.amount)}</div>
                      : <div style={{ fontSize:11,color:t.warning,fontWeight:600 }}>Variável</div>
                    }
                    {hasReminder && (
                      <div style={{ fontSize:10,color:hasReminder.status==="confirmed"?t.success:t.warning,fontWeight:600,marginTop:2 }}>
                        {hasReminder.status==="confirmed" ? "✅ lançado" : hasReminder.status==="skipped" ? "⏭ ignorado" : "🔔 pendente"}
                      </div>
                    )}
                  </div>
                  <div style={{ display:"flex",gap:4,flexShrink:0 }}>
                    <button onClick={() => { setEditRule(rule); setShowForm(true); }} title="Editar"
                      style={{ background:"transparent",border:`1px solid ${t.border}`,borderRadius:8,width:30,height:30,cursor:"pointer",color:t.textMuted,fontSize:13,display:"flex",alignItems:"center",justifyContent:"center" }}
                      onMouseEnter={e=>e.currentTarget.style.color=t.accent}
                      onMouseLeave={e=>e.currentTarget.style.color=t.textMuted}>✏️</button>
                    <button onClick={() => toggleActive(rule)} title={rule.active?"Pausar":"Reativar"}
                      style={{ background:"transparent",border:`1px solid ${t.border}`,borderRadius:8,width:30,height:30,cursor:"pointer",color:t.textMuted,fontSize:13,display:"flex",alignItems:"center",justifyContent:"center" }}>
                      {rule.active ? "⏸" : "▶"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Floating delete bar — RecurringView */}
      {rSelMode && rSelectedIds.size > 0 && (
        <div style={{ position:"fixed",bottom:"calc(64px + env(safe-area-inset-bottom) + 10px)",left:20,right:20,zIndex:200,padding:"10px 12px",borderRadius:18,background:"rgba(20,14,36,0.92)",backdropFilter:"blur(22px)",border:`1px solid rgba(255,255,255,0.1)`,display:"flex",alignItems:"center",gap:10,boxShadow:"0 20px 40px rgba(0,0,0,0.5)" }}>
          <button onClick={rExitSel} style={{ padding:"0 14px",height:40,borderRadius:12,background:"transparent",border:"1px solid rgba(255,255,255,0.15)",color:"rgba(255,255,255,0.7)",fontSize:13,fontWeight:600,cursor:"pointer" }}>Cancelar</button>
          <button onClick={rDeleteSelected} style={{ flex:1,height:40,borderRadius:12,background:"rgba(255,107,107,0.18)",border:"1px solid rgba(255,107,107,0.35)",color:"#FF9B9B",fontSize:13.5,fontWeight:700,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:6 }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 4h10M6 4V3a1 1 0 011-1h2a1 1 0 011 1v1M5 4l.5 9a1 1 0 001 1h3a1 1 0 001-1L11 4" stroke="#FF9B9B" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
            Excluir {rSelectedIds.size}
          </button>
        </div>
      )}

      {/* ── Form modal (create / edit) ── */}
      {showForm && (
        <RecurringForm
          t={t} rule={editRule} family={family} user={user}
          familyMembers={familyMembers} addToast={addToast}
          onClose={() => { setShowForm(false); setEditRule(null); }}
          onSaved={(saved, isEdit) => {
            if (isEdit) setRules(p => p.map(r => r.id === saved.id ? saved : r));
            else setRules(p => [...p, saved]);
            setShowForm(false); setEditRule(null);
          }}
        />
      )}

      <ConfirmModal
        open={!!rConfirmOpts}
        title={rConfirmOpts?.title}
        message={rConfirmOpts?.message}
        onConfirm={() => { rConfirmOpts?.onConfirm(); setRConfirmOpts(null); }}
        onCancel={() => setRConfirmOpts(null)}
        t={t}
      />
    </div>
  );
}

// ─── RECURRING FORM ───────────────────────────────────────────────────────────
function RecurringForm({ t, rule, family, user, familyMembers, addToast, onClose, onSaved }) {
  const isEdit = !!rule;
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    description:   rule?.description   || "",
    category:      rule?.category      || "",
    type:          rule?.type          || "debito",
    user_label:    rule?.user_label    || (familyMembers[0]?.first_name || "Você"),
    amount_type:   rule?.amount_type   || "fixed",
    amount:        rule?.amount        || "",
    frequency:     rule?.frequency     || "monthly",
    day_of_month:  rule?.day_of_month  || new Date().getDate(),
    month_of_year: rule?.month_of_year || (new Date().getMonth() + 1),
    end_date:      rule?.end_date      || "",
  });

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const handle = async () => {
    if (!form.description.trim()) { addToast("Informe a descrição", "error"); return; }
    if (!form.category) { addToast("Selecione uma categoria", "error"); return; }
    if (form.amount_type === "fixed" && (!form.amount || parseFloat(form.amount) <= 0)) {
      addToast("Informe o valor", "error"); return;
    }
    setSaving(true);
    const payload = {
      family_id:    family.family_id,
      description:  form.description.trim(),
      category:     form.category,
      type:         form.type,
      user_label:   form.user_label,
      amount_type:  form.amount_type,
      amount:       form.amount_type === "fixed" ? parseFloat(form.amount) : null,
      frequency:    form.frequency,
      day_of_month: parseInt(form.day_of_month),
      month_of_year: form.frequency === "yearly" ? parseInt(form.month_of_year) : null,
      end_date:     form.end_date || null,
      updated_at:   new Date().toISOString(),
    };
    try {
      if (isEdit) {
        await supabaseFetch(`/recurring_expenses?id=eq.${rule.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
          headers: { "Prefer": "return=minimal" },
        });
        onSaved({ ...rule, ...payload }, true);
        addToast("Recorrente atualizado!", "success");
      } else {
        const rows = await supabaseFetch("/recurring_expenses", {
          method: "POST",
          body: JSON.stringify({ ...payload, active: true }),
          headers: { "Prefer": "return=representation" },
        });
        onSaved(rows[0], false);
        addToast("Recorrente criado!", "success");
      }
    } catch (e) { addToast("Erro: " + e.message, "error"); setSaving(false); }
  };

  return (
    <div onClick={e=>{ if(e.target===e.currentTarget) onClose(); }}
      style={{ position:"fixed",inset:0,zIndex:500,background:"rgba(0,0,0,0.65)",backdropFilter:"blur(10px)",display:"flex",alignItems:"flex-start",justifyContent:"center",paddingTop:80,paddingBottom:32,paddingLeft:16,paddingRight:16,overflowY:"auto",WebkitOverflowScrolling:"touch" }}>
      <div onClick={e=>e.stopPropagation()}
        style={{ background:t.glassModal,border:`1.5px solid ${t.glassBorder}`,borderRadius:24,padding:"24px 20px",width:"100%",maxWidth:460,boxShadow:t.shadow,animation:"modalIn 0.25s ease",flexShrink:0 }}>
        <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20 }}>
          <h3 style={{ margin:0,fontSize:17,fontWeight:800,color:t.text,letterSpacing:"-0.02em" }}>
            {isEdit ? "✏️ Editar Recorrente" : "🔁 Novo Recorrente"}
          </h3>
          <button onClick={onClose} style={{ background:"transparent",border:"none",cursor:"pointer",color:t.textMuted,fontSize:22,padding:"2px 8px" }}>×</button>
        </div>

        <Input label="Descrição" t={t} value={form.description} onChange={e=>set("description",e.target.value)} placeholder="Ex: Conta de Luz, Netflix, Aluguel..." />

        {/* Who pays */}
        <Select label="Quem paga?" t={t} value={form.user_label} onChange={e=>set("user_label",e.target.value)}>
          {familyMembers.length > 0
            ? familyMembers.map(m => {
                const name = [m.first_name, m.last_name].filter(Boolean).join(" ") || m.email;
                return <option key={m.user_id} value={name}>{name}</option>;
              })
            : <option value="Você">Você</option>
          }
        </Select>

        <Select label="Tipo de pagamento" t={t} value={form.type} onChange={e=>set("type",e.target.value)}>
          <option value="pix">💸 PIX</option>
          <option value="debito">🏦 Débito</option>
          <option value="credito">💳 Crédito</option>
        </Select>

        <Select label="Categoria" t={t} value={form.category} onChange={e=>set("category",e.target.value)}>
          <option value="">Selecione...</option>
          {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.emoji} {c.label}</option>)}
        </Select>

        <Select label="Frequência" t={t} value={form.frequency} onChange={e=>set("frequency",e.target.value)}>
          <option value="monthly">📅 Mensal</option>
          <option value="weekly">📅 Semanal</option>
          <option value="yearly">📅 Anual</option>
        </Select>

        <div style={{ display:"grid",gridTemplateColumns: form.frequency==="yearly" ? "1fr 1fr" : "1fr",gap:12 }}>
          <Input label="Dia de vencimento" t={t} type="number" min={1} max={31} value={form.day_of_month} onChange={e=>set("day_of_month",e.target.value)} />
          {form.frequency === "yearly" && (
            <Select label="Mês" t={t} value={form.month_of_year} onChange={e=>set("month_of_year",e.target.value)}>
              {MONTH_FULL.map((m,i) => <option key={i} value={i+1}>{m}</option>)}
            </Select>
          )}
        </div>

        {/* Amount type toggle */}
        <div style={{ marginBottom:16 }}>
          <label style={{ display:"block",marginBottom:8,fontSize:13,fontWeight:600,color:t.textSecondary }}>Tipo de valor</label>
          <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:8 }}>
            {[{v:"fixed",label:"💰 Valor fixo"},{v:"variable",label:"🔔 Variável"}].map(opt=>(
              <button key={opt.v} type="button" onClick={()=>set("amount_type",opt.v)}
                style={{ padding:"10px 12px",borderRadius:12,border:`1.5px solid ${form.amount_type===opt.v?t.accent:t.border}`,background:form.amount_type===opt.v?t.accentSoft:"transparent",color:form.amount_type===opt.v?t.accent:t.textMuted,fontSize:12,fontWeight:700,cursor:"pointer",transition:"all 0.2s" }}>
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {form.amount_type === "fixed" && (
          <Input label="Valor (R$)" t={t} type="number" step="0.01" value={form.amount} onChange={e=>set("amount",e.target.value)} placeholder="0,00" />
        )}
        {form.amount_type === "variable" && (
          <div style={{ marginBottom:16,padding:"10px 14px",borderRadius:12,background:t.warningSoft,border:`1px solid ${t.warning}33`,fontSize:12,color:t.warning,fontWeight:600 }}>
            🔔 Todo mês você receberá um lembrete para inserir o valor pago.
          </div>
        )}

        <DateInput label="Data de término (opcional)" t={t} value={form.end_date} onChange={e=>set("end_date",e.target.value)} />

        <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginTop:4 }}>
          <Btn t={t} variant="ghost" type="button" onClick={onClose}>Cancelar</Btn>
          <Btn t={t} type="button" onClick={handle} disabled={saving}>
            {saving ? "Salvando..." : isEdit ? "💾 Atualizar" : "💾 Criar"}
          </Btn>
        </div>
      </div>
    </div>
  );
}

// ─── RECURRING ALERT CARD (Dashboard) ────────────────────────────────────────
function RecurringAlertCard({ t, family, isDemo, onGoToRecurring }) {
  const [pending, setPending] = useState([]);

  useEffect(() => {
    if (isDemo || !family) return;
    const curMonth = today.getMonth() + 1;
    const curYear  = today.getFullYear();
    const curPrefix = `${curYear}-${String(curMonth).padStart(2,"0")}`;
    Promise.all([
      supabaseFetch(`/recurring_expenses?family_id=eq.${family.family_id}&active=eq.true&select=*`),
      supabaseFetch(`/recurring_reminders?family_id=eq.${family.family_id}&month=eq.${curMonth}&year=eq.${curYear}&select=*`),
    ]).then(([rules, rems]) => {
      if (!rules) return;
      const remMap = {};
      (rems || []).forEach(r => { remMap[r.recurring_id] = r; });
      const pendingRules = rules.filter(rule => {
        if (rule.frequency === "yearly" && rule.month_of_year !== curMonth) return false;
        if (rule.end_date && rule.end_date < `${curPrefix}-01`) return false;
        const rem = remMap[rule.id];
        return !rem || rem.status === "pending";
      });
      setPending(pendingRules);
    }).catch(() => {});
  }, [family, isDemo]);

  if (!pending.length) return null;

  return (
    <div style={{ background:t.warningSoft,border:`1px solid ${t.warning}44`,borderRadius:16,padding:"14px 18px",cursor:"pointer" }} onClick={onGoToRecurring}>
      <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8 }}>
        <span style={{ fontSize:13,fontWeight:700,color:t.warning }}>🔔 {pending.length} conta{pending.length>1?"s":""} aguardando valor</span>
        <span style={{ fontSize:12,color:t.accent,fontWeight:700 }}>Registrar →</span>
      </div>
      <div style={{ display:"flex",flexWrap:"wrap",gap:6 }}>
        {pending.slice(0,4).map(rule => {
          const cat = CATEGORIES.find(c => c.id === rule.category);
          return (
            <span key={rule.id} style={{ fontSize:11,background:t.surface,border:`1px solid ${t.border}`,borderRadius:8,padding:"3px 8px",color:t.text }}>
              {cat?.emoji} {rule.description}
            </span>
          );
        })}
        {pending.length > 4 && <span style={{ fontSize:11,color:t.textMuted }}>+{pending.length-4} mais</span>}
      </div>
    </div>
  );
}

// ─── BUDGET VIEW ──────────────────────────────────────────────────────────────
function BudgetView({ expenses, t, family, user, isDemo, addToast }) {
  const [budgets, setBudgets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingCat, setEditingCat] = useState(null); // category id being edited
  const [inputVal, setInputVal] = useState("");
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [viewYear, setViewYear] = useState(today.getFullYear());

  const prefix = `${viewYear}-${String(viewMonth+1).padStart(2,"0")}`;

  // Load budgets for current month/year
  useEffect(() => {
    if (isDemo || !family) { setLoading(false); return; }
    setLoading(true);
    supabaseFetch(`/budgets?family_id=eq.${family.family_id}&month=eq.${viewMonth+1}&year=eq.${viewYear}&select=*`)
      .then(rows => { setBudgets(rows || []); setLoading(false); })
      .catch(() => { setLoading(false); });
  }, [family, viewMonth, viewYear, isDemo]);

  const getBudget = (catId) => budgets.find(b => b.category === catId);

  const saveBudget = async (catId, value) => {
    const amount = parseFloat(value);
    if (!amount || amount <= 0) { deleteBudget(catId); return; }
    const existing = getBudget(catId);
    try {
      if (existing) {
        await supabaseFetch(`/budgets?id=eq.${existing.id}`, {
          method: "PATCH",
          body: JSON.stringify({ amount, updated_at: new Date().toISOString() }),
          headers: { "Prefer": "return=representation" },
        });
        setBudgets(p => p.map(b => b.id === existing.id ? { ...b, amount } : b));
      } else {
        const rows = await supabaseFetch("/budgets", {
          method: "POST",
          body: JSON.stringify({
            family_id: family.family_id,
            category: catId,
            amount,
            month: viewMonth + 1,
            year: viewYear,
          }),
          headers: { "Prefer": "return=representation" },
        });
        if (rows?.[0]) setBudgets(p => [...p, rows[0]]);
      }
      addToast("Orçamento salvo!", "success");
    } catch (e) { addToast("Erro ao salvar: " + e.message, "error"); }
    setEditingCat(null);
  };

  const deleteBudget = async (catId) => {
    const existing = getBudget(catId);
    if (!existing) return;
    try {
      await supabaseFetch(`/budgets?id=eq.${existing.id}`, { method: "DELETE" });
      setBudgets(p => p.filter(b => b.id !== existing.id));
    } catch (e) { addToast("Erro ao remover", "error"); }
    setEditingCat(null);
  };

  // Copy budgets from previous month
  const copyFromPrevMonth = async () => {
    const prevMonth = viewMonth === 0 ? 11 : viewMonth - 1;
    const prevYear  = viewMonth === 0 ? viewYear - 1 : viewYear;
    try {
      const prevBudgets = await supabaseFetch(
        `/budgets?family_id=eq.${family.family_id}&month=eq.${prevMonth+1}&year=eq.${prevYear}&select=*`
      );
      if (!prevBudgets?.length) { addToast("Nenhum orçamento encontrado no mês anterior", "info"); return; }
      const inserts = prevBudgets
        .filter(b => !getBudget(b.category))
        .map(b => ({ family_id: family.family_id, category: b.category, amount: b.amount, month: viewMonth+1, year: viewYear }));
      if (!inserts.length) { addToast("Todas as categorias já têm orçamento este mês", "info"); return; }
      const rows = await supabaseFetch("/budgets", {
        method: "POST",
        body: JSON.stringify(inserts),
        headers: { "Prefer": "return=representation" },
      });
      if (rows) setBudgets(p => [...p, ...rows]);
      addToast(`${inserts.length} orçamento(s) copiado(s)!`, "success");
    } catch (e) { addToast("Erro ao copiar: " + e.message, "error"); }
  };

  // Totals
  const totalBudgeted = budgets.reduce((s, b) => s + parseFloat(b.amount), 0);
  const totalSpent    = expenses.filter(e => e.date?.startsWith(prefix)).reduce((s, e) => s + (parseFloat(e.amount)||0), 0);
  const totalPct      = totalBudgeted > 0 ? Math.min(100, (totalSpent / totalBudgeted) * 100) : 0;

  // Month navigation
  const prevMonth = () => { if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y-1); } else setViewMonth(m => m-1); };
  const nextMonth = () => { if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y+1); } else setViewMonth(m => m+1); };
  const isCurrentMonth = viewMonth === today.getMonth() && viewYear === today.getFullYear();

  return (
    <div style={{ display:"flex",flexDirection:"column",gap:20 }}>

      {/* Header */}
      <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:12 }}>
        <div style={{ display:"flex",alignItems:"center",gap:12 }}>
          <button onClick={prevMonth}
            style={{ background:t.surfaceHover,border:`1px solid ${t.border}`,borderRadius:10,width:34,height:34,cursor:"pointer",color:t.text,fontSize:16,display:"flex",alignItems:"center",justifyContent:"center" }}>‹</button>
          <span style={{ fontWeight:700,fontSize:16,color:t.text,minWidth:140,textAlign:"center",letterSpacing:"-0.02em" }}>
            {MONTH_FULL[viewMonth]} {viewYear}
          </span>
          <button onClick={nextMonth}
            style={{ background:t.surfaceHover,border:`1px solid ${t.border}`,borderRadius:10,width:34,height:34,cursor:"pointer",color:t.text,fontSize:16,display:"flex",alignItems:"center",justifyContent:"center" }}>›</button>
        </div>
        {!isDemo && (
          <button onClick={copyFromPrevMonth}
            style={{ background:t.accentSoft,border:`1px solid ${t.accent}33`,borderRadius:10,padding:"7px 14px",cursor:"pointer",color:t.accent,fontSize:12,fontWeight:700,display:"flex",alignItems:"center",gap:6 }}>
            📋 Copiar do mês anterior
          </button>
        )}
      </div>

      {/* Total summary bar */}
      {totalBudgeted > 0 && (
        <div style={{ background:t.surface,border:`1px solid ${t.border}`,borderRadius:16,padding:"16px 20px" }}>
          <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10 }}>
            <span style={{ fontSize:13,fontWeight:700,color:t.text }}>Total do orçamento</span>
            <span style={{ fontSize:13,fontWeight:700,color:totalPct>=100?t.danger:totalPct>=80?t.warning:t.success }}>
              {fmt(totalSpent)} <span style={{ color:t.textMuted,fontWeight:400 }}>de {fmt(totalBudgeted)}</span>
            </span>
          </div>
          <div style={{ height:8,borderRadius:4,background:t.surfaceHover,overflow:"hidden" }}>
            <div style={{ height:"100%",borderRadius:4,width:`${totalPct}%`,transition:"width 0.6s ease",
              background: totalPct>=100 ? t.danger : totalPct>=80 ? t.warning : t.success }} />
          </div>
          <div style={{ fontSize:11,color:t.textMuted,marginTop:6 }}>
            {totalPct>=100 ? "⚠️ Orçamento estourado" : totalPct>=80 ? `⚡ ${(100-totalPct).toFixed(0)}% restante` : `✅ ${(100-totalPct).toFixed(0)}% restante`}
            {" · "}{fmt(Math.max(0, totalBudgeted - totalSpent))} disponível
          </div>
        </div>
      )}

      {/* Category list */}
      {loading ? (
        <div style={{ textAlign:"center",padding:"32px 0",color:t.textMuted,fontSize:14 }}>Carregando orçamentos...</div>
      ) : (
        <div style={{ display:"flex",flexDirection:"column",gap:10 }}>
          {CATEGORIES.map(cat => {
            const budget = getBudget(cat.id);
            const spent  = expenses.filter(e => e.date?.startsWith(prefix) && e.category === cat.id)
                                   .reduce((s,e) => s + (parseFloat(e.amount)||0), 0);
            const pct    = budget ? Math.min(100, (spent / parseFloat(budget.amount)) * 100) : 0;
            const over   = budget && spent > parseFloat(budget.amount);
            const warn   = budget && !over && pct >= 80;
            const barColor = over ? t.danger : warn ? t.warning : t.accent;
            const isEditing = editingCat === cat.id;

            return (
              <div key={cat.id} style={{
                background:t.surface,border:`1px solid ${over ? t.danger+"55" : warn ? t.warning+"55" : t.border}`,
                borderRadius:16,padding:"14px 16px",transition:"all 0.2s"
              }}>
                <div style={{ display:"flex",alignItems:"center",gap:12 }}>
                  {/* Icon + name */}
                  <span style={{ fontSize:20,flexShrink:0 }}>{cat.emoji}</span>
                  <div style={{ flex:1,minWidth:0 }}>
                    <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom: budget ? 6 : 0 }}>
                      <span style={{ fontSize:13,fontWeight:600,color:t.text }}>{cat.label}</span>
                      <div style={{ display:"flex",alignItems:"center",gap:8,flexShrink:0 }}>
                        {budget && (
                          <span style={{ fontSize:12,color:over?t.danger:warn?t.warning:t.textMuted,fontWeight:600 }}>
                            {fmt(spent)} / {fmt(parseFloat(budget.amount))}
                          </span>
                        )}
                        {!budget && spent > 0 && (
                          <span style={{ fontSize:12,color:t.textMuted }}>
                            {fmt(spent)} <span style={{ color:t.textMuted,opacity:0.6 }}>(sem limite)</span>
                          </span>
                        )}
                        {/* Edit/Set button */}
                        {!isDemo && !isEditing && (
                          <button onClick={() => { setEditingCat(cat.id); setInputVal(budget ? String(budget.amount) : ""); }}
                            style={{ background:budget?t.surfaceHover:t.accentSoft,border:`1px solid ${budget?t.border:t.accent+"33"}`,borderRadius:8,padding:"4px 8px",cursor:"pointer",fontSize:13,fontWeight:700,color:budget?t.textMuted:t.accent,flexShrink:0 }}>
                            {budget ? "✏️" : "+"}
                          </button>
                        )}
                      </div>
                    </div>
                    {/* Progress bar */}
                    {budget && (
                      <div style={{ height:6,borderRadius:3,background:t.surfaceHover,overflow:"hidden" }}>
                        <div style={{ height:"100%",borderRadius:3,width:`${pct}%`,background:barColor,transition:"width 0.5s ease" }} />
                      </div>
                    )}
                    {/* Inline edit */}
                    {isEditing && (
                      <div style={{ display:"flex",gap:8,marginTop:10,alignItems:"center" }} onClick={e=>e.stopPropagation()}>
                        <input
                          type="number" step="0.01" min="0" autoFocus
                          value={inputVal} onChange={e=>setInputVal(e.target.value)}
                          onKeyDown={e=>{ if(e.key==="Enter") saveBudget(cat.id,inputVal); if(e.key==="Escape") setEditingCat(null); }}
                          placeholder="Ex: 500,00"
                          style={{ flex:1,padding:"8px 12px",borderRadius:10,border:`1px solid ${t.accent}`,background:t.inputBg,color:t.text,fontSize:13,outline:"none",boxSizing:"border-box" }}
                        />
                        <button onClick={()=>saveBudget(cat.id,inputVal)}
                          style={{ background:t.accent,border:"none",borderRadius:10,padding:"8px 14px",cursor:"pointer",color:"#fff",fontSize:12,fontWeight:700 }}>✓</button>
                        <button onClick={()=>setEditingCat(null)}
                          style={{ background:t.surfaceHover,border:`1px solid ${t.border}`,borderRadius:10,padding:"8px 10px",cursor:"pointer",color:t.textMuted,fontSize:12 }}>✕</button>
                        {budget && (
                          <button onClick={()=>deleteBudget(cat.id)}
                            style={{ background:t.dangerSoft,border:`1px solid ${t.danger}33`,borderRadius:10,padding:"8px 10px",cursor:"pointer",color:t.danger,fontSize:12 }}>🗑</button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                {/* Over budget warning */}
                {over && (
                  <div style={{ marginTop:8,fontSize:11,color:t.danger,fontWeight:600,display:"flex",alignItems:"center",gap:4 }}>
                    ⚠️ Limite ultrapassado em {fmt(spent - parseFloat(budget.amount))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!isDemo && budgets.length === 0 && !loading && (
        <div style={{ textAlign:"center",padding:"24px 0",color:t.textMuted,fontSize:13,lineHeight:1.7 }}>
          Nenhum orçamento definido para este mês.<br/>
          Clique em <strong style={{color:t.accent}}>+ Definir</strong> em cada categoria para estabelecer limites.<br/>
          Ou use <strong style={{color:t.accent}}>Copiar do mês anterior</strong> se já configurou antes.
        </div>
      )}
    </div>
  );
}

// ─── SKELETON SCREENS ─────────────────────────────────────────────────────────
function SummaryCardsSkeleton({ t }) {
  return (
    <div className="summary-grid" style={{ marginBottom:24 }}>
      {[1,2,3,4].map(i=>(
        <div key={i} style={{ background:t.surface,border:`1px solid ${t.border}`,borderRadius:18,padding:"18px 20px" }}>
          <div className="sk" style={{ width:32,height:32,borderRadius:8,marginBottom:12 }} />
          <div className="sk" style={{ width:"55%",height:10,borderRadius:6,marginBottom:8 }} />
          <div className="sk" style={{ width:"75%",height:24,borderRadius:8 }} />
        </div>
      ))}
    </div>
  );
}

function TransactionsListSkeleton({ t, rows = 6 }) {
  return (
    <div style={{ display:"flex",flexDirection:"column",gap:8 }}>
      {Array.from({length:rows},(_,i)=>(
        <div key={i} style={{ display:"flex",alignItems:"center",gap:12,padding:"12px 14px",borderRadius:16,background:t.surface,border:`1px solid ${t.border}` }}>
          <div className="sk" style={{ width:40,height:40,borderRadius:"50%",flexShrink:0 }} />
          <div style={{ flex:1 }}>
            <div className="sk" style={{ width:"60%",height:12,borderRadius:6,marginBottom:6 }} />
            <div className="sk" style={{ width:"40%",height:10,borderRadius:6 }} />
          </div>
          <div className="sk" style={{ width:60,height:16,borderRadius:6 }} />
        </div>
      ))}
    </div>
  );
}

function ChartsViewSkeleton({ t }) {
  return (
    <div style={{ display:"flex",flexDirection:"column",gap:20 }}>
      <div style={{ display:"flex",gap:8 }}>
        {[1,2,3].map(i=><div key={i} className="sk" style={{ flex:1,height:34,borderRadius:10 }} />)}
      </div>
      <div className="sk" style={{ width:"100%",height:260,borderRadius:16 }} />
      <div style={{ display:"flex",gap:8,justifyContent:"center" }}>
        {[1,2,3].map(i=><div key={i} className="sk" style={{ width:i===1?18:8,height:8,borderRadius:4 }} />)}
      </div>
    </div>
  );
}

// ─── SUMMARY CARDS ────────────────────────────────────────────────────────────
function SummaryCards({ expenses, incomes, t, only = null }) {
  const prefix=`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}`;
  // Use monthlyAmount: for credit installments, amount is already the monthly value
  const monthExp=expenses.filter(e=>e.date?.startsWith(prefix)).reduce((s,e)=>s+(parseFloat(e.amount)||0),0);
  const monthInc=incomes.filter(i=>i.date?.startsWith(prefix)).reduce((s,i)=>s+(parseFloat(i.amount)||0),0);
  const balance=monthInc-monthExp;
  // Parcelas futuras: amount = valor de cada parcela, parcelas = total de parcelas
  // Calcular quantas parcelas ainda faltam (a partir do mês atual inclusive)
  const { creditPending, lastInstallmentDate } = (() => {
    const nowYr = today.getFullYear(), nowMo = today.getMonth();
    let total = 0, lastDate = null;
    expenses.forEach(e => {
      const p = parseInt(e.parcelas) || 1;
      if ((e.type||"").trim().toLowerCase() !== "credito" || p <= 1) return;
      const installment = parseFloat(e.amount) || 0;
      if (!e.date || installment <= 0) return;
      const parts = e.date.slice(0,7).split("-");
      const startYr = parseInt(parts[0]), startMo = parseInt(parts[1]) - 1;
      const elapsed = (nowYr - startYr) * 12 + (nowMo - startMo);
      const remaining = Math.max(0, p - elapsed);
      total += installment * remaining;
      const lastMoTotal = startMo + (p - 1);
      const lastYr = startYr + Math.floor(lastMoTotal / 12);
      const lastMo = lastMoTotal % 12;
      const lastDay = parseInt(e.date.slice(8, 10)) || 1;
      const candidate = new Date(lastYr, lastMo, lastDay);
      if (!lastDate || candidate > lastDate) lastDate = candidate;
    });
    return { creditPending: total, lastInstallmentDate: lastDate };
  })();
  const lastInstallmentLabel = lastInstallmentDate
    ? `Última parcela em ${String(lastInstallmentDate.getDate()).padStart(2,'0')}/${String(lastInstallmentDate.getMonth()+1).padStart(2,'0')}/${lastInstallmentDate.getFullYear()}`
    : null;
  const cards=[
    { label:"Receitas do Mês",value:fmt(monthInc),color:t.success,bg:t.successSoft,border:`${t.success}33`,icon:"💰" },
    { label:"Gastos do Mês",value:fmt(monthExp),color:t.danger,bg:t.dangerSoft,border:`${t.danger}33`,icon:"💸" },
    { label:"Saldo",value:fmt(balance),color:balance>=0?t.success:t.danger,bg:balance>=0?t.successSoft:t.dangerSoft,border:`${balance>=0?t.success:t.danger}33`,icon:balance>=0?"📈":"📉" },
    { label:"Parcelas Futuras",value:fmt(creditPending),color:t.warning,bg:t.warningSoft,border:`${t.warning}33`,icon:"💳",subtitle:lastInstallmentLabel },
  ];
  const visibleCards = only ? cards.filter(c => only.includes(c.label)) : cards;
  const gridClass = only
    ? (only.length === 3 ? "summary-grid-3" : only.length === 1 ? "summary-grid-1" : "summary-grid")
    : "summary-grid";
  return (
    <div className={gridClass}>
      {visibleCards.map(c=>(
        <div key={c.label} style={{ background:c.bg,border:`1px solid ${c.border}`,backdropFilter:"blur(12px)",borderRadius:18,padding:"20px 22px",transition:"transform 0.2s" }}
          onMouseEnter={e=>e.currentTarget.style.transform="translateY(-2px)"}
          onMouseLeave={e=>e.currentTarget.style.transform="translateY(0)"}
        >
          <div style={{ fontSize:26,marginBottom:10 }}>{c.icon}</div>
          <div style={{ fontSize:10,fontWeight:700,color:t.textMuted,letterSpacing:"0.08em",marginBottom:4,textTransform:"uppercase" }}>{c.label}</div>
          {c.subtitle && <div style={{ fontSize:11,color:t.textMuted,marginBottom:6 }}>{c.subtitle}</div>}
          <div style={{ fontSize:22,fontWeight:800,color:c.color,letterSpacing:"-0.02em" }}>{c.value}</div>
        </div>
      ))}
    </div>
  );
}


// ─── IMPORT VIEW ─────────────────────────────────────────────────────────────
function ImportView({ t, darkMode, family, user, isDemo, onImported, addToast, existingExpenses, existingIncomes }) {
  const [step, setStep] = useState("upload");
  const [fileName, setFileName] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("");
  const [mapped, setMapped] = useState([]);
  const [stats, setStats] = useState(null);
  const [dupFilter, setDupFilter] = useState("all"); // all | new | duplicate

  // ── Duplicate detection: same description + date + amount ──
  const isDuplicate = (row, existingList) => {
    const amt = parseFloat(row.amount);
    return existingList.some(e =>
      e.date?.slice(0,10) === row.date &&
      Math.abs((parseFloat(e.amount) || 0) - amt) < 0.01 &&
      (e.description || "").toLowerCase().trim() === (row.description || "").toLowerCase().trim()
    );
  };

  // PDF processing is handled server-side by the Supabase Edge Function via analyzeWithAI

  // ── CSV parser helpers ──────────────────────────────────────────────────────
  const cleanBRL = (v) => {
    if (!v) return 0;
    const s = String(v).replace(/[R$\s\u00a0]/g,'').replace(/-/g,'').replace(/\./g,'').replace(/,/g,'.');
    const n = parseFloat(s);
    return isNaN(n) || n <= 0 ? 0 : n;
  };

  const parseCSVRows = (text) => {
    const lines = text.replace(/\r\n/g,'\n').replace(/\r/g,'\n').split('\n');
    return lines.map(line => {
      const cols = []; let cur = '', inQ = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') { inQ = !inQ; }
        else if (c === ',' && !inQ) { cols.push(cur.trim()); cur = ''; }
        else { cur += c; }
      }
      cols.push(cur.trim());
      return cols;
    });
  };

  // ── Detect format and parse locally (no AI needed for known formats) ────────
  const detectAndParseLocal = (text, filename) => {
    const lines = text.replace(/\r/g,'').split('\n').filter(l => l.trim());
    const firstLine = lines[0] || '';
    const secondLine = lines[1] || '';

    // Format 1: Annual_Expenses — "Planilha Financeira" + "*HABITAÇÃO|Dia 1|Dia 2..."
    if (firstLine.includes('Planilha Financeira') || lines.some(l => l.includes('*HABITAÇÃO') || l.includes('*RENDA FAMILIAR') || l.includes('RENDA FAMILIAR'))) {
      return parseAnnualExpenses(text, filename);
    }

    // Format 2: Gastos_Anual — header starts with "Cartão,Data,Descrição,Parcela"
    if (firstLine.toLowerCase().includes('cartão') && firstLine.toLowerCase().includes('parcela') && firstLine.toLowerCase().includes('descrição')) {
      return parseGastosAnual(text, filename);
    }

    // Unknown format — send to AI
    return null;
  };

  const parseAnnualExpenses = (text, filename) => {
    const catMap = {
      'aluguel':'moradia','luz':'moradia','gás':'moradia','condomínio':'moradia',
      'internet':'moradia','água':'moradia','diarista':'moradia','gas':'moradia',
      'supermercado':'supermercado','escola':'educacao','faculdade':'educacao','curso':'educacao',
      'plano de saúde':'saude','dentista':'saude','farmácia':'saude','psico':'saude',
      'academia':'saude','farmacia':'saude','plano':'saude',
      'combustível':'transporte','mecânico':'transporte','lavagem':'transporte','combustivel':'transporte',
      'salão':'saude','vestuário':'vestuario','vestuario':'vestuario','roupa':'vestuario',
      'ifood':'alimentacao','padaria':'alimentacao','restaurante':'alimentacao',
      'passeio':'lazer','presente':'lazer','netflix':'lazer','spotify':'lazer',
      'telefone':'tecnologia','celular':'tecnologia',
    };
    const incomeKw = ['salário','salario','benefício','beneficio','13°','outros'];
    const skipKw = ['total','não editar','nao editar','dia 1','planilha','(não','habitação','saúde',
                    'automóvel','despesas','lazer','outros','renda familiar','cartão','*habitação',
                    '*saúde','*automóvel','*despesas','*lazer'];

    // Detect month and year from filename or content
    const monthMap = {jan:1,fev:2,mar:3,abr:4,mai:5,jun:6,jul:7,ago:8,set:9,out:10,nov:11,dez:12,
                       january:1,february:2,march:3};
    let month = 1, year = new Date().getFullYear();
    const fn = filename.toLowerCase();
    for (const [k,v] of Object.entries(monthMap)) { if (fn.includes(k)) { month = v; break; } }
    const yrMatch = fn.match(/20(\d{2})/); if (yrMatch) year = 2000 + parseInt(yrMatch[1]);

    const rows = parseCSVRows(text);
    const records = [];
    let inRenda = false;

    for (const row of rows) {
      if (!row.length || !row[0].trim()) continue;
      const raw = row[0].trim();
      const label = raw.replace(/^[* ]+/,'').toLowerCase();

      if (label.includes('renda familiar') || raw.includes('*RENDA')) { inRenda = true; continue; }
      if (raw.startsWith('*') && raw.length > 1) inRenda = false;

      if (skipKw.some(s => label === s || label.startsWith(s) || label.startsWith('(não'))) continue;
      if (label === '' || label === 'total:') continue;

      const isIncome = inRenda || incomeKw.some(k => label.startsWith(k));
      let cat = isIncome ? 'salario' : 'outros';
      if (!isIncome) { for (const [k,v] of Object.entries(catMap)) { if (label.includes(k)) { cat = v; break; } } }

      for (let d = 1; d <= 31 && d < row.length; d++) {
        const val = cleanBRL(row[d]);
        if (val > 0) {
          records.push({
            record_type: isIncome ? 'income' : 'expense',
            description: raw.replace(/^[* ]+/,'').trim(),
            amount: Math.round(val * 100) / 100,
            date: year + "-" + String(month).padStart(2,'0') + "-" + String(d).padStart(2,'0'),
            category: cat,
            type: 'pix',
            parcelas: 1,
            user_label: 'Você',
            _confidence: 0.92,
            _notes: "Dia " + d + "/" + String(month).padStart(2,'0') + "/" + year
          });
        }
      }
    }
    return records;
  };

  const parseGastosAnual = (text, filename) => {
    const monthMap = {DEZ:12,JAN:1,FEV:2,MAR:3,ABR:4,MAI:5,JUN:6,JUL:7,AGO:8,SET:9,OUT:10,NOV:11};
    const rows = parseCSVRows(text);
    if (rows.length < 2) return [];

    const header = rows[0].map(h => h.trim().toUpperCase());
    const year = new Date().getFullYear();

    // Find which month columns exist and ask user — default to all months with data
    const records = [];
    for (let ci = 4; ci < header.length; ci++) {
      const mLabel = header[ci].trim();
      const mNum = monthMap[mLabel];
      if (!mNum) continue;

      // Use year based on month (DEZ = previous year)
      const yr = mNum === 12 ? year - 1 : year;

      for (let ri = 1; ri < rows.length; ri++) {
        const row = rows[ri];
        if (!row[0] || !row[0].trim()) continue;
        const val = cleanBRL(row[ci]);
        if (val <= 0) continue;

        const desc = row[2]?.trim() || 'Compra cartão';
        const parcStr = row[3]?.trim() || '1/1';
        const dateRaw = row[1]?.trim() || '01';
        let day = 1;
        try { day = Math.min(28, Math.max(1, parseInt(dateRaw.split('/')[0]) || 1)); } catch{}
        let parcTotal = 1;
        try { parcTotal = parseInt(parcStr.split('/')[1]) || 1; } catch{}

        records.push({
          record_type: 'expense',
          description: desc,
          amount: Math.round(val * 100) / 100,
          date: yr + "-" + String(mNum).padStart(2,'0') + "-" + String(day).padStart(2,'0'),
          category: 'outros',
          type: 'credito',
          parcelas: parcTotal,
          user_label: 'Você',
          _confidence: 0.95,
          _notes: "Parcela " + parcStr + " - Cartão " + (row[0]?.trim() || '') + " - " + mLabel + "/" + yr
        });
      }
    }
    return records;
  };

  // ── Handle file ──
  const ALLOWED_EXTENSIONS = ["csv", "txt", "xlsx", "xls", "pdf"];
  const ALLOWED_MIME_TYPES = [
    "text/csv", "text/plain", "application/pdf",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "",  // alguns sistemas não enviam MIME — validar pela extensão
  ];
  const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

  const handleFile = async (file) => {
    if (!file) return;
    const ext = file.name.split(".").pop().toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      addToast("Formato não suportado. Use CSV, XLSX ou PDF.", "error"); return;
    }
    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      addToast("Tipo de arquivo inválido.", "error"); return;
    }
    if (file.size > MAX_FILE_BYTES) {
      addToast("Arquivo muito grande. Limite: 10 MB.", "error"); return;
    }
    setFileName(file.name);
    setStep("mapping"); setLoading(true);

    try {
      let textData = "";
      if (ext === "csv" || ext === "txt") {
        setLoadingMsg("📄 Lendo CSV...");
        textData = await file.text();
      } else if (ext === "xlsx" || ext === "xls") {
        setLoadingMsg("📊 Lendo planilha Excel...");
        const buf = await file.arrayBuffer();
        const ExcelJS = (await import("exceljs")).default;
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(buf);
        const worksheet = workbook.worksheets[0];
        const csvRows = [];
        worksheet.eachRow({ includeEmpty: false }, (row) => {
          const vals = [];
          row.eachCell({ includeEmpty: true }, (cell) => {
            let v = "";
            if (cell.value === null || cell.value === undefined) v = "";
            else if (typeof cell.value === "object" && cell.value.text) v = cell.value.text;
            else if (typeof cell.value === "object" && cell.value.result !== undefined) v = String(cell.value.result);
            else if (cell.value instanceof Date) v = cell.value.toISOString().slice(0, 10);
            else v = String(cell.value);
            vals.push(v.includes(",") || v.includes("\n") ? `"${v.replace(/"/g, '""')}"` : v);
          });
          csvRows.push(vals.join(","));
        });
        textData = csvRows.join("\n");
      } else if (ext === "pdf") {
        setLoadingMsg("📄 Enviando PDF para análise...");
        const buf = await file.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let binary = "";
        for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
        const pdfBase64 = btoa(binary);
        await analyzeWithAI("", file.name, pdfBase64);
        return;
      } else {
        throw new Error("Formato não suportado. Use CSV, XLSX ou PDF.");
      }

      // Try local parser first (fast, accurate for known formats)
      const localRows = detectAndParseLocal(textData, file.name);
      if (localRows && localRows.length > 0) {
        setLoadingMsg(`✅ ${localRows.length} transações detectadas!`);
        const processed = localRows.map((r, i) => {
          const existingList = r.record_type === "expense" ? (existingExpenses || []) : (existingIncomes || []);
          const dup = isDuplicate(r, existingList);
          return { ...r, _id: `imp_${Date.now()}_${i}`, _selected: !dup, _duplicate: dup };
        });
        const dupCount = processed.filter(r => r._duplicate).length;
        if (dupCount > 0) addToast("⚠️ " + dupCount + " possível(is) duplicata(s) detectada(s)", "info");
        setMapped(processed);
        setStep("preview");
        setLoading(false);
        return;
      }

      // Fallback to AI for unknown formats
      await analyzeWithAI(textData, file.name);
    } catch(e) {
      addToast(e.message || "Erro ao ler arquivo", "error");
      setStep("upload"); setLoading(false);
    }
  };

  // ── AI mapping via Supabase Edge Function (Anthropic API key stays server-side) ──
  const analyzeWithAI = async (textData, filename, pdfBase64 = null) => {
    setLoadingMsg("🤖 Mapeando dados com IA...");

    try {
      const body = pdfBase64
        ? { pdfBase64, filename }
        : { textData, filename };

      const res = await fetch(`${SUPABASE_URL}/functions/v1/analyze-import`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${_authToken || SUPABASE_ANON_KEY}`,
          "apikey": SUPABASE_ANON_KEY,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(errBody.error || `Erro ${res.status} na análise`);
      }

      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const rows = data.rows;
      if (!rows || !rows.length) throw new Error("Nenhuma transação encontrada no arquivo. Verifique se contém dados financeiros.");

      // Detect duplicates against existing data
      const processed = rows.map((r, i) => {
        const existingList = r.record_type === "expense" ? (existingExpenses || []) : (existingIncomes || []);
        const dup = isDuplicate(r, existingList);
        return { ...r, _id: `imp_${Date.now()}_${i}`, _selected: !dup, _duplicate: dup };
      });

      const dupCount = processed.filter(r => r._duplicate).length;
      if (dupCount > 0) addToast(`⚠️ ${dupCount} possível(is) duplicata(s) detectada(s) — desmarcadas automaticamente`, "info");

      setMapped(processed);
      setStep("preview");
    } catch(e) {
      addToast("Erro na análise: " + e.message, "error");
      setStep("upload");
    } finally { setLoading(false); setLoadingMsg(""); }
  };

  // ── Date sanitizer: frontend safety net for Brazilian dates ──
  const sanitizeDate = (raw) => {
    if (!raw) return new Date().toISOString().slice(0, 10);
    const s = String(raw).trim();
    // Already YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      const [y, m, d] = s.split("-").map(Number);
      // If month > 12, day and month were swapped — fix it
      if (m > 12 && d <= 12) return `${y}-${String(d).padStart(2,"0")}-${String(m).padStart(2,"0")}`;
      return s;
    }
    // DD/MM/YYYY or DD-MM-YYYY
    const br = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
    if (br) {
      const [, dd, mm, yyyy] = br;
      return `${yyyy}-${mm.padStart(2,"0")}-${dd.padStart(2,"0")}`;
    }
    return s;
  };

  // ── Import ──
  const handleImport = async () => {
    const selected = mapped.filter(r => r._selected);
    if (!selected.length) { addToast("Nenhum item selecionado", "error"); return; }
    setLoading(true); setLoadingMsg("💾 Salvando...");
    const expenses = selected.filter(r => r.record_type === "expense").map(r => ({
      description: r.description, amount: parseFloat(r.amount) || 0, date: sanitizeDate(r.date),
      category: r.category, type: r.type || "pix", parcelas: parseInt(r.parcelas) || 1,
      user_label: r.user_label || "Você", family_id: family?.family_id,
    }));
    const incomes = selected.filter(r => r.record_type === "income").map(r => ({
      description: r.description, amount: parseFloat(r.amount) || 0, date: sanitizeDate(r.date),
      source: r.category, category: r.category, user_label: r.user_label || "Você",
      family_id: family?.family_id,
    }));
    if (!isDemo) {
      try {
        const BATCH = 25;
        const sendBatch = async (table, items) => {
          for (let i = 0; i < items.length; i += BATCH) {
            const chunk = items.slice(i, i + BATCH);
            setLoadingMsg("Salvando... " + Math.min(i + BATCH, items.length) + "/" + items.length);
            const res = await fetch(SUPABASE_URL + "/rest/v1/" + table, {
              method: "POST",
              headers: {
                "apikey": SUPABASE_ANON_KEY,
                "Authorization": "Bearer " + (_authToken || SUPABASE_ANON_KEY),
                "Content-Type": "application/json",
                // resolution=ignore-duplicates → ON CONFLICT DO NOTHING, silently skips duplicates
                "Prefer": "return=minimal,resolution=ignore-duplicates",
              },
              body: JSON.stringify(chunk),
            });
            if (!res.ok && res.status !== 201) {
              const errText = await res.text().catch(() => res.status.toString());
              throw new Error(errText);
            }
          }
        };
        if (expenses.length) await sendBatch("expenses", expenses);
        if (incomes.length) await sendBatch("incomes", incomes);
      } catch(e) { addToast("Erro ao salvar: " + e.message, "error"); setLoading(false); return; }
    }
    // Add local IDs for in-memory state (not sent to Supabase)
    const expensesWithId = expenses.map(e => ({ ...e, id: crypto.randomUUID() }));
    const incomesWithId  = incomes.map(i => ({ ...i, id: crypto.randomUUID() }));
    onImported(expensesWithId, incomesWithId);
    setStats({ expenses: expenses.length, incomes: incomes.length, skipped: mapped.filter(r => !r._selected).length, duplicates: mapped.filter(r => r._duplicate).length });
    setStep("done"); setLoading(false);
    addToast(`✅ ${selected.length} itens importados!`, "success");
  };

  const toggleRow = (id) => setMapped(p => p.map(r => r._id === id ? { ...r, _selected: !r._selected, _duplicate: r._duplicate && r._selected ? r._duplicate : r._duplicate } : r));
  const toggleAll = (val) => setMapped(p => p.map(r => ({ ...r, _selected: val })));

  const ICard = ({ children, style = {} }) => (
    <div style={{ background: t.glassModal, border: `1px solid ${t.glassBorder}`, borderRadius: 20, padding: 24, ...style }}>{children}</div>
  );

  // STEP: UPLOAD
  if (step === "upload") return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <h2 style={{ margin: "0 0 6px", fontSize: 22, fontWeight: 800, color: t.text, letterSpacing:"-0.02em" }}>📥 Importar Lançamentos</h2>
        <p style={{ color: t.textMuted, fontSize: 14 }}>A IA lê e mapeia automaticamente qualquer formato de extrato ou planilha</p>
      </div>
      <div
        onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = t.accent; e.currentTarget.style.background = t.accentSoft; }}
        onDragLeave={e => { e.currentTarget.style.borderColor = t.glassBorder; e.currentTarget.style.background = t.surface; }}
        onDrop={e => { e.preventDefault(); e.currentTarget.style.borderColor = t.glassBorder; e.currentTarget.style.background = t.surface; const f = e.dataTransfer.files[0]; if(f) handleFile(f); }}
        onClick={() => document.getElementById("imp-input").click()}
        style={{ border: `2px dashed ${t.glassBorder}`, borderRadius: 20, padding: "52px 24px", textAlign: "center", cursor: "pointer", transition: "all 0.2s", background: t.surface }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = t.accent; e.currentTarget.style.background = t.accentSoft; }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = t.glassBorder; e.currentTarget.style.background = t.surface; }}
      >
        <div style={{ fontSize: 52, marginBottom: 12 }}>📂</div>
        <div style={{ fontSize: 16, fontWeight: 700, color: t.text, marginBottom: 6 }}>Arraste seu arquivo aqui</div>
        <div style={{ fontSize: 13, color: t.textMuted, marginBottom: 16 }}>ou clique para selecionar</div>
        <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
          {[["CSV","text"], ["XLSX","spreadsheet"], ["PDF","document"]].map(([f, icon]) => (
            <span key={f} style={{ padding: "5px 14px", borderRadius: 10, background: t.accentSoft, color: t.accent, fontSize: 12, fontWeight: 700 }}>{f}</span>
          ))}
        </div>
        <input id="imp-input" type="file" accept=".csv,.xlsx,.xls,.pdf,.txt" style={{ display: "none" }}
          onChange={e => { const f = e.target.files[0]; if(f) handleFile(f); e.target.value = ""; }} />
      </div>

      <ICard>
        <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 700, color: t.text, textAlign: "left" }}>✨ Como funciona</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {[
            ["1", "Arraste CSV, Excel ou PDF", "Extrato do banco, planilha do Google Sheets ou Excel — qualquer formato"],
            ["2", "IA analisa e mapeia automaticamente", "Detecta datas, valores, categorias, tipo de pagamento e parcelas"],
            ["3", "Duplicatas são marcadas automaticamente", "Itens que já existem no app ficam desmarcados — você decide o que importar"],
            ["4", "Revise e confirme", "Veja o preview completo antes de salvar qualquer coisa"],
          ].map(([n, title, desc]) => (
            <div key={n} style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
              <div style={{ width: 28, height: 28, minWidth: 28, borderRadius: "50%", background: t.accentSoft, color: t.accent, fontWeight: 800, fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1 }}>{n}</div>
              <div style={{ flex: 1, textAlign: "left" }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: t.text, lineHeight: 1.4 }}>{title}</div>
                <div style={{ fontSize: 12, color: t.textMuted, marginTop: 3, lineHeight: 1.5 }}>{desc}</div>
              </div>
            </div>
          ))}
        </div>
      </ICard>

      <ICard style={{ background: t.warningSoft, border: `1px solid ${t.warning}33` }}>
        <div style={{ fontSize: 13, color: t.warning, fontWeight: 700, marginBottom: 10, textAlign: "left" }}>💡 Como exportar do seu banco</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12, color: t.textSecondary, textAlign: "left" }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}><span style={{ flexShrink: 0 }}>🟣</span><span><strong>Nubank:</strong> App → Perfil → Exportar dados → CSV</span></div>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}><span style={{ flexShrink: 0 }}>🟠</span><span><strong>Itaú:</strong> Internet Banking → Extrato → Exportar → CSV/OFX</span></div>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}><span style={{ flexShrink: 0 }}>🔴</span><span><strong>Santander:</strong> App → Extrato → Compartilhar → CSV</span></div>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}><span style={{ flexShrink: 0 }}>🔵</span><span><strong>Bradesco:</strong> Internet Banking → Extrato → Salvar → XLS</span></div>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}><span style={{ flexShrink: 0 }}>📊</span><span><strong>Planilha própria:</strong> Google Sheets → Arquivo → Download → CSV</span></div>
        </div>
      </ICard>
    </div>
  );

  // STEP: LOADING
  if (step === "mapping" || (loading && step !== "preview")) return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 360, gap: 20 }}>
      <div style={{ fontSize: 52, animation: "importSpin 1.2s linear infinite" }}>⚙️</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: t.text, textAlign: "center", letterSpacing:"-0.02em" }}>{loadingMsg || "Processando..."}</div>
      <div style={{ fontSize: 13, color: t.textMuted }}>{fileName}</div>
      <style>{`@keyframes importSpin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }`}</style>
    </div>
  );

  // STEP: PREVIEW
  if (step === "preview") {
    const dupCount = mapped.filter(r => r._duplicate).length;
    const selCount = mapped.filter(r => r._selected).length;
    const expSel = mapped.filter(r => r._selected && r.record_type === "expense").length;
    const incSel = mapped.filter(r => r._selected && r.record_type === "income").length;

    const visRows = mapped.filter(r => {
      if (dupFilter === "new") return !r._duplicate;
      if (dupFilter === "duplicate") return r._duplicate;
      return true;
    });

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
          <div>
            <h2 style={{ margin: "0 0 4px", fontSize: 20, fontWeight: 800, color: t.text, letterSpacing:"-0.02em" }}>📋 Revisar Importação</h2>
            <p style={{ color: t.textMuted, fontSize: 13 }}>{fileName} — {mapped.length} itens detectados</p>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Btn t={t} variant="ghost" type="button" onClick={() => { setStep("upload"); setMapped([]); setFileName(""); }} style={{ fontSize: 13, padding: "9px 16px" }}>← Voltar</Btn>
            <Btn t={t} type="button" onClick={handleImport} disabled={selCount === 0 || loading} style={{ fontSize: 13, padding: "9px 16px" }}>
              {loading ? "Salvando..." : `💾 Importar ${selCount}`}
            </Btn>
          </div>
        </div>

        {/* Stats */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8 }}>
          {[
            { label: "Novos", value: mapped.length - dupCount, color: t.success, bg: t.successSoft },
            { label: "Duplicatas", value: dupCount, color: t.warning, bg: t.warningSoft },
            { label: "Gastos ✓", value: expSel, color: t.danger, bg: t.dangerSoft },
            { label: "Receitas ✓", value: incSel, color: t.accent, bg: t.accentSoft },
          ].map(s => (
            <div key={s.label} style={{ background: s.bg, borderRadius: 12, padding: "10px 14px" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: t.textMuted, letterSpacing: "0.05em" }}>{s.label.toUpperCase()}</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: s.color }}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* Duplicate banner */}
        {dupCount > 0 && (
          <div style={{ background: t.warningSoft, border: `1px solid ${t.warning}44`, borderRadius: 14, padding: "12px 16px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <span style={{ fontSize: 20 }}>⚠️</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: t.warning }}>{dupCount} possível{dupCount > 1 ? "is" : ""} duplicata{dupCount > 1 ? "s" : ""} detectada{dupCount > 1 ? "s" : ""}</div>
              <div style={{ fontSize: 12, color: t.textMuted }}>Itens com mesma data, descrição e valor já existentes no app foram desmarcados. Você pode selecioná-los se necessário.</div>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={() => setMapped(p => p.map(r => r._duplicate ? { ...r, _selected: true } : r))} style={{ padding: "6px 12px", borderRadius: 8, border: `1px solid ${t.warning}55`, background: "transparent", color: t.warning, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Marcar todas</button>
              <button onClick={() => setMapped(p => p.map(r => r._duplicate ? { ...r, _selected: false } : r))} style={{ padding: "6px 12px", borderRadius: 8, border: `1px solid ${t.warning}55`, background: "transparent", color: t.warning, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Ignorar todas</button>
            </div>
          </div>
        )}

        {/* Toolbar */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: t.surface, borderRadius: 12, border: `1px solid ${t.border}`, flexWrap: "wrap" }}>
          <input type="checkbox" checked={mapped.length > 0 && mapped.every(r => r._selected)} onChange={e => toggleAll(e.target.checked)}
            style={{ width: 16, height: 16, cursor: "pointer", accentColor: t.accent }} />
          <span style={{ fontSize: 13, color: t.textSecondary, fontWeight: 600 }}>Todos</span>
          <div style={{ flex: 1 }} />
          {/* Filter tabs */}
          <div style={{ display: "flex", background: t.glassModal, borderRadius: 10, padding: 3, gap: 3 }}>
            {[["all","Todos"], ["new","Novos"], ["duplicate","Duplicatas"]].map(([v,l]) => (
              <button key={v} onClick={() => setDupFilter(v)} style={{ padding: "5px 12px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600, background: dupFilter === v ? t.accent : "transparent", color: dupFilter === v ? "#fff" : t.textMuted, transition: "all 0.15s" }}>{l}</button>
            ))}
          </div>
          <span style={{ fontSize: 12, color: t.textMuted }}>{selCount}/{mapped.length}</span>
        </div>

        {/* Rows */}
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          {visRows.length === 0 && <div style={{ textAlign: "center", padding: 32, color: t.textMuted, fontSize: 14 }}>Nenhum item nesta categoria</div>}
          {visRows.map(row => {
            const isExp = row.record_type === "expense";
            const cat = isExp ? CATEGORIES.find(c => c.id === row.category) : INCOME_SOURCES.find(s => s.id === row.category);
            const lowConf = (row._confidence || 1) < 0.7;
            return (
              <div key={row._id} onClick={() => toggleRow(row._id)} style={{
                display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 13, cursor: "pointer", transition: "all 0.15s",
                background: row._duplicate && !row._selected ? t.surface : row._selected ? (isExp ? t.dangerSoft : t.successSoft) : t.surface,
                border: `1px solid ${row._selected ? (isExp ? t.danger : t.success) + "44" : row._duplicate ? t.warning + "44" : t.border}`,
                opacity: row._selected ? 1 : 0.5,
              }}>
                <input type="checkbox" checked={row._selected} onChange={() => toggleRow(row._id)} onClick={e => e.stopPropagation()} style={{ width: 15, height: 15, cursor: "pointer", accentColor: t.accent, flexShrink: 0 }} />
                <span style={{ fontSize: 18, flexShrink: 0 }}>{cat?.emoji || (isExp ? "📦" : "💰")}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: t.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.description}</span>
                    {row._duplicate && <span style={{ fontSize: 10, background: t.warningSoft, color: t.warning, padding: "2px 7px", borderRadius: 6, fontWeight: 700, flexShrink: 0 }}>duplicata</span>}
                    {lowConf && !row._duplicate && <span style={{ fontSize: 10, background: t.accentSoft, color: t.accent, padding: "2px 7px", borderRadius: 6, fontWeight: 700, flexShrink: 0 }}>⚠ verificar</span>}
                  </div>
                  <div style={{ fontSize: 11, color: t.textMuted, marginTop: 1 }}>
                    {row.date} · {cat?.label || row.category}
                    {row.type && ` · ${row.type}`}
                    {row.parcelas > 1 && ` · ${row.parcelas}x`}
                    {row._notes && <span style={{ fontStyle: "italic" }}> · {row._notes}</span>}
                  </div>
                </div>
                <span style={{ fontWeight: 700, fontSize: 13, color: isExp ? t.danger : t.success, flexShrink: 0 }}>
                  {isExp ? "-" : "+"}{fmt(parseFloat(row.amount) || 0)}
                </span>
              </div>
            );
          })}
        </div>

        {/* Sticky footer */}
        <div style={{ position: "sticky", bottom: 16, zIndex: 210, background: `${t.bg}f8`, backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", borderRadius: 16, padding: "13px 18px", border: `1px solid ${t.accent}44`, boxShadow: `0 4px 24px rgba(0,0,0,0.3)`, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <div style={{ fontSize: 13, color: t.textSecondary }}>
            <strong style={{ color: t.text }}>{selCount}</strong> selecionados
            {dupCount > 0 && <span style={{ color: t.warning }}> · {dupCount} duplicatas</span>}
          </div>
          <Btn t={t} type="button" onClick={handleImport} disabled={selCount === 0 || loading}>
            {loading ? "Salvando..." : "💾 Confirmar importação"}
          </Btn>
        </div>
      </div>
    );
  }

  // STEP: DONE
  if (step === "done") return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 420, gap: 24, textAlign: "center" }}>
      <div style={{ fontSize: 72 }}>🎉</div>
      <div>
        <h2 style={{ margin: "0 0 8px", fontSize: 24, fontWeight: 800, color: t.text, letterSpacing:"-0.02em" }}>Importação concluída!</h2>
        <p style={{ color: t.textMuted, fontSize: 14 }}>Os dados já estão disponíveis em todo o dashboard</p>
      </div>
      {stats && (
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", justifyContent: "center" }}>
          {stats.expenses > 0 && <div style={{ background: t.dangerSoft, borderRadius: 14, padding: "14px 22px" }}><div style={{ fontSize: 28, fontWeight: 800, color: t.danger }}>{stats.expenses}</div><div style={{ fontSize: 11, color: t.textMuted, fontWeight: 700 }}>GASTOS</div></div>}
          {stats.incomes > 0 && <div style={{ background: t.successSoft, borderRadius: 14, padding: "14px 22px" }}><div style={{ fontSize: 28, fontWeight: 800, color: t.success }}>{stats.incomes}</div><div style={{ fontSize: 11, color: t.textMuted, fontWeight: 700 }}>RECEITAS</div></div>}
          {stats.duplicates > 0 && <div style={{ background: t.warningSoft, borderRadius: 14, padding: "14px 22px" }}><div style={{ fontSize: 28, fontWeight: 800, color: t.warning }}>{stats.duplicates}</div><div style={{ fontSize: 11, color: t.textMuted, fontWeight: 700 }}>DUPLICATAS</div></div>}
          {stats.skipped > 0 && <div style={{ background: t.surface, borderRadius: 14, padding: "14px 22px" }}><div style={{ fontSize: 28, fontWeight: 800, color: t.textMuted }}>{stats.skipped}</div><div style={{ fontSize: 11, color: t.textMuted, fontWeight: 700 }}>IGNORADOS</div></div>}
        </div>
      )}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center" }}>
        <Btn t={t} variant="ghost" type="button" onClick={() => { setStep("upload"); setMapped([]); setStats(null); setFileName(""); }}>📥 Importar mais</Btn>
        <Btn t={t} type="button" onClick={() => window.dispatchEvent(new CustomEvent("goto-tab", { detail: "transactions" }))}>📋 Ver lançamentos</Btn>
      </div>
    </div>
  );

  return null;
}


// ─── PROFILE MODAL ────────────────────────────────────────────────────────────
// Phone DDI config
const DDI_LIST = [
  { code: "+55", flag: "🇧🇷", name: "Brasil",          mask: "(XX) XXXXX-XXXX" },
  { code: "+1",  flag: "🇺🇸", name: "EUA/Canadá",      mask: "(XXX) XXX-XXXX" },
  { code: "+351",flag: "🇵🇹", name: "Portugal",         mask: "XXX XXX XXX" },
  { code: "+34", flag: "🇪🇸", name: "Espanha",          mask: "XXX XXX XXX" },
  { code: "+39", flag: "🇮🇹", name: "Itália",           mask: "XXX XXX XXXX" },
  { code: "+44", flag: "🇬🇧", name: "Reino Unido",      mask: "XXXX XXXXXX" },
  { code: "+49", flag: "🇩🇪", name: "Alemanha",         mask: "XXXX XXXXXXX" },
  { code: "+33", flag: "🇫🇷", name: "França",           mask: "XX XX XX XX XX" },
  { code: "+54", flag: "🇦🇷", name: "Argentina",        mask: "XX XXXX-XXXX" },
  { code: "+56", flag: "🇨🇱", name: "Chile",            mask: "X XXXX XXXX" },
  { code: "+57", flag: "🇨🇴", name: "Colômbia",         mask: "XXX XXX XXXX" },
  { code: "+52", flag: "🇲🇽", name: "México",           mask: "XXX XXX XXXX" },
  { code: "+81", flag: "🇯🇵", name: "Japão",            mask: "XX-XXXX-XXXX" },
  { code: "+86", flag: "🇨🇳", name: "China",            mask: "XXX XXXX XXXX" },
];

function applyPhoneMask(value, mask) {
  // Remove everything except digits
  const digits = value.replace(/\D/g, "");
  let result = "", di = 0;
  for (let i = 0; i < mask.length && di < digits.length; i++) {
    if (mask[i] === "X") { result += digits[di++]; }
    else { result += mask[i]; }
  }
  return result;
}

function ProfileModal({ t, user, profile, onSaved, addToast }) {
  const [firstName, setFirstName] = useState(profile?.first_name || "");
  const [lastName,  setLastName]  = useState(profile?.last_name  || "");
  const [loading, setLoading] = useState(false);

  // Parse stored phone: "+55 (11) 99999-9999" → ddi + local
  const parseStoredPhone = (stored) => {
    if (!stored) return { ddi: "+55", local: "" };
    const ddi = DDI_LIST.find(d => stored.startsWith(d.code + " ")) || DDI_LIST[0];
    const local = stored.startsWith(ddi.code + " ") ? stored.slice(ddi.code.length + 1) : stored;
    return { ddi: ddi.code, local };
  };

  const parsed = parseStoredPhone(profile?.phone);
  const [ddi,   setDdi]   = useState(parsed.ddi);
  const [local, setLocal] = useState(parsed.local);

  const currentDdi = DDI_LIST.find(d => d.code === ddi) || DDI_LIST[0];
  const fullPhone = local ? `${ddi} ${local}` : "";

  const handleLocalChange = (e) => {
    const masked = applyPhoneMask(e.target.value, currentDdi.mask);
    setLocal(masked);
  };

  const save = async () => {
    if (!firstName.trim()) { addToast("Informe seu nome", "error"); return; }
    setLoading(true);
    try {
      await supabaseRpc("upsert_profile", {
        p_first_name: firstName.trim(),
        p_last_name:  lastName.trim(),
        p_phone:      fullPhone,
      });
      addToast("Perfil atualizado!", "success");
      onSaved({ first_name: firstName.trim(), last_name: lastName.trim(), phone: fullPhone });
    } catch(e) { addToast(e.message, "error"); }
    finally { setLoading(false); }
  };

  // Label style — always left-aligned above input
  const lbl = { display:"block", marginBottom:6, fontSize:13, fontWeight:600, color:t.textSecondary, letterSpacing:"0.02em", textAlign:"left" };
  const inp = { width:"100%", padding:"11px 14px", borderRadius:12, fontSize:14, fontFamily:"'DM Sans', sans-serif", background:t.inputBg, border:`1px solid ${t.border}`, color:t.text, outline:"none", transition:"border-color 0.2s", boxSizing:"border-box" };

  return (
    <div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:16 }}>
        <div>
          <label style={lbl}>Nome *</label>
          <input value={firstName} onChange={e=>setFirstName(e.target.value)} placeholder="João" style={inp}
            onFocus={e=>e.target.style.borderColor=t.accent} onBlur={e=>e.target.style.borderColor=t.border} />
        </div>
        <div>
          <label style={lbl}>Sobrenome</label>
          <input value={lastName} onChange={e=>setLastName(e.target.value)} placeholder="Silva" style={inp}
            onFocus={e=>e.target.style.borderColor=t.accent} onBlur={e=>e.target.style.borderColor=t.border} />
        </div>
      </div>

      <div style={{ marginBottom:16 }}>
        <label style={lbl}>E-mail</label>
        <input value={user?.email||""} readOnly style={{ ...inp, opacity:0.55, cursor:"default" }} />
      </div>

      <div style={{ marginBottom:16 }}>
        <label style={lbl}>Telefone</label>
        <div style={{ display:"flex", gap:8 }}>
          {/* DDI selector */}
          <select value={ddi} onChange={e=>{ setDdi(e.target.value); setLocal(""); }} style={{ padding:"11px 10px", borderRadius:12, fontSize:13, fontFamily:"'DM Sans', sans-serif", background:t.inputBg, border:`1px solid ${t.border}`, color:t.text, outline:"none", cursor:"pointer", flexShrink:0, minWidth:90 }}>
            {DDI_LIST.map(d => (
              <option key={d.code} value={d.code}>{d.flag} {d.code}</option>
            ))}
          </select>
          {/* Local number with mask */}
          <input value={local} onChange={handleLocalChange} placeholder={currentDdi.mask.replace(/X/g,"0")} type="tel" style={{ ...inp, flex:1 }}
            onFocus={e=>e.target.style.borderColor=t.accent} onBlur={e=>e.target.style.borderColor=t.border} />
        </div>
        <div style={{ fontSize:11, color:t.textMuted, marginTop:5 }}>
          {currentDdi.flag} {currentDdi.name} · Formato: {currentDdi.mask}
        </div>
      </div>

      <Btn t={t} type="button" onClick={save} style={{ width:"100%", marginTop:4 }} disabled={loading}>
        {loading ? "Salvando..." : "💾 Salvar"}
      </Btn>
    </div>
  );
}

// ─── FAMILY MODAL ─────────────────────────────────────────────────────────────
function FamilyModal({ t, family, currentUserId, familyMembers, setFamilyMembers, onRegenCode, addToast, isAdmin }) {
  const [updatingRole, setUpdatingRole] = useState(null);

  const handleRoleChange = async (userId, newRole) => {
    setUpdatingRole(userId);
    try {
      await supabaseRpc("update_member_role", { p_target_user_id: userId, p_new_role: newRole });
      setFamilyMembers(p => p.map(m => m.user_id === userId ? { ...m, role: newRole } : m));
      addToast("Permissão atualizada!", "success");
    } catch(e) { addToast(e.message, "error"); }
    finally { setUpdatingRole(null); }
  };

  return (
    <div style={{ display:"flex",flexDirection:"column",gap:20 }}>

      {/* Invite code — admin only */}
      {isAdmin ? (
        <div>
          <p style={{ color:t.textSecondary,fontSize:13,marginBottom:16,lineHeight:1.6 }}>
            Compartilhe este código com seu cônjuge para que entre no mesmo dashboard.
          </p>
          <div style={{ background:t.accentSoft,border:`2px dashed ${t.accent}55`,borderRadius:16,padding:"20px 16px",textAlign:"center",marginBottom:12 }}>
            <div style={{ fontSize:10,fontWeight:700,color:t.textMuted,letterSpacing:"0.12em",marginBottom:8 }}>CÓDIGO DE CONVITE</div>
            <div style={{ fontSize:34,fontWeight:800,color:t.accent,letterSpacing:"0.3em" }}>
              {family?.invite_code || "------"}
            </div>
          </div>
          <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:16 }}>
            <Btn t={t} type="button" onClick={()=>{ navigator.clipboard?.writeText(family?.invite_code||"").catch(()=>{}); addToast("Código copiado!","success"); }} style={{ fontSize:13 }}>
              📋 Copiar
            </Btn>
            <Btn t={t} variant="ghost" type="button" onClick={onRegenCode} style={{ fontSize:13 }}>
              🔄 Novo código
            </Btn>
          </div>
          <div style={{ padding:"10px 14px",borderRadius:12,background:t.warningSoft,border:`1px solid ${t.warning}33`,fontSize:12,color:t.warning }}>
            💡 Seu cônjuge cria uma conta, escolhe "Entrar em uma família" e digita este código.
          </div>
        </div>
      ) : (
        <div style={{ padding:"12px 16px",borderRadius:12,background:t.successSoft,border:`1px solid ${t.success}33`,fontSize:13,color:t.success }}>
          ✅ Você é membro desta família. Apenas administradores podem convidar novos membros.
        </div>
      )}

      {/* Members list */}
      {familyMembers.length > 0 && (
        <div>
          <div style={{ fontSize:13,fontWeight:700,color:t.text,marginBottom:12 }}>
            👥 Membros da família ({familyMembers.length})
          </div>
          <div style={{ display:"flex",flexDirection:"column",gap:8 }}>
            {familyMembers.map(m => {
              const isMe = m.user_id === currentUserId;
              const displayName = [m.first_name, m.last_name].filter(Boolean).join(" ") || m.email || "Membro";
              return (
                <div key={m.user_id} style={{ display:"flex",alignItems:"center",gap:12,padding:"12px 14px",borderRadius:14,background:t.surface,border:`1px solid ${t.border}` }}>
                  <div style={{ width:38,height:38,borderRadius:"50%",background:m.role==="admin"?t.accentSoft:t.successSoft,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0 }}>
                    {m.role==="admin"?"👑":"👤"}
                  </div>
                  <div style={{ flex:1,minWidth:0 }}>
                    <div style={{ fontSize:13,fontWeight:700,color:t.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>
                      {displayName}{isMe ? " (você)" : ""}
                    </div>
                    <div style={{ fontSize:11,color:t.textMuted,marginTop:1 }}>
                      {m.email}{m.phone ? ` · ${m.phone}` : ""}
                    </div>
                  </div>
                  <div style={{ flexShrink:0 }}>
                    {isAdmin && !isMe ? (
                      <select value={m.role} disabled={updatingRole===m.user_id}
                        onChange={e=>handleRoleChange(m.user_id, e.target.value)}
                        style={{ padding:"5px 10px",borderRadius:8,border:`1px solid ${t.border}`,background:t.inputBg,color:m.role==="admin"?t.accent:t.textSecondary,fontSize:12,fontWeight:700,cursor:"pointer",outline:"none" }}>
                        <option value="member">Membro</option>
                        <option value="admin">Administrador</option>
                      </select>
                    ) : (
                      <span style={{ padding:"4px 10px",borderRadius:8,background:m.role==="admin"?t.accentSoft:t.surface,color:m.role==="admin"?t.accent:t.textMuted,fontSize:11,fontWeight:700,border:`1px solid ${m.role==="admin"?t.accent+"33":t.border}` }}>
                        {m.role==="admin"?"👑 Admin":"Membro"}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── CARDS MANAGER ───────────────────────────────────────────────────────────
function CardsManager({ t, family, isDemo, addToast, billingPeriods = [], setBillingPeriods = ()=>{} }) {
  const [cards, setCards] = useState([]);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({ name:"", holder:"", closing_day:28, due_day:6, color:"#7c6af7" });
  const [loading, setLoading] = useState(false);
  const [showCardForm, setShowCardForm] = useState(false);
  const CARD_COLORS = ["#7c6af7","#10b981","#ef4444","#3b82f6","#f97316","#ec4899"];
  const sf = (k,v) => setForm(p=>({...p,[k]:v}));

  // Billing periods form state
  const bpEmpty = { card_id:"", fatura_month: new Date().getMonth()+1, fatura_year: new Date().getFullYear(), period_start:"", period_end:"", due_date:"", total_pdf:"" };
  const [bpForm, setBpForm] = useState(bpEmpty);
  const [bpEditId, setBpEditId] = useState(null);
  const [bpLoading, setBpLoading] = useState(false);
  const [showBpForm, setShowBpForm] = useState(false);
  const [cardConfirmOpts, setCardConfirmOpts] = useState(null);
  const sbp = (k,v) => setBpForm(p=>({...p,[k]:v}));

  useEffect(()=>{
    if(isDemo||!family?.family_id) return;
    supabaseFetch(`/cards?family_id=eq.${family.family_id}&active=eq.true&order=created_at`)
      .then(d=>setCards(d||[])).catch(()=>{});
  },[family?.family_id,isDemo]);

  const resetForm = ()=>{ setForm({name:"",holder:"",closing_day:28,due_day:6,color:"#7c6af7"}); setEditId(null); setShowCardForm(false); };

  const save = async()=>{
    if(!form.name.trim()||!form.holder.trim()){ addToast("Preencha nome e titular.","error"); return; }
    setLoading(true);
    const payload={ name:form.name.trim(), holder:form.holder.trim(), closing_day:parseInt(form.closing_day)||28, due_day:parseInt(form.due_day)||6, color:form.color, family_id:family?.family_id, active:true };
    try{
      if(editId){
        await supabaseFetch(`/cards?id=eq.${editId}`,{method:"PATCH",body:JSON.stringify(payload)});
        setCards(p=>p.map(c=>c.id===editId?{...c,...payload}:c));
        addToast("Cartão atualizado!","success");
      } else {
        const cr=await supabaseFetch("/cards",{method:"POST",body:JSON.stringify(payload)});
        if(cr?.[0]) setCards(p=>[...p,cr[0]]);
        addToast("Cartão criado!","success");
      }
      resetForm();
    }catch(err){addToast(err.message,"error");}
    finally{setLoading(false);}
  };



  const del = (id)=>{
    if(cards.length<=1){addToast("Não é possível excluir o único cartão.","error");return;}
    setCardConfirmOpts({
      title: "Excluir cartão",
      message: "Excluir este cartão? Esta ação não pode ser desfeita.",
      onConfirm: async () => {
        try{
          await supabaseFetch(`/cards?id=eq.${id}`,{method:"DELETE",headers:{"Prefer":"return=minimal"}});
          setCards(p=>p.filter(c=>c.id!==id));
          addToast("Cartão excluído.","info");
        }catch(err){addToast(err.message,"error");}
      },
    });
  };

  const startEdit=(c)=>{ setEditId(c.id); setForm({name:c.name,holder:c.holder,closing_day:c.closing_day,due_day:c.due_day,color:c.color}); setShowCardForm(true); };

  // Billing periods CRUD
  const resetBpForm = () => { setBpForm(bpEmpty); setBpEditId(null); setShowBpForm(false); };

  const saveBp = async () => {
    if (!bpForm.card_id || !bpForm.period_start || !bpForm.period_end || !bpForm.due_date) {
      addToast("Preencha cartão, datas do período e vencimento.","error"); return;
    }
    setBpLoading(true);
    const payload = {
      card_id: bpForm.card_id,
      family_id: family?.family_id,
      fatura_month: parseInt(bpForm.fatura_month),
      fatura_year: parseInt(bpForm.fatura_year),
      period_start: bpForm.period_start,
      period_end: bpForm.period_end,
      due_date: bpForm.due_date,
      total_pdf: bpForm.total_pdf ? parseFloat(bpForm.total_pdf) : null,
    };
    try {
      if (bpEditId) {
        await supabaseFetch(`/billing_periods?id=eq.${bpEditId}`,{method:"PATCH",body:JSON.stringify(payload)});
        setBillingPeriods(p => p.map(bp => bp.id===bpEditId ? {...bp,...payload} : bp));
        addToast("Período atualizado!","success");
      } else {
        const cr = await supabaseFetch("/billing_periods",{method:"POST",body:JSON.stringify(payload)});
        if (cr?.[0]) setBillingPeriods(p => [...p, cr[0]]);
        addToast("Período adicionado!","success");
      }
      resetBpForm();
    } catch(err) { addToast(err.message,"error"); }
    finally { setBpLoading(false); }
  };

  const delBp = (id) => {
    setCardConfirmOpts({
      title: "Excluir período",
      message: "Excluir este período de fatura?",
      onConfirm: async () => {
        try {
          await supabaseFetch(`/billing_periods?id=eq.${id}`,{method:"DELETE",headers:{"Prefer":"return=minimal"}});
          setBillingPeriods(p => p.filter(bp => bp.id !== id));
          addToast("Período excluído.","info");
        } catch(err) { addToast(err.message,"error"); }
      },
    });
  };

  const startEditBp = (bp) => {
    setBpEditId(bp.id);
    setBpForm({ card_id:bp.card_id, fatura_month:bp.fatura_month, fatura_year:bp.fatura_year, period_start:bp.period_start, period_end:bp.period_end, due_date:bp.due_date, total_pdf:bp.total_pdf||"" });
    setShowBpForm(true);
  };

  const fmtDate = (iso) => { if (!iso) return "—"; const [y,m,d]=iso.split("-"); return `${d}/${m}/${y}`; };
  const bpYears = Array.from({length:5},(_,i)=>new Date().getFullYear()-1+i);

  return(
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      {cards.map(c=>(
        <div key={c.id} style={{display:"flex",alignItems:"center",gap:12,padding:"12px 16px",borderRadius:14,background:t.surface,border:`1px solid ${t.border}`}}>
          <div style={{width:12,height:12,borderRadius:"50%",background:c.color,flexShrink:0}}/>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:13,fontWeight:700,color:t.text}}>{c.name}</div>
            <div style={{fontSize:11,color:t.textMuted,marginTop:2}}>{c.holder} · Fecha dia {c.closing_day} · Vence dia {c.due_day}</div>
          </div>
          <div style={{display:"flex",gap:4,flexShrink:0}}>
            <button onClick={()=>startEdit(c)} style={{background:"transparent",border:"none",cursor:"pointer",color:t.textMuted,fontSize:13,padding:"4px 6px",borderRadius:6}} onMouseEnter={e=>e.currentTarget.style.color=t.accent} onMouseLeave={e=>e.currentTarget.style.color=t.textMuted}>✏️</button>
            <button onClick={()=>del(c.id)} style={{background:"transparent",border:"none",cursor:"pointer",color:t.textMuted,fontSize:13,padding:"4px 6px",borderRadius:6}} onMouseEnter={e=>e.currentTarget.style.color=t.danger} onMouseLeave={e=>e.currentTarget.style.color=t.textMuted}>🗑</button>
          </div>
        </div>
      ))}
      <div style={{borderRadius:16,background:t.surface,border:`1px solid ${showCardForm ? t.accent+"66" : t.border}`,overflow:"hidden",transition:"border-color 0.2s"}}>
        <button
          onClick={()=>{ if(!editId) setShowCardForm(v=>!v); }}
          style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 16px",background:"transparent",border:"none",cursor:editId?"default":"pointer",gap:8}}
        >
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <span style={{fontSize:15,lineHeight:1}}>{editId?"✏️":"➕"}</span>
            <span style={{fontSize:13,fontWeight:700,color:t.text}}>{editId?"Editar cartão":"Novo cartão"}</span>
          </div>
          {!editId && (
            <span style={{color:t.textMuted,fontSize:12,transform:showCardForm?"rotate(180deg)":"rotate(0deg)",transition:"transform 0.25s",lineHeight:1}}>▼</span>
          )}
        </button>
        {showCardForm && (
          <div style={{padding:"0 16px 16px"}}>
            <Input label="Nome do cartão" t={t} value={form.name} onChange={e=>sf("name",e.target.value)} placeholder="Ex: Santander Casal" />
            <Input label="Titular" t={t} value={form.holder} onChange={e=>sf("holder",e.target.value)} placeholder="Ex: Casal, Fernando" />
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
              <Input label="Dia fechamento" t={t} type="number" min={1} max={31} value={form.closing_day} onChange={e=>sf("closing_day",e.target.value)} />
              <Input label="Dia vencimento" t={t} type="number" min={1} max={31} value={form.due_day} onChange={e=>sf("due_day",e.target.value)} />
            </div>
            <div style={{marginBottom:16}}>
              <label style={{display:"block",marginBottom:8,fontSize:13,fontWeight:600,color:t.textSecondary}}>Cor</label>
              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                {CARD_COLORS.map(col=>(
                  <button key={col} onClick={()=>sf("color",col)}
                    style={{width:28,height:28,borderRadius:"50%",background:col,border:form.color===col?"3px solid white":"2px solid transparent",outline:form.color===col?`2px solid ${col}`:"none",cursor:"pointer",transition:"all 0.15s"}}/>
                ))}
              </div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:editId?"1fr 1fr":"1fr",gap:10}}>
              {editId&&<Btn t={t} variant="ghost" onClick={resetForm}>Cancelar</Btn>}
              <Btn t={t} onClick={save} disabled={loading}>{loading?"Salvando...":(editId?"Salvar alterações":"Criar cartão")}</Btn>
            </div>
          </div>
        )}
      </div>

      {/* ── Períodos de Fatura ── */}
      {!isDemo && cards.length > 0 && (
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",paddingTop:8,borderTop:`1px solid ${t.border}`}}>
            <span style={{fontSize:13,fontWeight:700,color:t.text}}>📅 Períodos de Fatura</span>
            {!showBpForm && <button onClick={()=>setShowBpForm(true)} style={{fontSize:12,fontWeight:600,color:t.accent,background:"transparent",border:`1px solid ${t.accent}44`,borderRadius:8,padding:"4px 10px",cursor:"pointer"}}>+ Adicionar</button>}
          </div>
          {billingPeriods.length === 0 && !showBpForm && (
            <div style={{fontSize:12,color:t.textMuted,padding:"10px 0"}}>Nenhum período cadastrado. Adicione para que o gráfico de faturas reflita exatamente o extrato do banco.</div>
          )}
          {billingPeriods.map(bp => {
            const card = cards.find(c => c.id === bp.card_id);
            return (
              <div key={bp.id} style={{padding:"10px 14px",borderRadius:12,background:t.surface,border:`1px solid ${t.border}`,display:"flex",alignItems:"center",gap:10}}>
                {card && <span style={{width:8,height:8,borderRadius:"50%",background:card.color,flexShrink:0}}/>}
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:12,fontWeight:700,color:t.text}}>{MONTH_FULL[(bp.fatura_month||1)-1]} {bp.fatura_year}</div>
                  <div style={{fontSize:11,color:t.textMuted,marginTop:2}}>{fmtDate(bp.period_start)} → {fmtDate(bp.period_end)} · Vence {fmtDate(bp.due_date)}{bp.total_pdf?` · R$ ${Number(bp.total_pdf).toLocaleString("pt-BR",{minimumFractionDigits:2})}`:""}</div>
                </div>
                <div style={{display:"flex",gap:4,flexShrink:0}}>
                  <button onClick={()=>startEditBp(bp)} style={{background:"transparent",border:"none",cursor:"pointer",color:t.textMuted,fontSize:12,padding:"3px 5px",borderRadius:6}} onMouseEnter={e=>e.currentTarget.style.color=t.accent} onMouseLeave={e=>e.currentTarget.style.color=t.textMuted}>✏️</button>
                  <button onClick={()=>delBp(bp.id)} style={{background:"transparent",border:"none",cursor:"pointer",color:t.textMuted,fontSize:12,padding:"3px 5px",borderRadius:6}} onMouseEnter={e=>e.currentTarget.style.color=t.danger} onMouseLeave={e=>e.currentTarget.style.color=t.textMuted}>🗑</button>
                </div>
              </div>
            );
          })}
          {showBpForm && (
            <div style={{padding:16,borderRadius:14,background:t.surface,border:`1px solid ${t.border}`}}>
              <div style={{fontSize:13,fontWeight:700,color:t.text,marginBottom:14}}>{bpEditId?"Editar período":"Novo período de fatura"}</div>
              <div style={{marginBottom:14}}>
                <label style={{display:"block",marginBottom:6,fontSize:13,fontWeight:600,color:t.textSecondary}}>Cartão</label>
                <select value={bpForm.card_id} onChange={e=>sbp("card_id",e.target.value)} style={{width:"100%",padding:"10px 14px",borderRadius:10,border:`1px solid ${t.border}`,background:t.inputBg,color:bpForm.card_id?t.text:t.textMuted,fontSize:13,outline:"none"}}>
                  <option value="">Selecione o cartão</option>
                  {cards.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:4}}>
                <div>
                  <label style={{display:"block",marginBottom:6,fontSize:13,fontWeight:600,color:t.textSecondary}}>Mês da fatura</label>
                  <select value={bpForm.fatura_month} onChange={e=>sbp("fatura_month",parseInt(e.target.value))} style={{width:"100%",padding:"10px 14px",borderRadius:10,border:`1px solid ${t.border}`,background:t.inputBg,color:t.text,fontSize:13,outline:"none"}}>
                    {MONTH_FULL.map((mn,i)=><option key={i+1} value={i+1}>{mn}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{display:"block",marginBottom:6,fontSize:13,fontWeight:600,color:t.textSecondary}}>Ano da fatura</label>
                  <select value={bpForm.fatura_year} onChange={e=>sbp("fatura_year",parseInt(e.target.value))} style={{width:"100%",padding:"10px 14px",borderRadius:10,border:`1px solid ${t.border}`,background:t.inputBg,color:t.text,fontSize:13,outline:"none"}}>
                    {bpYears.map(y=><option key={y} value={y}>{y}</option>)}
                  </select>
                </div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                <DateInput label="Início do período" t={t} value={bpForm.period_start} onChange={e=>sbp("period_start",e.target.value)} />
                <DateInput label="Fim do período" t={t} value={bpForm.period_end} onChange={e=>sbp("period_end",e.target.value)} />
              </div>
              <DateInput label="Data de vencimento" t={t} value={bpForm.due_date} onChange={e=>sbp("due_date",e.target.value)} />
              <Input label="Total do extrato PDF (opcional)" t={t} type="number" value={bpForm.total_pdf} onChange={e=>sbp("total_pdf",e.target.value)} placeholder="Ex: 1250.00" />
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                <Btn t={t} variant="ghost" onClick={resetBpForm}>Cancelar</Btn>
                <Btn t={t} onClick={saveBp} disabled={bpLoading}>{bpLoading?"Salvando...":(bpEditId?"Salvar alterações":"Adicionar período")}</Btn>
              </div>
            </div>
          )}
        </div>
      )}

      <ConfirmModal
        open={!!cardConfirmOpts}
        title={cardConfirmOpts?.title}
        message={cardConfirmOpts?.message}
        onConfirm={() => { cardConfirmOpts?.onConfirm(); setCardConfirmOpts(null); }}
        onCancel={() => setCardConfirmOpts(null)}
        t={t}
      />
    </div>
  );
}

// ─── BILLING CARD (Dashboard) ─────────────────────────────────────────────────
function BillingCard({ cards, billingPeriods = [], appBillingData = [], t }) {
  const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`;

  // Determine current fatura using first available card's closing_day/periods
  const firstCard = cards[0];
  const firstCardPeriods = billingPeriods.filter(p => p.card_id === firstCard?.id);
  const curFatura = getBillingMonth(todayStr, firstCardPeriods, firstCard?.closing_day ?? 28);

  if (!curFatura) return null;

  // Find the pre-computed bar that matches the current fatura month
  const bar = appBillingData.find(d => d.yr === curFatura.year && d.mo === curFatura.month - 1);
  const total = bar?.value ?? 0;

  if (!total) return null;

  const faturaMo = curFatura.month;
  const faturaYr = curFatura.year;

  // Due date label: prefer DB period due_date, fallback to card.due_day
  const activePeriod = firstCardPeriods.find(p => todayStr >= p.period_start && todayStr <= p.period_end);
  let dueLabel;
  if (activePeriod?.due_date) {
    const [dy, dm, dd] = activePeriod.due_date.split("-");
    dueLabel = `Vence ${dd}/${dm}/${dy}`;
  } else {
    const dueDay = firstCard?.due_day ?? 6;
    dueLabel = `Vence dia ${dueDay}/${String(faturaMo).padStart(2,"0")}/${faturaYr}`;
  }

  return (
    <div style={{background:t.accentSoft,border:`1px solid ${t.accent}33`,backdropFilter:"blur(12px)",borderRadius:18,padding:"20px 22px",transition:"transform 0.2s"}}
      onMouseEnter={e=>e.currentTarget.style.transform="translateY(-2px)"}
      onMouseLeave={e=>e.currentTarget.style.transform="translateY(0)"}>
      <div style={{fontSize:26,marginBottom:10}}>💳</div>
      <div style={{fontSize:10,fontWeight:700,color:t.textMuted,letterSpacing:"0.08em",marginBottom:4,textTransform:"uppercase"}}>Fatura em Aberto</div>
      <div style={{fontSize:11,color:t.textMuted,marginBottom:6}}>{dueLabel}</div>
      <div style={{fontSize:22,fontWeight:800,color:t.accent,letterSpacing:"-0.02em"}}>{fmt(total)}</div>
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [darkMode, setDarkMode] = useState(true);
  const [initializing, setInitializing] = useState(
    () => import.meta.env.DEV ? !!localStorage.getItem("sb_token") : true
  );
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [family, setFamily] = useState(null);
  const [familyMembers, setFamilyMembers] = useState([]);
  const [tab, setTab] = useState("dashboard");
  const [expenses, setExpenses] = useState([]);
  const [incomes, setIncomes] = useState([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [cards, setCards] = useState([]);
  const [recurringRules, setRecurringRules] = useState([]);
  const [billingPeriods, setBillingPeriods] = useState([]);
  const [showCardsManager, setShowCardsManager] = useState(false);
  const [modal, setModal] = useState(null);
  const [calendarDate, setCalendarDate] = useState(null); // date selected in CalendarView
  const [showInvite, setShowInvite] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showFabSheet, setShowFabSheet] = useState(false);
  const [showMoreDrawer, setShowMoreDrawer] = useState(false);

  const t = themes[darkMode ? "dark" : "light"];
  const isDemo = SUPABASE_URL.includes("YOUR_PROJECT") || user?.id === "demo";

  const currentUserLabel = useMemo(() => {
    if (user?.id === "demo") return "Você";
    const name = [profile?.first_name, profile?.last_name].filter(Boolean).join(" ").trim();
    return name || user?.email || "Você";
  }, [profile, user]);

  // Billing data anchored to today — same algorithm as billingChartData in ChartsView
  // but with fixed sm/sy so BillingCard always matches the chart's default view
  const appBillingData = useMemo(() => {
    const sm = today.getMonth(), sy = today.getFullYear();
    const result = {};
    for (let i=0;i<12;i++) {
      const d=new Date(sy,sm+i,1);
      result[`${d.getFullYear()}-${d.getMonth()}`]={ value:0, yr:d.getFullYear(), mo:d.getMonth() };
    }
    expenses.forEach(e => {
      if (e.type !== "credito" || !e.date) return;
      const p = parseInt(e.parcelas) || 1;
      const iv = parseFloat(e.amount) || 0;
      const card = cards.find(c => c.id === e.card_id);
      const closingDay = card?.closing_day ?? 28;
      const cardPeriods = billingPeriods.filter(bp => bp.card_id === e.card_id);
      const [dYr, dMoStr, dDayStr] = e.date.slice(0,10).split("-");
      const purYr=parseInt(dYr), purMo=parseInt(dMoStr)-1, purDay=parseInt(dDayStr)||1;
      for (let i=0;i<p;i++) {
        const totalMo=purMo+i, instMo=totalMo%12, instYr=purYr+Math.floor(totalMo/12);
        const maxDay=new Date(instYr,instMo+1,0).getDate(), instDay=Math.min(purDay,maxDay);
        const instDate=`${instYr}-${String(instMo+1).padStart(2,"0")}-${String(instDay).padStart(2,"0")}`;
        const bm=getBillingMonth(instDate,cardPeriods,closingDay);
        if (!bm) continue;
        const k=`${bm.year}-${bm.month-1}`;
        if (result[k]) result[k].value += iv;
      }
    });
    const todayMidnight=new Date(); todayMidnight.setHours(0,0,0,0);
    recurringRules.forEach(rule => {
      if (rule.type!=="credito"||!rule.active||rule.amount_type==="variable") return;
      const ruleAmt=parseFloat(rule.amount)||0;
      if (ruleAmt<=0) return;
      for (let i=0;i<12;i++) {
        const d=new Date(sy,sm+i,1);
        const targetYr=d.getFullYear(), targetMo=d.getMonth()+1;
        if (rule.frequency==="yearly"&&rule.month_of_year!==targetMo) continue;
        if (rule.end_date&&new Date(rule.end_date+"T12:00:00")<d) continue;
        const mPrefix=`${targetYr}-${String(targetMo).padStart(2,"0")}`;
        const alreadyConfirmed=expenses.some(e=>
          e.type==="credito"&&
          e.description?.toLowerCase().trim()===rule.description?.toLowerCase().trim()&&
          e.date?.startsWith(mPrefix)
        );
        if (alreadyConfirmed) continue;
        const day=rule.day_of_month||1;
        const dateStr=`${targetYr}-${String(targetMo).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
        const bm=getBillingMonth(dateStr,[],28);
        if (!bm) continue;
        const matchingPeriod=billingPeriods.find(bp=>bp.fatura_month===bm.month&&bp.fatura_year===bm.year);
        if (matchingPeriod&&new Date(matchingPeriod.period_end+"T23:59:59")<todayMidnight) continue;
        const k=`${bm.year}-${bm.month-1}`;
        if (result[k]) result[k].value += ruleAmt;
      }
    });
    return Object.values(result).map(r=>({...r,value:Math.round(r.value)}));
  }, [expenses, cards, recurringRules, billingPeriods]);

  const addToast = useCallback((message, type="info") => {
    const id=Date.now();
    setToasts(p=>[...p,{id,message,type}]);
    setTimeout(()=>setToasts(p=>p.filter(t=>t.id!==id)),3500);
  }, []);

  const removeToast = useCallback((id)=>setToasts(p=>p.filter(t=>t.id!==id)),[]);

  // Listen for navigation events from ImportView
  useEffect(() => {
    const handler = (e) => { setTab(e.detail); setMobileMenu(false); if(e.detail !== "calendar") setCalendarDate(null); };
    window.addEventListener("goto-tab", handler);

    // Handle expired session: log user out cleanly
    const expiredHandler = () => {
      setUser(null); setFamily(null); setProfile(null);
      setFamilyMembers([]); setExpenses([]); setIncomes([]);
    };
    window.addEventListener("sb-session-expired", expiredHandler);
    return () => {
      window.removeEventListener("goto-tab", handler);
      window.removeEventListener("sb-session-expired", expiredHandler);

    };
  }, []);

  // Restore session on page load
  useEffect(() => {
    if (isDemo) { setInitializing(false); return; }

    const restoreSession = async (accessToken, user) => {
      if (!accessToken || !user?.id) { setInitializing(false); return; }
      setAuthToken(accessToken);
      const fam = await getOrCreateFamily(user.id).catch(() => null);
      if (!fam) { setInitializing(false); return; }
      setUser(user);
      setFamily(fam);
      try {
        const rows = await supabaseFetch(`/profiles?id=eq.${user.id}&select=first_name,last_name,phone`);
        if (rows?.[0]) setProfile(rows[0]);
      } catch {}
      try {
        const members = await supabaseRpc("get_family_members_with_profiles");
        setFamilyMembers(Array.isArray(members) ? members : []);
      } catch {}
      setInitializing(false);
    };

    if (import.meta.env.DEV) {
      // Dev: restore from localStorage token
      const token = localStorage.getItem("sb_token");
      if (!token) { setInitializing(false); return; }
      fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: { "apikey": SUPABASE_ANON_KEY, "Authorization": `Bearer ${token}` }
      })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(u => restoreSession(token, u))
      .catch(() => { setAuthToken(null); setInitializing(false); });
    } else {
      // Production: restore using HttpOnly cookie via Vercel API route
      fetch("/api/auth/refresh", { method: "POST" })
        .then(r => r.ok ? r.json() : Promise.reject())
        .then(data => restoreSession(data.access_token, data.user))
        .catch(() => setInitializing(false));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadData = useCallback(async () => {
    if (isDemo||!user||!family) { setDataLoading(false); return; }
    setDataLoading(true);
    try {
      const [exp,inc,cds,rec]=await Promise.all([
        supabaseFetch(`/expenses?family_id=eq.${family.family_id}&select=*&order=date.desc`),
        supabaseFetch(`/incomes?family_id=eq.${family.family_id}&select=*&order=date.desc`),
        supabaseFetch(`/cards?family_id=eq.${family.family_id}&active=eq.true&order=created_at`),
        supabaseFetch(`/recurring_expenses?family_id=eq.${family.family_id}&active=eq.true&select=*`),
      ]);
      setExpenses(exp||[]); setIncomes(inc||[]); setCards(cds||[]); setRecurringRules(rec||[]);
      // billing_periods is optional — fetch separately so a missing table never breaks the main load
      supabaseFetch(`/billing_periods?family_id=eq.${family.family_id}&order=due_date.asc`)
        .then(bps => setBillingPeriods(bps||[]))
        .catch(() => {});
    } catch { addToast("Erro ao carregar dados","error"); }
    finally { setDataLoading(false); }
  }, [user, family, isDemo, addToast]);

  useEffect(()=>{ if(user&&family) loadData(); },[user,family,loadData]);

  const handleLogin=async(u, token, fam)=>{
    setUser(u);
    setFamily(fam);
    if(u.id === "demo"){
      const d = makeDemoData();
      setExpenses(d.expenses);
      setIncomes(d.incomes);
      setDataLoading(false);
      setProfile({ first_name:"Demo", last_name:"" });
      setFamilyMembers([
        { user_id:"demo",  user_label:"Você",   role:"admin"  },
        { user_id:"demo2", user_label:"Esposa", role:"member" },
      ]);
      setInitializing(false);
      addToast("Modo demonstração ativo 🎉","success");
      return;
    }
    // Load user profile
    try {
      const rows = await supabaseFetch(`/profiles?id=eq.${u.id}&select=first_name,last_name,phone`);
      if(rows && rows[0]) setProfile(rows[0]);
    } catch{}
    // Load family members
    if(fam){
      try {
        const members = await supabaseRpc("get_family_members_with_profiles");
        setFamilyMembers(Array.isArray(members) ? members : []);
      } catch{}
    }
  };

  const handleLogout = () => {
    setAuthToken(null);
    setUser(null); setFamily(null); setProfile(null); setFamilyMembers([]);
    setExpenses([]); setIncomes([]); setCards([]); setRecurringRules([]); setBillingPeriods([]);
    if (!import.meta.env.DEV) {
      // Production: clear the HttpOnly refresh token cookie server-side
      fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    }
    addToast("Saiu com sucesso", "info");
  };

  const handleRegenCode = async () => {
    if (!family) return;
    try {
      const code = await regenerateInviteCode(family.family_id);
      setFamily(f => ({ ...f, invite_code: code }));
      addToast("Novo código gerado!", "success");
    } catch { addToast("Erro ao gerar código","error"); }
  };

  const saveExpense=async(data)=>{
    const { _recurring, installAmount, id: _id, ...expData } = data;
    // Only send columns that exist in the expenses table
    const payload = {
      description: expData.description,
      amount:      expData.amount,
      date:        expData.date,
      category:    expData.category,
      type:        expData.type,
      parcelas:    expData.parcelas,
      user_label:  expData.user_label,
      card_id:     expData.card_id || null,
      family_id:   family?.family_id,
      user_id:     user?.id,
    };
    if(!isDemo){
      try{
        const s=await supabaseFetch("/expenses",{method:"POST",body:JSON.stringify(payload),headers:{"Prefer":"return=representation,resolution=ignore-duplicates"}});
        setExpenses(p=>[s[0],...p]);
        // If marked as recurring, also create the recurring rule
        if(_recurring && family?.family_id){
          const recPayload = {
            family_id: family.family_id,
            description: expData.description,
            category: expData.category,
            type: expData.type,
            user_label: expData.user_label,
            amount_type: _recurring.amount_type,
            amount: _recurring.amount_type === "fixed" ? (parseFloat(expData.amount)||null) : null,
            frequency: _recurring.frequency,
            day_of_month: parseInt(_recurring.day_of_month) || today.getDate(),
            end_date: _recurring.end_date || null,
            active: true,
          };
          await supabaseFetch("/recurring_expenses",{method:"POST",body:JSON.stringify(recPayload),headers:{"Prefer":"return=minimal"}});
          addToast("Gasto registrado e regra recorrente criada! ✅","success");
        } else {
          addToast("Gasto registrado!","success");
        }
      }catch(err){addToast(err.message,"error");return;}
    } else {
      setExpenses(p=>[payload,...p]);
      addToast("Gasto registrado!","success");
    }
    setModal(null);
  };

  const saveIncome=async(data)=>{
    const { id: _id, ...incData } = data;
    const payload = {
      description: incData.description,
      amount:      incData.amount,
      date:        incData.date,
      source:      incData.source,
      category:    incData.category,
      user_label:  incData.user_label,
      family_id:   family?.family_id,
      user_id:     user?.id,
    };
    if(!isDemo){try{const s=await supabaseFetch("/incomes",{method:"POST",body:JSON.stringify(payload)});setIncomes(p=>[s[0],...p]);}catch(err){addToast(err.message,"error");return;}}
    else setIncomes(p=>[payload,...p]);
    setModal(null); addToast("Receita registrada!","success");
  };

  const deleteExpense=async(id)=>{ if(!isDemo){ try{ await supabaseFetch(`/expenses?id=eq.${id}`,{method:"DELETE"}); }catch(err){ addToast("Erro ao remover: "+err.message,"error"); return; }} setExpenses(p=>p.filter(e=>e.id!==id)); addToast("Gasto removido","info"); };
  const deleteIncome=async(id)=>{ if(!isDemo){ try{ await supabaseFetch(`/incomes?id=eq.${id}`,{method:"DELETE"}); }catch(err){ addToast("Erro ao remover: "+err.message,"error"); return; }} setIncomes(p=>p.filter(i=>i.id!==id)); addToast("Receita removida","info"); };

  const editExpense=async(payload)=>{
    const { _type, ...data } = payload;
    if(!isDemo){
      try {
        // PATCH and then re-fetch the updated record to guarantee state matches DB
        await supabaseFetch(`/expenses?id=eq.${data.id}`, {
          method:"PATCH",
          body: JSON.stringify({
            description: data.description, amount: data.amount, date: data.date,
            category: data.category, type: data.type, parcelas: data.parcelas,
            user_label: data.user_label, card_id: data.card_id || null,
          }),
        });
        // Re-fetch the updated record from DB
        const updated = await supabaseFetch(`/expenses?id=eq.${data.id}&select=*`);
        if (updated && updated[0]) {
          setExpenses(p => p.map(e => e.id === data.id ? updated[0] : e));
        } else {
          setExpenses(p => p.map(e => e.id === data.id ? { ...e, ...data } : e));
        }
      } catch(err) { addToast("Erro ao editar: " + err.message, "error"); return; }
    } else {
      setExpenses(p => p.map(e => e.id === data.id ? { ...e, ...data } : e));
    }
    addToast("Gasto atualizado! ✓", "success");
  };

  const editIncome=async(payload)=>{
    const { _type, ...data } = payload;
    if(!isDemo){
      try {
        await supabaseFetch(`/incomes?id=eq.${data.id}`, {
          method:"PATCH",
          body: JSON.stringify({
            description: data.description, amount: data.amount, date: data.date,
            category: data.category, source: data.source, user_label: data.user_label,
          }),
        });
        const updated = await supabaseFetch(`/incomes?id=eq.${data.id}&select=*`);
        if (updated && updated[0]) {
          setIncomes(p => p.map(i => i.id === data.id ? updated[0] : i));
        } else {
          setIncomes(p => p.map(i => i.id === data.id ? { ...i, ...data } : i));
        }
      } catch(err) { addToast("Erro ao editar: " + err.message, "error"); return; }
    } else {
      setIncomes(p => p.map(i => i.id === data.id ? { ...i, ...data } : i));
    }
    addToast("Receita atualizada! ✓", "success");
  };

  const deleteAllExpenses=async(ids)=>{
    if(!ids.length) return;
    if(!isDemo){
      try {
        for(let i=0;i<ids.length;i+=20){
          const chunk=ids.slice(i,i+20);
          await supabaseFetch("/expenses?id=in.("+chunk.join(",")+")",{method:"DELETE"});
        }
      } catch(err){ addToast("Erro ao remover gastos: "+err.message,"error"); return; }
    }
    setExpenses(p=>p.filter(e=>!ids.includes(e.id)));
    addToast("Gastos removidos","info");
  };

  const deleteAllIncomes=async(ids)=>{
    if(!ids.length) return;
    if(!isDemo){
      try {
        for(let i=0;i<ids.length;i+=20){
          const chunk=ids.slice(i,i+20);
          await supabaseFetch("/incomes?id=in.("+chunk.join(",")+")",{method:"DELETE"});
        }
      } catch(err){ addToast("Erro ao remover receitas: "+err.message,"error"); return; }
    }
    setIncomes(p=>p.filter(i=>!ids.includes(i.id)));
    addToast("Receitas removidas","info");
  };

  const tabs=[
    {id:"dashboard",  label:"Início",      shortLabel:"Início",     icon:"home"},
    {id:"calendar",   label:"Calendário",  shortLabel:"Calendário", icon:"calendar"},
    {id:"charts",     label:"Gráficos",    shortLabel:"Gráficos",   icon:"chart"},
    {id:"budget",     label:"Orçamento",   shortLabel:"Orçamento",  icon:"target"},
    {id:"recurring",  label:"Recorrentes", shortLabel:"Recorr.",    icon:"repeat"},
    {id:"transactions",label:"Lançamentos",shortLabel:"Lançam.",    icon:"list"},
    {id:"import",     label:"Importar",    shortLabel:"Importar",   icon:"upload"},
  ];
  // primary tabs shown in the mobile bottom bar (4 slots + center FAB)
  const PRIMARY_MOBILE_TABS = ["dashboard","calendar","charts","__menu"];

  const css=`
    @import url('https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700;800&family=DM+Sans:wght@400;500;600;700&display=swap');
    *{box-sizing:border-box;margin:0;padding:0;}
    html{-webkit-text-size-adjust:100%;touch-action:manipulation;}
    body{font-family:'DM Sans',sans-serif;background:${t.bg};-webkit-overflow-scrolling:touch;}
    @keyframes fadeInUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
    @keyframes slideInRight{from{opacity:0;transform:translateX(24px)}to{opacity:1;transform:translateX(0)}}
    @keyframes slideInLeft{from{opacity:0;transform:translateX(-24px)}to{opacity:1;transform:translateX(0)}}
    @keyframes modalIn{from{opacity:0;transform:scale(0.95) translateY(10px)}to{opacity:1;transform:scale(1) translateY(0)}}
    @keyframes sheetIn{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
    ::-webkit-scrollbar{width:6px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:rgba(124,106,247,0.3);border-radius:3px}
    input[type=date]::-webkit-calendar-picker-indicator{opacity:0.7;cursor:pointer;filter:${darkMode?"brightness(0) saturate(100%) invert(96%) sepia(5%) saturate(200%) hue-rotate(200deg) brightness(105%)":"brightness(0) saturate(100%) invert(8%) sepia(20%) saturate(800%) hue-rotate(215deg) brightness(90%)"}}
    input[type=date]::-webkit-calendar-picker-indicator:hover{opacity:1}
    input[type=date]{width:100%!important;max-width:100%!important;box-sizing:border-box!important;text-align:left!important;-webkit-appearance:none!important;appearance:none!important;padding:11px 14px!important;}
    input[type=date]::-webkit-date-and-time-value{text-align:left!important;}
    .summary-grid{display:grid;grid-template-columns:1fr;gap:12px;}
    .summary-grid-3{display:grid;grid-template-columns:1fr;gap:12px;}
    .summary-grid-1{display:grid;grid-template-columns:1fr;gap:12px;}
    .dashboard-row2{display:flex;flex-direction:column;gap:12px;}
    .sidebar-btn{transition:background 0.15s,color 0.15s;}
    .sidebar-btn:hover{background:${t.surfaceHover}!important;color:${t.text}!important;}
    @media(max-width:600px){
      .desktop-sidebar{display:none!important;}
      .desktop-topbar{display:none!important;}
      .desktop-fab{display:none!important;}
      .main-content-wrap{margin-left:0!important;padding-top:calc(56px + env(safe-area-inset-top))!important;padding-bottom:calc(64px + env(safe-area-inset-bottom))!important;}
    }
    @media(min-width:601px){
      .mobile-topbar{display:none!important;}
      .mobile-bottombar{display:none!important;}
      .mobile-fab-sheet{display:none!important;}
      .summary-grid{grid-template-columns:repeat(4,1fr);}
      .summary-grid-3{grid-template-columns:repeat(3,1fr);}
      .summary-grid-1{grid-template-columns:1fr;}
      .dashboard-row2{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
      .main-content{padding-bottom:100px!important;}
    }
    @media(min-width:601px) and (max-width:900px){
      .desktop-sidebar{width:64px!important;}
      .nav-label{display:none!important;}
      .sidebar-appname{display:none!important;}
      .main-content-wrap{margin-left:64px!important;}
    }
    @media(min-width:901px){
      .desktop-sidebar{width:210px!important;}
      .main-content-wrap{margin-left:210px!important;}
    }
    @keyframes sheetUp{from{opacity:0;transform:translateY(100%)}to{opacity:1;transform:translateY(0)}}
    @keyframes lpFill{from{stroke-dashoffset:100}to{stroke-dashoffset:0}}
    .lp-ring-svg{position:absolute;inset:-3px;width:calc(100% + 6px);height:calc(100% + 6px);pointer-events:none;border-radius:inherit;}
    .lp-ring-path{stroke-dasharray:100;stroke-dashoffset:100;animation:lpFill 500ms linear forwards;}
    @keyframes shimmer{0%{background-position:-400px 0}100%{background-position:400px 0}}
    .sk{border-radius:10px;background:linear-gradient(90deg,${t.surface} 25%,${t.surfaceHover} 50%,${t.surface} 75%);background-size:800px 100%;animation:shimmer 1.5s infinite linear;}
    @media(prefers-reduced-motion:reduce){*{animation-duration:0.01ms!important;transition-duration:0.01ms!important}}
    @media(max-width:600px){.chart-tab-label{display:none!important;}}
    @media(max-width:600px){
      .modal-sheet{position:fixed!important;bottom:0!important;left:0!important;right:0!important;border-radius:20px 20px 0 0!important;max-width:100%!important;max-height:90vh!important;animation:sheetUp 0.25s ease!important;}
      .modal-handle-wrap{display:flex!important;}
      .modal-centered{border-radius:20px 20px 0 0!important;position:fixed!important;bottom:0!important;left:0!important;right:0!important;max-width:100%!important;}
    }
    @media(min-width:601px){
      .modal-sheet{animation:modalIn 0.25s ease!important;}
    }
  `;

  if (initializing) return (
    <><style>{css + `
      @keyframes shimmer{0%{background-position:-400px 0}100%{background-position:400px 0}}
      .sk{border-radius:10px;background:linear-gradient(90deg,${t.surface} 25%,${t.surfaceHover} 50%,${t.surface} 75%);background-size:800px 100%;animation:shimmer 1.4s infinite linear;}
    `}</style>
    <div style={{ minHeight:"100vh",background:t.bg,fontFamily:"'DM Sans',sans-serif" }}>
      {/* Skeleton sidebar (desktop) */}
      <div className="desktop-sidebar" style={{ position:"fixed",left:0,top:0,bottom:0,background:t.bg,borderRight:`1px solid ${t.border}`,display:"flex",flexDirection:"column",alignItems:"flex-start",padding:"14px 0",gap:8 }}>
        <div className="sk" style={{ width:120,height:28,borderRadius:8,margin:"0 12px 8px" }} />
        {[1,2,3,4,5,6,7].map(i=><div key={i} className="sk" style={{ width:"80%",height:40,borderRadius:12,margin:"0 8px" }} />)}
      </div>
      {/* Skeleton top header */}
      <div className="main-content-wrap" style={{ marginLeft:0 }}>
        <div className="desktop-topbar" style={{ height:60,background:`${t.bg}ee`,borderBottom:`1px solid ${t.border}`,display:"flex",alignItems:"center",padding:"0 28px",gap:16 }}>
          <div className="sk" style={{ width:120,height:22,borderRadius:8 }} />
          <div style={{ flex:1 }} />
          <div className="sk" style={{ width:200,height:36,borderRadius:999 }} />
          <div className="sk" style={{ width:36,height:36,borderRadius:10 }} />
        </div>
        <div style={{ maxWidth:960,margin:"0 auto",padding:"28px 24px" }}>
          {/* Skeleton summary cards */}
          <div className="summary-grid" style={{ marginBottom:24 }}>
          {[1,2,3,4].map(i=>(
            <div key={i} style={{ background:t.surface,border:`1px solid ${t.border}`,borderRadius:18,padding:"18px 20px" }}>
              <div className="sk" style={{ width:32,height:32,borderRadius:8,marginBottom:12 }} />
              <div className="sk" style={{ width:"60%",height:10,borderRadius:6,marginBottom:8 }} />
              <div className="sk" style={{ width:"80%",height:24,borderRadius:8 }} />
            </div>
          ))}
        </div>
        {/* Skeleton chart card */}
        <div style={{ background:t.surface,border:`1px solid ${t.border}`,borderRadius:20,padding:24,marginBottom:20 }}>
          <div className="sk" style={{ width:200,height:16,borderRadius:8,marginBottom:24 }} />
          <div className="sk" style={{ width:"100%",height:200,borderRadius:12 }} />
        </div>
        </div>
      </div>
    </div>
    <Toast toasts={toasts} remove={removeToast} /></>
  );

  if (!user) return <><style>{css}</style><LoginPage t={t} darkMode={darkMode} onLogin={handleLogin} addToast={addToast} /><Toast toasts={toasts} remove={removeToast} /></>;

  const currentTabLabel = tabs.find(tb=>tb.id===tab)?.label || "Início";

  return (
    <>
      <style>{css}</style>
      <div style={{ minHeight:"100vh",background:t.bg }}>
        <div style={{ position:"fixed",width:500,height:500,borderRadius:"50%",background:`radial-gradient(circle, ${t.accentGlow} 0%, transparent 70%)`,top:-150,right:-150,pointerEvents:"none",zIndex:0 }} />
        <div style={{ position:"fixed",width:300,height:300,borderRadius:"50%",background:`radial-gradient(circle, ${t.successSoft} 0%, transparent 70%)`,bottom:50,left:-50,pointerEvents:"none",zIndex:0 }} />

        {/* ══ DESKTOP SIDEBAR ══ */}
        <aside className="desktop-sidebar" style={{ position:"fixed",left:0,top:0,bottom:0,zIndex:100,display:"flex",flexDirection:"column",alignItems:"stretch",padding:"14px 0 12px",background:t.bg,borderRight:`1px solid ${t.border}`,overflowX:"hidden" }}>
          {/* App name */}
          <div style={{ display:"flex",alignItems:"center",gap:8,padding:"0 14px",marginBottom:16,flexShrink:0 }}>
            <span style={{ fontSize:22,flexShrink:0 }}>💎</span>
            <span className="sidebar-appname" style={{ fontFamily:"'Sora',sans-serif",fontWeight:800,fontSize:14,color:t.text,letterSpacing:"-0.02em",whiteSpace:"nowrap",overflow:"hidden" }}>Finanças Casal</span>
          </div>
          {/* Nav items */}
          <div style={{ flex:1,display:"flex",flexDirection:"column",gap:2,width:"100%",paddingBottom:8 }}>
            {tabs.map(tb=>(
              <button key={tb.id} onClick={()=>setTab(tb.id)} title={tb.label}
                className="sidebar-btn"
                style={{ width:"100%",height:44,borderRadius:12,border:"none",cursor:"pointer",display:"flex",alignItems:"center",gap:10,padding:"0 12px",
                  background:tab===tb.id?t.accentSoft:"transparent",
                  color:tab===tb.id?t.accent:t.textMuted }}>
                <Icon name={tb.icon} size={20} color={tab===tb.id?t.accent:t.textMuted} />
                <span className="nav-label" style={{ fontSize:13,fontWeight:tab===tb.id?700:500,whiteSpace:"nowrap" }}>{tb.label}</span>
              </button>
            ))}
          </div>
          {/* User avatar + name */}
          {!isDemo && user && (
            <div style={{ position:"relative",padding:"8px 8px 0",borderTop:`1px solid ${t.border}` }}>
              <button onClick={e=>{e.stopPropagation();setShowUserMenu(v=>!v);}} title={profile?.first_name||"Conta"}
                className="sidebar-btn"
                style={{ width:"100%",height:44,borderRadius:12,border:"none",cursor:"pointer",display:"flex",alignItems:"center",gap:10,padding:"0 12px",background:showUserMenu?t.accentSoft:"transparent",color:t.text }}>
                <div style={{ width:28,height:28,borderRadius:"50%",background:t.accent,color:"#fff",fontSize:12,fontWeight:800,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0 }}>
                  {(profile?.first_name||"U")[0].toUpperCase()}
                </div>
                <span className="nav-label" style={{ fontSize:13,fontWeight:600,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis" }}>{profile?.first_name||"Conta"}</span>
              </button>
              {showUserMenu&&<div onClick={()=>setShowUserMenu(false)} style={{ position:"fixed",inset:0,zIndex:9998 }} />}
              {showUserMenu&&(
                <div onClick={e=>e.stopPropagation()} style={{ position:"absolute",bottom:"calc(100% + 8px)",left:0,background:t.glassModal,border:`1px solid ${t.glassBorder}`,borderRadius:14,padding:8,minWidth:210,boxShadow:t.shadow,zIndex:9999,animation:"fadeInUp 0.15s ease" }}>
                  <div style={{ padding:"8px 12px",borderBottom:`1px solid ${t.border}`,marginBottom:6 }}>
                    <div style={{ fontSize:12,fontWeight:700,color:t.text }}>{profile?.first_name} {profile?.last_name}</div>
                    <div style={{ fontSize:11,color:t.textMuted,marginTop:1 }}>{user?.email}</div>
                  </div>
                  {[{label:"👤 Meu Perfil",action:()=>{setShowProfile(true);setShowUserMenu(false);}},{label:"👥 Família",action:()=>{setShowInvite(true);setShowUserMenu(false);}},{label:"💳 Cartões",action:()=>{setShowCardsManager(true);setShowUserMenu(false);}}].map(item=>(
                    <button key={item.label} onClick={item.action} style={{ width:"100%",padding:"8px 12px",borderRadius:8,border:"none",cursor:"pointer",fontSize:12,fontWeight:600,textAlign:"left",background:"transparent",color:t.text }} onMouseEnter={e=>e.currentTarget.style.background=t.surfaceHover} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>{item.label}</button>
                  ))}
                  <div style={{ height:1,background:t.border,margin:"6px 0" }} />
                  <button onClick={()=>{setDarkMode(!darkMode);setShowUserMenu(false);}} style={{ width:"100%",padding:"8px 12px",borderRadius:8,border:"none",cursor:"pointer",fontSize:12,fontWeight:600,textAlign:"left",background:"transparent",color:t.text }} onMouseEnter={e=>e.currentTarget.style.background=t.surfaceHover} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>{darkMode?"☀️ Modo claro":"🌙 Modo escuro"}</button>
                  <div style={{ height:1,background:t.border,margin:"6px 0" }} />
                  <button onClick={()=>{handleLogout();setShowUserMenu(false);}} style={{ width:"100%",padding:"8px 12px",borderRadius:8,border:"none",cursor:"pointer",fontSize:12,fontWeight:600,textAlign:"left",background:"transparent",color:t.danger }} onMouseEnter={e=>e.currentTarget.style.background=t.dangerSoft} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>🚪 Sair</button>
                </div>
              )}
            </div>
          )}
          {isDemo&&(
            <div style={{ display:"flex",flexDirection:"column",alignItems:"center",gap:6,marginTop:8 }}>
              <div style={{ fontSize:10,background:t.warningSoft,color:t.warning,padding:"3px 6px",borderRadius:6,fontWeight:700,textAlign:"center",width:44 }}>DEMO</div>
              <button onClick={handleLogout} title="Sair do Demo"
                style={{ width:38,height:38,borderRadius:12,border:`1px solid ${t.dangerSoft}`,background:"transparent",cursor:"pointer",color:t.danger,fontSize:17,display:"flex",alignItems:"center",justifyContent:"center" }}>
                🚪
              </button>
            </div>
          )}
        </aside>

        {/* ══ MOBILE TOP HEADER ══ */}
        <header className="mobile-topbar" style={{ position:"fixed",top:0,left:0,right:0,height:"calc(56px + env(safe-area-inset-top))",zIndex:100,display:"flex",alignItems:"center",justifyContent:"center",padding:"0 16px",background:`${t.bg}f0`,backdropFilter:"blur(20px)",WebkitBackdropFilter:"blur(20px)",borderBottom:`1px solid ${t.border}`,paddingTop:"env(safe-area-inset-top)" }}>
          <button onClick={()=>setTab("dashboard")} style={{ display:"flex",alignItems:"center",gap:8,background:"none",border:"none",cursor:"pointer",padding:0 }}>
            <span style={{ fontSize:20 }}>💎</span>
            <span style={{ fontFamily:"'Sora',sans-serif",fontWeight:800,fontSize:15,color:t.text,letterSpacing:"-0.01em" }}>Finanças Casal</span>
            {isDemo&&<span style={{ fontSize:10,background:t.warningSoft,color:t.warning,padding:"2px 7px",borderRadius:6,fontWeight:700 }}>DEMO</span>}
          </button>
        </header>

        {/* ══ MAIN CONTENT WRAP (margin-left set by CSS on desktop) ══ */}
        <div className="main-content-wrap" style={{ display:"flex",flexDirection:"column",minHeight:"100vh" }}>

          {/* ── Desktop top header ── */}
          <div className="desktop-topbar" style={{ position:"sticky",top:0,height:60,zIndex:50,display:"flex",alignItems:"center",justifyContent:"center",padding:"0 28px",background:`${t.bg}ee`,backdropFilter:"blur(20px)",WebkitBackdropFilter:"blur(20px)",borderBottom:`1px solid ${t.border}` }}>
            <h1 style={{ fontSize:19,fontWeight:800,fontFamily:"'Sora',sans-serif",color:t.text,margin:0,letterSpacing:"-0.02em",textAlign:"center" }}>{currentTabLabel}</h1>
          </div>

          {/* ── Main content ── */}
          <main className="main-content" style={{ maxWidth:960,margin:"0 auto",width:"100%",padding:"24px 24px 100px",position:"relative",animation:"fadeInUp 0.3s ease",flex:1 }}>
            {tab==="dashboard"&&(
              <div style={{ display:"flex",flexDirection:"column",gap:24 }}>
                <div>
                  <h2 style={{ margin:"0 0 4px",fontSize:22,fontWeight:800,color:t.text,letterSpacing:"-0.02em" }}>
                    Olá{profile?.first_name ? `, ${profile.first_name}` : ""}! 👋
                  </h2>
                  <p style={{ color:t.textMuted,fontSize:13 }}>Visão geral de {MONTH_FULL[today.getMonth()]} {today.getFullYear()}</p>
                </div>
                {dataLoading ? <SummaryCardsSkeleton t={t} /> : <SummaryCards expenses={expenses} incomes={incomes} t={t} only={["Receitas do Mês","Gastos do Mês","Saldo"]} />}
                <div className="dashboard-row2">
                  <BillingCard cards={cards} billingPeriods={billingPeriods} appBillingData={appBillingData} t={t} />
                  <SummaryCards expenses={expenses} incomes={incomes} t={t} only={["Parcelas Futuras"]} />
                </div>
                <BudgetAlertCard expenses={expenses} t={t} family={family} isDemo={isDemo} onGoToBudget={()=>setTab("budget")} />
                <RecurringAlertCard t={t} family={family} isDemo={isDemo} onGoToRecurring={()=>setTab("recurring")} />
                <div style={{ background:t.glassModal,border:`1px solid ${t.glassBorder}`,backdropFilter:"blur(16px)",borderRadius:20,padding:24 }}>
                  <h3 style={{ margin:"0 0 20px",fontSize:16,fontWeight:700,color:t.text,letterSpacing:"-0.02em" }}>📊 Últimos 6 meses</h3>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={Array.from({length:6},(_,i)=>{ const baseYr=today.getFullYear(),baseMo=today.getMonth(); const totalMo=baseMo-5+i; const yr=baseYr+Math.floor(totalMo/12), mn=((totalMo%12)+12)%12; const px=`${yr}-${String(mn+1).padStart(2,"0")}`; return { name:MONTHS[mn], Receitas:Math.round(incomes.filter(i=>i.date?.startsWith(px)).reduce((s,i)=>s+(parseFloat(i.amount)||0),0)), Gastos:Math.round(expenses.filter(e=>e.date?.startsWith(px)).reduce((s,e)=>s+(parseFloat(e.amount)||0),0)) }; })} barGap={4} barCategoryGap="30%">
                      <CartesianGrid strokeDasharray="3 3" stroke={t.border} vertical={false} />
                      <XAxis dataKey="name" tick={{ fill:t.textMuted,fontSize:12 }} axisLine={false} tickLine={false} />
                      <YAxis tickFormatter={fmtShort} tick={{ fill:t.textMuted,fontSize:11 }} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={{ background:t.tooltipBg,border:`1px solid ${t.glassBorder}`,borderRadius:12,boxShadow:t.shadowSm }} labelStyle={{ color:t.text,fontWeight:700 }} itemStyle={{ color:t.text }} cursor={{ fill:t.chartCursorFill }} />
                      <Bar dataKey="Receitas" fill={t.success} radius={[6,6,0,0]} />
                      <Bar dataKey="Gastos" fill={t.danger} radius={[6,6,0,0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
            {tab==="calendar"&&<CalendarView expenses={expenses} incomes={incomes} t={t} onDeleteExpense={deleteExpense} onDeleteIncome={deleteIncome} onEditExpense={editExpense} onEditIncome={editIncome} familyMembers={familyMembers} onDaySelect={d=>setCalendarDate(d)} family={family} isDemo={isDemo} />}
            {tab==="charts"&&(dataLoading ? <ChartsViewSkeleton t={t} /> : <ChartsView expenses={expenses} incomes={incomes} t={t} onEditExpense={editExpense} onDeleteExpense={deleteExpense} familyMembers={familyMembers} cards={cards} recurringRules={recurringRules} billingPeriods={billingPeriods} />)}
            {tab==="recurring"&&(
              <div style={{ display:"flex",flexDirection:"column",gap:0 }}>
                <div style={{ marginBottom:20 }}>
                  <h2 style={{ margin:"0 0 6px",fontSize:22,fontWeight:800,color:t.text,letterSpacing:"-0.02em" }}>🔁 Gastos Recorrentes</h2>
                  <p style={{ color:t.textMuted,fontSize:14 }}>Aluguel, contas fixas, assinaturas e lembretes mensais</p>
                </div>
                <RecurringView expenses={expenses} setExpenses={setExpenses} t={t} family={family} user={user} isDemo={isDemo} addToast={addToast} familyMembers={familyMembers} />
              </div>
            )}
            {tab==="budget"&&(
              <div style={{ display:"flex",flexDirection:"column",gap:0 }}>
                <div style={{ marginBottom:20 }}>
                  <h2 style={{ margin:"0 0 6px",fontSize:22,fontWeight:800,color:t.text,letterSpacing:"-0.02em" }}>🎯 Orçamento Mensal</h2>
                  <p style={{ color:t.textMuted,fontSize:14 }}>Defina limites de gastos por categoria e acompanhe em tempo real</p>
                </div>
                <BudgetView expenses={expenses} t={t} family={family} user={user} isDemo={isDemo} addToast={addToast} />
              </div>
            )}
            {tab==="transactions"&&(dataLoading ? <TransactionsListSkeleton t={t} /> : <TransactionsList expenses={expenses} incomes={incomes} t={t} onDeleteExpense={deleteExpense} onDeleteIncome={deleteIncome} onDeleteAllExpenses={deleteAllExpenses} onDeleteAllIncomes={deleteAllIncomes} onEditExpense={editExpense} onEditIncome={editIncome} familyMembers={familyMembers} cards={cards} currentUserLabel={currentUserLabel} billingPeriods={billingPeriods} />)}
            {tab==="import"&&<ImportView t={t} darkMode={darkMode} family={family} user={user} isDemo={isDemo} existingExpenses={expenses} existingIncomes={incomes} onImported={(exps,incs)=>{ setExpenses(p=>[...exps,...p]); setIncomes(p=>[...incs,...p]); }} addToast={addToast} />}
          </main>

          {/* Desktop FABs */}
          {tab !== "import" && (
            <div className="desktop-fab" style={{ position:"fixed",bottom:28,right:28,zIndex:150,display:"flex",flexDirection:"column",gap:12,alignItems:"flex-end" }}>
              <Btn t={t} variant="success" onClick={()=>setModal("income")} style={{ borderRadius:16,width:148,height:48,fontSize:14 }}>+ Receita</Btn>
              <Btn t={t} onClick={()=>setModal("expense")} style={{ borderRadius:16,width:148,height:48,fontSize:14 }}>+ Gasto</Btn>
            </div>
          )}

          <footer style={{ borderTop:`1px solid ${t.border}`,padding:"18px 24px",textAlign:"center" }}>
            <div style={{ fontSize:12,color:t.textMuted }}>
              Desenvolvido com 💜 por Fernando Ghiberti em parceria com Claude IA · 2026
            </div>
          </footer>
        </div>

        {/* ══ MOBILE BOTTOM BAR ══ */}
        <div className="mobile-bottombar" style={{ position:"fixed",bottom:0,left:0,right:0,zIndex:200,background:`${t.bg}f4`,backdropFilter:"blur(24px)",WebkitBackdropFilter:"blur(24px)",borderTop:`1px solid ${t.border}`,display:"flex",alignItems:"center",paddingBottom:"env(safe-area-inset-bottom)" }}>
          {/* Tab: Dashboard */}
          {["dashboard","calendar"].map(id => {
            const tb = tabs.find(x=>x.id===id); const isAct = tab===id;
            return (
              <button key={id} onClick={()=>{setTab(id);setShowMoreDrawer(false);}} style={{ flex:1,border:"none",background:"transparent",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"8px 2px 6px",gap:3,cursor:"pointer",color:isAct?t.accent:t.textMuted,transition:"color 0.15s",position:"relative" }}>
                <Icon name={tb.icon} size={22} color={isAct?t.accent:t.textMuted} />
                <span style={{ fontSize:9.5,fontWeight:isAct?700:500,lineHeight:1.2,whiteSpace:"nowrap" }}>{tb.shortLabel}</span>
                {isAct&&<span style={{ position:"absolute",bottom:2,width:18,height:2,borderRadius:2,background:t.accent }} />}
              </button>
            );
          })}
          {/* Center FAB */}
          <button onClick={()=>{setShowFabSheet(v=>!v);setShowMoreDrawer(false);}} style={{ flex:1,border:"none",background:"transparent",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",paddingBottom:4 }}>
            <span style={{ width:52,height:52,borderRadius:"50%",background:showFabSheet?`${t.accent}cc`:t.accent,display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",boxShadow:`0 4px 18px ${t.accentGlow}`,transform:showFabSheet?"rotate(45deg)":"none",transition:"all 0.2s",marginTop:-8 }}>
              <Icon name="plus" size={26} color="#fff" />
            </span>
          </button>
          {/* Tab: Charts */}
          {["charts"].map(id => {
            const tb = tabs.find(x=>x.id===id); const isAct = tab===id;
            return (
              <button key={id} onClick={()=>{setTab(id);setShowMoreDrawer(false);}} style={{ flex:1,border:"none",background:"transparent",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"8px 2px 6px",gap:3,cursor:"pointer",color:isAct?t.accent:t.textMuted,transition:"color 0.15s",position:"relative" }}>
                <Icon name={tb.icon} size={22} color={isAct?t.accent:t.textMuted} />
                <span style={{ fontSize:9.5,fontWeight:isAct?700:500,lineHeight:1.2,whiteSpace:"nowrap" }}>{tb.shortLabel}</span>
                {isAct&&<span style={{ position:"absolute",bottom:2,width:18,height:2,borderRadius:2,background:t.accent }} />}
              </button>
            );
          })}
          {/* Menu button */}
          <button onClick={()=>setShowMoreDrawer(v=>!v)} style={{ flex:1,border:"none",background:"transparent",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"8px 2px 6px",gap:3,cursor:"pointer",color:showMoreDrawer?t.accent:t.textMuted,transition:"color 0.15s" }}>
            <Icon name="more" size={22} color={showMoreDrawer?t.accent:t.textMuted} />
            <span style={{ fontSize:9.5,fontWeight:showMoreDrawer?700:500,lineHeight:1.2 }}>Menu</span>
          </button>
        </div>

        {/* ══ MORE DRAWER (mobile) ══ */}
        {showMoreDrawer&&(
          <>
            <div onClick={()=>setShowMoreDrawer(false)} style={{ position:"fixed",inset:0,zIndex:201,background:"rgba(0,0,0,0.45)" }} />
            <div style={{ position:"fixed",bottom:"calc(64px + env(safe-area-inset-bottom))",left:0,right:0,zIndex:202,background:t.glassModal,backdropFilter:"blur(24px)",WebkitBackdropFilter:"blur(24px)",borderRadius:"20px 20px 0 0",border:`1px solid ${t.glassBorder}`,borderBottom:"none",padding:"20px 16px 8px",animation:"sheetUp 0.22s ease",boxShadow:t.shadow }}>
              <div style={{ display:"flex",justifyContent:"center",marginBottom:16 }}>
                <div style={{ width:36,height:4,borderRadius:2,background:t.border }} />
              </div>
              {[
                {id:"recurring", icon:"repeat", label:"Recorrentes"},
                {id:"budget",    icon:"target", label:"Orçamento"},
                {id:"transactions",icon:"list",label:"Lançamentos"},
                {id:"import",   icon:"upload", label:"Importar"},
              ].map(item=>(
                <button key={item.id} onClick={()=>{setTab(item.id);setShowMoreDrawer(false);}} style={{ width:"100%",display:"flex",alignItems:"center",gap:14,padding:"13px 16px",borderRadius:12,border:"none",cursor:"pointer",background:tab===item.id?t.accentSoft:"transparent",color:tab===item.id?t.accent:t.text,fontSize:15,fontWeight:600,textAlign:"left",marginBottom:4 }}>
                  <Icon name={item.icon} size={20} color={tab===item.id?t.accent:t.textMuted} />
                  {item.label}
                </button>
              ))}
              <div style={{ height:1,background:t.border,margin:"8px 0" }} />
              {!isDemo&&<button onClick={()=>{setShowProfile(true);setShowMoreDrawer(false);}} style={{ width:"100%",display:"flex",alignItems:"center",gap:14,padding:"12px 16px",borderRadius:12,border:"none",cursor:"pointer",background:"transparent",color:t.text,fontSize:14,fontWeight:500,textAlign:"left" }}><Icon name="user" size={18} color={t.textMuted} />Meu Perfil</button>}
              {family&&!isDemo&&<button onClick={()=>{setShowInvite(true);setShowMoreDrawer(false);}} style={{ width:"100%",display:"flex",alignItems:"center",gap:14,padding:"12px 16px",borderRadius:12,border:"none",cursor:"pointer",background:"transparent",color:t.text,fontSize:14,fontWeight:500,textAlign:"left" }}><Icon name="users" size={18} color={t.textMuted} />Família</button>}
              {family&&!isDemo&&<button onClick={()=>{setShowCardsManager(true);setShowMoreDrawer(false);}} style={{ width:"100%",display:"flex",alignItems:"center",gap:14,padding:"12px 16px",borderRadius:12,border:"none",cursor:"pointer",background:"transparent",color:t.text,fontSize:14,fontWeight:500,textAlign:"left" }}><Icon name="card" size={18} color={t.textMuted} />Cartões</button>}
              <div style={{ height:1,background:t.border,margin:"8px 0" }} />
              <button onClick={()=>setDarkMode(v=>!v)} style={{ width:"100%",display:"flex",alignItems:"center",gap:14,padding:"12px 16px",borderRadius:12,border:"none",cursor:"pointer",background:"transparent",color:t.text,fontSize:14,fontWeight:500,textAlign:"left" }}><Icon name={darkMode?"sun":"moon"} size={18} color={t.textMuted} />{darkMode?"Modo claro":"Modo escuro"}</button>
              <div style={{ height:1,background:t.border,margin:"8px 0" }} />
              {!isDemo&&<button onClick={()=>{handleLogout();setShowMoreDrawer(false);}} style={{ width:"100%",display:"flex",alignItems:"center",gap:14,padding:"12px 16px",borderRadius:12,border:"none",cursor:"pointer",background:"transparent",color:t.danger,fontSize:14,fontWeight:600,textAlign:"left" }}><Icon name="logout" size={18} color={t.danger} />Sair</button>}
              {isDemo&&<button onClick={()=>{handleLogout();setShowMoreDrawer(false);}} style={{ width:"100%",display:"flex",alignItems:"center",gap:14,padding:"12px 16px",borderRadius:12,border:"none",cursor:"pointer",background:"transparent",color:t.danger,fontSize:14,fontWeight:600,textAlign:"left" }}><Icon name="logout" size={18} color={t.danger} />Sair do Demo</button>}
            </div>
          </>
        )}

        {/* ══ MOBILE FAB SHEET ══ */}
        {showFabSheet&&(
          <>
            <div className="mobile-fab-sheet" onClick={()=>setShowFabSheet(false)} style={{ position:"fixed",inset:0,zIndex:201,background:"rgba(0,0,0,0.45)" }} />
            <div className="mobile-fab-sheet" style={{ position:"fixed",bottom:"calc(70px + env(safe-area-inset-bottom))",left:20,right:20,zIndex:202,borderRadius:20,background:t.glassModal,backdropFilter:"blur(24px)",WebkitBackdropFilter:"blur(24px)",border:`1px solid ${t.glassBorder}`,padding:16,display:"flex",flexDirection:"column",gap:12,animation:"sheetIn 0.2s ease",boxShadow:t.shadow }}>
              <Btn t={t} variant="success" onClick={()=>{setModal("income");setShowFabSheet(false);}} style={{ width:"100%",height:52,fontSize:15,borderRadius:14,justifyContent:"center" }}>💰 + Receita</Btn>
              <Btn t={t} onClick={()=>{setModal("expense");setShowFabSheet(false);}} style={{ width:"100%",height:52,fontSize:15,borderRadius:14,justifyContent:"center" }}>💸 + Gasto</Btn>
            </div>
          </>
        )}
      </div>

      {/* Expense / Income modals */}
      <Modal open={modal==="expense"} onClose={()=>setModal(null)} title="💸 Registrar Gasto" t={t} darkMode={darkMode}>
        <ExpenseForm t={t} onSave={saveExpense} onClose={()=>setModal(null)} familyMembers={familyMembers} initialDate={tab==="calendar"&&calendarDate?calendarDate:undefined} cards={cards} currentUserLabel={currentUserLabel} />
      </Modal>
      <Modal open={modal==="income"} onClose={()=>setModal(null)} title="💰 Registrar Receita" t={t} darkMode={darkMode}>
        <IncomeForm t={t} onSave={saveIncome} onClose={()=>setModal(null)} familyMembers={familyMembers} initialDate={tab==="calendar"&&calendarDate?calendarDate:undefined} currentUserLabel={currentUserLabel} />
      </Modal>

      {/* Invite code modal */}
      <Modal open={showInvite} onClose={()=>setShowInvite(false)} title="👥 Família" t={t} darkMode={darkMode}>
        {showInvite && <FamilyModal t={t} family={family} currentUserId={user?.id} familyMembers={familyMembers} setFamilyMembers={setFamilyMembers} onRegenCode={handleRegenCode} addToast={addToast} isAdmin={family?.role==="admin"} />}
      </Modal>

      <Modal open={showProfile} onClose={()=>setShowProfile(false)} title="👤 Meu Perfil" t={t} darkMode={darkMode}>
        <ProfileModal t={t} user={user} profile={profile} addToast={addToast} onSaved={(p)=>{ setProfile(p); setShowProfile(false); }} />
      </Modal>

      <Modal open={showCardsManager} onClose={()=>setShowCardsManager(false)} title="💳 Meus Cartões" t={t} darkMode={darkMode}>
        {showCardsManager && <CardsManager t={t} family={family} isDemo={isDemo} addToast={addToast} billingPeriods={billingPeriods} setBillingPeriods={setBillingPeriods} />}
      </Modal>

      <Toast toasts={toasts} remove={removeToast} />
    </>
  );
}
