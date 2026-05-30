Vou planejar a implementação da feature "$ARGUMENTS" seguindo as boas práticas do projeto antes de escrever qualquer código.

**1. LEITURA OBRIGATÓRIA**
Leia CONTEXT.md e o trecho relevante de App.jsx antes de continuar.

**2. ANÁLISE DA FEATURE**
Responda:
- Essa feature está no roadmap do CONTEXT.md? Em qual sprint/fase?
- Requer nova tabela no banco ou usa dados existentes?
- Requer nova RPC function no Supabase?
- Requer novo componente ou extensão de um existente?
- Tem impacto em cálculos do Dashboard (totais, saldo, parcelas futuras)?
- Tem impacto em filtros do TransactionsList?

**3. IMPACTO DE SEGURANÇA**
- A feature processa inputs do usuário? Quais validações são necessárias?
- A feature faz queries ao banco? Confirme que filtram por `family_id`
- A feature tem upload de arquivo? Confirme validação de MIME + tamanho
- A feature toca em auth ou tokens? Confirme que não duplica lógica de refresh

**4. PLANO DE IMPLEMENTAÇÃO**
Liste em ordem:
1. Mudanças no banco (migrations SQL, se necessário)
2. Novos componentes ou funções em App.jsx
3. Integração com componentes existentes
4. Casos de erro e fallbacks

**5. PLANO DE TESTES**
Defina os casos de teste obrigatórios:
- Fase 1 (unit): quais funções puras extrair e testar?
- Fase 2 (component): quais cenários de renderização cobrir?
- Fase 3 (E2E): qual fluxo do usuário simular?

**6. IMPACTO NA DOCUMENTAÇÃO**
O que precisará ser atualizado:
- CLAUDE.md: nova armadilha, padrão ou regra?
- CONTEXT.md: novo componente, schema, caso de teste?
- README.md: nova feature visível ao usuário?
- DECISIONS.md: nova decisão arquitetural relevante?

**7. APROVAÇÃO**
Apresente o plano completo e aguarde confirmação antes de escrever qualquer código.
