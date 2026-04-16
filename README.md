# 💎 Finanças do Casal

> Gestão financeira compartilhada para casais — controle gastos, receitas, orçamentos e parcelas de forma colaborativa e em tempo real.

**[🌐 Acessar aplicação](https://financa-casal.vercel.app)**

---

## 📋 Índice

- [Sobre o projeto](#sobre-o-projeto)
- [Funcionalidades](#funcionalidades)
- [Tecnologias](#tecnologias)
- [Arquitetura](#arquitetura)
- [Banco de dados](#banco-de-dados)
- [Como executar localmente](#como-executar-localmente)
- [Variáveis de ambiente](#variáveis-de-ambiente)
- [Deploy](#deploy)
- [Estrutura do projeto](#estrutura-do-projeto)

---

## Sobre o projeto

O **Finanças do Casal** é uma aplicação web progressiva (PWA) desenvolvida para que casais possam gerenciar suas finanças de forma colaborativa. Cada membro da família pode registrar gastos e receitas, acompanhar orçamentos por categoria, gerenciar gastos recorrentes mensais, visualizar o histórico em calendário, consultar gráficos e importar extratos bancários automaticamente.

A aplicação foi construída com foco em:

- **PWA mobile-first** — instalável no iPhone/Android com navegação em barra inferior fixa, suporte à notch e home indicator do iOS
- **Colaboração em tempo real** — alterações de um membro refletem imediatamente para o outro
- **Segurança** — Row Level Security (RLS) no Supabase garante isolamento total entre famílias
- **Importação inteligente** de planilhas CSV/XLSX/PDF via IA (Claude Sonnet)

---

## Funcionalidades

### 🔐 Autenticação e Perfis
- Cadastro e login com e-mail e senha
- Persistência de sessão via `localStorage` — sem necessidade de logar novamente ao recarregar
- Skeleton loading durante restauração de sessão
- Perfil com nome, sobrenome e telefone com DDI internacional (14 países)

### 👨‍👩‍👦 Sistema de Família
- Criar família ou entrar em família existente via **código de convite de 6 letras**
- Gerenciamento de membros com dois papéis: **Membro** e **Administrador**
- Apenas administradores podem regenerar o código de convite
- Proteção contra remoção do último administrador

### 🏠 Dashboard
- Cards de resumo: Receitas do Mês, Gastos do Mês, Saldo e Parcelas Futuras
- Gráfico de barras: Receitas × Gastos dos últimos 6 meses
- **Card de alertas de orçamento** — aparece automaticamente quando alguma categoria ultrapassa 80% do limite definido
- **Card de lembretes de recorrentes** — lista os gastos fixos que ainda não foram confirmados no mês, com acesso direto à aba Recorrentes
- Saudação personalizada com nome do usuário logado

### 📅 Calendário
- Visualização mensal com indicadores visuais por dia:
  - 🔴 ponto vermelho = gasto avulso
  - 🟣 ponto roxo = parcela de crédito
  - 🟢 ponto verde = receita
- Valores resumidos diretamente na célula do dia
- Painel de detalhes ao clicar em um dia com lista completa de lançamentos
- Editar e excluir gastos/receitas diretamente do calendário

### 📊 Gráficos
- **Receitas × Gastos × Saldo** — barras por mês, filtrável por mês/ano
- **Gastos por categoria** — gráfico de rosca (donut) interativo:
  - Toque em uma fatia ou item da legenda para selecionar a categoria
  - Fatias não selecionadas ficam em 35% de opacidade
  - Lista detalhada de lançamentos da categoria aparece abaixo do gráfico (descrição, quem pagou, tipo, data, valor)
  - Total da categoria destacado no cabeçalho da lista
- **Parcelas de crédito** — linha do tempo das parcelas futuras (12 meses):
  - Toque em um ponto para ver e editar as parcelas daquele mês
  - Edição de parcelas diretamente no gráfico

### 🎯 Orçamento Mensal
- Definir limite de gasto por categoria (ex: Alimentação: R$ 2.000)
- Barra de progresso por categoria com percentual de uso
- Cores indicativas: verde (< 80%), amarelo (80–100%), vermelho (> 100%)
- Card de alerta no Dashboard quando qualquer categoria ultrapassa 80%
- Histórico por mês — navegação entre meses passados

### 🔁 Gastos Recorrentes
- Cadastrar regras de gastos fixos mensais, semanais ou anuais (aluguel, contas, assinaturas)
- Cada regra possui: descrição, categoria, tipo de pagamento, dia de vencimento, tipo de valor (fixo ou variável)
- **Sistema de lembretes mensais** — todo mês são gerados lembretes para cada regra ativa:
  - Pendentes: campo de valor + botão confirmar ✓ + botão pular ✕
  - Confirmar cria o lançamento na aba Lançamentos automaticamente
  - Detecta se o lançamento já foi importado e apenas vincula o lembrete
- **Card de confirmados** com lista de pagamentos do mês e **total lançado**
- Card de alertas no Dashboard com os lembretes pendentes do mês

### 📋 Lançamentos
- Listagem de gastos e receitas com filtros por: mês, ano, tipo (Todos/Gastos/Receitas), tipo de pagamento e categoria
- **Seleção individual** com checkbox para deleção em massa
- Botão "Selecionar tudo" com contador de itens selecionados
- **Detecção automática de duplicatas** — itens sinalizados com badge `🔁 duplicata`
- Banner de alerta com contagem de duplicatas e remoção em massa
- Editar qualquer lançamento com modal completo
- Subtítulo informativo: `Quem pagou · Data · Tipo · Parcela X de N · Categoria`

### ➕ Registro de Gastos
**Ordem dos campos:** Descrição → Quem pagou → Tipo de pagamento → Categoria

- **PIX / Débito:** Valor + Data
- **Crédito parcelado:**
  - Nº de parcelas + Valor da Parcela
  - Valor Total calculado automaticamente (somente leitura)
  - Data da 1ª parcela (com aviso sobre data da fatura)
  - Banner informativo: `💳 Propagado de Jan/2026 até Jun/2026 · Total: R$ 600,00`
  - O valor armazenado é **o da parcela** — cada mês exibe o custo real
- Opção de tornar o gasto **recorrente** diretamente no formulário

### ➕ Registro de Receitas
- Descrição, Quem recebeu, Categoria, Valor e Data

### 📥 Importação de Planilhas
Suporte a **CSV, XLSX e PDF** com dois modos:

**Parsers locais (gratuitos, sem IA):**
- `Annual_Expenses_*.csv` — planilha com categorias em linhas e dias do mês em colunas
- `Gastos_Anual.csv` — cartão de crédito com meses como colunas (DEZ, JAN, FEV...)

**IA via Edge Function (Claude Sonnet):**
- Para formatos desconhecidos, a planilha é enviada para análise pela API da Anthropic
- Mapeamento automático de colunas e normalização de datas brasileiras (DD/MM/YYYY)

**Preview antes de importar:**
- Detecção de duplicatas em relação aos dados já existentes
- Filtros: Todos / Novos / Duplicatas
- Seleção individual ou em massa
- Importação com `ON CONFLICT DO NOTHING` — reimportar o mesmo arquivo nunca cria duplicatas

### ✏️ Edição de Lançamentos
- Modal com os mesmos campos do cadastro, pré-preenchido com os valores atuais
- Para crédito parcelado: exibe o valor da parcela e calcula o total automaticamente
- Após salvar, re-busca o registro do banco para garantir sincronização perfeita

### 📱 PWA / Mobile
- Instalável na tela inicial do iPhone e Android
- **Barra de navegação inferior fixa** com todos os 7 tabs: Início, Agenda, Gráficos, Orçamento, Recorr., Lançam., Importar
- `env(safe-area-inset-bottom)` — botões não ficam atrás do indicador home do iPhone
- `env(safe-area-inset-top)` — conteúdo não conflita com a status bar do iOS no modo standalone
- Barra superior simplificada no mobile: logo, modo escuro, perfil e família
- Botões FAB (+ Gasto / + Receita) reposicionados acima da barra inferior no mobile

---

## Tecnologias

### Frontend
| Tecnologia | Versão | Uso |
|---|---|---|
| React | 18 | UI e gerenciamento de estado |
| Vite | 5 | Build tool e dev server |
| Recharts | 2 | Gráficos (barras, rosca, linha) |

### Backend / Infraestrutura
| Tecnologia | Uso |
|---|---|
| Supabase | Banco de dados PostgreSQL, autenticação e RLS |
| Supabase Edge Functions | Análise de planilhas via IA (Deno runtime) |
| Vercel | Deploy, CDN e hosting |

### IA
| Serviço | Uso |
|---|---|
| Claude Sonnet (Anthropic) | Interpretação de planilhas em formatos desconhecidos |

---

## Arquitetura

```
┌─────────────────────────────────────────────────┐
│                   Browser / PWA                  │
│  React SPA (Vite)  ──── localStorage (token)    │
│       │                                          │
│  supabaseFetch()   ──── Supabase REST API       │
│  supabaseRpc()     ──── Supabase RPC (SECURITY  │
│                         DEFINER functions)       │
└─────────────────────────────────────────────────┘
         │                        │
         ▼                        ▼
┌─────────────────┐    ┌──────────────────────┐
│  Supabase Auth  │    │  Supabase Database   │
│  (JWT tokens)   │    │  PostgreSQL + RLS    │
└─────────────────┘    └──────────────────────┘
                                 │
                        ┌────────▼───────┐
                        │  Edge Function │
                        │  analyze-import│
                        │  (Deno + Claude│
                        │   Sonnet API)  │
                        └────────────────┘
```

**Decisões de arquitetura:**
- **Single file component** — toda a aplicação está em `src/App.jsx` para facilitar iteração rápida
- **Sem SDK do Supabase** — usa `fetch` direto com headers manuais para maior controle e bundle menor
- **Sem TypeScript** — projeto pessoal, velocidade de iteração prioritária
- **Sem Tailwind** — inline styles com objeto de tema `t` para suporte a dark/light mode
- **Estado local** com React `useState` / `useMemo` — sem Redux ou Zustand
- **RLS no banco** — segurança no nível do banco, não apenas no frontend

---

## Banco de dados

### Tabelas

```sql
families            -- id, name, invite_code, created_at
family_members      -- id, family_id, user_id, role, joined_at
                    --   role: 'admin' | 'member'

expenses            -- id, family_id, user_id, description, amount, date,
                    --   category, type, parcelas, user_label, created_at
                    --   type: 'pix' | 'debit' | 'credit'
                    --   amount: SEMPRE o valor da parcela, nunca o total

incomes             -- id, family_id, user_id, description, amount, date,
                    --   source, category, user_label, created_at

profiles            -- id, first_name, last_name, phone, updated_at

budgets             -- id, family_id, category, amount, month (YYYY-MM)

recurring_expenses  -- id, family_id, user_id, description, amount, category,
                    --   type, frequency, day_of_month, month_of_year,
                    --   amount_type, active, end_date, created_at

recurring_reminders -- id, family_id, recurring_id, month, year,
                    --   amount, status, expense_id, created_at
                    --   status: 'pending' | 'confirmed' | 'skipped'
```

### Convenção de valores para crédito parcelado

O campo `amount` em `expenses` armazena **sempre o valor da parcela**, nunca o total. Isso garante que cada linha representa exatamente o custo daquele mês. O total é calculado no frontend como `amount × parcelas` apenas para exibição.

### Índices de unicidade (anti-duplicata)

```sql
CREATE UNIQUE INDEX idx_expenses_no_duplicates
  ON expenses (family_id, date, description, ROUND(amount::numeric, 2), category);

CREATE UNIQUE INDEX idx_incomes_no_duplicates
  ON incomes (family_id, date, description, ROUND(amount::numeric, 2), category);
```

### Funções RPC (SECURITY DEFINER)

| Função | Descrição |
|---|---|
| `get_my_family()` | Retorna família do usuário autenticado |
| `create_family_for_user()` | Cria família e define o criador como admin |
| `join_family_by_code()` | Entra em família via código de convite |
| `get_family_members_with_profiles()` | Membros com email, nome e telefone |
| `upsert_profile()` | Salva ou atualiza perfil do usuário |
| `update_member_role()` | Altera papel de membro (protege último admin) |
| `regenerate_invite_code()` | Gera novo código de convite (somente admin) |

### Políticas RLS

Todas as tabelas têm RLS ativo. As políticas de SELECT, INSERT, UPDATE e DELETE verificam `family_id = get_my_family_id()` — garantindo que cada família acessa apenas seus próprios dados.

---

## Como executar localmente

### Pré-requisitos

- Node.js 18+
- npm
- Conta no [Supabase](https://supabase.com) (gratuito)

### Instalação

```bash
# 1. Clone o repositório
git clone https://github.com/ghiberti85/financa-casal.git
cd financa-casal

# 2. Instale as dependências
npm install

# 3. Configure as variáveis de ambiente
cp .env.example .env.local
# Edite .env.local com suas credenciais do Supabase

# 4. Execute o servidor de desenvolvimento
npm run dev
```

Acesse `http://localhost:5173`

### Configuração do Supabase

1. Crie um projeto em [supabase.com](https://supabase.com)
2. Execute o script SQL em `supabase/schema.sql` no SQL Editor
3. Execute o script `supabase/rpc_functions.sql` para criar as funções RPC
4. Em **Authentication → Providers → Email**, desative "Confirm email"
5. Copie a **Project URL** e a **anon key** para o `.env.local`

---

## Variáveis de ambiente

Crie um arquivo `.env.local` na raiz do projeto:

```env
VITE_SUPABASE_URL=https://SEU_PROJECT_ID.supabase.co
VITE_SUPABASE_ANON_KEY=sua_anon_key_aqui
```

Para a Edge Function de importação com IA, adicione no Vault do Supabase:

```
Secret name:  ANTHROPIC_API_KEY
Secret value: sk-ant-...
```

---

## Deploy

O projeto está configurado para deploy automático na Vercel via GitHub.

### Deploy automático

Qualquer push para a branch `main` dispara um deploy automático na Vercel. O processo leva aproximadamente 1–2 minutos e pode ser acompanhado em **vercel.com/dashboard**.

```bash
git add src/App.jsx
git commit -m "feat: descrição da mudança"
git push
```

### Deploy manual (primeira vez)

```bash
npm install -g vercel
vercel login
vercel --prod
```

### Variáveis de ambiente na Vercel

Configure as mesmas variáveis do `.env.local` em:
**Vercel → Projeto → Settings → Environment Variables**

---

## Estrutura do projeto

```
financa-casal/
├── src/
│   └── App.jsx          # Aplicação completa (~4000 linhas)
├── public/
│   ├── favicon.svg      # Ícone diamante roxo
│   └── og-image.svg     # Imagem Open Graph (1200×630)
├── index.html           # HTML com SEO, Open Graph e PWA meta tags
├── vite.config.js       # Configuração do Vite
├── CONTEXT.md           # Contexto técnico para desenvolvimento com IA
├── CLAUDE.md            # Instruções e padrões para o Claude Code
├── package.json
└── README.md
```

### Componentes em `App.jsx`

| Componente | Descrição |
|---|---|
| `App` | Root — autenticação, estado global e roteamento por abas |
| `LoginPage` | Login/cadastro com fluxo de perfil e família (3 etapas) |
| `SummaryCards` | Cards: Receitas, Gastos, Saldo, Parcelas Futuras |
| `CalendarView` | Calendário mensal com indicadores e painel de detalhes |
| `ChartsView` | Receitas×Gastos, donut por categoria (clicável) e linha de parcelas |
| `BudgetView` | Orçamento por categoria com barras de progresso |
| `BudgetAlertCard` | Alerta no Dashboard quando categoria > 80% do orçamento |
| `RecurringView` | Lembretes mensais, confirmação de pagamentos e lista de regras |
| `RecurringForm` | Cadastro/edição de regra recorrente |
| `RecurringAlertCard` | Alerta no Dashboard com pagamentos recorrentes pendentes |
| `TransactionsList` | Lançamentos com filtros, seleção em massa e duplicatas |
| `ImportView` | Upload CSV/XLSX/PDF, preview e detecção de duplicatas |
| `ExpenseForm` | Gasto: PIX/Débito/Crédito parcelado + opção recorrente |
| `IncomeForm` | Receita: descrição, quem recebeu, categoria, valor, data |
| `EditModal` | Edição de gasto ou receita existente |
| `FamilyModal` | Código de convite, membros e gerenciamento de papéis |
| `ProfileModal` | Edição de perfil com telefone e DDI |
| `MemberSelect` | Dropdown de membros da família |
| `Modal` | Wrapper de modal reutilizável com backdrop e animação |
| `Btn` | Botão com variantes: primary, ghost, danger, success |
| `Toast` | Sistema de notificações temporárias (success/error/info) |

---

## Roadmap

- [ ] Metas financeiras mensais com barra de progresso
- [ ] Notificações push para vencimento de parcelas
- [ ] Exportação de relatórios em PDF
- [ ] Suporte a múltiplas moedas
- [ ] App mobile nativo (React Native)

---

## Licença

Este projeto é privado e de uso exclusivo familiar. Todos os direitos reservados.

---

<p align="center">
  Feito com 💜 para o casal Ghiberti
</p>
