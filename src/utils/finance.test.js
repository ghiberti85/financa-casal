import { describe, it, expect } from "vitest";
import { calcMonthVariation, buildMonthlySummary, calcGoalProgress, sumAmount, filterByMonth, getPendingRecurring } from "./finance.js";

describe("calcMonthVariation", () => {
  it("calcula aumento percentual", () => {
    expect(calcMonthVariation(1200, 1000)).toEqual({ pct: 20, direction: "up" });
  });

  it("calcula queda percentual", () => {
    expect(calcMonthVariation(800, 1000)).toEqual({ pct: 20, direction: "down" });
  });

  it("trata mês anterior zerado com gasto atual (sem dividir por zero)", () => {
    expect(calcMonthVariation(500, 0)).toEqual({ pct: 100, direction: "new" });
  });

  it("trata mês anterior zerado e mês atual também zerado", () => {
    expect(calcMonthVariation(0, 0)).toEqual({ pct: 0, direction: "flat" });
  });

  it("trata valores iguais como flat", () => {
    expect(calcMonthVariation(500, 500)).toEqual({ pct: 0, direction: "flat" });
  });
});

describe("buildMonthlySummary", () => {
  const expenses = [
    { description: "Aluguel", amount: 1500, category: "moradia" },
    { description: "Mercado", amount: 600, category: "alimentacao" },
    { description: "iFood", amount: 200, category: "alimentacao" },
  ];
  const incomes = [{ description: "Salário", amount: 5000 }];
  const prevExpenses = [
    { description: "Aluguel", amount: 1500, category: "moradia" },
    { description: "Mercado", amount: 400, category: "alimentacao" },
  ];

  it("calcula totais, saldo e variação com dados completos", () => {
    const s = buildMonthlySummary(expenses, incomes, prevExpenses);
    expect(s.totalExpenses).toBe(2300);
    expect(s.totalIncomes).toBe(5000);
    expect(s.balance).toBe(2700);
    expect(s.variation.direction).toBe("up");
    expect(s.hasData).toBe(true);
  });

  it("identifica a categoria que mais cresceu", () => {
    const s = buildMonthlySummary(expenses, incomes, prevExpenses);
    expect(s.topGrowingCategory.category).toBe("alimentacao");
    expect(s.topGrowingCategory.growth).toBe(400); // (600+200) - 400
  });

  it("identifica o maior gasto único do mês", () => {
    const s = buildMonthlySummary(expenses, incomes, prevExpenses);
    expect(s.biggestExpense.description).toBe("Aluguel");
    expect(s.biggestExpense.amount).toBe(1500);
  });

  it("lida com mês sem nenhum dado", () => {
    const s = buildMonthlySummary([], [], []);
    expect(s.totalExpenses).toBe(0);
    expect(s.totalIncomes).toBe(0);
    expect(s.balance).toBe(0);
    expect(s.biggestExpense).toBe(null);
    expect(s.topGrowingCategory).toBe(null);
    expect(s.hasData).toBe(false);
  });
});

describe("calcGoalProgress", () => {
  it("calcula % concluído corretamente", () => {
    const g = calcGoalProgress({ target_amount: "1000", current_amount: "250" });
    expect(g.pct).toBe(25);
    expect(g.reached).toBe(false);
    expect(g.remaining).toBe(750);
  });

  it("marca como atingida quando current >= target", () => {
    const g = calcGoalProgress({ target_amount: "1000", current_amount: "1200" });
    expect(g.reached).toBe(true);
    expect(g.pct).toBe(100); // nunca passa de 100%
    expect(g.remaining).toBe(0);
  });

  it("marca como vencida quando o prazo passou e a meta não foi atingida", () => {
    const g = calcGoalProgress(
      { target_amount: "1000", current_amount: "100", deadline: "2026-01-01" },
      new Date("2026-06-01")
    );
    expect(g.overdue).toBe(true);
  });

  it("não marca como vencida se a meta já foi atingida, mesmo com prazo passado", () => {
    const g = calcGoalProgress(
      { target_amount: "1000", current_amount: "1000", deadline: "2026-01-01" },
      new Date("2026-06-01")
    );
    expect(g.overdue).toBe(false);
  });
});

describe("sumAmount / filterByMonth", () => {
  it("soma valores de uma lista", () => {
    expect(sumAmount([{ amount: "10.50" }, { amount: 5 }])).toBe(15.5);
  });

  it("soma zero pra lista vazia ou undefined", () => {
    expect(sumAmount([])).toBe(0);
    expect(sumAmount(undefined)).toBe(0);
  });

  it("filtra por prefixo de mês", () => {
    const items = [{ date: "2026-09-01" }, { date: "2026-08-31" }, { date: "2026-09-15" }];
    expect(filterByMonth(items, "2026-09")).toHaveLength(2);
  });
});

describe("getPendingRecurring", () => {
  const ref = new Date("2026-09-15");

  it("inclui recorrente ativa sem lembrete registrado no mês", () => {
    const rules = [{ id: "r1", description: "Netflix", active: true, frequency: "monthly" }];
    expect(getPendingRecurring(rules, [], ref)).toHaveLength(1);
  });

  it("exclui recorrente já confirmada (status logged) no mês", () => {
    const rules = [{ id: "r1", description: "Netflix", active: true, frequency: "monthly" }];
    const reminders = [{ recurring_id: "r1", status: "logged" }];
    expect(getPendingRecurring(rules, reminders, ref)).toHaveLength(0);
  });

  it("exclui recorrente ignorada (status skipped) no mês", () => {
    const rules = [{ id: "r1", description: "Netflix", active: true, frequency: "monthly" }];
    const reminders = [{ recurring_id: "r1", status: "skipped" }];
    expect(getPendingRecurring(rules, reminders, ref)).toHaveLength(0);
  });

  it("exclui recorrente inativa", () => {
    const rules = [{ id: "r1", description: "Netflix", active: false, frequency: "monthly" }];
    expect(getPendingRecurring(rules, [], ref)).toHaveLength(0);
  });

  it("exclui recorrente anual fora do mês de referência", () => {
    const rules = [{ id: "r1", description: "IPVA", active: true, frequency: "yearly", month_of_year: 1 }];
    expect(getPendingRecurring(rules, [], ref)).toHaveLength(0);
  });

  it("inclui recorrente anual no mês de referência correto", () => {
    const rules = [{ id: "r1", description: "IPVA", active: true, frequency: "yearly", month_of_year: 9 }];
    expect(getPendingRecurring(rules, [], ref)).toHaveLength(1);
  });

  it("exclui recorrente já encerrada (end_date antes do mês de referência)", () => {
    const rules = [{ id: "r1", description: "Academia", active: true, frequency: "monthly", end_date: "2026-08-15" }];
    expect(getPendingRecurring(rules, [], ref)).toHaveLength(0);
  });
});
