# Finanças do Casal — Contexto do Projeto

## Visão Geral
Aplicação web PWA para gestão financeira colaborativa de casais/famílias.
Cada membro registra gastos e receitas, visualiza calendário, gráficos e importa extratos.

**URL em produção:** https://financa-casal.vercel.app
**Repositório:** https://github.com/ghiberti85/financa-casal
**Autor:** Fernando Ghiberti (ghiberti85@gmail.com)

---

## Stack Tecnológica

| Camada | Tecnologia |
|---|---|
| Frontend | React 19, Vite 8, JSX (sem TypeScript) |
| Gráficos | Recharts 3 (PieChart, BarChart, LineChart) |
| Estilo | Inline styles + glassmorphism — sem Tailwind nem CSS modules |
| Backend | Supabase REST API (sem SDK — fetch direto com headers manuais) |
| Auth | Supabase Auth via JWT — access token em memória, refresh token em cookie HttpOnly via `/api/auth/*` |
| Planilhas | exceljs (bundle local, sem vulnerabilidades) para CSV/XLSX; PDF via Edge Function |
| IA | Claude Sonnet via Supabase Edge Function (Deno) para importação |
| Deploy | Vercel (auto-deploy no push para main) + API Routes serverless |

---

## Arquitetura

```
api/auth/
  login.js    ← POST /api/auth/login (Vercel serverless)
  signup.js   ← POST /api/auth/signup
  refresh.js  ← POST /api/auth/refresh (lê cookie HttpOnly)
  logout.js   ← POST /api/auth/logout (apaga cookie)
src/
  App.jsx     ← aplicação INTEIRA em um único arquivo (~5920 linhas)
  index.css   ← estilos globais base
  main.jsx    ← entry point React
public/
  favicon.svg
  og-image.svg
index.html    ← SEO, Open Graph, PWA meta tags
vercel.json   ← headers HTTP de segurança e CSP
vite.config.js
```

**Decisões arquiteturais deliberadas — não alterar sem discussão:**
- **Single file** (`src/App.jsx`) — toda lógica, componentes e estilos em um único arquivo. Facilita iteração rápida. É uma escolha intencional, não um débito técnico.
- **Sem SDK Supabase** — usa `fetch` direto para bundle menor e maior controle
- **Sem TypeScript** — projeto pessoal, velocidade de iteração prioritária
- **Sem Tailwind** — inline styles com objeto de tema `t` passado como prop
- **Estado local** com `useState`/`useMemo` — sem Zustand, Redux ou Context API

---

## Sistema de Autenticação

```javascript
// Access token: apenas em memória (nunca em localStorage em produção)
let _authToken = null; // produção
// Desenvolvimento: localStorage para conveniência (sem rotas Vercel disponíveis)

// Refresh automático quando token expira (401 → refreshAccessToken() → retry)
async function supabaseFetch(path, options, _retry = true)
async function supabaseRpc(fn, params)  // para funções SECURITY DEFINER
async function supabaseAuth(action, email, password)
```

**Fluxo de auth em produção:**
1. Login → `/api/auth/login` (Vercel) → refresh token em cookie `HttpOnly; Secure; SameSite=Strict`
2. Access token retornado no body → salvo apenas em `_authToken` (memória)
3. Toda requisição usa Bearer token da memória
4. 401 → `refreshAccessToken()` chama `/api/auth/refresh` → cookie HttpOnly enviado automaticamente → novo access token
5. Refresh falha → dispara evento `sb-session-expired` → volta para login
6. Logout → `/api/auth/logout` apaga o cookie server-side

**Fluxo de auth em desenvolvimento (`import.meta.env.DEV`):**
1. Login → Supabase Auth direto (sem rotas Vercel)
2. Tokens salvos em `localStorage` para conveniência local
3. Restore de sessão via `localStorage.getItem("sb_token")`

**Rotas Vercel (`api/auth/`):**

| Rota | Função |
|---|---|
| `POST /api/auth/login` | Autentica, define cookie HttpOnly, retorna access token |
| `POST /api/auth/signup` | Cadastra, define cookie HttpOnly, retorna access token |
| `POST /api/auth/refresh` | Lê cookie HttpOnly, renova sessão, rotaciona token |
| `POST /api/auth/logout` | Apaga o cookie de sessão |

---

## Banco de Dados (Supabase)

### Tabelas

