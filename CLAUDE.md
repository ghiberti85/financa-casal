# Instruções para o Claude Code — Finanças do Casal

## Leitura Obrigatória
Leia o `CONTEXT.md` antes de qualquer tarefa.
Ele contém arquitetura, schema do banco, componentes, decisões técnicas e o **Roadmap de Lançamento Público** — verifique o status dos sprints antes de implementar qualquer nova feature.

---

## Primeira Coisa a Fazer em Cada Sessão

```
1. Leia CONTEXT.md
2. Leia src/App.jsx completo (é o arquivo principal — tudo está nele)
3. Resuma o que entendeu antes de escrever qualquer código
```

---

## Ciclo de Vida Completo de uma Alteração

Todo código que vai a produção **obrigatoriamente** segue este fluxo:

```
┌─────────────────────────────────────────────────────────────────┐
│  1. Branch       git checkout -b feat/nome  (ou fix/, docs/)    │
│  2. Código       editar App.jsx + assets                        │
│  3. Testes       npm run test  (quando implementados)           │
│                  + testar manualmente no browser (mobile+desk)  │
│  4. Build        npm run build  — deve passar sem erros         │
│  5. Segurança    verificar checklist de segurança abaixo        │
│  6. Docs         atualizar CLAUDE.md + CONTEXT.md + README.md   │
│  7. PR           abrir PR descritivo no GitHub                  │
│  8. Merge        squash merge para main                         │
│  9. Deploy       Vercel faz auto-deploy em ~1 min após merge    │
└─────────────────────────────────────────────────────────────────┘
```

### Ao ADICIONAR uma feature
1. Implementar em `App.jsx`
2. Escrever o teste (Vitest/RTL/Playwright) — ou, se testes ainda não estiverem implementados, **documentar o caso de teste obrigatório em CONTEXT.md** (seção "Plano de Testes", Fase 1/2/3)
3. `npm run test` + `npm run build`
4. Verificar checklist de segurança
5. Atualizar os três arquivos de docs
6. Branch → PR → merge

### Ao REMOVER uma feature
1. Remover o código de `App.jsx`
2. Remover os testes correspondentes (arquivos `.test.jsx`, `.spec.js`)
3. Remover referências em `CLAUDE.md`, `CONTEXT.md` e `README.md` — sem deixar entradas mortas
4. Verificar que o restante do código não depende do que foi removido
5. `npm run build`
6. Branch → PR → merge

### Ao CORRIGIR um bug
1. Identificar a causa raiz antes de corrigir
2. Se o bug expõe lacuna de teste: adicionar o caso de teste
3. `npm run test` + `npm run build`
4. Verificar checklist de segurança se o bug for de data, input ou auth
5. Branch (`fix/nome`) → PR → merge

---

## Checklist de PR (executar SEMPRE antes de abrir)

```
CÓDIGO
[ ] npm run build passou sem erros
[ ] npm run test passou (quando testes estiverem implementados)
[ ] Funcionalidade testada manualmente: desktop + mobile (375px) + dark mode
[ ] Nenhuma funcionalidade existente foi quebrada (regressão)

TESTES
[ ] Nova feature: caso de teste documentado em CONTEXT.md (Fase 1, 2 ou 3)
[ ] Feature removida: testes e casos em CONTEXT.md removidos junto
[ ] Bug corrigido: caso de teste adicionado para prevenir regressão

SEGURANÇA
[ ] Nenhuma chave, senha ou segredo hardcoded
[ ] Inputs do usuário não executados como código
[ ] Chamadas ao Supabase filtram por family_id (isolamento de dados)
[ ] isDemo verificado antes de qualquer operação no banco
[ ] Uploads validam tipo MIME + tamanho (máx 10 MB)

QUALIDADE
[ ] window.confirm() substituído por ConfirmModal onde aplicável
[ ] Emojis de UI substituídos por <Icon>
[ ] Fragment usado em vez de React.Fragment
[ ] Sem console.log() em código de produção

DOCUMENTAÇÃO
[ ] CLAUDE.md atualizado (novos padrões, armadilhas, regras)
[ ] CONTEXT.md atualizado (schema, componentes, casos de teste, roadmap)
[ ] README.md atualizado (features, estrutura, roadmap)
```

