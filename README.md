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
- [Segurança](#segurança)
- [Roadmap](#roadmap)

---

## Sobre o projeto

O **Finanças do Casal** é uma aplicação web progressiva (PWA) desenvolvida para que casais possam gerenciar suas finanças de forma colaborativa. Cada membro da família registra gastos e receitas, acompanha orçamentos por categoria, gerencia gastos recorrentes mensais, visualiza o histórico em calendário, consulta gráficos e importa extratos bancários automaticamente.

A aplicação foi construída com foco em:

- **PWA mobile-first** — instalável no iPhone/Android com navegação em barra inferior fixa, suporte à notch e home indicator do iOS
- **Colaboração em tempo real** — alterações de um membro refletem imediatamente para o outro
- **Segurança** — Row Level Security (RLS) no Supabase garante isolamento total entre famílias
- **Importação inteligente** de planilhas CSV/XLSX/PDF via IA (Claude Sonnet)

---

## Funcionalidades

### 🔐 Autenticação e Perfis
- Cadastro e login com e-mail e senha
- **Sessão segura:** refresh token em cookie `HttpOnly; Secure` (inacessível ao JS), access token apenas em memória
- Skeleton loading durante restauração de sessão
- Perfil com nome, sobrenome e telefone com DDI internacional (14 países)
- **Modo Demo** disponível sem cadastro: `demo@financacasal.app` / `demo1234`

### 👨‍👩‍👦 Sistema de Família
- Criar família ou entrar em família existente via **código de convite de 6 letras**
- Gerenciamento de membros com dois papéis: **Membro** e **Administrador**
- Apenas administradores podem regenerar o código de convite
- Proteção contra remoção do último administrador

### 🌙 Tema Dark / Light
- Alternância entre modo claro e escuro disponível no menu lateral (desktop) e no drawer (mobile)
- Tema salvo por sessão, aplicado em todos os componentes via objeto `t` (inline styles)

### 🏠 Dashboard
- Cards de resumo: Receitas do Mês, Gastos do Mês, Saldo e Parcelas Futuras
- Gráfico de barras: Receitas × Gastos dos últimos 6 meses
- **Card de alertas de orçamento** — aparece automaticamente quando alguma categoria ultrapassa 80% do limite definido
- **Card de lembretes de recorrentes** — lista os gastos fixos que ainda não foram confirmados no mês
- **BillingCard** — total da fatura do mês atual agrupado por cartão de crédito, com data de vencimento
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
  - Lista detalhada de lançamentos da categoria aparece abaixo do gráfico
- **Parcelas de crédito** — linha do tempo das parcelas futuras (12 meses):
  - Toque em um ponto para ver e editar as parcelas daquele mês

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
  - Confirmar cria o lançamento automaticamente
  - Detecta se o lançamento já foi importado e apenas vincula o lembrete
- Card de confirmados com lista de pagamentos do mês e total lançado

### 📋 Lançamentos
- Listagem de gastos e receitas com filtros por: mês, ano, tipo (Todos/Gastos/Receitas), tipo de pagamento (PIX, Débito, Crédito, Dinheiro) e categoria
- **Seleção individual** com long-press para entrar no modo de seleção em massa
- **Detecção automática de duplicatas** — itens sinalizados com badge `🔁 duplicata`
- **Pagamentos divididos** — quando um gasto foi registrado em duas formas de pagamento, ambos os cards exibem o badge `✂️ dividido`
- Editar qualquer lançamento com modal completo

### ➕ Registro de Gastos
**Tipos de pagamento suportados:** PIX · Débito · Crédito · Dinheiro

- **PIX / Débito / Dinheiro:** Valor + Data
- **Crédito parcelado:**
  - Nº de parcelas ↔ Valor da Parcela ↔ Valor Total (campos sincronizados)
  - Data da 1ª parcela (com aviso sobre data da fatura)
  - Banner informativo: `💳 Propagado de Jan/2026 até Jun/2026 · Total: R$ 600,00`
  - O valor armazenado é **o da parcela** — cada mês exibe o custo real
- **Pagamento dividido (✂️):** um mesmo gasto pode ser pago em duas formas diferentes (ex: R$ 50 em dinheiro + R$ 150 no PIX). Cria dois registros vinculados com o mesmo `split_group_id`. Somatorias permanecem corretas automaticamente.
- Opção de tornar o gasto **recorrente** diretamente no formulário

### ➕ Registro de Receitas
- Descrição, Quem recebeu, Categoria, Valor e Data

### 💳 Cartões de Crédito
- Cadastro de múltiplos cartões com nome, titular, dia de fechamento e dia de vencimento
- Cor customizável por cartão para fácil identificação
- Ao registrar um gasto de crédito, selecionar o cartão (opcional)
- BillingCard no Dashboard com total da fatura agrupado por cartão

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
- `ON CONFLICT DO NOTHING` — reimportar o mesmo arquivo nunca cria duplicatas

### ✏️ Edição de Lançamentos
- Modal com os mesmos campos do cadastro, pré-preenchido com os valores atuais
- Para crédito parcelado: exibe o valor da parcela e calcula o total automaticamente
- Após salvar, re-busca o registro do banco para garantir sincronização perfeita

### 📱 PWA / Mobile
- Instalável na tela inicial do iPhone e Android
- **Bottom bar** com 3 abas primárias (Início, Agenda, Gráficos) + botão FAB central ("+") + botão "Menu"
- **Botão Menu** abre bottom sheet com abas secundárias na ordem: Recorrentes → Lançamentos → Orçamento → Importar, além de Perfil, Família, Cartões, Tema e Sair
- **Desktop sidebar rail** de 64px (colapsado) / 210px (expandido) com todos os 7 tabs + avatar de usuário com submenu
- `env(safe-area-inset-bottom)` — bottom bar não fica atrás do home indicator do iPhone
- `env(safe-area-inset-top)` — topbar não conflita com a status bar do iOS no modo standalone
- Modais com swipe-to-close restrito ao handle bar e header — o body do formulário tem scroll livre sem risco de fechamento acidental

---

## Tecnologias

### Frontend
| Tecnologia | Versão | Uso |
|---|---|---|
| React | 19 | UI e gerenciamento de estado |
| Vite | 8 | Build tool e dev server |
| Recharts | 3 | Gráficos (barras, rosca, linha) |
| exceljs | 4 | Leitura de planilhas Excel (bundle local) |

### Backend / Infraestrutura
| Tecnologia | Uso |
|---|---|
| Supabase | Banco de dados PostgreSQL, autenticação e RLS |
| Supabase Edge Functions | Análise de planilhas via IA (Deno runtime) |
| Vercel | Deploy, CDN, hosting e API Routes serverless |

### IA
| Serviço | Uso |
|---|---|
| Claude Sonnet (Anthropic) | Interpretação de planilhas em formatos desconhecidos |

---

## Arquitetura

```
┌─────────────────────────────────────────────────────┐
│                    Browser / PWA                     │
│  React SPA (Vite)  ──── access token (memória)      │
│       │                                              │
│  supabaseFetch()   ──── Supabase REST API            │
│  supabaseRpc()     ──── Supabase RPC (SECURITY       │
│                         DEFINER functions)           │
└─────────────────────────────────────────────────────┘
         │                         │
         ▼                         ▼
┌─────────────────────┐  ┌──────────────────────────┐
│  Vercel API Routes  │  │    Supabase Database     │
│  /api/auth/*        │  │    PostgreSQL + RLS       │
│  (HttpOnly cookie)  │  └──────────────────────────┘
└─────────────────────┘              │
         │                 ┌─────────▼──────────┐
         ▼                 │   Edge Function    │
┌─────────────────┐        │   analyze-import   │
│  Supabase Auth  │        │   (Deno + Claude   │
│  (JWT tokens)   │        │    Sonnet API)     │
└─────────────────┘        └────────────────────┘
```

**Decisões de arquitetura:**
- **Single file component** — toda a aplicação está em `src/App.jsx` (~6.100 linhas) para facilitar iteração rápida. Escolha intencional, não débito técnico.
- **Sem SDK do Supabase** — usa `fetch` direto com headers manuais para maior controle e bundle menor
- **Sem TypeScript** — projeto pessoal, velocidade de iteração prioritária
- **Sem Tailwind** — inline styles com objeto de tema `t` para suporte a dark/light mode
- **Estado local** com React `useState` / `useMemo` — sem Redux ou Zustand
- **RLS no banco** — segurança no nível do banco, não apenas no frontend
- **Auth via Vercel API Routes** — refresh token em cookie `HttpOnly`; access token apenas em memória

---

## Banco de dados

### Tabelas

```sql
families            -- id, name, invite_code, created_at

family_members      -- id, family_id, user_id, role, joined_at
                    --   role: 'admin' | 'member'

expenses            -- id, family_id, user_id, description, amount, date,
                    --   category, type, parcelas, user_label,
                    --   card_id, split_group_id, created_at
                    --   type: 'pix' | 'debito' | 'credito' | 'dinheiro'
                    --   amount: SEMPRE o valor da parcela, nunca o total
                    --   split_group_id: UUID compartilhado por dois registros
                    --                  de um pagamento dividido (nullable)

incomes             -- id, family_id, user_id, description, amount, date,
                    --   source, category, user_label, created_at

profiles            -- id, first_name, last_name, phone, updated_at

budgets             -- id, family_id, category, amount, month (YYYY-MM)

cards               -- id, family_id, name, holder, closing_day, due_day,
                    --   color, active, created_at
                    --   closing_day: dia de fechamento da fatura
                    --   due_day: dia de vencimento da fatura

billing_periods     -- id, family_id, card_id, month, year,
                    --   start_date, end_date, created_at

recurring_expenses  -- id, family_id, user_id, description, amount, category,
                    --   type, frequency, day_of_month, month_of_year,
                    --   amount_type, active, end_date, created_at
                    --   frequency: 'monthly' | 'weekly' | 'yearly'
                    --   amount_type: 'fixed' | 'variable'

recurring_reminders -- id, family_id, recurring_id, month, year,
                    --   amount, status, expense_id, created_at
                    --   status: 'pending' | 'confirmed' | 'skipped'
```

### Convenção de valores para crédito parcelado

O campo `amount` em `expenses` armazena **sempre o valor da parcela**, nunca o total. Isso garante que cada linha representa exatamente o custo daquele mês. O total é calculado no frontend como `amount × parcelas` apenas para exibição.

### Pagamento dividido (`split_group_id`)

Quando um gasto é pago em duas formas diferentes, são criados **dois registros** na tabela `expenses`, ambos com o mesmo `split_group_id` (UUID). Isso mantém todas as somatórias corretas sem nenhuma lógica especial — são simplesmente dois gastos vinculados.

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

> **Modo Demo:** sem configurar o Supabase, você já pode explorar a aplicação com dados fictícios usando `demo@financacasal.app` / `demo1234`.

### Configuração do Supabase

1. Crie um projeto em [supabase.com](https://supabase.com)
2. Execute o script SQL em `supabase/schema.sql` no SQL Editor
3. Execute o script `supabase/rpc_functions.sql` para criar as funções RPC
4. Em **Authentication → Providers → Email**, desative "Confirm email" (para desenvolvimento)
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

Qualquer push para a branch `main` dispara um deploy automático. O processo leva ~1–2 minutos.

> ⚠️ **Nunca commitar diretamente na `main`.** Sempre usar branch + PR. O Vercel faz auto-deploy no push para `main` — um commit com erro quebra produção.

### Variáveis de ambiente na Vercel

Configure as mesmas variáveis do `.env.local` em:
**Vercel → Projeto → Settings → Environment Variables**

---

## Estrutura do projeto

```
financa-casal/
├── api/
│   └── auth/
│       ├── login.js     # POST /api/auth/login — autentica e define cookie HttpOnly
│       ├── signup.js    # POST /api/auth/signup — cadastra e define cookie HttpOnly
│       ├── refresh.js   # POST /api/auth/refresh — renova sessão via cookie HttpOnly
│       └── logout.js    # POST /api/auth/logout — apaga o cookie de sessão
├── src/
│   ├── App.jsx          # Aplicação completa (~6.100 linhas)
│   ├── index.css        # Estilos globais base
│   └── main.jsx         # Entry point React
├── public/
│   ├── favicon.svg      # Ícone diamante roxo
│   └── og-image.svg     # Imagem Open Graph (1200×630)
├── index.html           # HTML com SEO, Open Graph e PWA meta tags
├── vercel.json          # Headers de segurança HTTP e CSP
├── vite.config.js       # Configuração do Vite
├── CONTEXT.md           # Contexto técnico completo para desenvolvimento com IA
├── CLAUDE.md            # Instruções, padrões e armadilhas para o Claude Code
├── package.json
└── README.md
```

### Principais componentes em `App.jsx`

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
| `RecurringAlertCard` | Alerta no Dashboard com pagamentos recorrentes pendentes |
| `CardsManager` | CRUD de cartões de crédito (nome, titular, fechamento, vencimento) |
| `BillingCard` | Resumo da fatura atual no Dashboard, agrupado por cartão |
| `TransactionsList` | Lançamentos com filtros, seleção em massa e detecção de duplicatas |
| `ImportView` | Upload CSV/XLSX/PDF, preview e detecção de duplicatas |
| `ExpenseForm` | Gasto: PIX/Débito/Crédito/Dinheiro + parcelado + recorrente + pagamento dividido |
| `IncomeForm` | Receita: descrição, quem recebeu, categoria, valor, data |
| `EditModal` | Edição de gasto ou receita existente |
| `FamilyModal` | Código de convite, membros e gerenciamento de papéis |
| `ProfileModal` | Edição de perfil com telefone e DDI |
| `Modal` | Wrapper de modal reutilizável com bottom sheet no mobile |
| `ConfirmModal` | Modal de confirmação (substitui `window.confirm`) |
| `Toast` | Sistema de notificações temporárias (success/error/info/warning) |
| `Icon` | Ícone SVG inline via `ICON_PATHS` (33 ícones Lucide-inspired) |

---

## Segurança

### Autenticação e sessão
- **Refresh token** em cookie `HttpOnly; Secure; SameSite=Strict` — inacessível ao JavaScript, mesmo em caso de XSS
- **Access token** mantido apenas em memória (`_authToken`) — nunca persiste em `localStorage` em produção
- **Rotação de refresh token** a cada uso — prevenção de token replay
- Refresh automático transparente: 401 → `/api/auth/refresh` → retry da requisição original

### Proteção de dados (Supabase)
- **RLS ativo em todas as tabelas** — isolamento total entre famílias via `family_id`
- **Funções SECURITY DEFINER** para operações sensíveis (criação de família, troca de papel, convite)
- Índices `UNIQUE` no banco garantem idempotência na importação (`ON CONFLICT DO NOTHING`)

### Proteção da API Anthropic
- A chave da API Anthropic fica **exclusivamente no Supabase Vault** (servidor)
- O browser nunca recebe nem transmite a chave

### Headers HTTP (`vercel.json`)
| Header | Proteção |
|---|---|
| `Strict-Transport-Security` | Força HTTPS com preload |
| `Content-Security-Policy` | Bloqueia scripts externos; proíbe iframes |
| `X-Frame-Options` | Previne clickjacking |
| `X-Content-Type-Options` | Previne MIME sniffing |
| `Permissions-Policy` | Desativa câmera, microfone e geolocalização |

### Upload de arquivos
- Tamanho máximo: **10 MB**
- MIME type validado antes do processamento
- Extensões permitidas: `.csv`, `.xlsx`, `.xls`, `.pdf`, `.txt`
- Leitura de XLSX via `exceljs` (substitui o `xlsx` abandonado)

### Rate limiting
- **Frontend:** 3 tentativas falhas → bloqueio de 30 segundos no botão de login
- **Servidor:** `/api/auth/login` limita 10 tentativas por IP em janela de 15 minutos

---

## Roadmap

### Pré-lançamento
- [ ] Resumo mensal algorítmico no Dashboard (variação vs mês anterior, maior gasto, etc.)
- [ ] Comparativo mês a mês com indicadores `↑ 23%` ao lado dos totais
- [ ] Previsão de saldo ao fim do mês (recorrentes + média dos últimos 3 meses)
- [ ] Alerta de fatura chegando (3 dias antes do vencimento)
- [ ] Notificações de vencimento de parcelas de crédito
- [ ] Metas financeiras mensais com barra de progresso
- [ ] Divisão de gastos entre o casal (acerto mensal)
- [ ] Testes automatizados (Vitest + React Testing Library + Playwright)

### Pós-lançamento
- [ ] Foto de recibo → registro automático via Claude Vision
- [ ] Relatório anual / retrospectiva estilo Spotify Wrapped
- [ ] Exportação de relatórios em PDF (server-side via Edge Function)
- [ ] Notificações push quando parceiro registra gasto
- [ ] Score de saúde financeira (0–100 mensal)
- [ ] Orçamento por percentuais (regra 50/30/20)
- [ ] App mobile nativo (React Native)

---

## Licença

Este projeto é privado e de uso exclusivo familiar. Todos os direitos reservados.

---

<p align="center">
  Feito com 💜 para o casal Ghiberti
</p>