```sql
families            (id, name, invite_code, created_at)
family_members      (id, family_id, user_id, role, joined_at)
                   role: 'admin' | 'member'

expenses            (id, family_id, user_id, description, amount, date,
                     category, type, parcelas, user_label, card_id, created_at)
                   type: 'pix' | 'debito' | 'credito'
                   amount: SEMPRE o valor da PARCELA, nunca o total
                   parcelas: número total de parcelas (null para não-parcelado)
                   card_id: FK para cards (nullable)

incomes             (id, family_id, user_id, description, amount, date,
                     source, category, user_label, created_at)

profiles            (id, first_name, last_name, phone, updated_at)

budgets             (id, family_id, category, amount, month — YYYY-MM)

cards               (id, family_id, name, holder, closing_day, due_day,
                     color, active, created_at)
                   closing_day: dia de fechamento da fatura
                   due_day: dia de vencimento da fatura

recurring_expenses  (id, family_id, user_id, description, amount, category,
                     type, frequency, day_of_month, month_of_year,
                     amount_type, active, end_date, created_at)
                   frequency: 'monthly' | 'weekly' | 'yearly'
                   amount_type: 'fixed' | 'variable'

recurring_reminders (id, family_id, recurring_id, month, year,
                     amount, status, expense_id, created_at)
                   status: 'pending' | 'confirmed' | 'skipped'
```

### Convenção crítica — crédito parcelado
`amount` em `expenses` = **valor da parcela**, não o total.
Total = `amount × parcelas` (calculado no frontend para exibição apenas).
Cada linha representa exatamente o custo daquele mês.

### Índices de unicidade (anti-duplicata)
```sql
UNIQUE INDEX idx_expenses_no_duplicates
  ON expenses (family_id, date, description, ROUND(amount::numeric, 2), category)

UNIQUE INDEX idx_incomes_no_duplicates
  ON incomes (family_id, date, description, ROUND(amount::numeric, 2), category)
```
Importação usa `ON CONFLICT DO NOTHING` — reimportar nunca cria duplicatas.

### Funções RPC (SECURITY DEFINER — bypassam RLS)
| Função | Parâmetros |
|---|---|
| `get_my_family()` | — |
| `create_family_for_user()` | p_user_id, p_family_name, p_invite_code |
| `join_family_by_code()` | p_user_id, p_invite_code |
| `get_family_members_with_profiles()` | — |
| `upsert_profile()` | p_first_name, p_last_name, p_phone |
| `update_member_role()` | p_member_id, p_role (protege último admin) |
| `regenerate_invite_code()` | p_family_id, p_new_code |

---

## Sistema de Temas

```javascript
const themes = { light: {...}, dark: {...} }
// Objeto 't' passado como prop para todos os componentes
// Contém: bg, surface, surfaceHover, glass, glassModal, glassBorder,
//         text, textMuted, textSecondary, accent, accentGlow, accentSoft,
//         success, successSoft, danger, dangerSoft, warning, warningSoft,
//         border, shadow, shadowSm, inputBg, tooltipBg,
//         chartColors, chartCursorFill, innerGlow
```

Todos os componentes recebem `t` como prop e usam inline styles.
Não existe classe CSS — tudo é `style={{ color: t.text }}`.

---

## Sistema de Ícones

```javascript
const ICON_PATHS = {
  home, calendar, chart, pieChart, list, target, repeat,
  upload, download, plus, minus, more, search, x, trash,
  edit, check, filter, sun, moon, user, users, card, logout,
  chevronLeft, chevronRight, chevronDown, arrowUp, arrowDown,
  wallet, bell, menuLines
}

function Icon({ name, size=20, color="currentColor", style }) { ... }
```

- Todos os ícones de ação da UI usam `<Icon>` — nunca emojis
- Emojis de conteúdo (categorias, títulos de seção, toasts) são permitidos
- Para adicionar: inserir novo entry em `ICON_PATHS` com path SVG Lucide

---

## Hooks Utilitários

```javascript
// Long-press com vibração
function useLongPress(onTrigger, ms = 500)
// Retorna: { pressingId, start(id), cancel() }
// Ao completar: chama onTrigger(id) e navigator.vibrate(30)

// Debounce de valor para buscas
function useDebounce(value, delay = 300)
// Retorna: debouncedValue
```

---

## Componentes em App.jsx

