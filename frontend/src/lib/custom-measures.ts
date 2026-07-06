// ──────────────────────────────────────────────
// Custom Measures (Calculated Fields)
// ──────────────────────────────────────────────
//
// A safe, dependency-free arithmetic formula engine for user-defined measures.
// Formulas reference existing columns (and previously-defined measures) by name
// and combine them with arithmetic operators and a small set of functions.
//
// Example formulas:
//   [revenue] - [cost]
//   profit / revenue * 100
//   round([margin], 2)
//   coalesce([discount], 0)
//
// Field references may be bracketed ([Column Name]) — required for names with
// spaces/punctuation — or bare identifiers for simple names. Evaluation is
// row-wise and pure: no eval(), no globals, no side effects.

export interface CustomMeasure {
  /** Stable id (used as React key + to reference/delete). */
  id: string;
  /** Output column name. */
  name: string;
  /** Formula expression. */
  formula: string;
}

export interface FormulaValidation {
  valid: boolean;
  error?: string;
  /** Field/measure names the formula references. */
  referencedFields: string[];
}

// ── Supported functions (row-level, numeric) ──
const FUNCTIONS: Record<string, (args: number[]) => number> = {
  abs: (a) => Math.abs(a[0]),
  round: (a) => {
    const d = a[1] ?? 0;
    const f = Math.pow(10, d);
    return Math.round(a[0] * f) / f;
  },
  floor: (a) => Math.floor(a[0]),
  ceil: (a) => Math.ceil(a[0]),
  sqrt: (a) => Math.sqrt(a[0]),
  pow: (a) => Math.pow(a[0], a[1]),
  min: (a) => Math.min(...a),
  max: (a) => Math.max(...a),
  coalesce: (a) => {
    for (const v of a) if (v != null && !Number.isNaN(v)) return v;
    return NaN;
  },
};

// ── AST ──
type Node =
  | { kind: 'num'; value: number }
  | { kind: 'field'; name: string }
  | { kind: 'unary'; op: '-'; operand: Node }
  | { kind: 'binary'; op: string; left: Node; right: Node }
  | { kind: 'call'; name: string; args: Node[] };

type Token =
  | { t: 'num'; v: string }
  | { t: 'ident'; v: string }
  | { t: 'field'; v: string }
  | { t: 'op'; v: string }
  | { t: 'lparen' }
  | { t: 'rparen' }
  | { t: 'comma' };

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const c = input[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
    if (c === '[') {
      const end = input.indexOf(']', i);
      if (end === -1) throw new Error('Unclosed [ in field reference');
      tokens.push({ t: 'field', v: input.slice(i + 1, end).trim() });
      i = end + 1;
      continue;
    }
    if (c === '(') { tokens.push({ t: 'lparen' }); i++; continue; }
    if (c === ')') { tokens.push({ t: 'rparen' }); i++; continue; }
    if (c === ',') { tokens.push({ t: 'comma' }); i++; continue; }
    if ('+-*/%^'.includes(c)) { tokens.push({ t: 'op', v: c }); i++; continue; }
    if (/[0-9.]/.test(c)) {
      let j = i + 1;
      while (j < input.length && /[0-9.]/.test(input[j])) j++;
      tokens.push({ t: 'num', v: input.slice(i, j) });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < input.length && /[A-Za-z0-9_]/.test(input[j])) j++;
      tokens.push({ t: 'ident', v: input.slice(i, j) });
      i = j;
      continue;
    }
    throw new Error(`Unexpected character '${c}'`);
  }
  return tokens;
}

const PRECEDENCE: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2, '%': 2, '^': 3 };

