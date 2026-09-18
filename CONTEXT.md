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
| IA | Claude Sonnet via Supabase Edge Function (Deno) para importação e assistente financeiro |
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
  App.jsx     ← aplicação INTEIRA em um único arquivo (~6100 linhas)
  index.css   ← estilos globais base
  main.jsx    ← entry point React
public/
  favicon.svg            ← ícone SVG do app (diamante 5 facetas, gradiente roxo)
  apple-touch-icon.png   ← ícone PNG 180×180 para iOS home screen
  og-image.svg           ← imagem Open Graph 1200×630
.github/
  pull_request_template.md ← checklist automático em todo PR aberto no GitHub
.claude/
  commands/
    pr-check.md       ← /pr-check: roda checklist completo antes de abrir PR
    feature-plan.md   ← /feature-plan <nome>: planeja feature antes de codificar
    security-scan.md  ← /security-scan: varredura de segurança nas mudanças
index.html    ← SEO, Open Graph, PWA meta tags (apple-touch-icon aponta para o PNG)
vercel.json   ← headers HTTP de segurança e CSP
vite.config.js
CLAUDE.md     ← instruções, padrões e regras para o Claude Code
CONTEXT.md    ← contexto técnico completo (este arquivo)
DECISIONS.md  ← Architecture Decision Records (por que cada decisão foi tomada)
README.md     ← visão geral do projeto (inglês, para recrutadores)
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

**Recuperação de senha ("Esqueci minha senha") — ✅ Implementado (2026-09):**

Chamadas diretas ao GoTrue (Supabase Auth) a partir do frontend — não passam por `api/auth/*`, pois não criam sessão/cookie, apenas usam a chave anônima pública:

```javascript
async function supabaseRecoverPassword(email)      // POST /auth/v1/recover?redirect_to=<origin>
async function supabaseUpdatePassword(token, pass)  // PUT  /auth/v1/user  (Bearer = token de recovery)
function parseRecoveryHash()                        // lê #access_token=...&type=recovery do hash
```

Fluxo:
1. Usuário clica "Esqueceu sua senha?" no `LoginPage` (step `auth` → `forgot`) → informa e-mail → `supabaseRecoverPassword(email)`.
2. Supabase envia e-mail com link contendo `#access_token=...&type=recovery&refresh_token=...` no hash, redirecionando para `redirect_to` (a origem atual, `window.location.origin`) — **desde que essa URL esteja na allowlist de Redirect URLs do projeto no Supabase Studio**; caso contrário o GoTrue ignora o `redirect_to` e usa o Site URL padrão do projeto.
3. Ao abrir o link, `LoginPage` detecta o hash via `parseRecoveryHash()` em um `useEffect` de mount, limpa a URL imediatamente com `window.history.replaceState` (o token não deve ficar exposto na barra de endereço/histórico) e vai para o step `reset`.
4. Usuário define nova senha (mín. 6 caracteres, com confirmação) → `supabaseUpdatePassword(recoveryToken, newPassword)` → volta para o login.

**Limitação conhecida:** o token de recovery é curto (~1h) e escopado só para `PUT /auth/v1/user` — não gera cookie de sessão. Depois de trocar a senha, o usuário precisa fazer login normalmente (fluxo não faz auto-login).

---

## Banco de Dados (Supabase)

### Tabelas