| Componente | Descrição |
|---|---|
| `App` | Root — auth, estado global, roteamento por tabs |
| `LoginPage` | Login/cadastro + fluxo de perfil e família (3 etapas) |
| `LoginCard` | Wrapper visual do card de login (subcomponente) |
| `LoginLogo` | Logo + título da tela de login (subcomponente) |
| `Icon` | Ícone SVG inline via `ICON_PATHS` (Lucide-inspired) |
| `ConfirmModal` | Modal de confirmação glassmorphism via `createPortal` (substitui `window.confirm`) |
| `Highlight` | Destaque de trecho de texto em resultados de busca |
| `SummaryCards` | Cards: Receitas, Gastos, Saldo, Parcelas Futuras |
| `SummaryCardsSkeleton` | Skeleton de carregamento para SummaryCards |
| `CalendarView` | Calendário mensal com indicadores e painel de detalhes |
| `CalendarPickerModal` | Seletor de data customizado (sem input[type=date] nativo) |
| `DateInput` | Input de data que abre CalendarPickerModal |
| `ChartsView` | Gráficos: receitas×gastos, donut categorias, linha parcelas |
| `ChartsViewSkeleton` | Skeleton de carregamento para ChartsView |
| `TransactionsList` | Lista com filtros, agrupamento por data, busca, seleção em massa, duplicatas |
| `TransactionsListSkeleton` | Skeleton de carregamento para TransactionsList |
| `ImportView` | Upload CSV/XLSX/PDF + preview + detecção de duplicatas |
| `ExpenseForm` | Gasto: PIX/Débito/Crédito parcelado + opção recorrente |
| `IncomeForm` | Receita: descrição, quem recebeu, categoria, valor, data |
| `EditModal` | Edição de gasto ou receita existente |
| `BudgetView` | Orçamento por categoria com barra de progresso |
| `BudgetAlertCard` | Alerta no dashboard quando orçamento > 80% |
| `RecurringView` | Lembretes mensais e confirmação de pagamentos |
| `RecurringForm` | Cadastro/edição de regra recorrente |
| `RecurringAlertCard` | Alerta de gastos recorrentes pendentes no dashboard |
| `CardsManager` | CRUD de cartões de crédito (nome, titular, fechamento, vencimento) |
| `BillingCard` | Card no dashboard com total da fatura do mês atual por cartão |
| `FamilyModal` | Código de convite, membros, papéis |
| `ProfileModal` | Edição de perfil com telefone e DDI |
| `MemberSelect` | Dropdown de membros da família |
| `Modal` | Wrapper de modal reutilizável (suporta bottom sheet no mobile) |
| `Input` | Input estilizado com label e foco no tema |
| `Select` | Select estilizado com label e tema |
| `Btn` | Botão com variantes: primary, ghost, danger, success |
| `Toast` | Sistema de notificações temporárias |

---

## Funções Utilitárias

```javascript
// Agrupa array de itens por data ISO (retorna [{date, label, items}])
function groupByDate(items)

// Formata data ISO para label relativo: "Hoje", "Ontem" ou "DD de Mês de AAAA"
function formatDateHeader(iso)

// Auto-categoriza descrição por palavras-chave (retorna id de CATEGORIES)
function autoCategory(description)

// Retorna { month, year } da fatura correspondente à data de compra
// Compra ≤ closingDay → fatura do mesmo mês; > closingDay → fatura do próximo
function getBillingMonth(dateStr, billingPeriods, closingDay)
```

---

## Tabs da Aplicação

```
dashboard    → SummaryCards + BillingCard + alertas + gráfico 6 meses
calendar     → CalendarView
charts       → ChartsView (receitas×gastos, categorias, parcelas)
budget       → BudgetView (orçamento por categoria)
recurring    → RecurringView (gastos fixos mensais)
transactions → TransactionsList
import       → ImportView
```

### Layout de Navegação

**Desktop (≥ 601px):**
- Sidebar rail fixa (64px colapsado, 210px expandido) com todos os 7 tabs como ícones SVG
- Topbar horizontal sticky com título da aba atual
- FABs fixos no canto inferior direito: "+ Receita" e "+ Gasto"
- User avatar no rodapé da sidebar → menu dropdown com `Icon` SVG (Perfil, Família, Cartões, Tema, Sair)

