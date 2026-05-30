Execute uma varredura de segurança completa nas mudanças da branch atual. Analise cada categoria:

**1. AUTENTICAÇÃO & SESSÃO**
Busque em App.jsx e nos arquivos da branch por:
- `localStorage.setItem` com tokens — nunca em produção
- `_authToken` sendo exposto em logs ou respostas
- Lógica de refresh duplicada fora de `supabaseFetch()`
- Chamadas diretas à API do Supabase sem passar por `supabaseFetch()`

**2. ISOLAMENTO DE DADOS (RLS)**
Para cada `supabaseFetch()` nas mudanças:
- A query filtra por `family_id`? (`family_id=eq.${family.id}`)
- O `isDemo` é verificado antes de INSERT/UPDATE/DELETE?
- RPC functions novas precisam de SECURITY DEFINER?

**3. INPUTS & FORMULÁRIOS**
Para cada campo de formulário nas mudanças:
- Valores monetários usam `parseFloat()` antes de gravar?
- Datas são validadas no formato YYYY-MM-DD?
- Campos obrigatórios são checados antes do fetch?
- `dangerouslySetInnerHTML` está sendo usado? (nunca usar sem sanitização)
- `eval()` ou `Function()` estão sendo usados? (nunca usar)

**4. UPLOADS**
Para qualquer lógica de upload nas mudanças:
- MIME type é verificado antes de processar?
- Tamanho máximo de 10 MB é aplicado?
- Extensões são restringidas a: `.csv`, `.xlsx`, `.xls`, `.pdf`, `.txt`?

**5. SEGREDOS**
Busque em todos os arquivos modificados por:
- Strings que parecem chaves de API (`sk-`, `eyJ`, `service_role`)
- URLs com tokens inline
- Variáveis que incluam `password`, `secret`, `key`, `token` com valores hardcoded
- `ANTHROPIC_API_KEY` em qualquer arquivo do frontend

**6. HTTP & CSP**
Se novos domínios externos foram adicionados (CDN, API, fonte):
- Estão incluídos no `vercel.json` Content-Security-Policy?
- A requisição usa HTTPS?

**7. RELATÓRIO**
Para cada categoria, reporte:
- ✅ Sem problemas encontrados
- ⚠️ Atenção recomendada (explique)
- ❌ Problema crítico encontrado (explique e corrija antes de continuar)
