# Instruções para o Claude Code — Finanças do Casal

## Leitura Obrigatória
Leia o `CONTEXT.md` antes de qualquer tarefa.
Ele contém arquitetura, schema do banco, componentes e decisões técnicas.

---

## Primeira Coisa a Fazer em Cada Sessão

```
1. Leia CONTEXT.md
2. Leia src/App.jsx completo (é o arquivo principal — tudo está nele)
3. Resuma o que entendeu antes de escrever qualquer código
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

### Sobre o Supabase
- Usar `supabaseFetch()` para queries REST — nunca importar o SDK Supabase
- Usar `supabaseRpc()` para funções RPC
- Sempre verificar `if (isDemo) return;` antes de chamadas ao banco
- `amount` em `expenses` é SEMPRE o valor da parcela — nunca o total
- `ON CONFLICT DO NOTHING` em todas as inserções da importação

### Sobre autenticação
- Token em `localStorage` como `sb_token` e `sb_refresh`
- Refresh automático já implementado em `supabaseFetch()` — não duplicar essa lógica

### Sobre commits
- Rodar `npm run build` antes de commitar
- Se build falhar, corrigir antes do commit
- Commit com mensagem descritiva em português ou inglês
- Push para `origin main` após cada commit

---

## Padrão para Novo Componente

```jsx
// ─── NOME DO COMPONENTE ──────────────────────────────────────────────────────
function NomeDoComponente({ t, family, user, isDemo, addToast, ...props }) {
  const [estado, setEstado] = useState(null);

  // Sempre verificar demo antes de chamadas ao banco
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

## Próximas Features (por prioridade)

### 1. Metas Financeiras Mensais
Nova tab "🎯 Metas" ou seção no Dashboard.
Nova tabela `goals` no Supabase: `(id, family_id, description, target_amount, current_amount, deadline, category, created_at)`.
Barra de progresso visual por meta. Integração com saldo do mês atual.

### 2. Notificações de Vencimento de Parcelas
Banner/card no Dashboard alertando parcelas que vencem nos próximos 7 dias.
Baseado na tabela `expenses` onde `type = 'credit'` e `date` está próxima.
Não requer nova tabela — apenas lógica de filtro no frontend.

### 3. Exportação de Relatórios em PDF
Botão "Exportar PDF" na aba Gráficos e Lançamentos.
Usar `jsPDF` + `html2canvas` para capturar os gráficos Recharts.
Relatório mensal com: resumo, gráficos, lista de lançamentos.

### 4. Divisão do App.jsx em arquivos separados
Apenas quando o arquivo dificultar a manutenção.
Criar pasta `src/components/` e extrair componentes um a um.
Manter o mesmo padrão de props e inline styles.

### 5. Suporte a múltiplas moedas
Campo `currency` nas tabelas `expenses` e `incomes`.
Taxa de câmbio via API externa (exchangerate-api.com — gratuito).
Conversão para BRL na exibição dos totais.

---

## Armadilhas Conhecidas

1. **`amount` em expenses** — sempre parcela, nunca total. Total = `amount × parcelas`.

2. **isDemo** — sempre verificar antes de chamar Supabase. Dados demo são arrays locais.

3. **Último admin** — `update_member_role` RPC tem proteção contra remover último admin. Não duplicar essa lógica no frontend.

4. **Refresh token** — `supabaseFetch` já faz retry automático. Não implementar refresh manual em outros lugares.

5. **Anti-duplicata** — o índice UNIQUE no banco garante idempotência. O frontend apenas alerta visualmente — não bloquear a importação.

6. **Inline styles e tema** — sempre `t.propDoTema`, nunca `#hexCor` hardcoded exceto para cores absolutas como `"#fff"` ou `"transparent"`.

7. **Recharts e responsividade** — sempre usar `ResponsiveContainer` wrapping os gráficos.