```sql
families            (id, name, invite_code, created_at)
family_members      (id, family_id, user_id, role, joined_at)
                   role: 'admin' | 'member'

expenses            (id, family_id, user_id, description, amount, date,
                     category, type, parcelas, user_label, card_id,
                     split_group_id, created_at)
                   type: 'pix' | 'debito' | 'credito' | 'dinheiro'
                   amount: SEMPRE o valor da PARCELA, nunca o total
                   parcelas: número total de parcelas (null para não-parcelado)
                   card_id: FK para cards (nullable)
                   split_group_id: UUID compartilhado por dois registros de um
                                   pagamento dividido (nullable)

incomes             (id, family_id, user_id, description, amount, date,
                     source, category, user_label, created_at)

profiles            (id, first_name, last_name, phone, updated_at)

budgets             (id, family_id, category, amount, month — YYYY-MM)

goals               (id, family_id, description, target_amount,
                     current_amount, deadline, category, active,
                     created_at, updated_at)
                   target_amount/current_amount: numeric, sempre > 0 / >= 0
                   deadline: date, opcional
                   active: soft-delete-friendly, mas hoje o CRUD deleta
                     de verdade (DELETE) — ver GoalsView

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

billing_periods     (id, card_id, fatura_month, fatura_year,
                     period_start, period_end, due_date, total_pdf,
                     created_at)
                   Períodos de fatura cadastrados manualmente pelo usuário
                   ao fechar cada fatura no extrato do banco.
                   fatura_month/year: mês/ano de VENCIMENTO da fatura
                     (não o mês em que as compras aconteceram)
                   period_start/period_end: intervalo de datas de COMPRA
                     que cai nessa fatura (fechamento do cartão — varia
                     mês a mês, não segue um dia fixo mesmo com
                     cards.closing_day configurado)
                   total_pdf: valor real lido no extrato/PDF do banco,
                     usado como referência para conferir o total calculado
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
| `LoginPage` | Login + recuperação de senha (steps: auth, forgot, reset). Cadastro (mode `signup`, steps `profile`/`family_setup`) continua implementado mas sem entrada na UI — ver armadilha #24 |
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
| `ExpenseForm` | Gasto: PIX/Débito/Crédito/Dinheiro + parcelado + recorrente + pagamento dividido (split) |
| `IncomeForm` | Receita: descrição, quem recebeu, categoria, valor, data |
| `EditModal` | Edição de gasto ou receita existente |
| `BudgetView` | Orçamento por categoria com barra de progresso |
| `MonthlySummaryCard` | Resumo mensal algorítmico no dashboard (`buildMonthlySummary`): variação vs. mês anterior, categoria que mais cresceu, maior gasto único — layout de `StatRow` (rótulo + valor) |
| `StatRow` | Subcomponente de linha "rótulo em cima, valor embaixo" com badge de ícone — usado pelo `MonthlySummaryCard` para não deixar número órfão em quebra de linha no mobile |
| `AIAssistantCard` | Card de pergunta livre no dashboard — chama a Edge Function `financial-assistant`, que só narra dados já calculados no frontend (nunca faz conta sozinha). Tem chips de sugestão de pergunta e mostra erro inline com botão "Tentar de novo" |
| `BudgetAlertCard` | Alerta no dashboard quando orçamento > 80% |
| `GoalsView` | CRUD de metas financeiras com barra de progresso (tabela `goals`) |
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
- Botão **Menu** abre `showMoreDrawer` (bottom sheet) com abas secundárias: Recorrentes, **Lançamentos**, **Orçamento**, Importar + links para Perfil, Família, Cartões, Tema, Sair
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

## Assistente de IA (`AIAssistantCard`)

Card no Dashboard onde o usuário pergunta livremente sobre o mês, gastos ou metas.

**Arquitetura — cálculo determinístico vs. narrativa (decisão deliberada, ver o plano original desta feature):**
- Todo número (totais, variação, categoria que mais cresceu, progresso de metas, recorrentes pendentes) é calculado no **frontend** via `buildMonthlySummary`/`calcGoalProgress`/`getPendingRecurring` (`src/utils/finance.js`) e mandado **já pronto** pro backend.
- A Edge Function `financial-assistant` (Deno) só recebe esse resumo + a pergunta e gera a **narrativa** — nunca soma, nunca recalcula, nunca inventa número. Isso elimina a classe de erro mais perigosa (IA "alucinando" um saldo errado) e reduz MUITO o custo de tokens (manda um resumo compacto, não a lista crua de transações).
- Modelo: `claude-sonnet-5`, com `cache_control: ephemeral` no system prompt (fixo entre chamadas — barato de reusar).
- **Contexto enviado à IA (payload do POST):** `{ family_id, summary, goals, pendingRecurring, question, lang }`. `pendingRecurring` (✅ 2026-09) vem de `getPendingRecurring(recurringRules, recurringReminders, today)` — mesma regra de "não lançada nem ignorada este mês" usada em `RecurringAlertCard` — mapeado para `{ description, amount, category, day_of_month }` antes de enviar (nunca a linha crua da `recurring_expenses`).

**Segurança:**
- `verify_jwt: true` na Edge Function — exige JWT válido do Supabase.
- A função decodifica o JWT (`supabaseAdmin.auth.getUser`) e confirma que o usuário pertence à `family_id` que o frontend mandou, via `family_members` — nunca confia cegamente no `family_id` do body.
- **Rate limit de 20 perguntas/família/dia**, aplicado na tabela `assistant_usage` (incrementada pela própria Edge Function com service role, **antes** de chamar a Anthropic) — evita custo de API descontrolado.
- Chave da Anthropic só no Supabase Vault (`ANTHROPIC_API_KEY`, mesmo secret da `analyze-import`), nunca no frontend.
- Disclaimer fixo na UI: é uma ferramenta educacional, não consultoria financeira registrada — o próprio system prompt da IA reforça isso e recusa dar conselho de investimento.
- Modo demo (`isDemo`): nunca chama a Edge Function de verdade, mostra uma mensagem estática.

**Tabela `assistant_usage`:** `(id, family_id, day, count, updated_at)`, `UNIQUE(family_id, day)`. RLS: família só lê o próprio uso; só a Edge Function (service role) escreve.

**Testado com usuário real (2026-09):** fluxo autenticado de ponta a ponta (login real → pergunta → resposta da IA) confirmado funcionando em produção.

**Bug corrigido (2026-09) — respostas vazias/erro em toda pergunta real:** `financial-assistant` v2 usava `max_tokens: 500` e lia `data.content[0].text` direto. Modelos Sonnet 5 rodam *adaptive thinking* ligado por padrão, que consome do mesmo orçamento de `max_tokens` — com 500 tokens, o thinking podia consumir tudo antes de gerar texto visível, e mesmo quando sobrava texto, o primeiro bloco em `content[]` podia ser um bloco `thinking` (sem campo `.text`), fazendo a extração falhar. Corrigido na v3: `max_tokens: 1024`, `output_config: { effort: "low" }` (narrativa simples não precisa de raciocínio profundo) e busca o primeiro bloco com `type === "text"` em vez de indexar `[0]` cegamente. Também adicionado `console.error` nos dois pontos de falha (erro da Anthropic e resposta vazia) pra facilitar debug futuro via `query_logs`.

**UX mobile (2026-09):** `AIAssistantCard` empilha input + botão "Perguntar" em telas ≤600px (`.ai-ask-row`/`.ai-ask-btn`, botão full-width) em vez de ficarem espremidos lado a lado. Estado de loading mostra spinner + texto "Perguntando.../Pensando..." em vez de só "...". Chips de sugestão (`assistant.suggestions`) evitam ter que digitar no celular — clicar já dispara a pergunta. **Erro aparece dentro do card** (bloco vermelho com a mensagem + botão "Tentar de novo"), não mais só como toast: no mobile o toast cobre a tela e some sozinho, deixando o usuário sem saber o que houve.

**`MonthlySummaryCard` — layout de `StatRow` (2026-09):** antes cada linha era uma frase corrida ("Você gastou 38% a menos que mês passado"), que no mobile quebrava em 2 linhas e deixava o valor órfão, com o ícone desalinhado. Agora cada linha é badge de ícone + rótulo curto (11px, muted) + valor em negrito embaixo — o número nunca quebra no meio (`whiteSpace:"nowrap"` no valor monetário) e a leitura fica scaneável. As strings de i18n mudaram de funções de frase (`variation`, `topGrowing`, `biggest`) para rótulos + valores (`labelVariation`, `valueVariation`, `labelTopGrowing`, `labelBiggest`, `valueNew`).

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
  { id: "gyovana",     label: "Gyovana",      emoji: "💳" },
  { id: "metlife",     label: "MetLife",      emoji: "🛡️" },
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

## Workflow de Desenvolvimento

Todo código que vai a produção segue o fluxo abaixo sem exceção.

```
Branch → Código → Testes → Build → Segurança → Docs → PR → Merge → Deploy
```

### Fluxo passo a passo

| Passo | Comando / Ação | Critério de aceite |
|---|---|---|
| 1. Branch | `git checkout -b feat/nome` | Branch criada a partir de `main` atualizado |
| 2. Código | Editar `App.jsx` | Funcionalidade implementada |
| 3. Testes | `npm run test` | Todos os testes passam (quando implementados) |
| 4. Build | `npm run build` | Zero erros de compilação |
| 5. Segurança | Checar lista em CLAUDE.md | Nenhum item crítico falhando |
| 6. Docs | Atualizar CLAUDE.md + CONTEXT.md + README.md | Os três sincronizados com o código |
| 7. PR | Abrir PR descritivo no GitHub | Checklist do PR preenchido |
| 8. Merge | Squash merge para `main` | PR aprovado, sem conflitos |
| 9. Deploy | Vercel auto-deploy (~1 min) | Deploy concluído sem erros de runtime |

### Regra de testes por feature

Ao implementar qualquer feature nova:
1. Se testes já estiverem implementados → escrever o teste junto com o código
2. Se testes ainda não estiverem implementados → documentar o caso de teste obrigatório no plano abaixo (Fase 1/2/3)
3. Nunca marcar uma feature como concluída sem o teste documentado

Ao remover qualquer feature:
1. Remover o código
2. Remover o teste correspondente (arquivo + caso no plano abaixo)
3. Remover referências nos três arquivos de docs
4. Sem entradas mortas, sem código comentado, sem TODO órfão

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
- [x] "Esqueci minha senha" no `LoginPage` (link → e-mail de reset → tela de nova senha) — ✅ Implementado (2026-09). Ver seção "Recuperação de Senha" abaixo. **Pendente de verificação manual:** conferir em Supabase Studio → Authentication → URL Configuration se a Redirect URL de produção (`https://financa-casal.vercel.app`) está na allowlist — sem isso, o e-mail de recuperação redireciona para o Site URL padrão (visto em produção apontando para `localhost:3000`) em vez da origem correta.
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

