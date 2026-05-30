# Architecture Decision Records — Finanças do Casal

Cada decisão arquitetural relevante é documentada aqui no formato ADR.
**Não altere uma decisão sem abrir um PR com a justificativa e atualizar o status.**

---

## ADR-001 — Single-file architecture (`src/App.jsx`)

**Status:** Aceito

**Contexto:**
O projeto é um aplicativo pessoal iterado rapidamente por um desenvolvedor solo. A modularização em múltiplos arquivos exigiria overhead de importações, passagem de props entre arquivos e configuração de paths que adicionaria atrito sem benefício real na escala atual.

**Decisão:**
Toda a lógica, componentes e utilitários vivem em `src/App.jsx`. Um único arquivo, ~6.100 linhas.

**Alternativas descartadas:**
- `src/components/` com um arquivo por componente — adicionaria 30+ arquivos e importações para uma pessoa gerenciar
- Feature-based folders (`src/features/expenses/`, etc.) — overhead de organização desnecessário antes de ter time

**Consequências:**
- ✅ Iteração rápida: nenhum custo de navegação entre arquivos
- ✅ Contexto completo: a IA lê o arquivo inteiro e entende todas as dependências
- ⚠️ Arquivo grande: acima de ~6.000 linhas começa a dificultar a leitura (ver ADR-008)
- ⚠️ Merges podem gerar conflitos maiores se múltiplas branches tocarem regiões próximas

**Quando revisar:** quando o arquivo ultrapassar ~8.000 linhas e a performance do editor começar a degradar.

---

## ADR-002 — Sem TypeScript

**Status:** Aceito

**Contexto:**
Projeto pessoal com um desenvolvedor. TypeScript adicionaria tempo de setup, manutenção de tipos e complexidade na configuração do Vite sem retorno proporcional em um codebase gerenciado por uma pessoa.

**Decisão:**
JSX puro. Sem TypeScript, sem JSDoc tipado.

**Alternativas descartadas:**
- TypeScript com `strict: true` — custo de migração alto, retorno baixo em projeto solo
- JSDoc + `@ts-check` — compromisso ruim: a verbosidade do TypeScript sem o tooling completo

**Consequências:**
- ✅ Zero config de tipos, sem erros de compilação de tipo
- ✅ A IA pode editar o arquivo sem precisar manter compatibilidade de tipos
- ⚠️ Erros de tipo só aparecem em runtime
- ⚠️ Props de componentes não são auto-documentadas pelo compilador

**Quando revisar:** se o projeto ganhar um time ou se a superfície de bugs de tipo crescer significativamente.

---

## ADR-003 — Sem SDK Supabase (fetch manual)

**Status:** Aceito

**Contexto:**
O SDK Supabase (`@supabase/supabase-js`) adiciona ~50 KB ao bundle e introduz uma abstração que mascara o que está sendo enviado ao banco. Com fetch manual, cada query é explícita e auditável.

**Decisão:**
`supabaseFetch()` e `supabaseRpc()` são wrappers internos sobre `fetch`. Zero dependência do SDK.

**Alternativas descartadas:**
- SDK completo — bundle maior, menos controle sobre headers e retry logic
- SDK com tree-shaking — ainda adicionaria código desnecessário e ocultaria as queries

**Consequências:**
- ✅ Bundle menor
- ✅ Cada query é legível e auditável no próprio App.jsx
- ✅ Refresh de token implementado exatamente como necessário, sem colisão com lógica do SDK
- ⚠️ Real-time (subscriptions) não disponível sem o SDK — não é necessário por ora
- ⚠️ Queries precisam ser escritas em PostgREST syntax (`?select=*&family_id=eq.${id}`)

---

## ADR-004 — Inline styles com objeto de tema `t`

**Status:** Aceito

**Contexto:**
O app tem dois temas (dark/light) aplicados dinamicamente. Tailwind requer purge correto e não suporta valores dinâmicos sem CSS variables. CSS modules exigiriam um arquivo por componente. Inline styles com um objeto de tema permitem dark/light com zero configuração adicional.