> **Regra de ouro:** os três arquivos de documentação (`CLAUDE.md`, `CONTEXT.md`, `README.md`) devem sempre refletir o estado real do código. Nunca abrir PR sem revisar os três.

---

## Checklist de Segurança

Verificar em todo PR que toque em auth, formulários, banco ou uploads:

```
AUTH & SESSÃO
[ ] Access token nunca gravado em localStorage em produção
[ ] Refresh token nunca exposto no frontend (cookie HttpOnly)
[ ] supabaseFetch() cuida do refresh — não duplicar essa lógica

BANCO DE DADOS
[ ] Toda query filtra por family_id — zero acesso cruzado entre famílias
[ ] RPC functions usam SECURITY DEFINER quando precisam bypassar RLS
[ ] isDemo verificado antes de qualquer INSERT/UPDATE/DELETE
[ ] Importação usa ON CONFLICT DO NOTHING (nunca ON CONFLICT DO UPDATE)

INPUTS & FORMULÁRIOS
[ ] Valores monetários convertidos com parseFloat() antes de gravar
[ ] Datas validadas antes de enviar (formato YYYY-MM-DD)
[ ] Campos obrigatórios validados no frontend antes do fetch
[ ] Sem dangerouslySetInnerHTML; sem eval() ou Function()

UPLOADS
[ ] MIME type verificado antes de processar
[ ] Tamanho máximo 10 MB aplicado
[ ] Extensões permitidas: .csv, .xlsx, .xls, .pdf, .txt
[ ] Arquivo processado localmente — nunca exposto a terceiros exceto Edge Function Supabase

SEGREDOS
[ ] Nenhuma env var ANTHROPIC_API_KEY no frontend (vive no Supabase Vault)
[ ] VITE_SUPABASE_ANON_KEY é pública por design — não confundir com service_role_key
[ ] Nenhum segredo em comentários, logs ou mensagens de erro ao usuário

HTTP
[ ] CSP em vercel.json cobre todos os domínios externos usados
[ ] Novos domínios externos (CDN, API) adicionados ao CSP antes de usar
```

---

## Regras Críticas — NUNCA Violar

### Sobre o arquivo App.jsx
- **Todo o código novo vai em `src/App.jsx`** — é uma decisão arquitetural deliberada, não um erro
- Nunca criar arquivos separados em `src/components/` sem aprovação explícita do usuário
- Nunca remover funcionalidades existentes ao aplicar mudanças — leia o arquivo ANTES de editar
- Ao adicionar componente novo: inserir na ordem lógica dentro do App.jsx, com comentário separador `// ─── NOME DO COMPONENTE ───`

### Sobre estilos
- **Apenas inline styles** — nunca adicionar classes Tailwind, CSS modules ou arquivos `.css`
- Sempre usar o objeto `t` (tema) para cores: `style={{ color: t.text }}`, nunca hardcodar cores
- O `t` é passado como prop para todos os componentes — sempre incluir `t` nas props de novos componentes
- Exceção: `@keyframes` e classes CSS globais existem dentro da `<style>` tag no JSX do componente `App` — usá-las via `className` é permitido

### Sobre ícones
- **Sempre usar `<Icon name="..." />`** para ícones de ação da UI
- **Nunca usar emojis como ícones de UI** (✏️ 🗑 👤 👥 💳 🌙 ☀️ 🚪)
- Emojis de **conteúdo** são permitidos (categorias, títulos de seção, toasts, badges)
- Lista completa de ícones disponíveis em `ICON_PATHS`: `home`, `calendar`, `chart`, `pieChart`, `list`, `target`, `repeat`, `upload`, `download`, `plus`, `minus`, `more`, `search`, `x`, `trash`, `edit`, `check`, `filter`, `sun`, `moon`, `user`, `users`, `card`, `logout`, `chevronLeft`, `chevronRight`, `chevronDown`, `arrowUp`, `arrowDown`, `wallet`, `bell`, `menuLines`
- Para adicionar um ícone novo: inserir em `ICON_PATHS` com o path SVG do Lucide