## Roadmap de Features

### Pré-lançamento — implementar antes de abrir para outros usuários

**Dashboard & insights (sem nova tabela — usam dados existentes)**
- [ ] **Resumo mensal algorítmico** — card no Dashboard com: total do mês vs mês anterior (% variação), categoria que mais cresceu, maior gasto único, recorrentes pendentes. String templates com cálculos, sem IA.
- [ ] **Comparativo mês a mês** — indicadores de variação `↑ 23%` ao lado de cada total no Dashboard
- [ ] **Previsão de saldo ao fim do mês** — estimativa baseada em recorrentes cadastrados + média dos últimos 3 meses
- [ ] **Alerta de fatura chegando** — card no Dashboard 3 dias antes do vencimento do cartão (usa `cards.due_day` já existente)

**Features de produto**
- [ ] **Notificações de vencimento de parcelas** — banner/card no Dashboard alertando crédito parcelado com `date` nos próximos 7 dias. Sem nova tabela.
- [ ] **Metas financeiras mensais** — nova tab ou seção no Dashboard com barra de progresso por meta. Nova tabela `goals (id, family_id, description, target_amount, current_amount, deadline, category, created_at)`.
- [ ] **Divisão de gastos entre o casal** — painel mostrando quanto cada membro gastou no mês e o "acerto" (quem deve quanto a quem). Usa `user_label` já existente em todas as despesas. Sem nova tabela.