**Mobile (≤ 600px):**
- Topbar fixa (`56px + safe-area-inset-top`) com logo centralizado e badge DEMO
- Bottom bar fixa com 3 abas primárias (`dashboard`, `calendar`, `charts`) + FAB central ("+") + botão "Menu"
- Botão **Menu** abre `showMoreDrawer` (bottom sheet) com abas secundárias: Recorrentes, Orçamento, Lançamentos, Importar + links para Perfil, Família, Cartões, Tema, Sair
- FAB central abre `showFabSheet` com "+ Gasto" e "+ Receita"
- `env(safe-area-inset-bottom)` garante que a bottom bar não fique atrás do home indicator do iPhone
- Barras flutuantes de ação usam `bottom: "calc(64px + env(safe-area-inset-bottom) + 10px)"`

### Animações CSS (keyframes em `<style>` no App)

| Keyframe | Uso |
|---|---|
| `fadeInUp` | Entrada de conteúdo principal |
| `slideInRight` | Toast notifications |
| `slideInLeft` | — |
| `modalIn` | Entrada de modais |
| `sheetIn` | Entrada de sheets menores |
| `sheetUp` | Bottom sheet mobile (showMoreDrawer, showFabSheet) |
| `lpGlow` | Long-press: anima `box-shadow` de 0 a anel de 2.5px em 500ms |
| `shimmer` | Skeleton screens |

---

## Importação de Planilhas

**Parsers locais (sem IA):**
- `Annual_Expenses_*.csv` — categorias em linhas, dias do mês em colunas
- `Gastos_Anual.csv` — cartão de crédito, meses como colunas (DEZ, JAN...)

**IA via Edge Function:**
- Supabase Edge Function `analyze-import` (Deno runtime)
- Envia planilha para Claude Sonnet API
- Retorna JSON normalizado com mapeamento de colunas
- Ativada para formatos desconhecidos

**Preview antes de importar:**
- Filtros: Todos / Novos / Duplicatas
- Seleção individual ou em massa
- `ON CONFLICT DO NOTHING` garante idempotência

---

## Variáveis de Ambiente

```
VITE_SUPABASE_URL=https://SEU_PROJECT_ID.supabase.co
VITE_SUPABASE_ANON_KEY=sua_anon_key
```

Edge Function (Supabase Vault):
```
ANTHROPIC_API_KEY=sk-ant-...
```

---

## Modo Demo

A aplicação tem um modo demo (`isDemo`) que usa dados fake sem autenticação.
Verificar sempre `isDemo` antes de fazer chamadas ao Supabase.
```javascript
if (isDemo) {
  // usar dados locais
  return;
}
// chamar Supabase
```

---

## Categorias de Gastos

```javascript
const CATEGORIES = [
  { id: "alimentacao", label: "Alimentação",  emoji: "🍽️" },
  { id: "supermercado",label: "Supermercado", emoji: "🛒" },
  { id: "moradia",     label: "Moradia",      emoji: "🏠" },
  { id: "transporte",  label: "Transporte",   emoji: "🚗" },
  { id: "saude",       label: "Saúde",        emoji: "💊" },
  { id: "farmacia",    label: "Farmácia",     emoji: "💉" },
  { id: "filho",       label: "Filho",        emoji: "👶" },
  { id: "educacao",    label: "Educação",     emoji: "📚" },
  { id: "beleza",      label: "Beleza",       emoji: "💅" },
  { id: "vestuario",   label: "Vestuário",    emoji: "👕" },
  { id: "lazer",       label: "Lazer",        emoji: "🎬" },
  { id: "assinaturas", label: "Assinaturas",  emoji: "📱" },
  { id: "presentes",   label: "Presentes",    emoji: "🎁" },
  { id: "tecnologia",  label: "Tecnologia",   emoji: "💻" },
  { id: "outros",      label: "Outros",       emoji: "📦" },
];

const INCOME_SOURCES = [
  { id: "salario",     label: "Salário",      emoji: "💼" },
  { id: "freelance",   label: "Freelance",    emoji: "💡" },
  { id: "investimento",label: "Investimento", emoji: "📈" },
  { id: "aluguel",     label: "Aluguel",      emoji: "🏘️" },
  { id: "outros",      label: "Outros",       emoji: "💰" },
];
```

---

## Roadmap de Lançamento Público

**Status:** Em andamento — todas as etapas abaixo devem ser concluídas antes de abrir a aplicação para outros usuários.

> Contexto de custo: infraestrutura fica em ~R$242/mês fixos até ~3.000 assinantes. Margem líquida após Stripe (~5,3%) é de ~93% em escala. Break-even a partir de 9 assinantes a R$29,90/mês.

---