### Sobre o Supabase
- Usar `supabaseFetch()` para queries REST — nunca importar o SDK Supabase
- Usar `supabaseRpc()` para funções RPC
- Sempre verificar `if (isDemo) return;` antes de chamadas ao banco
- `amount` em `expenses` é SEMPRE o valor da parcela — nunca o total
- `ON CONFLICT DO NOTHING` em todas as inserções da importação

### Sobre autenticação
- Token em memória como `_authToken` (produção) ou `localStorage` como `sb_token`/`sb_refresh` (dev)
- Refresh automático já implementado em `supabaseFetch()` — não duplicar essa lógica

### Sobre JSX e React
- Usar `Fragment` (named import) — **nunca `React.Fragment`**
- O JSX transform do Vite não injeta `React` global — `React.Fragment` causa `ReferenceError`
- Import correto: `import { useState, useEffect, ..., Fragment } from "react"`

### Sobre commits e PRs
- Rodar `npm run build` antes de commitar — se falhar, corrigir antes
- Criar uma branch por feature/fix: `git checkout -b feat/nome` ou `fix/nome`
- Commit com mensagem descritiva em português ou inglês
- Push para a branch: `git push -u origin nome-da-branch`
- Abrir PR e mergear — **nunca** commitar direto no `main`
- **Antes de abrir o PR:** verificar e atualizar `CLAUDE.md`, `CONTEXT.md` e `README.md` se necessário

---

## Padrão para Novo Componente

```jsx
// ─── NOME DO COMPONENTE ──────────────────────────────────────────────────────
function NomeDoComponente({ t, family, user, isDemo, addToast, ...props }) {
  const [estado, setEstado] = useState(null);

  async function carregarDados() {
    if (isDemo) {
      setEstado(dadosFake);
      return;
    }
    try {
      const data = await supabaseFetch("/tabela?select=*");
      setEstado(data);
    } catch (err) {
      addToast(err.message, "error");
    }
  }

  useEffect(() => { carregarDados(); }, [family?.id]);

  return (
    <div style={{ background: t.glass, borderRadius: 16, padding: 20 }}>
      {/* conteúdo */}
    </div>
  );
}
```

**Ao criar um novo componente, obrigatoriamente:**
1. Adicionar a entrada na tabela de componentes do `CONTEXT.md`
2. Documentar o caso de teste correspondente no plano de testes do `CONTEXT.md`
3. Atualizar a seção de Features do `README.md` se for visível ao usuário

---

## Padrão de Ícones

```jsx
// Ícone simples
<Icon name="edit" size={16} color={t.textMuted} />

// Ícone em botão de ação (inline)
<button onClick={...}
  style={{ background:"transparent", border:"none", cursor:"pointer",
           color:t.textMuted, padding:"4px 6px", borderRadius:6,
           display:"flex", alignItems:"center" }}
  onMouseEnter={e=>e.currentTarget.style.color=t.accent}
  onMouseLeave={e=>e.currentTarget.style.color=t.textMuted}>
  <Icon name="edit" size={14} />
</button>

// Ícone com texto em menu/botão
<button style={{ display:"flex", alignItems:"center", gap:10, ... }}>
  <Icon name="logout" size={15} color={t.danger} />Sair
</button>
```

---

## Padrão de Long-Press

```jsx
// Hook
const { pressingId, start, cancel } = useLongPress(
  useCallback((id) => { /* ação ao completar */ }, [dep]),
  500 // ms
);

// No card
const isLong = pressingId === item.id;

<div
  style={{
    ...
    transform: isLong ? "scale(1.015)" : "none",
    boxShadow: isLong ? undefined : "none",
    animation: isLong ? "lpGlow 500ms linear forwards" : undefined,
    // transition deve incluir: "transform 120ms, box-shadow 120ms"
  }}
  onMouseDown={() => start(item.id)}
  onMouseUp={cancel}
  onMouseLeave={cancel}
  onTouchStart={() => start(item.id)}
  onTouchEnd={cancel}
  onTouchCancel={cancel}
>
```

