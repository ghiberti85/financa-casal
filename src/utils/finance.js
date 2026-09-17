// ─── FUNÇÕES PURAS DE FINANÇAS ────────────────────────────────────────────────
// Nenhuma função aqui faz fetch, usa estado do React ou depende de IA.
// São o contexto estruturado que a Edge Function do assistente de IA vai
// receber já calculado — a IA só narra, nunca soma valores sozinha.

/**
 * Soma o total de uma lista de expenses/incomes já filtrada por mês.
 */
export function sumAmount(items) {
  return (items || []).reduce((s, item) => s + (parseFloat(item.amount) || 0), 0);
}

/**
 * Filtra expenses/incomes por prefixo de mês (YYYY-MM).
 */
export function filterByMonth(items, monthPrefix) {
  return (items || []).filter((item) => item.date?.startsWith(monthPrefix));
}

/**
 * Variação percentual entre o valor atual e o anterior.
 * Trata o caso de mês anterior zerado (não dá pra calcular % de variação
 * de um total que era zero — retorna direction "new" em vez de dividir por 0).
 */
export function calcMonthVariation(current, previous) {
  const cur = parseFloat(current) || 0;
  const prev = parseFloat(previous) || 0;
  if (prev === 0) {
    return { pct: cur === 0 ? 0 : 100, direction: cur === 0 ? "flat" : "new" };
  }
  const pct = Math.round(((cur - prev) / prev) * 100);
  return { pct: Math.abs(pct), direction: pct > 0 ? "up" : pct < 0 ? "down" : "flat" };
}

/**
 * Resumo mensal algorítmico: total do mês vs. anterior, categoria que mais
 * cresceu, e o maior gasto único do mês. Sem chamada de IA.
 */
export function buildMonthlySummary(expenses, incomes, prevExpenses) {
  const totalExpenses = sumAmount(expenses);
  const totalIncomes = sumAmount(incomes);
  const totalPrevExpenses = sumAmount(prevExpenses);
  const balance = totalIncomes - totalExpenses;
  const variation = calcMonthVariation(totalExpenses, totalPrevExpenses);

  const byCategory = (items) => {
    const map = {};
    (items || []).forEach((e) => {
      const cat = e.category || "outros";
      map[cat] = (map[cat] || 0) + (parseFloat(e.amount) || 0);
    });
    return map;
  };
  const currentByCat = byCategory(expenses);
  const prevByCat = byCategory(prevExpenses);

  let topGrowingCategory = null;
  let topGrowth = 0;
  Object.keys(currentByCat).forEach((cat) => {
    const growth = currentByCat[cat] - (prevByCat[cat] || 0);
    if (growth > topGrowth) { topGrowth = growth; topGrowingCategory = cat; }
  });

  const biggestExpense = (expenses || []).reduce((max, e) => {
    const amt = parseFloat(e.amount) || 0;
    return !max || amt > max.amount ? { description: e.description, amount: amt, category: e.category } : max;
  }, null);

  return {
    totalExpenses,
    totalIncomes,
    balance,
    variation,
    topGrowingCategory: topGrowingCategory ? { category: topGrowingCategory, growth: topGrowth } : null,
    biggestExpense,
    hasData: (expenses?.length || 0) > 0 || (incomes?.length || 0) > 0,
  };
}

/**
 * Progresso de uma meta financeira (tabela `goals`): % concluído, se já
 * bateu a meta, se o prazo já passou.
 */
export function calcGoalProgress(goal, referenceDate = new Date()) {
  const target = parseFloat(goal?.target_amount) || 0;
  const current = parseFloat(goal?.current_amount) || 0;
  const pct = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
  const reached = target > 0 && current >= target;
  const overdue = !reached && !!goal?.deadline && new Date(goal.deadline + "T23:59:59") < referenceDate;
  const remaining = Math.max(0, target - current);
  return { pct, reached, overdue, remaining };
}