---

### Pós-lançamento — após validar produto com usuários reais

- [ ] **Foto de recibo → registro automático** — câmera do celular + Edge Function extrai valor, data e categoria do cupom fiscal e preenche o formulário. Requer nova Edge Function com Claude Vision.
- [ ] **Relatório anual / retrospectiva** — painel do ano: maiores gastos, mês mais caro, categorias que mais cresceram. Alto potencial de compartilhamento. Sem nova tabela.
- [ ] **Exportação de relatórios em PDF** — botão na aba Gráficos e Lançamentos. Gerar server-side via Edge Function (mais confiável que `jsPDF + html2canvas` com glassmorphism).
- [ ] **Notificação push quando parceiro registra gasto** — Web Push API + service worker. Requer tabela de push subscriptions.
- [ ] **Score de saúde financeira** — pontuação 0–100 mensal baseada em: saldo positivo, orçamento respeitado, metas atingidas, recorrentes em dia. Gamificação para retenção.
- [ ] **Orçamento por percentuais (regra 50/30/20)** — configurar orçamento como % da renda em vez de valores fixos. Extensão do `BudgetView` existente.
- [ ] **App mobile nativo** — React Native. Somente após validar produto no PWA com usuários reais.

---

### Técnico (não são features de usuário)

- [ ] **Testes automatizados** — plano em 3 fases (ver detalhes abaixo)
- [ ] **Divisão do App.jsx em componentes separados** — somente quando ultrapassar ~6.000 linhas e dificultar manutenção. Manter padrão de props e inline styles.

---

## Plano de Testes Automatizados

**Status:** Fase 1 iniciada (2026-09) — `vitest` instalado, `src/utils/finance.js` criado com as primeiras 3 funções puras e 16 testes passando (`npm run test`). Fases 2 e 3 (React Testing Library, Playwright) ainda não iniciadas.
**Regra:** toda feature nova exige caso de teste documentado aqui. Toda feature removida exige remoção do caso de teste correspondente.