> ⚠️ **NUNCA usar SVG `stroke-dashoffset` para o ring do long-press.** O `@keyframes lpGlow` anima `box-shadow`, que segue o `border-radius` do card nativamente em qualquer tamanho de tela.

---

## Padrão de Confirmação de Deleção

```jsx
// Estado no componente
const [confirmOpts, setConfirmOpts] = useState(null);
const openConfirm = (title, message, onConfirm) =>
  setConfirmOpts({ title, message, onConfirm });
const closeConfirm = () => setConfirmOpts(null);

// Disparar
const handleDelete = () => {
  openConfirm(
    "Remover lançamento",
    "Esta ação não pode ser desfeita.",
    () => doDelete()
  );
};

// No return
<ConfirmModal
  open={!!confirmOpts}
  title={confirmOpts?.title}
  message={confirmOpts?.message}
  onConfirm={() => { confirmOpts?.onConfirm(); closeConfirm(); }}
  onCancel={closeConfirm}
  t={t}
/>
```

> Nunca usar `window.confirm()` — não respeita o tema e bloqueia thread.

---

## Padrão de Chamadas ao Supabase

```javascript
// SELECT
const data = await supabaseFetch(
  `/expenses?family_id=eq.${family.id}&select=*&order=date.desc`
);

// INSERT
await supabaseFetch("/expenses", {
  method: "POST",
  body: JSON.stringify({ family_id: family.id, ...campos }),
});

// UPDATE
await supabaseFetch(`/expenses?id=eq.${id}`, {
  method: "PATCH",
  body: JSON.stringify({ campo: valor }),
});

// DELETE
await supabaseFetch(`/expenses?id=eq.${id}`, {
  method: "DELETE",
  headers: { "Prefer": "return=minimal" },
});

// RPC
const resultado = await supabaseRpc("nome_da_funcao", { parametro: valor });
```

---

## Padrão de Toast (Notificações)

```javascript
addToast("Gasto registrado com sucesso!", "success");
addToast("Erro ao salvar. Tente novamente.", "error");
addToast("Atenção: duplicata detectada.", "warning");
```

---

## Padrão de Modal

```jsx
<Modal open={showModal} onClose={() => setShowModal(false)} title="Título" t={t} darkMode={darkMode}>
  <ConteudoDoModal />
</Modal>
```

---

## Formatação de Valores

```javascript
// Moeda brasileira
const fmt = (v) => `R$ ${Number(v || 0).toLocaleString("pt-BR", {
  minimumFractionDigits: 2, maximumFractionDigits: 2
})}`;

// Valor compacto (gráficos)
const fmtShort = (v) => v >= 1000 ? `${(v/1000).toFixed(1)}k` : v;

// Data
const MONTHS = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
const MONTH_FULL = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho",
                    "Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
```

---

## Próximas Features — Pré-lançamento

> Para cada feature abaixo, ao implementar: (1) escrever o teste correspondente, (2) documentar o caso de teste em CONTEXT.md se ainda não constar, (3) atualizar os três arquivos de docs.

### 1. Resumo Mensal Algorítmico
Card no Dashboard com resumo calculado sem IA: total do mês vs anterior (% variação), categoria que mais cresceu, maior gasto único, recorrentes pendentes. Implementar com string templates e cálculos sobre `expenses`/`incomes` já carregados. Sem nova tabela, sem chamada de API externa.
**Teste obrigatório:** Fase 1 — função pura `buildMonthlySummary(expenses, incomes, prevExpenses)` com casos de variação positiva, negativa e mês sem dados.