**Decisão:**
Todos os estilos são inline (`style={{ color: t.text }}`). O objeto `t` é passado como prop para todos os componentes. Nenhum arquivo `.css` de componente, nenhuma classe Tailwind.

**Alternativas descartadas:**
- Tailwind com variáveis CSS — precisa de `dark:` prefix em cada classe, purge de classes dinâmicas
- CSS Modules — arquivo extra por componente, não funciona bem com o single-file approach (ADR-001)
- Styled-components — overhead de runtime e bundle

**Consequências:**
- ✅ Dark/light mode sem nenhuma configuração extra
- ✅ Qualquer novo componente herda o tema automaticamente via prop `t`
- ✅ Funciona perfeitamente com a arquitetura single-file
- ⚠️ Sem autocomplete de propriedades CSS no editor (sem CSS language server)
- ⚠️ Estilos repetitivos entre componentes (sem reutilização via classe)

---

## ADR-005 — Estado local (useState/useMemo) sem gerenciador global

**Status:** Aceito

**Contexto:**
A aplicação tem um estado relativamente plano: `expenses`, `incomes`, `family`, `user`, `cards`, etc. são carregados no componente `App` e passados para baixo via props. Não há necessidade de compartilhamento de estado entre sub-árvores díspares que justifique Redux ou Zustand.

**Decisão:**
`useState` e `useMemo` no componente `App`. Props drilling explícito. Sem Context API, sem Zustand, sem Redux.

**Alternativas descartadas:**
- Zustand — útil em equipe, desnecessário aqui; adicionaria indireção sem ganho
- Context API — adequado para tema e auth, mas o `t` já é passado como prop; duplicar via Context criaria dois caminhos
- Redux Toolkit — overkill severo para um projeto pessoal

**Consequências:**
- ✅ Fluxo de dados explícito e rastreável
- ✅ A IA pode seguir o fluxo de dados lendo apenas App.jsx
- ⚠️ Props drilling pode ficar profundo em componentes muito aninhados
- ⚠️ Adições de estado global exigem passar nova prop por toda a cadeia

---

## ADR-006 — Auth via Vercel API Routes (token em memória, refresh em cookie HttpOnly)

**Status:** Aceito

**Contexto:**
Supabase Auth retorna access + refresh token. Guardar o refresh token em localStorage expõe o usuário a ataques XSS (qualquer script injetado pode roubar a sessão permanentemente). A solução padrão de segurança é guardar o refresh token em um cookie HttpOnly (inacessível a JavaScript) e o access token apenas em memória.

**Decisão:**
- Vercel API Routes (`/api/auth/*`) fazem o handshake com Supabase e definem o cookie `HttpOnly; Secure; SameSite=Strict`
- Access token retornado no body → salvo em `_authToken` (variável em memória)
- 401 → `supabaseFetch` chama `/api/auth/refresh` → cookie enviado automaticamente pelo browser → novo access token

**Alternativas descartadas:**
- `localStorage` para ambos os tokens — vulnerável a XSS; qualquer extensão de browser pode exfiltrar
- Apenas memory para ambos — refresh perdido ao fechar a aba; UX ruim
- SDK Supabase Auth com `storage: 'cookie'` — exigiria o SDK (ver ADR-003) e menos controle

**Consequências:**
- ✅ Refresh token nunca acessível a JavaScript mesmo sob XSS
- ✅ Token rotation a cada refresh
- ✅ Logout server-side apaga o cookie definitivamente
- ⚠️ Requer API Routes no Vercel — não funciona com `npm run dev` sem configuração adicional
- ⚠️ Em desenvolvimento local, tokens ficam em `localStorage` por conveniência (flag `import.meta.env.DEV`)

---

## ADR-007 — Split payment com dois registros (`split_group_id`)

**Status:** Aceito

**Contexto:**
Um gasto pode ser pago com duas formas de pagamento (ex: R$50 em dinheiro + R$150 no PIX). Precisamos registrar ambos sem quebrar as somas de totais do Dashboard, filtros e gráficos.