### Sprint 0 — Pré-requisitos de infraestrutura
*Fazer ANTES de qualquer desenvolvimento dos Sprints seguintes.*

- [ ] Upgrade Supabase para Pro (backups diários, PITR, PgBouncer connection pooling)
- [ ] Domínio próprio + DNS + SSL (ex: `financacasal.com.br`)
- [ ] Customizar templates de e-mail no Supabase para PT-BR (confirmação, reset, convite)
- [ ] `npm audit` + corrigir todas as vulnerabilidades críticas e altas

---

### Sprint 1 — Segurança e legal
*Bloqueadores de lançamento — sem esses itens a aplicação não pode ser aberta.*

- [ ] Auditar e documentar RLS policies no Supabase para todas as tabelas (`expenses`, `incomes`, `families`, `family_members`, `profiles`, `budgets`, `cards`, `recurring_expenses`, `recurring_reminders`)
- [ ] Ativar email confirmation no Supabase + tela "Verifique seu e-mail" no `LoginPage`
- [ ] "Esqueci minha senha" no `LoginPage` (link → e-mail de reset → tela de nova senha)
- [ ] Rate limiting no `api/auth/signup.js` (igual ao `login.js`: 10 tentativas / 15 min por IP)
- [ ] Página de Política de Privacidade (informar data residency: AWS us-east-1 via Supabase)
- [ ] Página de Termos de Uso + Política de Reembolso
- [ ] Cookie banner básico (LGPD)
- [ ] Botão "Excluir minha conta" no `ProfileModal` (delete em cascade no banco)
- [ ] DPA (Data Processing Agreement) com Supabase e Vercel — processo administrativo, não código
- [ ] Documento interno de resposta a incidentes (quem notifica, como, prazo 72h LGPD)

---

### Sprint 2 — Stripe e monetização

- [ ] Definir modelo de planos: trial 14 dias (acesso completo) → Pro pago → Free limitado
- [ ] Definir feature gating: o que é Free vs Pro (ex: histórico limitado a 3 meses, sem importação, sem recorrentes no Free)
- [ ] Atualizar CSP no `vercel.json` para incluir domínios Stripe (`js.stripe.com`, `hooks.stripe.com`, `*.stripe.com`)
- [ ] `api/stripe/create-checkout.js` — cria Stripe Checkout Session com trial
- [ ] `api/stripe/webhook.js` — handlers para `customer.subscription.created`, `invoice.payment_failed`, `customer.subscription.deleted` (**obrigatório:** verificar assinatura com `stripe.webhooks.constructEvent()`)
- [ ] `api/stripe/portal.js` — abre Customer Portal para gerenciar/cancelar assinatura
- [ ] Migração Supabase: adicionar `stripe_customer_id`, `subscription_status` (`'free'`|`'trial'`|`'active'`|`'past_due'`|`'canceled'`), `subscription_id`, `current_period_end` à tabela `profiles`
- [ ] `PaywallModal` no `App.jsx` + feature gating baseado em `profile.subscription_status`
- [ ] Canal de suporte mínimo: e-mail dedicado (ex: `suporte@financacasal.com.br`)

---

### Sprint 3 — Produto e conversão

- [ ] Empty state de onboarding no Dashboard quando não há dados (card "Comece por aqui" com ações primárias)
- [ ] E-mails transacionais via Resend: boas-vindas, confirmação de pagamento, trial expirando em 3 dias, pagamento falhou
- [ ] Landing page separada do app (fora do React SPA, ou rota `/`)
- [ ] Sentry para monitoramento de erros em produção (`VITE_SENTRY_DSN` como env var)

---

### Sprint 4 — Performance e alcance
*Pós-lançamento — melhorias incrementais.*

- [ ] Code splitting com `React.lazy()` + `Suspense` nas abas pesadas (`ImportView`, `ChartsView`) — reduz bundle inicial em ~40%
- [ ] Service worker básico para PWA offline (registrar gastos sem sinal)
- [ ] Acessibilidade mínima: ARIA labels em modais, `role` em elementos interativos, contraste de cores WCAG AA

---

## Roadmap de Features (pós-lançamento)

- [ ] Notificações push para vencimento de parcelas
- [ ] Metas financeiras mensais com progresso visual
- [ ] Exportação de relatórios em PDF
- [ ] Suporte a múltiplas moedas
- [ ] App mobile nativo (React Native)
- [ ] Testes automatizados
- [ ] Divisão do App.jsx em componentes separados (quando necessário)
