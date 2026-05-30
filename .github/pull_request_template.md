## O que foi feito

<!-- Descreva o que mudou e por quê. Uma linha por ponto. -->

-
-

---

## Checklist

### Código
- [ ] `npm run build` passou sem erros
- [ ] `npm run test` passou (quando testes estiverem implementados)
- [ ] Funcionalidade testada manualmente: desktop + mobile (375px) + dark mode
- [ ] Nenhuma funcionalidade existente foi quebrada (regressão)

### Testes
- [ ] Nova feature: caso de teste documentado em `CONTEXT.md` (Fase 1, 2 ou 3)
- [ ] Feature removida: testes e casos em `CONTEXT.md` removidos junto
- [ ] Bug corrigido: caso de teste adicionado para prevenir regressão

### Segurança
- [ ] Nenhuma chave, senha ou segredo hardcoded
- [ ] Inputs do usuário não executados como código
- [ ] Chamadas ao Supabase filtram por `family_id` (isolamento de dados)
- [ ] `isDemo` verificado antes de qualquer operação no banco
- [ ] Uploads validam tipo MIME + tamanho (máx 10 MB) — se aplicável

### Qualidade
- [ ] `window.confirm()` substituído por `ConfirmModal` — se aplicável
- [ ] Emojis de UI substituídos por `<Icon>` — se aplicável
- [ ] `Fragment` usado em vez de `React.Fragment` — se aplicável
- [ ] Sem `console.log()` em código de produção

### Documentação
- [ ] `CLAUDE.md` atualizado (novos padrões, armadilhas, regras) — se aplicável
- [ ] `CONTEXT.md` atualizado (schema, componentes, casos de teste, roadmap) — se aplicável
- [ ] `README.md` atualizado (features, estrutura, roadmap) — se aplicável

---

## Tipo de mudança

- [ ] Nova feature
- [ ] Correção de bug
- [ ] Refatoração (sem mudança de comportamento)
- [ ] Documentação
- [ ] Infra / configuração

## Issue relacionada

<!-- Fixes #número — se aplicável -->
