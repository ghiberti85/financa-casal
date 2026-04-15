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
| Frontend | React 18, Vite 5, JSX (sem TypeScript) |
| Gráficos | Recharts (PieChart, BarChart, LineChart) |
| Estilo | Inline styles + glassmorphism — sem Tailwind nem CSS modules |
| Backend | Supabase REST API (sem SDK — fetch direto com headers manuais) |
| Auth | Supabase Auth via JWT — token em localStorage |
| IA | Claude Sonnet via Supabase Edge Function (Deno) para importação |
| Deploy | Vercel (auto-deploy no push para main) |

---

## Arquitetura

```
src/
  App.jsx     ← aplicação INTEIRA em um único arquivo (~4000 linhas)
public/
  favicon.svg
  og-image.svg
index.html    ← SEO, Open Graph, PWA meta tags
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
// Token armazenado em localStorage
let _authToken = localStorage.getItem("sb_token") || null;
let _refreshToken = localStorage.getItem("sb_refresh") || null;

// Refresh automático quando token expira (401 → refreshAccessToken() → retry)
async function supabaseFetch(path, options, _retry = true)
async function supabaseRpc(fn, params)  // para funções SECURITY DEFINER
async function supabaseAuth(action, email, password)
```

**Fluxo de auth:**
1. Login → JWT salvo em localStorage
2. Toda requisição usa Bearer token
3. 401 → tenta refresh token automaticamente → retry
4. Refresh falha → dispara evento `sb-session-expired` → volta para login

---

## Banco de Dados (Supabase)

### Tabelas

```sql
families        (id, name, invite_code, created_at)
family_members  (id, family_id, user_id, role, joined_at)
               role: 'admin' | 'member'

expenses        (id, family_id, user_id, description, amount, date,
                 category, type, parcelas, user_label, created_at)
               type: 'pix' | 'debit' | 'credit'
               amount: SEMPRE o valor da PARCELA, nunca o total
               parcelas: número total de parcelas (null para não-parcelado)

incomes         (id, family_id, user_id, description, amount, date,
                 source, category, user_label, created_at)

profiles        (id, first_name, last_name, phone, updated_at)

budgets         (id, family_id, category, amount, month — YYYY-MM)
recurring       (id, family_id, user_id, description, amount, category,
                 day_of_month, active, created_at)
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
// Contém: text, textMuted, surface, surfaceHover, accent, accentGlow,
//         accentSoft, border, success, danger, glass, glassModal,
//         glassBorder, tooltipBg, shadowSm, chartCursorFill
```

Todos os componentes recebem `t` como prop e usam inline styles.
Não existe classe CSS — tudo é `style={{ color: t.text }}`.

---

## Componentes em App.jsx

| Componente | Descrição |
|---|---|
| `App` | Root — auth, estado global, roteamento por tabs |
| `LoginPage` | Login/cadastro + fluxo de perfil e família |
| `SummaryCards` | Cards: Receitas, Gastos, Saldo, Parcelas Futuras |
| `CalendarView` | Calendário mensal com indicadores e painel de detalhes |
| `ChartsView` | Gráficos: receitas×gastos, donut categorias, linha parcelas |
| `TransactionsList` | Lista com filtros, seleção em massa, duplicatas |
| `ImportView` | Upload CSV/XLSX/PDF + preview + detecção de duplicatas |
| `ExpenseForm` | Gasto: PIX/Débito/Crédito parcelado |
| `IncomeForm` | Receita: descrição, quem recebeu, categoria, valor, data |
| `EditModal` | Edição de gasto ou receita existente |
| `BudgetView` | Orçamento por categoria com barra de progresso |
| `RecurringView` | Gastos recorrentes (aluguel, assinaturas) |
| `FamilyModal` | Código de convite, membros, papéis |
| `ProfileModal` | Edição de perfil com telefone e DDI |
| `MemberSelect` | Dropdown de membros da família |
| `Modal` | Wrapper de modal reutilizável |
| `Btn` | Botão com variantes (accent, success, danger) |
| `Toast` | Sistema de notificações temporárias |
| `BudgetAlertCard` | Alerta no dashboard quando orçamento > 80% |
| `RecurringAlertCard` | Alerta de gastos recorrentes no dashboard |

---

## Tabs da Aplicação

```
dashboard    → SummaryCards + gráfico 6 meses + alertas
calendar     → CalendarView
charts       → ChartsView (receitas×gastos, categorias, parcelas)
budget       → BudgetView (orçamento por categoria)
recurring    → RecurringView (gastos fixos mensais)
transactions → TransactionsList
import       → ImportView
```

FAB (botões flutuantes) com "+ Gasto" e "+ Receita" visíveis em todas as tabs exceto `import`.

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
const EXPENSE_CATEGORIES = [
  "Alimentação", "Transporte", "Moradia", "Saúde", "Educação",
  "Lazer", "Roupas", "Tecnologia", "Viagem", "Pets",
  "Assinaturas", "Presente", "Beleza", "Outros"
]
```

---

## Roadmap (Pendente)

- [ ] Notificações push para vencimento de parcelas
- [ ] Metas financeiras mensais com progresso visual
- [ ] Exportação de relatórios em PDF
- [ ] Suporte a múltiplas moedas
- [ ] App mobile nativo (React Native)
- [ ] Testes automatizados
- [ ] Divisão do App.jsx em componentes separados (quando necessário)