**Decisão:**
Dois registros separados na tabela `expenses`, ambos compartilhando o mesmo `split_group_id` (UUID). Cada registro tem seu próprio `amount` e `type`. Os cálculos existentes funcionam sem nenhuma mudança — são simplesmente dois gastos vinculados.

**Alternativas descartadas:**
- Um registro com colunas `type2` e `amount2` — quebraria todas as queries existentes que somam `amount`; criaria valores nulos em 99% dos registros; violaria a forma normal do banco
- JSON array de pagamentos em uma coluna — impossível de filtrar e somar via PostgREST

**Consequências:**
- ✅ Zero impacto em somas, filtros, gráficos e orçamentos existentes
- ✅ Schema mínimo: uma coluna nullable `split_group_id UUID`
- ✅ Badge `✂️ dividido` exibido quando `split_group_id IS NOT NULL`
- ⚠️ Ao deletar um registro split, verificar e deletar o par (mesmo `split_group_id`)
- ⚠️ Importação CSV pode criar duplicatas de split — anti-duplicata já cobre via UNIQUE index

---

## ADR-008 — Quando dividir o App.jsx

**Status:** Proposto (ainda não atingido o threshold)

**Contexto:**
O App.jsx está em ~6.100 linhas (maio/2026). A arquitetura single-file (ADR-001) tem um limite prático quando o arquivo começa a degradar a performance do editor e dificultar a navegação mesmo com busca.

**Decisão (quando aplicar):**
Somente quando ultrapassar **~8.000 linhas** E a performance do editor degradar. A extração deve ser feita componente por componente, mantendo inline styles e passagem de props. Nenhuma mudança de comportamento.

**Ordem sugerida de extração:**
1. `ImportView` — mais isolado, sem dependências laterais
2. `ChartsView` — autocontido, apenas lê dados
3. `RecurringView` + `RecurringForm` — par coeso
4. `CalendarView` + `CalendarPickerModal` — par coeso
5. `TransactionsList` — maior, mais dependências
6. Componentes primitivos (`Modal`, `Input`, `Select`, `Btn`, `Icon`, `Toast`)

**Consequências da extração:**
- ✅ Arquivos menores, mais fáceis de navegar
- ⚠️ A IA precisará ler múltiplos arquivos por sessão em vez de um
- ⚠️ Props drilling fica mais explícito e verboso entre arquivos

---

## ADR-009 — `apple-touch-icon` como PNG (não SVG)

**Status:** Aceito

**Contexto:**
iOS Safari ignora silenciosamente SVG em `<link rel="apple-touch-icon">` e gera um fallback com a inicial do título da página. Isso foi descoberto quando o ícone instalado na home screen mostrava "F" ao invés do diamante.

**Decisão:**
`public/apple-touch-icon.png` (180×180 px RGBA) referenciado em `index.html`. O `favicon.svg` continua sendo usado para o ícone da aba do browser.

**Alternativas descartadas:**
- SVG para apple-touch-icon — não funciona de forma confiável no iOS
- Data URI inline no HTML — não é suportado por `<link rel="apple-touch-icon">`

**Consequências:**
- ✅ Ícone correto na home screen do iPhone em todas as versões iOS testadas
- ⚠️ Se o design do ícone mudar, é necessário regenerar o PNG (usar `generate-icon.cjs` localmente — não commitar o script)
- ⚠️ PNG binário no repositório — aumenta o tamanho do repo em ~2.7 KB

---

## Como adicionar um ADR

1. Copie o template abaixo
2. Incremente o número (`ADR-010`, etc.)
3. Preencha todos os campos
4. Abra PR com a descrição da decisão

```markdown
## ADR-XXX — Título curto

**Status:** Proposto | Aceito | Depreciado | Substituído por ADR-YYY

**Contexto:**
Por que essa decisão precisou ser tomada?

**Decisão:**
O que foi decidido exatamente?

**Alternativas descartadas:**
- Alternativa A — por que não
- Alternativa B — por que não

**Consequências:**
- ✅ Ganhos
- ⚠️ Custos / trade-offs

**Quando revisar:** condição que justificaria reabrir a discussão.
```
