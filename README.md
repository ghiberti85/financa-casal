# 💎 Finanças do Casal

> Gestão financeira compartilhada para casais — controle seus gastos, receitas e parcelas de forma colaborativa e em tempo real.

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

O **Finanças do Casal** é uma aplicação web progressiva (PWA) desenvolvida para que casais possam gerenciar suas finanças de forma colaborativa. Cada membro da família pode registrar gastos e receitas, visualizar o histórico em calendário, acompanhar gráficos mensais e importar extratos bancários automaticamente.

A aplicação foi construída com foco em:

- **Experiência mobile-first** com design responsivo e glassmorphism
- **Tempo real** — alterações de um membro refletem imediatamente para o outro
- **Segurança** — Row Level Security (RLS) no Supabase garante que cada família acessa apenas seus próprios dados
- **Importação inteligente** de planilhas CSV/XLSX/PDF via IA (Claude)

---

## Funcionalidades

### 🔐 Autenticação e Perfis
- Cadastro e login com e-mail e senha
- Persistência de sessão via `localStorage` — sem necessidade de logar novamente ao recarregar
- Perfil com nome, sobrenome e telefone com DDI internacional (14 países)
- Skeleton loading durante restauração de sessão — sem flash de tela de login

### 👨‍👩‍👦 Sistema de Família
- Criar família ou entrar em família existente via **código de convite de 6 letras**
- Gerenciamento de membros com dois papéis: **Membro** e **Administrador**
- Apenas administradores podem convidar novos membros e regenerar o código
- Proteção contra remoção do último administrador

### 🏠 Dashboard
- Cards de resumo: Receitas do Mês, Gastos do Mês, Saldo e Parcelas Futuras
- Gráfico de barras: Receitas × Gastos dos últimos 6 meses
- Saudação personalizada com nome do usuário logado

### 📅 Calendário
- Visualização mensal com indicadores visuais por dia (ponto vermelho = gasto, ponto verde = receita)
- Valores resumidos diretamente na célula do dia
- Painel de detalhes ao clicar em um dia com lista completa de lançamentos
- Editar e excluir gastos/receitas diretamente do calendário

### 📊 Gráficos
- **Receitas × Gastos × Saldo** — barras por mês, filtrável por mês ou ano
- **Gastos por categoria** — gráfico de rosca (donut) com legenda em duas colunas mostrando todas as categorias
- **Parcelas de crédito** — linha do tempo das parcelas futuras por mês
- Filtros de período: mês específico ou visão anual

### 📋 Lançamentos
- Listagem de gastos e receitas com filtros por mês, ano, tipo (Todos/Gastos/Receitas), tipo de pagamento e categoria
- **Seleção individual** com checkbox em cada item para deleção em massa
- Botão "Selecionar tudo" com contador de itens selecionados
- **Detecção automática de duplicatas** — itens com mesmo nome, categoria e valor no mesmo dia são sinalizados com badge `🔁 duplicata` e sugeridos para remoção
- Banner de alerta com contagem de duplicatas e botão para remover todas de uma vez
- Editar qualquer lançamento com modal completo
- Subtítulo informativo em cada item: `Quem pagou · Data · Tipo · Parcela X de N · Categoria`

### ➕ Registro de Gastos
**Ordem dos campos:** Descrição → Quem pagou → Tipo de pagamento → Categoria

- **PIX / Débito:** Valor + Data
- **Crédito parcelado:**
  - Nº de parcelas + Valor da Parcela
  - Valor Total calculado automaticamente (somente leitura)
  - Data da 1ª parcela
  - Banner informativo: `💳 Propagado de Jan/2026 até Jun/2026 · Total: R$ 600,00`
  - O valor armazenado é **o da parcela** — cada mês exibe o custo real daquele mês

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
│                   Browser                        │
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
- **Sem SDK do Supabase** — usa fetch direto com headers manuais para maior controle e bundle menor
- **Estado local** com React `useState` / `useMemo` — sem Redux ou Zustand
- **RLS no banco** — segurança no nível do banco, não apenas no frontend

---

## Banco de dados

### Tabelas

```sql
families        -- id, name, invite_code, created_at
family_members  -- id, family_id, user_id, role, joined_at
expenses        -- id, family_id, user_id, description, amount, date,
                --   category, type, parcelas, user_label, created_at
incomes         -- id, family_id, user_id, description, amount, date,
                --   source, category, user_label, created_at
profiles        -- id, first_name, last_name, phone, updated_at
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
- npm ou yarn
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
3. Execute o script `supabase/rpc_functions.sql` para criar as funções
4. Em **Authentication → Providers → Email**, desative "Confirm email" (o trigger `auto_confirm_user` já faz isso automaticamente)
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

### Deploy manual (primeira vez)

```bash
npm install -g vercel
vercel login
vercel --prod
```

### Deploy automático (após configuração do Git)

```bash
# Qualquer push para a branch main dispara um deploy automático
git add src/App.jsx
git commit -m "feat: descrição da mudança"
git push
```

O deploy leva aproximadamente 1 minuto e pode ser acompanhado em **vercel.com/dashboard**.

### Variáveis de ambiente na Vercel

Configure as mesmas variáveis do `.env.local` em:
**Vercel → Projeto → Settings → Environment Variables**

---

## Estrutura do projeto

```
financa-casal/
├── src/
│   └── App.jsx          # Aplicação completa (componentes, lógica, estilos)
├── public/
│   ├── favicon.svg      # Ícone diamante roxo
│   └── og-image.svg     # Imagem Open Graph (1200×630)
├── index.html           # HTML com SEO, Open Graph e PWA meta tags
├── vite.config.js       # Configuração do Vite
├── package.json
├── .gitignore
└── README.md
```

### Componentes principais em `App.jsx`

| Componente | Descrição |
|---|---|
| `App` | Root — gerencia autenticação, estado global e roteamento por abas |
| `LoginPage` | Tela de login/cadastro com fluxo de perfil e família |
| `SummaryCards` | Cards de resumo financeiro do mês atual |
| `CalendarView` | Calendário mensal com detalhes por dia |
| `ChartsView` | Gráficos de receitas, gastos e parcelas |
| `TransactionsList` | Lista de lançamentos com filtros, seleção e duplicatas |
| `ImportView` | Upload e preview de planilhas com detecção de duplicatas |
| `ExpenseForm` | Formulário de novo gasto (PIX/Débito/Crédito parcelado) |
| `IncomeForm` | Formulário de nova receita |
| `EditModal` | Edição de gasto ou receita existente |
| `MemberSelect` | Seletor dinâmico de membros da família |

---

## Roadmap

- [ ] Notificações push para vencimento de parcelas
- [ ] Metas financeiras mensais com progresso visual
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