### Stack escolhida
| Camada | Ferramenta | Motivo |
|---|---|---|
| Unit | Vitest | Compatível com Vite, zero config adicional, rápido |
| Component | React Testing Library | Testa comportamento do usuário, não implementação |
| E2E | Playwright | Testa fluxos reais no browser, suporte a mobile viewport |

### Estrutura de arquivos planejada
```
src/
  utils/
    finance.js            ← ✅ criado — funções puras (colocado com o teste, não em __tests__/)
    finance.test.js       ← ✅ criado — 16 testes, todos passando
  __tests__/
    components/
      ExpenseForm.test.jsx
      SummaryCards.test.jsx
      TransactionsList.test.jsx
      Modal.test.jsx
e2e/
  auth.spec.js
  expenses.spec.js
  navigation.spec.js
  filters.spec.js
  mobile.spec.js
  pwa.spec.js
playwright.config.js
vitest.config.js
```

---

### Fase 1 — Unit tests (funções puras)

Pré-requisito: extrair para `src/utils/finance.js` e importar de volta em App.jsx. Zero impacto visual.

#### Funções existentes em App.jsx
| Função | Risco | Casos obrigatórios |
|---|---|---|
| `monthlyAmount(expense)` | **Alto** | PIX/débito/dinheiro (1x), crédito 1x vs Nx, crédito split |
| `getBillingMonth(date, periods, closingDay)` | **Alto** | compra ≤ fechamento (mesmo mês), compra > fechamento (próximo mês), fechamento dia 1, dia 31 |
| `autoCategory(description)` | Médio | "uber", "mercado", "netflix", "gyovana", "metlife", string sem match → "outros" |
| `groupByDate(items)` | Médio | hoje, ontem, semana passada, array vazio |
| `fmt(value)` | Baixo | zero, negativo, milhar, dois decimais |
| `fmtShort(value)` | Baixo | < 1000 (passa inteiro), ≥ 1000 (converte para "k") |
| `applyPhoneMask(value, mask)` | Baixo | BR +55, US +1, número incompleto |

#### Funções a criar (features do roadmap)
| Função | Feature | Casos obrigatórios |
|---|---|---|
| `buildMonthlySummary(expenses, incomes, prev)` | ✅ Implementado e testado — #1 Resumo mensal (UI da card ainda não feita) | variação positiva, negativa, mês sem dados anterior |
| `calcGoalProgress(goal, refDate)` | ✅ Implementado, testado e em uso em `GoalsView` — #3 Metas | % concluído, meta atingida, prazo vencido, prazo vencido mas já atingida |
| `getUpcomingInstallments(expenses, today)` | #2 Notificações parcelas | vence em 0, 7 e 8 dias; sem crédito na lista |
| `calcMonthVariation(current, previous)` | ✅ Implementado e testado — #4 Comparativo mês a mês | aumento, queda, anterior = 0 (evitar divisão por zero) |
| `getPendingRecurring(rules, reminders, refDate)` | ✅ Implementado e testado (2026-09) — usada no contexto do Assistente de IA (recorrentes pendentes) | sem lembrete, status logged, status skipped, inativa, anual fora do mês, anual no mês certo, encerrada por end_date |
| `forecastBalance(income, recurring, last3)` | #5 Previsão de saldo | histórico completo, histórico < 3 meses, renda zero |
| `getCardsNearDue(cards, today)` | #6 Alerta de fatura | vence em 0, 3 e 4 dias; sem cartões |
| `calcCoupleSplit(expenses)` | #7 Divisão do casal | gastos iguais (acerto zero), membro sem gastos, um membro |
| `calcHealthScore(data)` | #11 Score de saúde | score mínimo 0, máximo 100, todos os critérios |
| `calcPercentBudget(income, percentages)` | #12 Orçamento % | renda zero, soma ≠ 100%, categoria sem percentual |

---

### Fase 2 — Component tests

#### Componentes existentes
| Componente | Cenários obrigatórios |
|---|---|
| `ExpenseForm` | Campo obrigatório vazio → não submete; cálculo parcela↔total em sincronia; tipo Dinheiro sem campo parcelas; toggle split requer valor > 0 na 2ª forma; crédito parcelado exibe range de meses |
| `SummaryCards` | Totalização correta de expenses/incomes; saldo líquido = receitas − gastos; parcelas futuras excluem mês atual |
| `BudgetView` | Barra verde < 80%, amarela 80–100%, vermelha > 100%; alerta aparece ao ultrapassar |
| `TransactionsList` | Filtro por tipo mostra apenas itens do tipo; busca por descrição; badge `✂️ dividido` quando `split_group_id` presente; badge `🔁 duplicata` |
| `Modal` | Swipe no handle/header fecha; onTouchMove no body **não** fecha; Esc fecha no desktop |

