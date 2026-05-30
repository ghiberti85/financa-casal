Execute o checklist completo de PR para as mudanças atuais desta branch. Siga cada passo na ordem:

**1. BUILD**
Execute `npm run build` e reporte se passou ou se há erros. Se falhar, identifique a causa antes de continuar.

**2. TESTES** (quando implementados)
Execute `npm run test` e reporte o resultado. Se ainda não há testes, confirme se o caso de teste da feature foi documentado em CONTEXT.md (seção "Plano de Testes").

**3. REVISÃO DE CÓDIGO**
Analise as mudanças em `src/App.jsx` e verifique:
- [ ] Nenhum `console.log()` deixado em produção
- [ ] `window.confirm()` não usado — apenas `ConfirmModal`
- [ ] Emojis de UI substituídos por `<Icon name="..." />`
- [ ] `Fragment` usado (nunca `React.Fragment`)
- [ ] Inline styles usando `t.prop` (nunca `#hexCor` hardcoded)

**4. SEGURANÇA**
Para cada chamada ao Supabase nas mudanças:
- [ ] Filtra por `family_id` — sem acesso cruzado entre famílias
- [ ] `isDemo` verificado antes de INSERT/UPDATE/DELETE
- [ ] Nenhuma chave ou segredo hardcoded

**5. DOCUMENTAÇÃO**
Verifique se os três arquivos estão atualizados para refletir as mudanças:
- [ ] `CLAUDE.md` — novos padrões, armadilhas ou regras adicionados?
- [ ] `CONTEXT.md` — schema, componentes, casos de teste ou roadmap alterados?
- [ ] `README.md` — novas features, estrutura ou roadmap alterados?
- [ ] Se nova feature: caso de teste documentado em CONTEXT.md?
- [ ] Se feature removida: testes e referências removidos dos três docs?

**6. RELATÓRIO FINAL**
Apresente um resumo em formato de checklist com ✅ (passou), ❌ (falhou) ou ⚠️ (atenção necessária) para cada item acima.

Se algum item falhou, corrija antes de continuar.
