import { useState, useEffect, useCallback, useMemo } from "react";
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, CartesianGrid, Legend } from "recharts";

// ─── SUPABASE CONFIG ──────────────────────────────────────────────────────────
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "";
let _authToken = localStorage.getItem("sb_token") || null;

let _refreshToken = localStorage.getItem("sb_refresh") || null;

function setAuthToken(token, refreshToken = null) {
  _authToken = token;
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

// Silently refresh the access token using the refresh token
async function refreshAccessToken() {
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
  const res = await fetch(`${SUPABASE_URL}/auth/v1/${action}`, {
    method: "POST",
    headers: { "apikey": SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error_description || data.error);
  return data;
}

// ─── FAMILY HELPERS (via Supabase RPC — bypasses RLS safely) ─────────────────
function genCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
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

const CATEGORIES = [
  { id: "alimentacao", label: "Alimentação", emoji: "🍽️" },
  { id: "transporte", label: "Transporte", emoji: "🚗" },
  { id: "moradia", label: "Moradia", emoji: "🏠" },
  { id: "saude", label: "Saúde", emoji: "💊" },
  { id: "lazer", label: "Lazer", emoji: "🎬" },
  { id: "vestuario", label: "Vestuário", emoji: "👕" },
  { id: "educacao", label: "Educação", emoji: "📚" },
  { id: "tecnologia", label: "Tecnologia", emoji: "💻" },
  { id: "supermercado", label: "Supermercado", emoji: "🛒" },
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
function Modal({ open, onClose, title, children, t, darkMode }) {
  if (!open) return null;
  return (
    <div onClick={(e)=>{ if(e.target===e.currentTarget) onClose(); }} style={{
      position: "fixed", inset: 0, zIndex: 500,
      background: "rgba(0,0,0,0.65)", backdropFilter: "blur(10px)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: t.glassModal,
        border: `1.5px solid ${t.glassBorder}`,
        backdropFilter: "blur(40px)", WebkitBackdropFilter: "blur(40px)",
        borderRadius: 24, padding: 32, width: "100%", maxWidth: 480,
        maxHeight: "90vh", overflowY: "auto",
        animation: "modalIn 0.25s ease",
        boxShadow: `${t.shadow}, ${t.innerGlow}`,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <h3 style={{ margin: 0, color: t.text, fontSize: 20, fontWeight: 700, fontFamily: "'Sora', sans-serif" }}>{title}</h3>
          <button
            onClick={onClose}
            style={{ background: t.surfaceHover, border: `1px solid ${t.border}`, borderRadius: 10, width: 36, height: 36, cursor: "pointer", color: t.textSecondary, fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.18s" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = t.danger+"22"; e.currentTarget.style.color = t.danger; e.currentTarget.style.borderColor = t.danger+"55"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = t.surfaceHover; e.currentTarget.style.color = t.textSecondary; e.currentTarget.style.borderColor = t.border; }}
          >×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ─── INPUT / SELECT / BTN ─────────────────────────────────────────────────────
function Input({ label, t, ...props }) {
  return (
    <div style={{ marginBottom: 16, minWidth: 0 }}>
      {label && <label style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 600, color: t.textSecondary, letterSpacing: "0.02em", textAlign: "left" }}>{label}</label>}
      <input {...props} style={{ width: "100%", maxWidth: "100%", padding: "11px 14px", borderRadius: 12, fontSize: 14, fontFamily: "'DM Sans', sans-serif", background: t.inputBg, border: `1px solid ${t.border}`, color: t.text, outline: "none", transition: "border-color 0.2s", boxSizing: "border-box", minWidth: 0, ...(props.style||{}) }}
        onFocus={(e) => { e.target.style.borderColor = t.accent; }}
        onBlur={(e) => { e.target.style.borderColor = t.border; }}
      />
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
  const isDemo = SUPABASE_URL.includes("YOUR_PROJECT");

  const handleAuth = async () => {
    if (isDemo) {
      addToast("Modo demonstração ativo! 🎉", "success");
      onLogin({ id: "demo", email: "demo@financacasal.app" }, null, null);
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
    } catch (err) { addToast(err.message, "error"); }
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
    {isDemo && <div style={{ background:t.warningSoft,border:`1px solid ${t.warning}33`,borderRadius:12,padding:"12px 16px",marginBottom:20,fontSize:13,color:t.warning,display:"flex",gap:8 }}><span>⚠️</span><span><strong>Modo Demo:</strong> Clique em entrar para explorar.</span></div>}
    <Input label="E-mail" t={t} type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="seu@email.com" onKeyDown={e=>e.key==="Enter"&&handleAuth()} />
    <Input label="Senha" t={t} type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="••••••••" onKeyDown={e=>e.key==="Enter"&&handleAuth()} />
    <Btn t={t} type="button" onClick={handleAuth} style={{ width:"100%",marginTop:4 }} disabled={loading}>
      {loading?"Aguarde...":isDemo?"🚀 Entrar no modo demo":mode==="login"?"🔐 Entrar":"✨ Criar conta"}
    </Btn>
    <p style={{ textAlign:"center",marginTop:18,fontSize:14,color:t.textMuted }}>
      {mode==="login"?"Não tem conta? ":"Já tem conta? "}
      <span onClick={()=>setMode(mode==="login"?"signup":"login")} style={{ color:t.accent,cursor:"pointer",fontWeight:600 }}>{mode==="login"?"Criar agora":"Entrar"}</span>
    </p>
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
      <Input label="Código de convite (6 dígitos)" t={t} value={inviteCode} onChange={e=>setInviteCode(e.target.value.toUpperCase())} placeholder="Ex: AB12CD" style={{ letterSpacing:"0.2em",fontWeight:700 }} />
      <Btn t={t} variant="success" type="button" onClick={handleJoinFamily} style={{ width:"100%" }} disabled={loading}>{loading?"Entrando...":"🔗 Entrar com código"}</Btn>
    </div>
  </>);

  return null;
}

// ─── CALENDAR ────────────────────────────────────────────────────────────────
function CalendarView({ expenses, incomes, t, onDeleteExpense, onDeleteIncome, onEditExpense, onEditIncome, familyMembers, onDaySelect }) {
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
    expenses.forEach((e) => {
      const d = e.date?.slice(0,10);
      if (d?.startsWith(`${yr}-${String(mo+1).padStart(2,"0")}`)) { const day = parseInt(d.slice(8)); if (!map[day]) map[day]=[]; map[day].push(e); }
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
        <h2 style={{ margin: 0, fontFamily: "'Sora', sans-serif", fontSize: 20, fontWeight: 700, color: t.text }}>{MONTH_FULL[mo]} {yr}</h2>
        <button onClick={() => { if(mo===11){setViewYr(y=>y+1);setViewMo(0);}else{setViewMo(m=>m+1);} setSelectedDay(null); }} style={{ background: t.surfaceHover, border: `1px solid ${t.border}`, borderRadius: 10, width: 36, height: 36, cursor: "pointer", color: t.text, fontSize: 16 }}>›</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 6, marginBottom: 8 }}>
        {["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"].map((d) => <div key={d} style={{ textAlign: "center", fontSize: 12, fontWeight: 700, color: t.textMuted, padding: "6px 0" }}>{d}</div>)}
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
              <div style={{ display: "flex", gap: 3 }}>
                {hasExp&&<span style={{ width:6,height:6,borderRadius:"50%",background:t.danger }}/>}
                {hasInc&&<span style={{ width:6,height:6,borderRadius:"50%",background:t.success }}/>}
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
            <h3 style={{ margin: 0, color: t.text, fontFamily: "'Sora', sans-serif", fontSize: 16, fontWeight: 700 }}>{selectedDay} de {MONTH_FULL[mo]}</h3>
            <div style={{ display: "flex", gap: 12 }}>
              {sInc.length>0&&<span style={{ fontSize:13,fontWeight:700,color:t.success }}>{fmt(sInc.reduce((s,i)=>s+(parseFloat(i.amount)||0),0))}</span>}
              {sExp.length>0&&<span style={{ fontSize:13,fontWeight:700,color:t.danger }}>{fmt(sExp.reduce((s,e)=>s+(parseFloat(e.amount)||0),0))}</span>}
            </div>
          </div>
          {sExp.length===0&&sInc.length===0 ? <p style={{ color:t.textMuted,fontSize:14,margin:0,textAlign:"center" }}>Nenhum lançamento neste dia</p> : (
            <div style={{ display:"flex",flexDirection:"column",gap:8 }}>
              {sInc.map((inc) => {
                const incCat = INCOME_SOURCES.find(s=>s.id===(inc.source||inc.category));
                return (
                  <div key={inc.id} style={{
                    display:"flex",alignItems:"center",justifyContent:"space-between",
                    padding:"12px 16px",borderRadius:14,transition:"all 0.2s",
                    background:t.successSoft, border:`1px solid ${t.success}22`,
                  }}>
                    <div style={{ display:"flex",alignItems:"center",gap:10,minWidth:0,flex:1 }}>
                      <span style={{ fontSize:22,flexShrink:0 }}>{incCat?.emoji||"💰"}</span>
                      <div style={{ minWidth:0,flex:1,textAlign:"left" }}>
                        <div style={{ fontSize:13,fontWeight:600,color:t.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{inc.description}</div>
                        <div style={{ fontSize:11,color:t.textMuted,marginTop:1,textAlign:"left" }}>
                          {inc.user_label} · {(inc.date||"").slice(8,10)+"/"+(inc.date||"").slice(5,7)+"/"+(inc.date||"").slice(2,4)}{incCat ? ` · ${incCat.label}` : ""}
                        </div>
                      </div>
                    </div>
                    <div style={{ display:"flex",alignItems:"center",gap:6,flexShrink:0 }}>
                      <span style={{ fontWeight:700,fontSize:14,color:t.success }}>{fmt(parseFloat(inc.amount)||0)}</span>
                      <button onClick={e=>{ e.stopPropagation(); setEditItem({...inc,_type:"income"}); }} title="Editar"
                        style={{ background:"transparent",border:"none",cursor:"pointer",color:t.textMuted,fontSize:13,padding:"4px 6px",borderRadius:6,transition:"color 0.2s" }}
                        onMouseEnter={e=>e.currentTarget.style.color=t.accent}
                        onMouseLeave={e=>e.currentTarget.style.color=t.textMuted}>✏️</button>
                      <button onClick={e=>{ e.stopPropagation(); onDeleteIncome(inc.id); }} title="Remover"
                        style={{ background:"transparent",border:"none",cursor:"pointer",color:t.textMuted,fontSize:13,padding:"4px 6px",borderRadius:6,transition:"color 0.2s" }}
                        onMouseEnter={e=>e.currentTarget.style.color=t.danger}
                        onMouseLeave={e=>e.currentTarget.style.color=t.textMuted}>🗑</button>
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
                  const startKey = exp.description?.toLowerCase().trim();
                  const allExpSame = (expenses||[]).filter(e=>e.description?.toLowerCase().trim()===startKey&&e.type==="credito"&&parseInt(e.parcelas)===p).sort((a,b)=>a.date?.localeCompare(b.date));
                  const startDate = allExpSame[0]?.date || exp.date;
                  const startD = new Date((startDate||exp.date).slice(0,10)+"T12:00:00");
                  const thisD  = new Date((exp.date||"").slice(0,10)+"T12:00:00");
                  const diffM  = (thisD.getFullYear()-startD.getFullYear())*12+(thisD.getMonth()-startD.getMonth());
                  const nth = Math.max(1,Math.min(p,diffM+1));
                  subtitleExtra = ` · Crédito ${nth} de ${p}`;
                } else {
                  subtitleExtra = ` · ${typeLabel}`;
                }
                if(cat?.label) subtitleExtra += ` · ${cat.label}`;
                return (
                  <div key={exp.id} style={{
                    display:"flex",alignItems:"center",justifyContent:"space-between",
                    padding:"12px 16px",borderRadius:14,transition:"all 0.2s",
                    background:t.dangerSoft, border:`1px solid ${t.danger}22`,
                  }}>
                    <div style={{ display:"flex",alignItems:"center",gap:10,minWidth:0,flex:1 }}>
                      <span style={{ fontSize:22,flexShrink:0 }}>{cat?.emoji||"📦"}</span>
                      <div style={{ minWidth:0,flex:1,textAlign:"left" }}>
                        <div style={{ fontSize:13,fontWeight:600,color:t.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{exp.description}</div>
                        <div style={{ fontSize:11,color:t.textMuted,marginTop:1,textAlign:"left" }}>
                          {exp.user_label} · {(exp.date||"").slice(8,10)+"/"+(exp.date||"").slice(5,7)+"/"+(exp.date||"").slice(2,4)}{subtitleExtra}
                        </div>
                      </div>
                    </div>
                    <div style={{ display:"flex",alignItems:"center",gap:6,flexShrink:0 }}>
                      <span style={{ fontWeight:700,fontSize:14,color:t.danger }}>{fmt(parseFloat(exp.amount)||0)}</span>
                      <button onClick={e=>{ e.stopPropagation(); setEditItem({...exp,_type:"expense"}); }} title="Editar"
                        style={{ background:"transparent",border:"none",cursor:"pointer",color:t.textMuted,fontSize:13,padding:"4px 6px",borderRadius:6,transition:"color 0.2s" }}
                        onMouseEnter={e=>e.currentTarget.style.color=t.accent}
                        onMouseLeave={e=>e.currentTarget.style.color=t.textMuted}>✏️</button>
                      <button onClick={e=>{ e.stopPropagation(); onDeleteExpense(exp.id); }} title="Remover"
                        style={{ background:"transparent",border:"none",cursor:"pointer",color:t.textMuted,fontSize:13,padding:"4px 6px",borderRadius:6,transition:"color 0.2s" }}
                        onMouseEnter={e=>e.currentTarget.style.color=t.danger}
                        onMouseLeave={e=>e.currentTarget.style.color=t.textMuted}>🗑</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Edit modal — inside CalendarView */}
      {editItem && (
        <div onClick={e=>{ if(e.target===e.currentTarget) setEditItem(null); }}
          style={{ position:"fixed",inset:0,zIndex:500,background:"rgba(0,0,0,0.65)",backdropFilter:"blur(10px)",display:"flex",alignItems:"center",justifyContent:"center",padding:20 }}>
          <div onClick={e=>e.stopPropagation()}
            style={{ background:t.glassModal,border:`1.5px solid ${t.glassBorder}`,borderRadius:24,padding:"24px 20px 20px",width:"100%",maxWidth:460,maxHeight:"90vh",overflowY:"auto",boxShadow:t.shadow,animation:"modalIn 0.25s ease" }}>
            <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20 }}>
              <h3 style={{ margin:0,fontSize:17,fontWeight:800,color:t.text,fontFamily:"'Sora', sans-serif" }}>✏️ Editar Lançamento</h3>
              <button onClick={()=>setEditItem(null)} style={{ background:"transparent",border:"none",cursor:"pointer",color:t.textMuted,fontSize:22,lineHeight:1,padding:"2px 8px",borderRadius:8 }}>×</button>
            </div>
            <EditModal t={t} item={editItem} onClose={()=>setEditItem(null)} familyMembers={familyMembers}
              onSave={async(payload)=>{ if(payload._type==="expense") await onEditExpense(payload); else await onEditIncome(payload); setEditItem(null); }} />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── CHARTS ──────────────────────────────────────────────────────────────────
function ChartsView({ expenses, incomes, t }) {
  const [selectedMonth, setSelectedMonth] = useState(today.getMonth());
  const [selectedYear, setSelectedYear] = useState(today.getFullYear());
  const period = "month"; // always month mode now

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

  // ── Bar chart: 6 months ending at the reference month ──
  const barData = useMemo(() => Array.from({length:6},(_,i) => {
    const d = new Date(refYear, refMonth - 5 + i, 1);
    const yr=d.getFullYear(), mn=d.getMonth();
    const prefix=`${yr}-${String(mn+1).padStart(2,"0")}`;
    const inc = incomes.filter(i=>i.date?.startsWith(prefix)).reduce((s,i)=>s+(parseFloat(i.amount)||0),0);
    const exp = expenses.filter(e=>e.date?.startsWith(prefix)).reduce((s,e)=>s+(parseFloat(e.amount)||0),0);
    return { name:MONTHS[mn], Receitas:Math.round(inc), Gastos:Math.round(exp), Saldo:Math.round(inc-exp) };
  }), [expenses, incomes, refYear, refMonth]);

  // ── Pie: filtered by selected period ──
  const pieData = useMemo(() => {
    const filtered = period==="month"
      ? expenses.filter(e=>e.date?.startsWith(`${selectedYear}-${String(selectedMonth+1).padStart(2,"0")}`))
      : expenses.filter(e=>e.date?.startsWith(`${selectedYear}`));
    const map = {};
    filtered.forEach(e=>{ map[e.category]=(map[e.category]||0)+e.amount; });
    return Object.entries(map).map(([id,value]) => { const cat=CATEGORIES.find(c=>c.id===id); return { name:cat?.label||id, value:Math.round(value), emoji:cat?.emoji||"📦" }; }).sort((a,b)=>b.value-a.value);
  }, [expenses, period, selectedMonth, selectedYear]);

  // ── Credit: 12 months starting from the reference month ──
  const creditData = useMemo(() => {
    const result = {};
    for (let i=0;i<12;i++) {
      const d=new Date(creditRefYear, creditRefMonth+i, 1);
      result[`${d.getFullYear()}-${d.getMonth()}`]={ name:`${MONTHS[d.getMonth()]}/${String(d.getFullYear()).slice(2)}`, value:0 };
    }
    expenses.forEach(e => {
      const p = parseInt(e.parcelas) || 1;
      if (e.type!=="credito" || p <= 1 || !e.date) return;
      // amount is already the per-installment value
      const iv = parseFloat(e.amount) || 0;
      const [dYr, dMoStr] = e.date.slice(0,7).split("-");
      const baseYr = parseInt(dYr), baseMo = parseInt(dMoStr) - 1;
      for (let i=0; i<p; i++) {
        const mo = (baseMo + i) % 12;
        const yr = baseYr + Math.floor((baseMo + i) / 12);
        const k = `${yr}-${mo}`;
        if (result[k]) result[k].value += iv;
      }
    });
    return Object.values(result).map(r=>({...r,value:Math.round(r.value)}));
  }, [expenses, selectedYear, selectedMonth]);

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
      {title&&<h3 style={{ margin:"0 0 20px",fontFamily:"'Sora', sans-serif",fontSize:16,fontWeight:700,color:t.text }}>{title}</h3>}
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

      <Card title={`📊 Receitas × Gastos — 6 meses até ${period==="month" ? MONTH_FULL[selectedMonth] : "Dez"}/${selectedYear}`}>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={barData} barGap={4} barCategoryGap="25%">
            <CartesianGrid strokeDasharray="3 3" stroke={t.border} vertical={false} />
            <XAxis dataKey="name" tick={{ fill:t.textMuted,fontSize:12,fontFamily:"'DM Sans', sans-serif" }} axisLine={false} tickLine={false} />
            <YAxis tickFormatter={fmtShort} tick={{ fill:t.textMuted,fontSize:11 }} axisLine={false} tickLine={false} />
            <Tooltip content={<CTip/>} cursor={{ fill:t.chartCursorFill }} />
            <Legend wrapperStyle={{ fontSize:13,fontFamily:"'DM Sans', sans-serif",color:t.textSecondary }} />
            <Bar dataKey="Receitas" fill={t.success} radius={[6,6,0,0]} />
            <Bar dataKey="Gastos" fill={t.danger} radius={[6,6,0,0]} />
            <Bar dataKey="Saldo" fill={t.accent} radius={[6,6,0,0]} />
          </BarChart>
        </ResponsiveContainer>
      </Card>

      <Card title={`🥧 Gastos por categoria — ${period==="month" ? MONTH_FULL[selectedMonth] : "Ano"} ${selectedYear}`}>
        <div style={{ display:"flex",flexWrap:"wrap",gap:24,alignItems:"center" }}>
          <ResponsiveContainer width="100%" height={220} style={{ minWidth:200 }}>
            <PieChart>
              <Pie data={pieData} cx="50%" cy="50%" innerRadius={55} outerRadius={90} paddingAngle={3} dataKey="value">
                {pieData.map((_,i)=><Cell key={i} fill={t.chartColors[i%t.chartColors.length]} />)}
              </Pie>
              <Tooltip content={<PTip/>} />
            </PieChart>
          </ResponsiveContainer>
          <div style={{ flex:1,minWidth:180,alignSelf:"flex-start" }}>
            <div style={{ display:"grid",gridTemplateColumns: pieData.length > 4 ? "1fr 1fr" : "1fr",gap:"4px 16px" }}>
              {pieData.map((d,i)=>(
                <div key={d.name} style={{ display:"flex",alignItems:"center",gap:6,padding:"4px 0",minWidth:0 }}>
                  <div style={{ width:9,height:9,borderRadius:2,background:t.chartColors[i%t.chartColors.length],flexShrink:0 }} />
                  <span style={{ fontSize:11,color:t.textSecondary,flex:1,textAlign:"left",lineHeight:1.3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{d.emoji} {d.name}</span>
                  <span style={{ fontSize:11,fontWeight:700,color:t.text,flexShrink:0,marginLeft:4 }}>{fmt(d.value)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Card>

      <Card title={`💳 Parcelas de Crédito — 12 meses a partir de ${MONTH_FULL[selectedMonth]}/${selectedYear}`}>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={creditData}>
            <CartesianGrid strokeDasharray="3 3" stroke={t.border} vertical={false} />
            <XAxis dataKey="name" tick={{ fill:t.textMuted,fontSize:11 }} axisLine={false} tickLine={false} />
            <YAxis tickFormatter={fmtShort} tick={{ fill:t.textMuted,fontSize:11 }} axisLine={false} tickLine={false} />
            <Tooltip content={<CTip/>} cursor={{ stroke:t.accent,strokeWidth:1,strokeDasharray:"4 4" }} />
            <Line type="monotone" dataKey="value" stroke={t.accent} strokeWidth={2.5} dot={{ fill:t.accent,r:4 }} activeDot={{ r:6 }} name="Parcelas" />
          </LineChart>
        </ResponsiveContainer>
      </Card>
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
function ExpenseForm({ t, onSave, onClose, familyMembers, initialDate }) {
  const [form, setForm] = useState({ description:"", amount:"", installAmount:"", date:initialDate || today.toISOString().slice(0,10), category:"", type:"pix", parcelas:1, user_label:"Você" });
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
      const n = parseInt(v) || 1;
      if (parseFloat(form.installAmount) > 0) {
        next.amount = n > 1 ? (parseFloat(form.installAmount) * n).toFixed(2) : form.installAmount;
      } else if (parseFloat(form.amount) > 0 && n > 1) {
        next.installAmount = (parseFloat(form.amount) / n).toFixed(2);
      } else {
        next.installAmount = "";
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
  const totalValue = isCredit && parcelas > 1
    ? (parseFloat(form.installAmount) || 0) * parcelas
    : parseFloat(form.amount) || 0;

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
      <Select label="Categoria" t={t} value={form.category} onChange={e=>set("category",e.target.value)}>
        <option value="">Selecione...</option>
        {CATEGORIES.map(c=><option key={c.id} value={c.id}>{c.emoji} {c.label}</option>)}
      </Select>
      {isCredit ? (
        <>
          {/* Credit: parcelas + installAmount first, then total (readonly) and date */}
          <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:12 }}>
            <Input label="Nº de parcelas" t={t} type="number" min={1} max={48} value={form.parcelas} onChange={e=>set("parcelas",parseInt(e.target.value)||1)} />
            <Input label="Valor da Parcela (R$)" t={t} type="number" step="0.01" value={form.installAmount} onChange={e=>set("installAmount",e.target.value)} placeholder="0,00" />
          </div>
          <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,minWidth:0,overflow:"hidden",marginBottom:0 }}>
            <div>
              <label style={{ display:"block",marginBottom:6,fontSize:13,fontWeight:600,color:t.textSecondary,letterSpacing:"0.02em",textAlign:"left" }}>Valor Total (R$)</label>
              <div style={{ padding:"11px 14px",borderRadius:12,fontSize:14,background:t.surface,border:`1px solid ${t.border}`,color:t.textMuted,opacity:0.8 }}>
                {totalValue > 0 ? fmt(totalValue) : "—"}
              </div>
            </div>
            <Input label="Data da 1ª parcela" t={t} type="date" value={form.date} onChange={e=>set("date",e.target.value)} />
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
          <Input label="Data" t={t} type="date" value={form.date} onChange={e=>set("date",e.target.value)} />
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
            <Input label="Data de término (opcional)" t={t} type="date" value={recurringForm.end_date} onChange={e=>setR("end_date",e.target.value)} style={{ height:44,padding:"11px 14px" }} />
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
function IncomeForm({ t, onSave, onClose, familyMembers, initialDate }) {
  const [form, setForm] = useState({ description:"Salário", amount:"", date:initialDate || today.toISOString().slice(0,10), source:"salario", category:"salario", user_label:"Você" });
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
        <Input label="Data" t={t} type="date" value={form.date} onChange={e=>setForm({...form,date:e.target.value})} />
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
function EditModal({ t, item, onSave, onClose, familyMembers }) {
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
        const newN = parseInt(v) || 1;
        const inst = parseFloat(p.installAmount) || 0;
        const total = parseFloat(p.amount) || 0;
        if (inst > 0 && newN > 1) next.amount = (inst * newN).toFixed(2);
        else if (total > 0 && newN > 1) next.installAmount = (total / newN).toFixed(2);
        else if (newN <= 1) { next.installAmount = ""; next.amount = p.installAmount || p.amount; }
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
      ...(isExp ? { type: form.type, parcelas } : { source: form.category, category: form.category }),
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
              <Input label="Nº de parcelas" t={t} type="number" min={1} max={48}
                value={form.parcelas} onChange={e=>set("parcelas",parseInt(e.target.value)||1)} />
              <Input label="Valor da Parcela (R$)" t={t} type="number" step="0.01"
                value={form.installAmount} onChange={e=>set("installAmount",e.target.value)} placeholder="0,00" />
            </div>
            <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,minWidth:0,overflow:"hidden",marginBottom:0 }}>
              <div>
                <label style={{ display:"block",marginBottom:6,fontSize:13,fontWeight:600,color:t.textSecondary,letterSpacing:"0.02em",textAlign:"left" }}>Valor Total (R$)</label>
                <div style={{ padding:"11px 14px",borderRadius:12,fontSize:14,background:t.surface,border:`1px solid ${t.border}`,color:t.textMuted,opacity:0.8 }}>
                  {totalVal > 0 ? fmt(totalVal) : "—"}
                </div>
              </div>
              <Input label="Data da 1ª parcela" t={t} type="date" value={form.date} onChange={e=>set("date",e.target.value)} />
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
            <Input label="Data" t={t} type="date" value={form.date} onChange={e=>set("date",e.target.value)} />
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
        <Input label="Data" t={t} type="date" value={form.date} onChange={e=>set("date",e.target.value)} />
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

// ─── TRANSACTIONS ─────────────────────────────────────────────────────────────
function TransactionsList({ expenses, incomes, t, onDeleteExpense, onDeleteIncome, onDeleteAllExpenses, onDeleteAllIncomes, onEditExpense, onEditIncome, familyMembers }) {
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [monthFilter, setMonthFilter] = useState(today.getMonth());
  const [editItem, setEditItem] = useState(null);
  const [showDupsOnly, setShowDupsOnly] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [paymentFilter, setPaymentFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");

  const toggleSelect = (id) => setSelectedIds(p => {
    const n = new Set(p);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });
  const clearAll = () => setSelectedIds(new Set());

  const availableYears = useMemo(() => {
    const years = new Set();
    [...expenses, ...incomes].forEach(r => {
      const y = r.date?.slice(0,4);
      if (y) years.add(parseInt(y));
    });
    years.add(today.getFullYear());
    return Array.from(years).sort((a,b) => b - a);
  }, [expenses, incomes]);

  const [yearFilter, setYearFilter] = useState(today.getFullYear());

  // Clear selection when filter context changes
  const setMonthFilterAndClear = (v) => { setMonthFilter(v); setSelectedIds(new Set()); };
  const setYearFilterAndClear  = (v) => { setYearFilter(v);  setSelectedIds(new Set()); };
  const setFilterAndClear      = (v) => { setFilter(v); setSelectedIds(new Set()); if(v!=="expense"){setPaymentFilter("all");setCategoryFilter("all");} };

  const all = useMemo(() => {
    const prefix = yearFilter + "-" + String(monthFilter+1).padStart(2,"0");
    return [
      ...expenses.filter(e=>e.date?.startsWith(prefix)).map(e=>({...e,_type:"expense"})),
      ...incomes.filter(i=>i.date?.startsWith(prefix)).map(i=>({...i,_type:"income"}))
    ].sort((a,b)=>b.date?.localeCompare(a.date));
  }, [expenses, incomes, monthFilter, yearFilter]);

  // ── Duplicate detection: same date + description (normalized) + amount + category ──
  const dupIds = useMemo(() => {
    const seen = new Map(); // key → [first_id, ...later_ids]
    const dups = new Set();
    // Process in date order (oldest first) so latest = duplicate
    const sorted = [...all].sort((a,b) => a.date?.localeCompare(b.date) || 0);
    sorted.forEach(item => {
      const key = [
        item.date?.slice(0,10),
        (item.description||"").toLowerCase().trim().replace(/\s+/g," "),
        String(Math.round((item.amount||0)*100)),
        item.category || item.source || "",
        item._type
      ].join("|");
      if (seen.has(key)) {
        dups.add(item.id); // Mark the later one as duplicate
      } else {
        seen.set(key, item.id);
      }
    });
    return dups;
  }, [all]);

  const filtered = useMemo(() => all.filter(item=>{
    if (filter==="expense"&&item._type!=="expense") return false;
    if (filter==="income"&&item._type!=="income") return false;
    if (search&&!item.description?.toLowerCase().includes(search.toLowerCase())) return false;
    if (showDupsOnly && !dupIds.has(item.id)) return false;
    if (paymentFilter!=="all" && item._type==="expense" && item.type!==paymentFilter) return false;
    if (categoryFilter!=="all" && item._type==="expense" && item.category!==categoryFilter) return false;
    return true;
  }), [all, filter, search, showDupsOnly, dupIds, paymentFilter, categoryFilter]);

  const selectAll = () => setSelectedIds(new Set(filtered.map(r => r.id)));
  const isAllSelected = filtered.length > 0 && filtered.every(r => selectedIds.has(r.id));

  const totalExp = all.filter(i=>i._type==="expense").reduce((s,i)=>s+(parseFloat(i.amount)||0),0);
  const totalInc = all.filter(i=>i._type==="income").reduce((s,i)=>s+(parseFloat(i.amount)||0),0);

  const filteredExpIds = filtered.filter(i=>i._type==="expense").map(i=>i.id);
  const filteredIncIds = filtered.filter(i=>i._type==="income").map(i=>i.id);
  const dupCount = dupIds.size;
  const dupIdsArray = Array.from(dupIds);

  const handleDeleteSelected = () => {
    const selArr = Array.from(selectedIds);
    const expIds = selArr.filter(id => all.find(i => i.id === id && i._type === "expense"));
    const incIds = selArr.filter(id => all.find(i => i.id === id && i._type === "income"));
    if (!selArr.length) return;
    if (!window.confirm(`Remover ${selArr.length} lançamento(s) selecionado(s)?`)) return;
    if (expIds.length) onDeleteAllExpenses(expIds);
    if (incIds.length) onDeleteAllIncomes(incIds);
    setSelectedIds(new Set());
  };

  return (
    <div>
      <div style={{ display:"flex",gap:10,marginBottom:20,flexWrap:"wrap" }}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="🔍 Buscar..." style={{ flex:1,minWidth:160,padding:"10px 14px",borderRadius:12,border:`1px solid ${t.border}`,background:t.inputBg,color:t.text,fontSize:13,outline:"none" }} />
        <select value={monthFilter} onChange={e=>setMonthFilterAndClear(Number(e.target.value))} style={{ padding:"10px 14px",borderRadius:12,border:`1px solid ${t.border}`,background:t.inputBg,color:t.text,fontSize:13,cursor:"pointer",outline:"none" }}>
          {MONTH_FULL.map((mn,i)=><option key={i} value={i}>{mn}</option>)}
        </select>
        <select value={yearFilter} onChange={e=>setYearFilterAndClear(Number(e.target.value))} style={{ padding:"10px 14px",borderRadius:12,border:`1px solid ${t.border}`,background:t.inputBg,color:t.text,fontSize:13,cursor:"pointer",outline:"none",fontWeight:700 }}>
          {availableYears.map(y=><option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      {/* Duplicate alert banner */}
      {dupCount > 0 && (
        <div style={{ marginBottom:16,padding:"14px 16px",borderRadius:14,background:"rgba(217,119,6,0.10)",border:"1px solid rgba(217,119,6,0.3)",display:"flex",alignItems:"flex-start",gap:12,flexWrap:"wrap" }}>
          <span style={{ fontSize:20,flexShrink:0,marginTop:1 }}>⚠️</span>
          <div style={{ flex:1,minWidth:200 }}>
            <div style={{ fontSize:13,fontWeight:700,color:t.warning,marginBottom:3 }}>
              {dupCount} lançamento{dupCount>1?"s":""}  duplicado{dupCount>1?"s":""} detectado{dupCount>1?"s":""}
            </div>
            <div style={{ fontSize:12,color:t.textMuted,lineHeight:1.5 }}>
              Itens com mesmo nome, categoria e valor no mesmo dia. Os mais recentes estão marcados com 🔁 e são sugeridos para remoção.
            </div>
          </div>
          <div style={{ display:"flex",gap:8,flexShrink:0,flexWrap:"wrap" }}>
            <button onClick={()=>setShowDupsOnly(v=>!v)}
              style={{ padding:"7px 14px",borderRadius:10,border:"1px solid rgba(217,119,6,0.4)",background:showDupsOnly?"rgba(217,119,6,0.15)":"transparent",color:t.warning,fontSize:12,fontWeight:700,cursor:"pointer" }}>
              {showDupsOnly ? "Ver todos" : "Ver duplicatas"}
            </button>
            <button onClick={()=>{
              const expDups = dupIdsArray.filter(id => all.find(i=>i.id===id&&i._type==="expense"));
              const incDups = dupIdsArray.filter(id => all.find(i=>i.id===id&&i._type==="income"));
              if(window.confirm(`Remover ${dupCount} lançamento(s) duplicado(s)? Esta ação não pode ser desfeita.`)){
                if(expDups.length) onDeleteAllExpenses(expDups);
                if(incDups.length) onDeleteAllIncomes(incDups);
                setShowDupsOnly(false);
              }
            }}
              style={{ padding:"7px 14px",borderRadius:10,border:"1px solid rgba(217,119,6,0.4)",background:"rgba(217,119,6,0.12)",color:t.warning,fontSize:12,fontWeight:700,cursor:"pointer" }}>
              🗑 Remover todos
            </button>
          </div>
        </div>
      )}

      <div style={{ display:"flex",alignItems:"center",gap:8,marginBottom:12,flexWrap:"wrap" }}>
        <div style={{ display:"flex",gap:6,alignItems:"center",flexWrap:"wrap" }}>
          {/* Select all checkbox */}
          <div style={{ display:"flex",alignItems:"center",gap:6,padding:"7px 10px",borderRadius:10,background:t.surfaceHover,cursor:"pointer" }}
            onClick={()=>isAllSelected?clearAll():selectAll()}>
            <input type="checkbox" checked={isAllSelected} onChange={()=>isAllSelected?clearAll():selectAll()}
              onClick={e=>e.stopPropagation()}
              style={{ width:14,height:14,cursor:"pointer",accentColor:t.accent }} />
            <span style={{ fontSize:12,fontWeight:600,color:t.textMuted,whiteSpace:"nowrap" }}>
              {selectedIds.size > 0 ? selectedIds.size + " selecionado" + (selectedIds.size !== 1 ? "s" : "") : "Selecionar"}
            </span>
          </div>
          {[["all","Todos"],["expense","Gastos"],["income","Receitas"]].map(([v,l])=>(
            <button key={v} onClick={()=>setFilterAndClear(v)} style={{ padding:"7px 16px",borderRadius:10,border:"none",cursor:"pointer",fontSize:13,fontWeight:600,background:filter===v?t.accent:t.surfaceHover,color:filter===v?"#fff":t.textMuted,transition:"all 0.2s" }}>{l}</button>
          ))}
        </div>
        <div style={{ flex:1 }} />
        {selectedIds.size > 0 && (
          <button onClick={handleDeleteSelected}
            style={{ padding:"7px 14px",borderRadius:10,border:`1px solid ${t.danger}66`,background:t.danger,color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer",display:"flex",alignItems:"center",gap:5,transition:"all 0.2s",boxShadow:`0 2px 8px ${t.danger}44` }}
            onMouseEnter={e=>e.currentTarget.style.opacity="0.85"}
            onMouseLeave={e=>e.currentTarget.style.opacity="1"}
          >🗑 Apagar {selectedIds.size} selecionado{selectedIds.size!==1?"s":""}</button>
        )}
      </div>
      {/* Payment type + category filters — only for expense view */}
      {filter !== "income" && (
        <div style={{ display:"flex",gap:8,marginBottom:16,flexWrap:"wrap" }}>
          <select value={paymentFilter} onChange={e=>setPaymentFilter(e.target.value)}
            style={{ padding:"8px 12px",borderRadius:10,border:`1px solid ${paymentFilter!=="all"?t.accent:t.border}`,background:paymentFilter!=="all"?t.accentSoft:t.inputBg,color:paymentFilter!=="all"?t.accent:t.text,fontSize:12,fontWeight:600,cursor:"pointer",outline:"none" }}>
            <option value="all">💳 Tipo: Todos</option>
            <option value="pix">💸 PIX</option>
            <option value="debito">🏦 Débito</option>
            <option value="credito">💳 Crédito</option>
          </select>
          <select value={categoryFilter} onChange={e=>setCategoryFilter(e.target.value)}
            style={{ padding:"8px 12px",borderRadius:10,border:`1px solid ${categoryFilter!=="all"?t.accent:t.border}`,background:categoryFilter!=="all"?t.accentSoft:t.inputBg,color:categoryFilter!=="all"?t.accent:t.text,fontSize:12,fontWeight:600,cursor:"pointer",outline:"none" }}>
            <option value="all">🏷️ Categoria: Todas</option>
            {CATEGORIES.map(c=><option key={c.id} value={c.id}>{c.emoji} {c.label}</option>)}
          </select>
          {(paymentFilter!=="all"||categoryFilter!=="all") && (
            <button onClick={()=>{setPaymentFilter("all");setCategoryFilter("all");}}
              style={{ padding:"8px 12px",borderRadius:10,border:`1px solid ${t.border}`,background:"transparent",color:t.textMuted,fontSize:12,fontWeight:600,cursor:"pointer" }}>
              ✕ Limpar filtros
            </button>
          )}
        </div>
      )}

      {/* Summary cards */}
      <div style={{ display:"grid", gridTemplateColumns: filter==="all"?"1fr 1fr":"1fr", gap:10, marginBottom:20 }}>
        {(filter==="all"||filter==="expense")&&(
          <div style={{ background:t.dangerSoft,border:`1px solid ${t.danger}33`,borderRadius:14,padding:"14px 18px" }}>
            <div style={{ fontSize:11,color:t.textMuted,fontWeight:600,marginBottom:4 }}>GASTOS</div>
            <div style={{ fontSize:18,fontWeight:800,color:t.danger }}>{fmt(totalExp)}</div>
          </div>
        )}
        {(filter==="all"||filter==="income")&&(
          <div style={{ background:t.successSoft,border:`1px solid ${t.success}33`,borderRadius:14,padding:"14px 18px" }}>
            <div style={{ fontSize:11,color:t.textMuted,fontWeight:600,marginBottom:4 }}>RECEITAS</div>
            <div style={{ fontSize:18,fontWeight:800,color:t.success }}>{fmt(totalInc)}</div>
          </div>
        )}
      </div>

      <div style={{ display:"flex",flexDirection:"column",gap:8 }}>
        {filtered.length===0 ? (
          <div style={{ textAlign:"center",padding:"40px 0",color:t.textMuted,fontSize:14 }}>
            {showDupsOnly ? "Nenhuma duplicata encontrada neste período" : "Nenhum lançamento encontrado"}
          </div>
        ) : filtered.map(item=>{
          const isExp = item._type==="expense";
          const isDup = dupIds.has(item.id);
          const isSel = selectedIds.has(item.id);
          const cat = isExp?CATEGORIES.find(c=>c.id===item.category):INCOME_SOURCES.find(s=>s.id===item.source);
          return (
            <div key={item.id} style={{
              display:"flex",alignItems:"center",justifyContent:"space-between",
              padding:"12px 16px",borderRadius:14,transition:"all 0.2s",
              background: isSel ? t.accentSoft : isDup ? "rgba(217,119,6,0.08)" : isExp ? t.dangerSoft : t.successSoft,
              border: isSel ? `1px solid ${t.accent}66` : isDup ? "1px solid rgba(217,119,6,0.35)" : `1px solid ${isExp?t.danger:t.success}22`,
              cursor:"pointer",
            }} onClick={()=>toggleSelect(item.id)}>
              <div style={{ display:"flex",alignItems:"center",gap:10,minWidth:0,flex:1 }}>
                <input type="checkbox" checked={isSel} onChange={()=>toggleSelect(item.id)}
                  onClick={e=>e.stopPropagation()}
                  style={{ width:15,height:15,cursor:"pointer",accentColor:t.accent,flexShrink:0 }} />
                <span style={{ fontSize:22,flexShrink:0 }}>{cat?.emoji||(isExp?"📦":"💰")}</span>
                <div style={{ minWidth:0,flex:1,textAlign:"left" }}>
                  <div style={{ display:"flex",alignItems:"center",gap:6,flexWrap:"wrap" }}>
                    <span style={{ fontSize:13,fontWeight:600,color:t.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{item.description}</span>
                    {isDup && (
                      <span style={{ fontSize:10,fontWeight:700,padding:"2px 7px",borderRadius:6,background:"rgba(217,119,6,0.15)",color:t.warning,border:"1px solid rgba(217,119,6,0.3)",flexShrink:0,whiteSpace:"nowrap" }}>
                        🔁 duplicata
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize:11,color:t.textMuted,marginTop:1,textAlign:"left" }}>
                    {item.user_label} · {(item.date||"").slice(8,10)+"/"+(item.date||"").slice(5,7)+"/"+(item.date||"").slice(2,4)}{isExp && (() => {
                      const typeLabel = item.type==="pix"?"PIX":item.type==="debito"?"Débito":"Crédito";
                      const p = parseInt(item.parcelas)||1;
                      const catLabel = cat?.label || "";
                      if(item.type==="credito" && p>1){
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
                    {isDup && <span style={{ color:t.warning,fontWeight:600 }}> · sugerido para remoção</span>}
                  </div>
                </div>
              </div>
              <div style={{ display:"flex",alignItems:"center",gap:6,flexShrink:0 }}>
                <span style={{ fontWeight:700,fontSize:14,color:isDup?t.warning:isExp?t.danger:t.success }}>{fmt(item.amount)}</span>
                <button onClick={()=>setEditItem(item)} title="Editar"
                  style={{ background:"transparent",border:"none",cursor:"pointer",color:t.textMuted,fontSize:13,padding:"4px 6px",borderRadius:6,transition:"color 0.2s" }}
                  onMouseEnter={e=>e.currentTarget.style.color=t.accent}
                  onMouseLeave={e=>e.currentTarget.style.color=t.textMuted}
                >✏️</button>
                <button onClick={()=>isExp?onDeleteExpense(item.id):onDeleteIncome(item.id)} title="Remover"
                  style={{ background:"transparent",border:"none",cursor:"pointer",color:isDup?t.warning:t.textMuted,fontSize:13,padding:"4px 6px",borderRadius:6,transition:"color 0.2s" }}
                  onMouseEnter={e=>e.currentTarget.style.color=t.danger}
                  onMouseLeave={e=>e.currentTarget.style.color=isDup?t.warning:t.textMuted}
                >🗑</button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Edit Modal */}
      {editItem && (
        <div onClick={e=>{ if(e.target===e.currentTarget) setEditItem(null); }}
          style={{ position:"fixed",inset:0,zIndex:500,background:"rgba(0,0,0,0.65)",backdropFilter:"blur(10px)",display:"flex",alignItems:"center",justifyContent:"center",padding:20 }}>
          <div onClick={e=>e.stopPropagation()}
            style={{ background:t.glassModal,border:`1.5px solid ${t.glassBorder}`,borderRadius:24,padding:"24px 20px 20px",width:"100%",maxWidth:460,maxHeight:"90vh",overflowY:"auto",boxShadow:t.shadow,animation:"modalIn 0.25s ease" }}>
            <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20 }}>
              <h3 style={{ margin:0,fontSize:17,fontWeight:800,color:t.text,fontFamily:"'Sora', sans-serif" }}>✏️ Editar Lançamento</h3>
              <button onClick={()=>setEditItem(null)} style={{ background:"transparent",border:"none",cursor:"pointer",color:t.textMuted,fontSize:22,lineHeight:1,padding:"2px 8px",borderRadius:8 }}>×</button>
            </div>
            <EditModal t={t} item={editItem} onClose={()=>setEditItem(null)} familyMembers={familyMembers}
              onSave={async(payload)=>{ if(payload._type==="expense") await onEditExpense(payload); else await onEditIncome(payload); setEditItem(null); }} />
          </div>
        </div>
      )}
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

  // ── Confirm a reminder (create expense) ─────────────────────────────────────
  const confirmReminder = async (reminder, rule) => {
    const amt = parseFloat(pendingAmt[reminder.id] ?? reminder.amount ?? "");
    if (!amt || amt <= 0) { addToast("Informe um valor válido", "error"); return; }
    setConfirmingId(reminder.id);
    const day = rule.day_of_month || 1;
    const dateStr = `${curYear}-${String(curMonth).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
    try {
      // Create expense
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
        headers: { "Prefer": "return=representation" },
      });
      const exp = expRows?.[0];
      // Update reminder
      await supabaseFetch(`/recurring_reminders?id=eq.${reminder.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "confirmed", expense_id: exp?.id, amount: amt }),
        headers: { "Prefer": "return=minimal" },
      });
      setReminders(p => p.map(r => r.id === reminder.id ? { ...r, status: "confirmed", expense_id: exp?.id, amount: amt } : r));
      if (exp) setExpenses(p => [exp, ...p]);
      addToast(`${rule.description} — ${fmt(amt)} lançado!`, "success");
    } catch (e) { addToast("Erro: " + e.message, "error"); }
    finally { setConfirmingId(null); }
  };

  const skipReminder = async (reminder) => {
    try {
      await supabaseFetch(`/recurring_reminders?id=eq.${reminder.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "skipped" }),
        headers: { "Prefer": "return=minimal" },
      });
      setReminders(p => p.map(r => r.id === reminder.id ? { ...r, status: "skipped" } : r));
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
    if (!window.confirm(`Remover "${rule.description}"? Os lançamentos já feitos não serão afetados.`)) return;
    try {
      await supabaseFetch(`/recurring_expenses?id=eq.${rule.id}`, { method: "DELETE" });
      setRules(p => p.filter(r => r.id !== rule.id));
      setReminders(p => p.filter(r => r.recurring_id !== rule.id));
      addToast("Recorrente removido", "info");
    } catch (e) { addToast("Erro: " + e.message, "error"); }
  };

  const pending  = reminders.filter(r => r.status === "pending");
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
            {pending.map(rem => {
              const rule = rules.find(r => r.id === rem.recurring_id);
              if (!rule) return null;
              const cat = CATEGORIES.find(c => c.id === rule.category);
              const isFixed = rule.amount_type === "fixed";
              const isConfirming = confirmingId === rem.id;
              return (
                <div key={rem.id} style={{ background:t.glassModal,border:`1px solid ${t.border}`,borderRadius:14,padding:"14px 16px" }}>
                  <div style={{ display:"flex",alignItems:"center",gap:10,marginBottom: isFixed ? 10 : 10 }}>
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
                  {/* Value input for variable OR confirm for fixed */}
                  <div style={{ display:"flex",gap:8,alignItems:"center" }}>
                    <input
                      type="number" step="0.01" min="0" placeholder={isFixed ? String(rule.amount) : "Quanto foi?"}
                      value={pendingAmt[rem.id] ?? (isFixed ? String(rule.amount) : "")}
                      onChange={e => setPendingAmt(p => ({ ...p, [rem.id]: e.target.value }))}
                      style={{ flex:1,padding:"9px 12px",borderRadius:10,border:`1px solid ${t.border}`,background:t.inputBg,color:t.text,fontSize:13,outline:"none",boxSizing:"border-box" }}
                    />
                    <button onClick={() => confirmReminder(rem, rule)} disabled={isConfirming}
                      style={{ background:t.success,border:"none",borderRadius:10,padding:"9px 16px",cursor:"pointer",color:"#fff",fontSize:12,fontWeight:700,whiteSpace:"nowrap",opacity:isConfirming?0.7:1 }}>
                      {isConfirming ? "..." : "✓ Confirmar"}
                    </button>
                    <button onClick={() => skipReminder(rem)} title="Ignorar este mês"
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
                  <span style={{ fontSize:13,fontWeight:700,color:t.success }}>{fmt(rem.amount)}</span>
                </div>
              );
            })}
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
              return (
                <div key={rule.id} style={{
                  display:"flex",alignItems:"center",gap:12,padding:"12px 14px",
                  borderRadius:14,background:t.surface,border:`1px solid ${rule.active ? t.border : t.border}`,
                  opacity: rule.active ? 1 : 0.55,
                }}>
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
                    <button onClick={() => deleteRule(rule)} title="Remover"
                      style={{ background:"transparent",border:`1px solid ${t.border}`,borderRadius:8,width:30,height:30,cursor:"pointer",color:t.textMuted,fontSize:13,display:"flex",alignItems:"center",justifyContent:"center" }}
                      onMouseEnter={e=>e.currentTarget.style.color=t.danger}
                      onMouseLeave={e=>e.currentTarget.style.color=t.textMuted}>🗑</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

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
          <h3 style={{ margin:0,fontSize:17,fontWeight:800,color:t.text,fontFamily:"'Sora', sans-serif" }}>
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

        <Input label="Data de término (opcional)" t={t} type="date" value={form.end_date} onChange={e=>set("end_date",e.target.value)} style={{ height:44,padding:"11px 14px" }} />

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
    Promise.all([
      supabaseFetch(`/recurring_reminders?family_id=eq.${family.family_id}&month=eq.${curMonth}&year=eq.${curYear}&status=eq.pending&select=*,recurring_expenses(*)`),
    ]).then(([rems]) => setPending(rems || [])).catch(() => {});
  }, [family, isDemo]);

  if (!pending.length) return null;

  return (
    <div style={{ background:t.warningSoft,border:`1px solid ${t.warning}44`,borderRadius:16,padding:"14px 18px",cursor:"pointer" }} onClick={onGoToRecurring}>
      <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8 }}>
        <span style={{ fontSize:13,fontWeight:700,color:t.warning }}>🔔 {pending.length} conta{pending.length>1?"s":""} aguardando valor</span>
        <span style={{ fontSize:12,color:t.accent,fontWeight:700 }}>Registrar →</span>
      </div>
      <div style={{ display:"flex",flexWrap:"wrap",gap:6 }}>
        {pending.slice(0,4).map(rem => {
          const rule = rem.recurring_expenses;
          const cat  = CATEGORIES.find(c => c.id === rule?.category);
          return (
            <span key={rem.id} style={{ fontSize:11,background:t.surface,border:`1px solid ${t.border}`,borderRadius:8,padding:"3px 8px",color:t.text }}>
              {cat?.emoji} {rule?.description}
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
          <span style={{ fontFamily:"'Sora',sans-serif",fontWeight:700,fontSize:16,color:t.text,minWidth:140,textAlign:"center" }}>
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
                            style={{ background:budget?t.surfaceHover:t.accentSoft,border:`1px solid ${budget?t.border:t.accent+"33"}`,borderRadius:8,padding:"3px 10px",cursor:"pointer",fontSize:11,fontWeight:700,color:budget?t.textMuted:t.accent,whiteSpace:"nowrap" }}>
                            {budget ? "✏️ Editar" : "+ Definir"}
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

// ─── SUMMARY CARDS ────────────────────────────────────────────────────────────
function SummaryCards({ expenses, incomes, t }) {
  const prefix=`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}`;
  // Use monthlyAmount: for credit installments, amount is already the monthly value
  const monthExp=expenses.filter(e=>e.date?.startsWith(prefix)).reduce((s,e)=>s+(parseFloat(e.amount)||0),0);
  const monthInc=incomes.filter(i=>i.date?.startsWith(prefix)).reduce((s,i)=>s+(parseFloat(i.amount)||0),0);
  const balance=monthInc-monthExp;
  // Parcelas futuras: amount = valor de cada parcela, parcelas = total de parcelas
  // Calcular quantas parcelas ainda faltam (a partir do mês atual inclusive)
  const creditPending = (() => {
    const nowYr = today.getFullYear(), nowMo = today.getMonth();
    return expenses.reduce((sum, e) => {
      const p = parseInt(e.parcelas) || 1;
      // Defensive: trim and lowercase to avoid type mismatch
      if ((e.type||"").trim().toLowerCase() !== "credito" || p <= 1) return sum;
      const installment = parseFloat(e.amount) || 0;
      if (!e.date || installment <= 0) return sum;
      const parts = e.date.slice(0,7).split("-");
      const startYr = parseInt(parts[0]), startMo = parseInt(parts[1]) - 1;
      // How many installments have already been charged (months before current month)
      const elapsed = (nowYr - startYr) * 12 + (nowMo - startMo);
      // Remaining = installments not yet paid (current month onward)
      const remaining = Math.max(0, p - elapsed);
      return sum + installment * remaining;
    }, 0);
  })();
  const cards=[
    { label:"Receitas do Mês",value:fmt(monthInc),color:t.success,bg:t.successSoft,border:`${t.success}33`,icon:"💰" },
    { label:"Gastos do Mês",value:fmt(monthExp),color:t.danger,bg:t.dangerSoft,border:`${t.danger}33`,icon:"💸" },
    { label:"Saldo",value:fmt(balance),color:balance>=0?t.success:t.danger,bg:balance>=0?t.successSoft:t.dangerSoft,border:`${balance>=0?t.success:t.danger}33`,icon:balance>=0?"📈":"📉" },
    { label:"Parcelas Futuras",value:fmt(creditPending),color:t.warning,bg:t.warningSoft,border:`${t.warning}33`,icon:"💳" },
  ];
  return (
    <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(180px, 1fr))",gap:14 }}>
      {cards.map(c=>(
        <div key={c.label} style={{ background:c.bg,border:`1px solid ${c.border}`,backdropFilter:"blur(12px)",borderRadius:18,padding:"18px 20px",transition:"transform 0.2s" }}
          onMouseEnter={e=>e.currentTarget.style.transform="translateY(-2px)"}
          onMouseLeave={e=>e.currentTarget.style.transform="translateY(0)"}
        >
          <div style={{ fontSize:24,marginBottom:10 }}>{c.icon}</div>
          <div style={{ fontSize:11,fontWeight:700,color:t.textMuted,letterSpacing:"0.06em",marginBottom:6 }}>{c.label.toUpperCase()}</div>
          <div style={{ fontSize:20,fontWeight:800,color:c.color,fontFamily:"'Sora', sans-serif" }}>{c.value}</div>
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

  // ── Extract text from PDF using AI ──
  const extractPDF = async (file) => {
    setLoading(true); setLoadingMsg("📄 Lendo PDF...");
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const base64 = e.target.result.split(",")[1];
          const res = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: "claude-sonnet-4-20250514",
              max_tokens: 4000,
              messages: [{
                role: "user",
                content: [
                  { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } },
                  { type: "text", text: "Extraia todas as transações financeiras deste extrato bancário e retorne como CSV com colunas: data,descricao,valor,tipo. Retorne APENAS o CSV sem explicações." }
                ]
              }]
            }),
          });
          const data = await res.json();
          resolve(data.content?.[0]?.text || "");
        } catch(err) { reject(err); }
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

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
  const handleFile = async (file) => {
    if (!file) return;
    setFileName(file.name);
    const ext = file.name.split(".").pop().toLowerCase();
    setStep("mapping"); setLoading(true);

    try {
      let textData = "";
      if (ext === "csv" || ext === "txt") {
        setLoadingMsg("📄 Lendo CSV...");
        textData = await file.text();
      } else if (ext === "xlsx" || ext === "xls") {
        setLoadingMsg("📊 Lendo planilha Excel...");
        const buf = await file.arrayBuffer();
        const { read, utils } = await import("https://cdn.sheetjs.com/xlsx-0.20.0/package/xlsx.mjs");
        const wb = read(buf);
        const ws = wb.Sheets[wb.SheetNames[0]];
        textData = utils.sheet_to_csv(ws);
      } else if (ext === "pdf") {
        textData = await extractPDF(file);
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

  // ── AI mapping via Supabase Edge Function (avoids CORS/auth issues) ──
  const analyzeWithAI = async (textData, filename) => {
    setLoadingMsg("🤖 Mapeando dados com IA...");

    try {
      // Call our Edge Function — it holds the Anthropic API key server-side
      const res = await fetch(`${SUPABASE_URL}/functions/v1/analyze-import`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${_authToken || SUPABASE_ANON_KEY}`,
          "apikey": SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ textData, filename }),
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
    const expensesWithId = expenses.map(e => ({ ...e, id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}` }));
    const incomesWithId  = incomes.map(i => ({ ...i, id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}` }));
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
        <h2 style={{ margin: "0 0 6px", fontFamily: "'Sora', sans-serif", fontSize: 22, fontWeight: 800, color: t.text }}>📥 Importar Lançamentos</h2>
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
      <div style={{ fontFamily: "'Sora', sans-serif", fontSize: 18, fontWeight: 700, color: t.text, textAlign: "center" }}>{loadingMsg || "Processando..."}</div>
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
            <h2 style={{ margin: "0 0 4px", fontFamily: "'Sora', sans-serif", fontSize: 20, fontWeight: 800, color: t.text }}>📋 Revisar Importação</h2>
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
              <div style={{ fontSize: 20, fontWeight: 800, color: s.color, fontFamily: "'Sora', sans-serif" }}>{s.value}</div>
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
        <h2 style={{ margin: "0 0 8px", fontFamily: "'Sora', sans-serif", fontSize: 24, fontWeight: 800, color: t.text }}>Importação concluída!</h2>
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
            <div style={{ fontSize:34,fontWeight:800,color:t.accent,fontFamily:"'Sora', sans-serif",letterSpacing:"0.3em" }}>
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

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [darkMode, setDarkMode] = useState(true);
  const [initializing, setInitializing] = useState(() => !!localStorage.getItem("sb_token"));
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [family, setFamily] = useState(null);
  const [familyMembers, setFamilyMembers] = useState([]);
  const [tab, setTab] = useState("dashboard");
  const [expenses, setExpenses] = useState([]);
  const [incomes, setIncomes] = useState([]);
  const [modal, setModal] = useState(null);
  const [calendarDate, setCalendarDate] = useState(null); // date selected in CalendarView
  const [showInvite, setShowInvite] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);

  const t = themes[darkMode ? "dark" : "light"];
  const isDemo = SUPABASE_URL.includes("YOUR_PROJECT");

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

  // Restore session from localStorage on page load
  useEffect(() => {
    const token = localStorage.getItem("sb_token");
    if (!token || isDemo) { setInitializing(false); return; }
    fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { "apikey": SUPABASE_ANON_KEY, "Authorization": `Bearer ${token}` }
    })
    .then(r => r.ok ? r.json() : Promise.reject())
    .then(async u => {
      if (!u?.id) { setInitializing(false); return; }
      setAuthToken(token, localStorage.getItem("sb_refresh"));
      const fam = await getOrCreateFamily(u.id).catch(() => null);
      if (!fam) { setInitializing(false); return; }
      setUser(u);
      setFamily(fam);
      try {
        const rows = await supabaseFetch(`/profiles?id=eq.${u.id}&select=first_name,last_name,phone`);
        if (rows?.[0]) setProfile(rows[0]);
      } catch {}
      try {
        const members = await supabaseRpc("get_family_members_with_profiles");
        setFamilyMembers(Array.isArray(members) ? members : []);
      } catch {}
      setInitializing(false);
    })
    .catch(() => { setAuthToken(null); setInitializing(false); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadData = useCallback(async () => {
    if (isDemo||!user||!family) return;
    try {
      const [exp,inc]=await Promise.all([
        supabaseFetch(`/expenses?family_id=eq.${family.family_id}&select=*&order=date.desc`),
        supabaseFetch(`/incomes?family_id=eq.${family.family_id}&select=*&order=date.desc`),
      ]);
      setExpenses(exp||[]); setIncomes(inc||[]);
    } catch { addToast("Erro ao carregar dados","error"); }
  }, [user, family, isDemo, addToast]);

  useEffect(()=>{ if(user&&family) loadData(); },[user,family,loadData]);

  const handleLogin=async(u, token, fam)=>{
    setUser(u);
    setFamily(fam);
    if(isDemo){
      addToast("Dados de exemplo carregados!","info");
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

  const handleLogout=()=>{
    setAuthToken(null); setUser(null); setFamily(null); setProfile(null); setFamilyMembers([]);
    setExpenses([]); setIncomes([]);
    addToast("Saiu com sucesso","info");
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
            user_label: data.user_label,
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
    if(!window.confirm(`Remover ${ids.length} gasto(s)? Esta ação não pode ser desfeita.`)) return;
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
    if(!window.confirm(`Remover ${ids.length} receita(s)? Esta ação não pode ser desfeita.`)) return;
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
    {id:"dashboard",label:"Dashboard",icon:"🏠"},
    {id:"calendar",label:"Calendário",icon:"📅"},
    {id:"charts",label:"Gráficos",icon:"📊"},
    {id:"budget",label:"Orçamento",icon:"🎯"},
    {id:"recurring",label:"Recorrentes",icon:"🔁"},
    {id:"transactions",label:"Lançamentos",icon:"📋"},
    {id:"import",label:"Importar",icon:"📥"},
  ];

  const css=`
    @import url('https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700;800&family=DM+Sans:wght@400;500;600;700&display=swap');
    *{box-sizing:border-box;margin:0;padding:0;}
    html{-webkit-text-size-adjust:100%;touch-action:manipulation;}
    body{font-family:'DM Sans',sans-serif;background:${t.bg};-webkit-overflow-scrolling:touch;}
    @keyframes fadeInUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
    @keyframes slideInRight{from{opacity:0;transform:translateX(24px)}to{opacity:1;transform:translateX(0)}}
    @keyframes modalIn{from{opacity:0;transform:scale(0.95) translateY(10px)}to{opacity:1;transform:scale(1) translateY(0)}}
    ::-webkit-scrollbar{width:6px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:rgba(124,106,247,0.3);border-radius:3px}
    input[type=date]::-webkit-calendar-picker-indicator{opacity:0.7;cursor:pointer;filter:${darkMode?"brightness(0) saturate(100%) invert(96%) sepia(5%) saturate(200%) hue-rotate(200deg) brightness(105%)":"brightness(0) saturate(100%) invert(8%) sepia(20%) saturate(800%) hue-rotate(215deg) brightness(90%)"}}
    input[type=date]::-webkit-calendar-picker-indicator:hover{opacity:1}
    input[type=date]{width:100%!important;max-width:100%!important;box-sizing:border-box!important;text-align:left!important;-webkit-appearance:none!important;appearance:none!important;padding:11px 14px!important;}
    input[type=date]::-webkit-date-and-time-value{text-align:left!important;}
    @media(max-width:600px){
      .mobile-hide{display:none!important;}
      .mobile-nav-label{display:none!important;}
    }
    @media(min-width:601px){
      .desktop-hide{display:none!important;}
    }
    @media(max-width:900px){
      .nav-label{display:none!important;}
    }
    @media(max-width:700px) and (min-width:601px){
      .nav-logo-text{display:none!important;}
    }
  `;

  if (initializing) return (
    <><style>{css + `
      @keyframes shimmer{0%{background-position:-400px 0}100%{background-position:400px 0}}
      .sk{border-radius:10px;background:linear-gradient(90deg,${t.surface} 25%,${t.surfaceHover} 50%,${t.surface} 75%);background-size:800px 100%;animation:shimmer 1.4s infinite linear;}
    `}</style>
    <div style={{ minHeight:"100vh",background:t.bg,fontFamily:"'DM Sans',sans-serif" }}>
      {/* Skeleton nav */}
      <div style={{ height:64,background:`${t.bg}ee`,borderBottom:`1px solid ${t.border}`,display:"flex",alignItems:"center",padding:"0 20px",gap:16,maxWidth:900,margin:"0 auto" }}>
        <div className="sk" style={{ width:32,height:32,borderRadius:10 }} />
        <div className="sk" style={{ width:160,height:20,borderRadius:8 }} />
        <div style={{ flex:1 }} />
        <div className="sk" style={{ width:80,height:32,borderRadius:10 }} />
        <div className="sk" style={{ width:32,height:32,borderRadius:10 }} />
      </div>
      <div style={{ maxWidth:900,margin:"0 auto",padding:"32px 20px" }}>
        {/* Skeleton summary cards */}
        <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:14,marginBottom:28 }}>
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
        {/* Skeleton list rows */}
        <div style={{ background:t.surface,border:`1px solid ${t.border}`,borderRadius:20,padding:24 }}>
          <div className="sk" style={{ width:140,height:16,borderRadius:8,marginBottom:20 }} />
          {[1,2,3,4,5].map(i=>(
            <div key={i} style={{ display:"flex",alignItems:"center",gap:12,padding:"12px 0",borderBottom:i<5?`1px solid ${t.border}`:"none" }}>
              <div className="sk" style={{ width:36,height:36,borderRadius:10,flexShrink:0 }} />
              <div style={{ flex:1 }}>
                <div className="sk" style={{ width:`${45+i*8}%`,height:13,borderRadius:6,marginBottom:6 }} />
                <div className="sk" style={{ width:`${25+i*5}%`,height:10,borderRadius:5 }} />
              </div>
              <div className="sk" style={{ width:70,height:16,borderRadius:6 }} />
            </div>
          ))}
        </div>
      </div>
    </div>
    <Toast toasts={toasts} remove={removeToast} /></>
  );

  if (!user) return <><style>{css}</style><LoginPage t={t} darkMode={darkMode} onLogin={handleLogin} addToast={addToast} /><Toast toasts={toasts} remove={removeToast} /></>;

  return (
    <>
      <style>{css}</style>
      <div style={{ minHeight:"100vh",background:t.bg }}>
        <div style={{ position:"fixed",width:500,height:500,borderRadius:"50%",background:`radial-gradient(circle, ${t.accentGlow} 0%, transparent 70%)`,top:-150,right:-150,pointerEvents:"none",zIndex:0 }} />
        <div style={{ position:"fixed",width:300,height:300,borderRadius:"50%",background:`radial-gradient(circle, ${t.successSoft} 0%, transparent 70%)`,bottom:50,left:-50,pointerEvents:"none",zIndex:0 }} />

        <nav style={{ position:"sticky",top:0,zIndex:100,background:`${t.bg}ee`,backdropFilter:"blur(20px)",WebkitBackdropFilter:"blur(20px)",borderBottom:`1px solid ${t.border}` }}>
          {/* ── Desktop nav ── */}
          <div className="mobile-hide" style={{ maxWidth:1100,margin:"0 auto",padding:"0 16px",height:64,display:"flex",alignItems:"center",gap:8 }}>
            {/* Logo — compact */}
            <div style={{ display:"flex",alignItems:"center",gap:8,flexShrink:0 }}>
              <span style={{ fontSize:20 }}>💎</span>
              <span className="nav-logo-text" style={{ fontFamily:"'Sora', sans-serif",fontWeight:800,fontSize:15,color:t.text,letterSpacing:"-0.02em",whiteSpace:"nowrap" }}>Finanças do Casal</span>
            </div>

            {/* Separator */}
            <div style={{ width:1,height:24,background:t.border,flexShrink:0 }} />

            {/* All secondary tabs centered */}
            <div style={{ flex:1,display:"flex",justifyContent:"center",gap:2,overflow:"hidden",minWidth:0 }}>
              {tabs.filter(tb=>["budget","recurring","transactions","import"].includes(tb.id)).map(tb=>(
                <button key={tb.id} onClick={()=>setTab(tb.id)}
                  title={tb.label}
                  style={{ padding:"6px 10px",borderRadius:9,border:"none",cursor:"pointer",fontSize:12,fontWeight:600,display:"flex",alignItems:"center",gap:4,whiteSpace:"nowrap",fontFamily:"'DM Sans', sans-serif",transition:"all 0.2s",flexShrink:1,minWidth:0,background:tab===tb.id?t.accent:"transparent",color:tab===tb.id?"#fff":t.textMuted,boxShadow:tab===tb.id?`0 2px 10px ${t.accentGlow}`:"none" }}
                  onMouseEnter={e=>{ if(tab!==tb.id){ e.currentTarget.style.background=t.surfaceHover; e.currentTarget.style.color=t.text; }}}
                  onMouseLeave={e=>{ if(tab!==tb.id){ e.currentTarget.style.background="transparent"; e.currentTarget.style.color=t.textMuted; }}}>
                  <span>{tb.icon}</span>
                  <span className="nav-label">{tb.label}</span>
                </button>
              ))}
            </div>

            {/* Separator */}
            <div style={{ width:1,height:24,background:t.border,flexShrink:0 }} />

            {/* Right: theme toggle + user avatar menu */}
            <div style={{ display:"flex",alignItems:"center",gap:6,flexShrink:0 }}>
              {isDemo&&<span style={{ fontSize:11,background:t.warningSoft,color:t.warning,padding:"3px 8px",borderRadius:6,fontWeight:700,border:`1px solid ${t.warning}33` }}>DEMO</span>}

              {/* Dark/light toggle — icon only */}
              <button onClick={()=>setDarkMode(!darkMode)}
                title={darkMode?"Modo claro":"Modo escuro"}
                style={{ background:"transparent",border:`1px solid ${t.border}`,borderRadius:9,width:34,height:34,cursor:"pointer",color:t.text,fontSize:15,display:"flex",alignItems:"center",justifyContent:"center",transition:"all 0.2s" }}
                onMouseEnter={e=>e.currentTarget.style.background=t.surfaceHover}
                onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                {darkMode?"☀️":"🌙"}
              </button>

              {/* Avatar button — opens user dropdown */}
              {!isDemo && user && (
                <div style={{ position:"relative",zIndex:9997 }}>
                  <button onClick={e=>{ e.stopPropagation(); setShowUserMenu(v=>!v); }}
                    style={{ background:t.accentSoft,border:`1px solid ${t.accent}33`,borderRadius:9,padding:"5px 10px",cursor:"pointer",color:t.accent,fontSize:12,fontWeight:700,display:"flex",alignItems:"center",gap:6,transition:"all 0.2s" }}
                    onMouseEnter={e=>e.currentTarget.style.background=t.accent+"22"}
                    onMouseLeave={e=>e.currentTarget.style.background=t.accentSoft}>
                    <span style={{ width:22,height:22,borderRadius:"50%",background:t.accent,color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:800,flexShrink:0 }}>
                      {(profile?.first_name||"U")[0].toUpperCase()}
                    </span>
                    {profile?.first_name || "Conta"}
                    <span style={{ fontSize:10,opacity:0.7 }}>▼</span>
                  </button>

                  {/* Backdrop to close menu on outside click */}
                  {showUserMenu && (
                    <div onClick={()=>setShowUserMenu(false)}
                      style={{ position:"fixed",inset:0,zIndex:9998 }} />
                  )}
                  {/* Dropdown */}
                  {showUserMenu && (
                    <div onClick={e=>e.stopPropagation()}
                      style={{ position:"absolute",top:"calc(100% + 8px)",right:0,background:t.glassModal,border:`1px solid ${t.glassBorder}`,borderRadius:14,padding:8,minWidth:190,boxShadow:t.shadow,zIndex:9999,animation:"fadeInUp 0.15s ease" }}>
                      <div style={{ padding:"8px 12px",borderBottom:`1px solid ${t.border}`,marginBottom:6 }}>
                        <div style={{ fontSize:12,fontWeight:700,color:t.text }}>{profile?.first_name} {profile?.last_name}</div>
                        <div style={{ fontSize:11,color:t.textMuted,marginTop:1 }}>{user?.email}</div>
                      </div>
                      <button onClick={()=>{ setShowProfile(true); setShowUserMenu(false); }}
                        style={{ width:"100%",padding:"8px 12px",borderRadius:8,border:"none",cursor:"pointer",fontSize:12,fontWeight:600,textAlign:"left",display:"flex",alignItems:"center",gap:8,background:"transparent",color:t.text,transition:"background 0.15s" }}
                        onMouseEnter={e=>e.currentTarget.style.background=t.surfaceHover}
                        onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                        👤 Meu Perfil
                      </button>
                      {family && (
                        <button onClick={()=>{ setShowInvite(true); setShowUserMenu(false); }}
                          style={{ width:"100%",padding:"8px 12px",borderRadius:8,border:"none",cursor:"pointer",fontSize:12,fontWeight:600,textAlign:"left",display:"flex",alignItems:"center",gap:8,background:"transparent",color:t.text,transition:"background 0.15s" }}
                          onMouseEnter={e=>e.currentTarget.style.background=t.surfaceHover}
                          onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                          👥 Família
                        </button>
                      )}
                      <div style={{ height:1,background:t.border,margin:"6px 0" }} />
                      <button onClick={()=>{ handleLogout(); setShowUserMenu(false); }}
                        style={{ width:"100%",padding:"8px 12px",borderRadius:8,border:"none",cursor:"pointer",fontSize:12,fontWeight:600,textAlign:"left",display:"flex",alignItems:"center",gap:8,background:"transparent",color:t.danger,transition:"background 0.15s" }}
                        onMouseEnter={e=>e.currentTarget.style.background=t.dangerSoft}
                        onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                        🚪 Sair
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* ── Mobile nav ── */}
          <div className="desktop-hide" style={{ padding:"0 16px",height:64,display:"flex",alignItems:"center",justifyContent:"space-between" }}>
            <div style={{ display:"flex",alignItems:"center",gap:8 }}>
              <span style={{ fontSize:22 }}>💎</span>
              <span style={{ fontFamily:"'Sora', sans-serif",fontWeight:800,fontSize:16,color:t.text }}>Finanças do Casal</span>
            </div>
            <div style={{ display:"flex",alignItems:"center",gap:8 }}>
              <button onClick={()=>setDarkMode(!darkMode)} style={{ background:"transparent",border:"none",cursor:"pointer",color:t.text,fontSize:18,padding:4 }}>{darkMode?"☀️":"🌙"}</button>
              <button onClick={()=>setMobileMenu(v=>!v)}
                style={{ background:"transparent",border:`1px solid ${t.border}`,borderRadius:10,width:38,height:38,cursor:"pointer",color:t.text,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:5,padding:"8px 9px" }}>
                <span style={{ width:18,height:2,background:t.text,borderRadius:2 }} />
                <span style={{ width:18,height:2,background:t.text,borderRadius:2 }} />
                <span style={{ width:18,height:2,background:t.text,borderRadius:2 }} />
              </button>
            </div>
          </div>

          {/* Mobile dropdown: Lançamentos + Importar + Perfil + Família + Sair */}
          {mobileMenu && (
            <div className="desktop-hide" style={{ background:t.glassModal,borderTop:`1px solid ${t.border}`,padding:"12px 16px",display:"flex",flexDirection:"column",gap:8 }}>
              {[{id:"budget",icon:"🎯",label:"Orçamento"},{id:"recurring",icon:"🔁",label:"Recorrentes"},{id:"transactions",icon:"📋",label:"Lançamentos"},{id:"import",icon:"📥",label:"Importar"}].map(tb=>(
                <button key={tb.id} onClick={()=>{ setTab(tb.id); setMobileMenu(false); }}
                  style={{ padding:"12px 16px",borderRadius:12,border:"none",cursor:"pointer",fontSize:14,fontWeight:600,textAlign:"left",display:"flex",alignItems:"center",gap:10,background:tab===tb.id?t.accent:t.surfaceHover,color:tab===tb.id?"#fff":t.text }}>
                  {tb.icon} {tb.label}
                </button>
              ))}
              <div style={{ height:1,background:t.border,margin:"4px 0" }} />
              {!isDemo && user && (
                <button onClick={()=>{ setShowProfile(true); setMobileMenu(false); }}
                  style={{ padding:"12px 16px",borderRadius:12,border:`1px solid ${t.border}`,cursor:"pointer",fontSize:14,fontWeight:600,textAlign:"left",display:"flex",alignItems:"center",gap:10,background:"transparent",color:t.text }}>
                  👤 {profile?.first_name || "Perfil"}
                </button>
              )}
              {!isDemo && family && (
                <button onClick={()=>{ setShowInvite(true); setMobileMenu(false); }}
                  style={{ padding:"12px 16px",borderRadius:12,border:`1px solid ${t.accent}33`,cursor:"pointer",fontSize:14,fontWeight:600,textAlign:"left",display:"flex",alignItems:"center",gap:10,background:t.accentSoft,color:t.accent }}>
                  👥 Família
                </button>
              )}
              <button onClick={()=>{ handleLogout(); setMobileMenu(false); }}
                style={{ padding:"12px 16px",borderRadius:12,border:`1px solid ${t.border}`,cursor:"pointer",fontSize:14,fontWeight:600,textAlign:"left",display:"flex",alignItems:"center",gap:10,background:"transparent",color:t.textMuted }}>
                🚪 Sair
              </button>
            </div>
          )}
        </nav>

        {/* Desktop bottom tab bar: Dashboard, Calendário, Gráficos */}
        <div className="mobile-hide" style={{ maxWidth:900,margin:"0 auto",padding:"0 20px" }}>
          <div style={{ display:"flex",gap:4,padding:"14px 0 0",justifyContent:"center" }}>
            {tabs.filter(tb=>["dashboard","calendar","charts"].includes(tb.id)).map(tb=>(
              <button key={tb.id} onClick={()=>setTab(tb.id)}
                style={{ padding:"9px 18px",borderRadius:12,border:"none",cursor:"pointer",fontSize:13,fontWeight:600,display:"flex",alignItems:"center",gap:6,whiteSpace:"nowrap",transition:"all 0.2s",background:tab===tb.id?t.accent:t.surfaceHover,color:tab===tb.id?"#fff":t.textMuted,boxShadow:tab===tb.id?`0 4px 14px ${t.accentGlow}`:"none" }}>
                {tb.icon} {tb.label}
              </button>
            ))}
          </div>
        </div>
        {/* Mobile tab bar: Dashboard, Calendário, Gráficos */}
        <div className="desktop-hide" style={{ maxWidth:900,margin:"0 auto",padding:"0 16px" }}>
          <div style={{ display:"flex",gap:4,padding:"12px 0 0",overflowX:"auto",WebkitOverflowScrolling:"touch" }}>
            {tabs.filter(tb=>["dashboard","calendar","charts"].includes(tb.id)).map(tb=>(
              <button key={tb.id} onClick={()=>setTab(tb.id)}
                style={{ padding:"9px 16px",borderRadius:12,border:"none",cursor:"pointer",fontSize:13,fontWeight:600,display:"flex",alignItems:"center",gap:6,whiteSpace:"nowrap",flexShrink:0,transition:"all 0.2s",background:tab===tb.id?t.accent:t.surfaceHover,color:tab===tb.id?"#fff":t.textMuted,boxShadow:tab===tb.id?`0 4px 14px ${t.accentGlow}`:"none" }}>
                {tb.icon} {tb.label}
              </button>
            ))}
          </div>
        </div>

        <main style={{ maxWidth:900,margin:"0 auto",padding:"24px 20px 120px",position:"relative",animation:"fadeInUp 0.3s ease" }}>
          {tab==="dashboard"&&(
            <div style={{ display:"flex",flexDirection:"column",gap:24 }}>
              <div>
                <h2 style={{ margin:"0 0 6px",fontFamily:"'Sora', sans-serif",fontSize:22,fontWeight:800,color:t.text }}>
                  Olá{profile?.first_name ? `, ${profile.first_name}` : ""}! 👋
                </h2>
                <p style={{ color:t.textMuted,fontSize:14 }}>Visão geral de {MONTH_FULL[today.getMonth()]} {today.getFullYear()}</p>
              </div>
              <SummaryCards expenses={expenses} incomes={incomes} t={t} />
              <BudgetAlertCard expenses={expenses} t={t} family={family} isDemo={isDemo} onGoToBudget={()=>setTab("budget")} />
              <RecurringAlertCard t={t} family={family} isDemo={isDemo} onGoToRecurring={()=>setTab("recurring")} />
              <div style={{ background:t.glassModal,border:`1px solid ${t.glassBorder}`,backdropFilter:"blur(16px)",borderRadius:20,padding:24 }}>
                <h3 style={{ margin:"0 0 20px",fontFamily:"'Sora', sans-serif",fontSize:16,fontWeight:700,color:t.text }}>📊 Últimos 6 meses</h3>
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
          {tab==="calendar"&&<CalendarView expenses={expenses} incomes={incomes} t={t} onDeleteExpense={deleteExpense} onDeleteIncome={deleteIncome} onEditExpense={editExpense} onEditIncome={editIncome} familyMembers={familyMembers} onDaySelect={d=>setCalendarDate(d)} />}
          {tab==="charts"&&<ChartsView expenses={expenses} incomes={incomes} t={t} />}
          {tab==="recurring"&&(
            <div style={{ display:"flex",flexDirection:"column",gap:0 }}>
              <div style={{ marginBottom:20 }}>
                <h2 style={{ margin:"0 0 6px",fontFamily:"'Sora', sans-serif",fontSize:22,fontWeight:800,color:t.text }}>🔁 Gastos Recorrentes</h2>
                <p style={{ color:t.textMuted,fontSize:14 }}>Aluguel, contas fixas, assinaturas e lembretes mensais</p>
              </div>
              <RecurringView expenses={expenses} setExpenses={setExpenses} t={t} family={family} user={user} isDemo={isDemo} addToast={addToast} familyMembers={familyMembers} />
            </div>
          )}
          {tab==="budget"&&(
            <div style={{ display:"flex",flexDirection:"column",gap:0 }}>
              <div style={{ marginBottom:20 }}>
                <h2 style={{ margin:"0 0 6px",fontFamily:"'Sora', sans-serif",fontSize:22,fontWeight:800,color:t.text }}>🎯 Orçamento Mensal</h2>
                <p style={{ color:t.textMuted,fontSize:14 }}>Defina limites de gastos por categoria e acompanhe em tempo real</p>
              </div>
              <BudgetView expenses={expenses} t={t} family={family} user={user} isDemo={isDemo} addToast={addToast} />
            </div>
          )}
          {tab==="transactions"&&<TransactionsList expenses={expenses} incomes={incomes} t={t} onDeleteExpense={deleteExpense} onDeleteIncome={deleteIncome} onDeleteAllExpenses={deleteAllExpenses} onDeleteAllIncomes={deleteAllIncomes} onEditExpense={editExpense} onEditIncome={editIncome} familyMembers={familyMembers} />}
          {tab==="import"&&<ImportView t={t} darkMode={darkMode} family={family} user={user} isDemo={isDemo} existingExpenses={expenses} existingIncomes={incomes} onImported={(exps,incs)=>{ setExpenses(p=>[...exps,...p]); setIncomes(p=>[...incs,...p]); }} addToast={addToast} />}
        </main>

        {/* FAB — hidden on import tab to avoid overlapping the review footer */}
        {tab !== "import" && (
          <div style={{ position:"fixed",bottom:28,right:24,zIndex:200,display:"flex",flexDirection:"column",gap:12,alignItems:"flex-end" }}>
            <Btn t={t} variant="success" onClick={()=>setModal("income")} style={{ borderRadius:16,width:148,height:48,fontSize:14 }}>+ Receita</Btn>
            <Btn t={t} onClick={()=>setModal("expense")} style={{ borderRadius:16,width:148,height:48,fontSize:14 }}>+ Gasto</Btn>
          </div>
        )}

        {/* Footer */}
        <footer style={{ borderTop:`1px solid ${t.border}`,marginTop:40,padding:"20px",textAlign:"center" }}>
          <div style={{ fontSize:12,color:t.textMuted }}>
            Desenvolvido com 💜 por Fernando Ghiberti em parceria com Claude IA · 2026
          </div>
        </footer>
      </div>

      {/* Expense / Income modals */}
      <Modal open={modal==="expense"} onClose={()=>setModal(null)} title="💸 Registrar Gasto" t={t} darkMode={darkMode}>
        <ExpenseForm t={t} onSave={saveExpense} onClose={()=>setModal(null)} familyMembers={familyMembers} initialDate={tab==="calendar"&&calendarDate?calendarDate:undefined} />
      </Modal>
      <Modal open={modal==="income"} onClose={()=>setModal(null)} title="💰 Registrar Receita" t={t} darkMode={darkMode}>
        <IncomeForm t={t} onSave={saveIncome} onClose={()=>setModal(null)} familyMembers={familyMembers} initialDate={tab==="calendar"&&calendarDate?calendarDate:undefined} />
      </Modal>

      {/* Invite code modal */}
      <Modal open={showInvite} onClose={()=>setShowInvite(false)} title="👥 Família" t={t} darkMode={darkMode}>
        {showInvite && <FamilyModal t={t} family={family} currentUserId={user?.id} familyMembers={familyMembers} setFamilyMembers={setFamilyMembers} onRegenCode={handleRegenCode} addToast={addToast} isAdmin={family?.role==="admin"} />}
      </Modal>

      <Modal open={showProfile} onClose={()=>setShowProfile(false)} title="👤 Meu Perfil" t={t} darkMode={darkMode}>
        <ProfileModal t={t} user={user} profile={profile} addToast={addToast} onSaved={(p)=>{ setProfile(p); setShowProfile(false); }} />
      </Modal>

      <Toast toasts={toasts} remove={removeToast} />
    </>
  );
}