### 2. Notificações de Vencimento de Parcelas
Banner/card no Dashboard alertando parcelas que vencem nos próximos 7 dias.
Filtrar `expenses` onde `type = 'credit'` e `date` está entre hoje e hoje+7.
Não requer nova tabela — apenas lógica de filtro no frontend.
**Teste obrigatório:** Fase 1 — `getUpcomingInstallments(expenses, today)` com parcelas vencendo em 0, 7 e 8 dias.

### 3. Metas Financeiras Mensais
Nova seção no Dashboard ou tab dedicada.
Nova tabela `goals`: `(id, family_id, description, target_amount, current_amount, deadline, category, created_at)`.
Barra de progresso visual por meta. Integração com saldo do mês atual.
**Teste obrigatório:** Fase 2 — componente `GoalsView` renderiza barra de progresso com % correto; Fase 3 — criar, editar e deletar meta.

### 4. Comparativo Mês a Mês
Indicadores de variação (`↑ 23%`, `↓ 8%`) ao lado dos totais no Dashboard.
Calcular diferença entre mês atual e mês anterior usando `expenses`/`incomes` já carregados.
Sem nova tabela.
**Teste obrigatório:** Fase 1 — `calcMonthVariation(current, previous)` com cenários de aumento, queda e mês anterior zerado.

### 5. Previsão de Saldo ao Fim do Mês
Estimativa baseada em: recorrentes ativos (`recurring_expenses`) + média de gastos variáveis dos últimos 3 meses. Card simples no Dashboard. Sem nova tabela.
**Teste obrigatório:** Fase 1 — `forecastBalance(income, recurring, last3months)` com histórico completo e incompleto.

### 6. Alerta de Fatura Chegando
Card no Dashboard 3 dias antes do vencimento do cartão.
Usa `cards.due_day` já existente. Sem nova tabela.
**Teste obrigatório:** Fase 1 — `getCardsNearDue(cards, today)` com vencimento em 0, 3 e 4 dias.

### 7. Divisão de Gastos Entre o Casal
Painel com: quanto cada membro gastou no mês e o "acerto" (quem deve quanto a quem).
Usa `user_label` já presente em todas as despesas. Sem nova tabela.
**Teste obrigatório:** Fase 1 — `calcCoupleSplit(expenses)` com gastos balanceados e desbalanceados; Fase 2 — exibe "acerto" correto no componente.

---

## Próximas Features — Pós-lançamento

### 8. Foto de Recibo → Registro Automático
Câmera do celular → Edge Function extrai valor, data e categoria via Claude Vision → preenche formulário.
Requer nova Edge Function. Alto impacto para usuários mobile.
**Teste obrigatório:** Fase 3 — upload de imagem de teste → campos do formulário preenchidos.

### 9. Relatório Anual / Retrospectiva
Painel do ano: maiores gastos, mês mais caro, categorias que mais cresceram.
Sem nova tabela. Alto potencial de compartilhamento social.
**Teste obrigatório:** Fase 1 — `buildAnnualReport(expenses, incomes)` com ano completo e parcial.

### 10. Exportação de Relatórios em PDF
Botão na aba Gráficos e Lançamentos.
Gerar server-side via Edge Function (preferível a `jsPDF + html2canvas` com glassmorphism).
**Teste obrigatório:** Fase 3 — clicar em exportar retorna resposta com Content-Type application/pdf.

### 11. Score de Saúde Financeira
Pontuação 0–100 mensal: saldo positivo, orçamento respeitado, metas atingidas, recorrentes em dia.
Gamificação para aumentar retenção.
**Teste obrigatório:** Fase 1 — `calcHealthScore(data)` retorna 0–100 com casos extremos.

### 12. Orçamento por Percentuais (50/30/20)
Configurar orçamento como % da renda em vez de valores fixos por categoria.
Extensão natural do `BudgetView` existente.
**Teste obrigatório:** Fase 1 — `calcPercentBudget(income, percentages)` com renda zero e percentuais somando ≠ 100.