/** Recursive-descent parser (precedence climbing). Throws on malformed input. */
function parse(tokens: Token[]): Node {
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  function parseExpression(minPrec = 0): Node {
    let left = parseUnary();
    while (true) {
      const tok = peek();
      if (!tok || tok.t !== 'op') break;
      const prec = PRECEDENCE[tok.v];
      if (prec == null || prec < minPrec) break;
      next();
      // '^' is right-associative; others left-associative.
      const nextMin = tok.v === '^' ? prec : prec + 1;
      const right = parseExpression(nextMin);
      left = { kind: 'binary', op: tok.v, left, right };
    }
    return left;
  }

  function parseUnary(): Node {
    const tok = peek();
    if (tok && tok.t === 'op' && tok.v === '-') {
      next();
      return { kind: 'unary', op: '-', operand: parseUnary() };
    }
    if (tok && tok.t === 'op' && tok.v === '+') { next(); return parseUnary(); }
    return parsePrimary();
  }

  function parsePrimary(): Node {
    const tok = next();
    if (!tok) throw new Error('Unexpected end of formula');
    if (tok.t === 'num') {
      const value = Number(tok.v);
      if (Number.isNaN(value)) throw new Error(`Invalid number '${tok.v}'`);
      return { kind: 'num', value };
    }
    if (tok.t === 'field') return { kind: 'field', name: tok.v };
    if (tok.t === 'lparen') {
      const expr = parseExpression();
      if (peek()?.t !== 'rparen') throw new Error('Missing closing )');
      next();
      return expr;
    }
    if (tok.t === 'ident') {
      // function call vs bare field reference
      if (peek()?.t === 'lparen') {
        const name = tok.v.toLowerCase();
        if (!FUNCTIONS[name]) throw new Error(`Unknown function '${tok.v}'`);
        next(); // consume '('
        const args: Node[] = [];
        if (peek()?.t !== 'rparen') {
          args.push(parseExpression());
          while (peek()?.t === 'comma') { next(); args.push(parseExpression()); }
        }
        if (peek()?.t !== 'rparen') throw new Error(`Missing ) in ${tok.v}()`);
        next();
        return { kind: 'call', name, args };
      }
      return { kind: 'field', name: tok.v };
    }
    throw new Error('Unexpected token in formula');
  }

  const ast = parseExpression();
  if (pos < tokens.length) throw new Error('Unexpected trailing input in formula');
  return ast;
}

function collectFields(node: Node, out: Set<string>): void {
  switch (node.kind) {
    case 'field': out.add(node.name); break;
    case 'unary': collectFields(node.operand, out); break;
    case 'binary': collectFields(node.left, out); collectFields(node.right, out); break;
    case 'call': node.args.forEach((a) => collectFields(a, out)); break;
  }
}

function evalNode(node: Node, row: Record<string, unknown>): number {
  switch (node.kind) {
    case 'num': return node.value;
    case 'field': return Number(row[node.name]);
    case 'unary': return -evalNode(node.operand, row);
    case 'call': return FUNCTIONS[node.name](node.args.map((a) => evalNode(a, row)));
    case 'binary': {
      const l = evalNode(node.left, row);
      const r = evalNode(node.right, row);
      switch (node.op) {
        case '+': return l + r;
        case '-': return l - r;
        case '*': return l * r;
        case '/': return r === 0 ? NaN : l / r;
        case '%': return r === 0 ? NaN : l % r;
        case '^': return Math.pow(l, r);
        default: return NaN;
      }
    }
  }
}

/** Compile a formula into an evaluator + its referenced fields. Throws on parse error. */
export function compileFormula(formula: string): {
  referencedFields: string[];
  evaluate: (row: Record<string, unknown>) => number | null;
} {
  if (!formula || !formula.trim()) throw new Error('Formula is empty');
  const ast = parse(tokenize(formula));
  const fields = new Set<string>();
  collectFields(ast, fields);
  return {
    referencedFields: Array.from(fields),
    evaluate: (row) => {
      const v = evalNode(ast, row);
      return Number.isFinite(v) ? v : null;
    },
  };
}

/**
 * Validate a formula against the set of available field names. Returns a
 * structured result (never throws) suitable for inline UI feedback.
 */
export function validateFormula(formula: string, availableFields: string[]): FormulaValidation {
  try {
    const { referencedFields } = compileFormula(formula);
    const available = new Set(availableFields.map((f) => f.toLowerCase()));
    const unknown = referencedFields.filter((f) => !available.has(f.toLowerCase()));
    if (unknown.length > 0) {
      return { valid: false, error: `Unknown field(s): ${unknown.join(', ')}`, referencedFields };
    }
    return { valid: true, referencedFields };
  } catch (err: any) {
    return { valid: false, error: err?.message || 'Invalid formula', referencedFields: [] };
  }
}

/**
 * Compute custom measures as new columns. Measures are evaluated in order, so a
 * later measure may reference an earlier one. Invalid measures are skipped.
 */
export function applyCustomMeasures(
  rows: Record<string, unknown>[],
  columns: string[],
  measures: CustomMeasure[] | undefined | null,
): { rows: Record<string, unknown>[]; columns: string[] } {
  if (!measures || measures.length === 0 || !rows || rows.length === 0) {
    return { rows, columns };
  }

  const outColumns = [...columns];
  const outRows = rows.map((r) => ({ ...r }));

  for (const measure of measures) {
    if (!measure.name?.trim() || !measure.formula?.trim()) continue;
    let compiled;
    try {
      compiled = compileFormula(measure.formula);
    } catch {
      continue; // skip invalid formula rather than breaking the whole widget
    }
    for (const row of outRows) {
      row[measure.name] = compiled.evaluate(row);
    }
    if (!outColumns.includes(measure.name)) outColumns.push(measure.name);
  }

  return { rows: outRows, columns: outColumns };
}
