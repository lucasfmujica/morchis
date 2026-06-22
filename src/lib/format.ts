// Money formatting helpers — all math in TypeScript, never in LLM.
// Amounts are stored as numeric(14,2): up to 2 decimals. We show cents only
// when present (minimumFractionDigits: 0) so whole amounts stay clean.

export function formatARS(amount: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount || 0); // `|| 0` collapses -0 so we never render "-$ 0"
}

export function formatUSD(amount: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount || 0); // `|| 0` collapses -0 so we never render "-US$ 0"
}

/**
 * Format the raw string being typed on the keypad (e.g. "1234,8") into a
 * currency display WITHOUT round-tripping through a float. This keeps the
 * decimal comma visible the moment it's pressed and preserves trailing zeros
 * (so "0,80" shows as "$ 0,80", not "$ 0,8"). The integer part is grouped via
 * Intl so the currency symbol/spacing matches formatARS/formatUSD exactly.
 */
export function formatTypedAmount(raw: string, currency: 'ARS' | 'USD'): string {
  const commaAt = raw.indexOf(',');
  const intDigits = (commaAt === -1 ? raw : raw.slice(0, commaAt)).replace(/\D/g, '');
  const intValue = intDigits ? parseInt(intDigits, 10) : 0;
  const intDisplay = new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(intValue);
  if (commaAt === -1) return intDisplay;
  const decDigits = raw.slice(commaAt + 1).replace(/\D/g, '').slice(0, 2);
  return `${intDisplay},${decDigits}`;
}

/**
 * Evaluate a small arithmetic expression typed in place of a plain amount, so
 * the user can do quick math while loading a movement ("1200+350", "990*3",
 * "5000/2"). Supports + − × ÷ with the usual precedence (× ÷ before + −).
 * Each operand is parsed with parseMoney (es-AR tolerant), so "1.200,50+300"
 * works too. A leading or trailing operator is ignored, a doubled operator
 * keeps the last one, and division by zero collapses to 0. Returns a number
 * rounded to 2 decimals (0 when there's nothing usable to evaluate).
 */
export function evalMoneyExpr(input: string): number {
  if (!input) return 0;
  const norm = input.replace(/×/g, '*').replace(/÷/g, '/').replace(/[−–—]/g, '-');
  const tokens = norm.match(/[\d.,]+|[+\-*/]/g);
  if (!tokens) return 0;

  const nums: number[] = [];
  const ops: string[] = [];
  let expectOperand = true;
  for (const t of tokens) {
    const isOp = t.length === 1 && '+-*/'.includes(t);
    if (isOp) {
      // Ignore a leading operator; collapse a run of operators to the last one.
      if (expectOperand) {
        if (ops.length > 0 && ops.length === nums.length) ops[ops.length - 1] = t;
        continue;
      }
      ops.push(t);
      expectOperand = true;
    } else {
      nums.push(parseMoney(t));
      expectOperand = false;
    }
  }
  if (nums.length === 0) return 0;

  // First pass: fold × and ÷ into running products; defer + and − to a second
  // pass so multiplication binds tighter than addition.
  const vals = [nums[0]];
  const addOps: string[] = [];
  for (let i = 0; i < ops.length && i + 1 < nums.length; i++) {
    const op = ops[i];
    const n = nums[i + 1];
    if (op === '*') vals[vals.length - 1] *= n;
    else if (op === '/') vals[vals.length - 1] = n === 0 ? 0 : vals[vals.length - 1] / n;
    else {
      addOps.push(op);
      vals.push(n);
    }
  }
  let result = vals[0];
  for (let i = 0; i < addOps.length; i++) {
    result = addOps[i] === '+' ? result + vals[i + 1] : result - vals[i + 1];
  }
  return Number.isFinite(result) ? roundMoney(result) : 0;
}

/** True when the string carries an arithmetic operator (so it's an expression,
 * not a plain amount). */
export function hasMoneyOperator(input: string): boolean {
  return /[+\-*/×÷]/.test(input);
}

/**
 * Format a typed expression for display: each operand gets es-AR thousands
 * grouping (keeping the decimal comma) and operators are shown as ×, ÷, −, +
 * with surrounding spaces. Used to echo the formula the user is building.
 */
export function formatExprDisplay(expr: string): string {
  const tokens = expr.match(/[\d.,]+|[+\-*/×÷]/g);
  if (!tokens) return '';
  return tokens
    .map((t) => {
      if (t.length === 1 && '+-*/×÷'.includes(t)) {
        const sym = t === '*' ? '×' : t === '/' ? '÷' : t === '-' ? '−' : t;
        return ` ${sym} `;
      }
      const commaAt = t.indexOf(',');
      const intDigits = (commaAt === -1 ? t : t.slice(0, commaAt)).replace(/\D/g, '');
      const intDisplay = intDigits ? parseInt(intDigits, 10).toLocaleString('es-AR') : '0';
      if (commaAt === -1) return intDisplay;
      const dec = t.slice(commaAt + 1).replace(/\D/g, '').slice(0, 2);
      return `${intDisplay},${dec}`;
    })
    .join('')
    .trim();
}

export function arsToUsd(ars: number, rateArsPerUsd: number): number {
  return roundMoney(ars / rateArsPerUsd);
}

export function usdToArs(usd: number, rateArsPerUsd: number): number {
  return roundMoney(usd * rateArsPerUsd);
}

/** Round to 2 decimals for storage/display, avoiding float drift. */
export function roundMoney(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Parse a money string into a number with up to 2 decimals.
 * Tolerant of es-AR formatting (1.234,56) and plain input (1234.56):
 * the LAST separator (',' or '.') is treated as the decimal point and any
 * earlier separators are thousands. Everything else is stripped.
 */
export function parseMoney(input: string): number {
  if (!input) return 0;
  const cleaned = input.replace(/[^\d.,]/g, '');
  if (!cleaned) return 0;
  const lastSep = Math.max(cleaned.lastIndexOf(','), cleaned.lastIndexOf('.'));
  let intPart: string;
  let decPart = '';
  if (lastSep === -1) {
    intPart = cleaned.replace(/\D/g, '');
  } else {
    intPart = cleaned.slice(0, lastSep).replace(/\D/g, '');
    decPart = cleaned.slice(lastSep + 1).replace(/\D/g, '').slice(0, 2);
  }
  const n = parseFloat(`${intPart || '0'}.${decPart || '0'}`);
  return Number.isFinite(n) ? roundMoney(n) : 0;
}