#### Componentes de features futuras (adicionar ao implementar)
| Componente | Cenários mínimos |
|---|---|
| `GoalsView` (#3) | Barra de progresso com % correto; meta concluída marca como ✅ |
| `CoupleSplitView` (#7) | "Deve R$ X ao parceiro" com valor correto; sem gastos → "estão empatados" |

---

### Fase 3 — E2E (Playwright)

Viewports testados: **mobile 390×844** (iPhone 14) e **desktop 1440×900**.

#### Autenticação
- Login demo (`demo@financacasal.app` / `demo1234`) → dashboard carrega com dados fake
- Toggle dark/light mode → cor do background muda e persiste ao navegar entre tabs

#### Gastos — registro
- Criar gasto PIX simples → aparece no Dashboard (totais atualizados) e em Lançamentos
- Criar gasto em Dinheiro → campo parcelas ausente do formulário
- Criar gasto crédito 6x → `amount` exibido é o valor da parcela (total/6); range de meses exibido
- Criar gasto com split (R$50 dinheiro + R$150 PIX) → dois cards em Lançamentos com badge `✂️ dividido`

#### Gastos — edição e deleção
- Editar descrição → card atualizado na lista
- Deletar gasto → some da lista; totais do Dashboard recalculados

#### Modal / UX mobile (390px)
- Scroll longo no formulário de gasto → modal permanece aberto
- Arrastar handle bar ≥ 80px para baixo → modal fecha
- Bottom bar permanece fixa durante scroll do Dashboard

#### Filtros e navegação
- Filtrar Lançamentos por "Dinheiro" → apenas gastos tipo `dinheiro` visíveis
- Navegar pelas 7 tabs (Dashboard, Calendário, Gráficos, Orçamento, Recorrentes, Lançamentos, Importar) → sem erro de renderização

#### PWA e meta tags
- `<link rel="apple-touch-icon">` aponta para `/apple-touch-icon.png` (não `.svg`)
- `<meta name="theme-color" content="#7c6af7">` presente no `<head>`
- `<meta name="apple-mobile-web-app-capable" content="yes">` presente

---

### Scripts a adicionar em package.json (quando implementar)
```json
"test":        "vitest run",
"test:watch":  "vitest",
"test:ui":     "vitest --ui",
"test:e2e":    "playwright test",
"test:e2e:ui": "playwright test --ui",
"test:all":    "vitest run && playwright test"
```

> O script `test:all` é o que roda no PR antes do merge.

### Dependências a instalar (quando implementar)
```bash
npm install -D vitest @vitest/ui jsdom
npm install -D @testing-library/react @testing-library/jest-dom @testing-library/user-event
npm install -D @playwright/test
npx playwright install chromium
```

---

## Histórico de Correções

### 2026-09 — Atribuição de usuário na importação e cálculo da fatura de crédito

**Sintomas relatados:**
1. Lançamentos importados apareciam com `user_label: "Você"` genérico em vez do nome real de quem importou — misturava dados dos dois membros no filtro de Lançamentos.
2. Gráfico "Fatura do Cartão" mostrava valor bem abaixo do real da fatura (ex: R$3.900 mostrado vs R$6.200 real em uma das faturas).

**Causas encontradas e correções:**

1. **`user_label: 'Você'` hardcoded em dois parsers de importação** (`parseAnnualExpenses` e `parseGastosAnual` em `ImportView`) — sobrescrevia o fallback `currentUserLabel` mesmo depois de uma correção anterior (PR #31) ter resolvido o mesmo bug em outro ponto do código. Corrigido para usar `currentUserLabel` nos dois parsers. **Lição:** ao corrigir um bug de valor hardcoded, buscar por TODAS as ocorrências no arquivo, não só a primeira encontrada.

2. **Campo de data no formulário de crédito pedia "data em que a 1ª parcela cai na fatura"** em vez da data da compra — convenção que o próprio casal já tinha abandonado no uso diário (voltaram a cadastrar pela data real da compra) porque causava confusão. Reverteu-se o formulário para pedir a **data da compra**; `billingChartData` já calcula o mês de vencimento sozinho via `closing_day`/`billing_periods`.

3. **~30 gastos de crédito sem `card_id` vinculado** (campo opcional no formulário) — sem cartão, o app não consegue casar o gasto com o período de fatura real cadastrado em `billing_periods` e cai num fallback genérico de fechamento dia 28, que é impreciso porque **o fechamento real do cartão varia mês a mês** (só o vencimento, dia 6, é fixo). Corrigido: cartão agora é **obrigatório** quando existe cartão cadastrado (auto-seleciona se houver só 1 cartão ativo), em `ExpenseForm` e `EditModal`. Backfill aplicado nos gastos históricos vinculando ao único cartão existente.

4. **Confusão de nomenclatura "mês da fatura"**: o app rotula a fatura pelo **mês de vencimento** (`fatura_month`, dia 6), não pelo mês em que a maioria das compras aconteceu. Uma fatura que cobre compras de 31/jul a 31/ago e vence em 06/09 é rotulada "Setembro" no app, mas o casal naturalmente pensa nela como "a fatura de agosto" (mês das compras). Não é um bug — é assim que `billing_periods.fatura_month` foi desenhado — mas gerou confusão na hora de comparar com o extrato real. **Sempre confirmar qual mês (compra vs. vencimento) antes de comparar valores.**

5. **Lançamento duplicado encontrado por comparação manual**: "CABO MACBOOK PRO" e "CABO MACBOOK PRO AMAZON", mesma data, mesmo valor (R$98,89) — a mesma compra cadastrada duas vezes com descrições ligeiramente diferentes. O índice `UNIQUE` anti-duplicata (`idx_expenses_no_duplicates`) não pegou porque a `description` era diferente entre os dois registros. Removido manualmente. **Limitação conhecida:** o índice de unicidade não protege contra duplicatas com descrição diferente — revisão manual continua necessária para esse caso.

**Pendências em aberto:**
- `billing_periods` não cobre set/2026 em diante (fatura ainda não fechou) — meses fora dessa janela caem no fallback genérico e podem estar imprecisos.

### 2026-09 (continuação) — Conferência item a item com os extratos reais do Santander

O usuário enviou os PDFs das faturas de janeiro, agosto e setembro/2026. Cruzamento item a item revelou:

1. **`period_start` de janeiro estava 2 dias tarde demais** — cadastrado como `2025-12-02`, mas o extrato real inclui compras a partir de `2025-11-30`. Corrigido em `billing_periods`. Isso também explica por que alguns lançamentos "sumiam" do cálculo sem estarem de fato ausentes do banco — eles existiam, mas caíam fora de qualquer período cadastrado e não apareciam nas minhas consultas de conferência (mesmo bug de fundo do item #1 acima, agora entendido com mais precisão).
2. **~25 compras nunca lançadas no app** — principalmente farmácias, lojas físicas e lanchonetes pagas com o cartão adicional (final 2771) da conta. Cadastradas retroativamente com base no extrato.
3. **IOF de compras em dólar não era lançado separadamente** — Claude AI e um app de entrevista (Interview Man) têm cobrança em USD + uma linha própria de "IOF DESPESA NO EXTERIOR" no extrato, cobrada à parte do valor principal. O app só tinha o valor principal (sem IOF, e em alguns casos com o valor errado por não converter certo). Corrigido: valores principais ajustados + 2 novos lançamentos de IOF.
4. **Existem dois cartões físicos na mesma conta Santander** (final 5246, titular, e final 2771, adicional) — o app trata os dois como um `card_id` só, o que é correto desde que sejam a mesma fatura/vencimento (confirmado: são).
5. **Nomes parecidos quase viraram uma exclusão errada**: "BRIQNUEDO GABI" (typo) e "BRINQUEDO GABI" pareciam a mesma compra lançada duas vezes — mas eram duas compras reais diferentes no mesmo dia (ver round 3 abaixo para o desfecho real: uma delas nem era crédito).
6. **Lançamentos com data errada "vazam" para o mês seguinte**: "SEM PARAR" e "SUPERMERCADO" datados 31/08 eram na verdade compras que só apareceriam na fatura de outubro (confirmado pelo usuário) — a data cadastrada precisava ser ajustada para cair no período correto.

Resultado após a 2ª rodada de conferência:

| Fatura | App | Extrato real | Diferença |
|---|---|---|---|
| Janeiro/2026 | R$ 7.673,52 | R$ 7.677,68 | R$ 4,16 |
| Agosto/2026 | R$ 5.316,31 | R$ 5.341,23 | R$ 24,92 |
| Setembro/2026 | R$ 6.054,52 | R$ 6.206,71 | R$ 152,19 |

A diferença de setembro (R$152,19) foi explicada errado nessa rodada — ver round 3 abaixo pra correção.

### 2026-09 (round 3) — Terceira conferência de setembro, a pedido do usuário

O usuário pediu pra investigar a diferença de R$152,19 em setembro com mais calma. Achados:

1. **"BRIQNUEDO GABI" (R$149,99) não era duplicata do "BRINQUEDO GABI" (R$91,56) — eram duas compras reais diferentes, mas uma delas nem era no crédito.** O usuário confirmou: "se não está na fatura é porque não foi crédito, deve ter sido débito". Corrigido: `type` alterado de `credito` para `debito`, removidos `card_id` e `parcelas`. **Lição reforçada da armadilha #20 (CLAUDE.md): a ausência de um item no extrato de crédito pode significar que ele foi pago de outra forma, não necessariamente que está faltando lançar.**
2. Ao remover esse item do cálculo de crédito, a diferença de setembro **aumentou** de R$152,19 para R$302,18 — a explicação anterior ("um item extra que não está no extrato compensava um buraco maior") estava mascarando um problema real, não resolvendo ele. **Lição:** quando uma correção piora a divergência antes de melhorar, é sinal de que a explicação anterior estava errada — não parar na primeira coisa que "quase bate".
3. Reconferência item a item (dessa vez linha por linha dos dois cartões, sem atalho) achou mais 3 problemas reais:
   - **Compra faltando**: "COVABRA LJ 22" R$188,42 (10/08) — uma segunda compra na mesma loja no mesmo dia que a primeira (R$338,77, já lançada), fácil de passar despercebido.
   - **"LAROC INGRESSO" com numeração de parcela adiantada em 1 ciclo**: o extrato mostra parcela 5/6 na fatura de agosto e 6/6 em setembro, mas a data de compra cadastrada (`28/02`) fazia o app calcular a parcela final (6/6) caindo em agosto em vez de setembro — a data está bem na fronteira entre dois períodos de fechamento. Ajustada a data de compra (`28/02` → `01/03`) só o suficiente para alinhar com o ciclo real, sem mudar o valor nem a contagem de parcelas.
   - **"Opencode GO" com valor errado e sem o IOF**: o item real no extrato é "ANOMALY" R$28,69 + IOF R$1,00 (compra em dólar) — o app tinha R$27,00 sem IOF. Valor corrigido e IOF lançado à parte, seguindo o mesmo padrão do achado #3 da 2ª rodada.
4. **"DISNEY PLUS" R$46,82 (parcelas, a partir de 14/06) não aparece em nenhuma das 3 faturas conferidas.** Perguntado ao usuário: é uma assinatura anual real (plano de 12 meses, iniciado em junho) — mas aparentemente cobrada em outro cartão/conta, não no Santander final 5246/2771 que estamos conferindo. Corrigido apenas o número de parcelas (11 → 12, conforme confirmado). **Não removido do banco** — é um gasto real, só não pertence ao extrato desse cartão. Deixa a diferença residual de setembro (R$47,12) explicada e sem mais o que investigar nesse cartão.

Resultado final (após a 3ª rodada):

| Fatura | App | Extrato real | Diferença | Status |
|---|---|---|---|---|
| Janeiro/2026 | R$ 7.673,52 | R$ 7.677,68 | R$ 4,16 | Fechado |
| Agosto/2026 | R$ 5.316,31 | R$ 5.341,23 | R$ 24,92 | Fechado |
| Setembro/2026 | R$ 6.253,83 | R$ 6.206,71 | R$ 47,12 | Fechado — 100% explicado pelo Disney+ (assinatura real, cartão diferente) |

**Pendências em aberto:**
- `billing_periods` ainda não cobre set/2026 em diante (fatura ainda não fechou) — cadastrar assim que essa fatura fechar.
- Considerar cadastrar o cartão/conta onde o Disney Plus é cobrado, se o usuário quiser rastrear essa fatura também no app.
- As três faturas conferidas (jan/ago/set 2026) estão fechadas com diferenças residuais pequenas e 100% explicadas. Novas divergências grandes (>R$50) em meses futuros provavelmente indicam lançamento faltando, duplicado, ou pago de outra forma (débito/outro cartão) — usar a mesma metodologia (join de `expenses` parceladas com `billing_periods` via SQL, comparando linha a linha com o extrato real, sem atalhos) para investigar. Se uma correção piorar o resultado antes de melhorar, é sinal para continuar investigando, não parar.