### 13. Divisão do App.jsx em Arquivos Separados
Somente quando ultrapassar ~6.000 linhas e dificultar manutenção.
Criar `src/components/` e extrair um a um. Manter padrão de props e inline styles.
**Teste obrigatório:** Fase 2 — todos os componentes extraídos continuam renderizando identicamente.

### 14. Testes Automatizados (implementação)
Plano em 3 fases — ver detalhamento completo em `CONTEXT.md` (seção "Plano de Testes Automatizados").
**Pré-requisito:** extrair funções puras de App.jsx para `src/utils/finance.js` e importá-las de volta. Zero impacto visual ou comportamental no app.

---

## Armadilhas Conhecidas

1. **`amount` em expenses** — sempre parcela, nunca total. Total = `amount × parcelas`.

2. **isDemo** — sempre verificar antes de chamar Supabase. Dados demo são arrays locais.

3. **Último admin** — `update_member_role` RPC tem proteção contra remover último admin. Não duplicar essa lógica no frontend.

4. **Refresh token** — `supabaseFetch` já faz retry automático. Não implementar refresh manual em outros lugares.

5. **Anti-duplicata** — o índice UNIQUE no banco garante idempotência. O frontend apenas alerta visualmente — não bloquear a importação.

6. **Inline styles e tema** — sempre `t.propDoTema`, nunca `#hexCor` hardcoded exceto para cores absolutas como `"#fff"` ou `"transparent"`.

7. **Recharts e responsividade** — sempre usar `ResponsiveContainer` wrapping os gráficos.

8. **`React.Fragment` não existe no escopo** — o JSX transform do Vite 8 não injeta `React` como global. Sempre importar `Fragment` pelo nome: `import { ..., Fragment } from "react"` e usar `<Fragment key={...}>`.

9. **Long-press ring via box-shadow** — usar `animation: "lpGlow 500ms linear forwards"` no `style` do card. Nunca usar SVG `<rect>` com `stroke-dashoffset` — o SVG com viewBox quadrado não cobre corretamente cards retangulares.

10. **ConfirmModal, nunca window.confirm()** — `window.confirm()` não respeita o tema, bloqueia a thread e não funciona em alguns browsers mobile (WebViews). Usar sempre o componente `ConfirmModal`.

11. **Commits direto no main** — proibido. Sempre usar branch + PR. O Vercel faz auto-deploy no push para `main`, então um commit com erro quebra produção.

12. **Pagamento dividido (split)** — um gasto dividido em duas formas de pagamento cria **dois registros separados** no banco, ambos com o mesmo `split_group_id` (UUID). Nunca tentar armazenar dois pagamentos em um único registro. Ao deletar um dos pares, verificar `split_group_id` e incluir o parceiro na operação. Badge `✂️ dividido` é exibido na lista quando `split_group_id` não é null.

13. **Modal swipe-to-close** — o gesto de arrastar para baixo que fecha o modal está vinculado **apenas** ao handle bar e ao header. O body do modal tem scroll livre sem interferência. Nunca adicionar `onTouchMove` de dismiss no elemento scrollável do body — causa fechamento acidental em formulários longos.

14. **Ícone PWA no iOS (`apple-touch-icon`)** — iOS Safari ignora SVG em `<link rel="apple-touch-icon">` e gera um fallback com a inicial do título da página. O ícone da home screen **deve** ser um PNG (recomendado 180×180). O projeto mantém `public/apple-touch-icon.png` para esse fim. Se precisar regenerar (ex: novo design), use `generate-icon.cjs` localmente (não commitar o script — ele é descartável). `favicon.svg` continua sendo usado como ícone no browser/aba.

15. **Remoção de feature** — ao remover qualquer funcionalidade: remover o código, remover o teste, remover a entrada na tabela de componentes do CONTEXT.md, remover da seção de Features do README.md. Nunca deixar referências mortas nos docs.

16. **console.log em produção** — nunca deixar `console.log()` em código que vai a produção. O Vite não remove logs automaticamente — eles ficam expostos nas DevTools do usuário.
