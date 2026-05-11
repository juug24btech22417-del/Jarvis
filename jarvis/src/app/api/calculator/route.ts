import { NextRequest, NextResponse } from "next/server";

// Evaluate math expression with scientific functions
function evaluateMath(expression: string): number {
  // Clean up the expression
  const cleanExpr = expression
    .replace(/\^/g, "**")
    .replace(/%/g, "/100")
    .trim();

  if (!cleanExpr) {
    throw new Error("Empty expression");
  }

  const mathScope = {
    pi: Math.PI,
    e: Math.E,
    sin: (x: number) => Math.sin(x * Math.PI / 180),
    cos: (x: number) => Math.cos(x * Math.PI / 180),
    tan: (x: number) => Math.tan(x * Math.PI / 180),
    asin: (x: number) => Math.asin(x) * 180 / Math.PI,
    acos: (x: number) => Math.acos(x) * 180 / Math.PI,
    atan: (x: number) => Math.atan(x) * 180 / Math.PI,
    sinh: Math.sinh,
    cosh: Math.cosh,
    tanh: Math.tanh,
    sqrt: Math.sqrt,
    cbrt: Math.cbrt,
    log: Math.log10,
    ln: Math.log,
    log2: Math.log2,
    exp: Math.exp,
    abs: Math.abs,
    floor: Math.floor,
    ceil: Math.ceil,
    round: Math.round,
    trunc: Math.trunc,
    min: Math.min,
    max: Math.max,
    pow: Math.pow,
    random: Math.random,
    fact: factorial,
  };

  // Replace constants
  let processedExpr = cleanExpr
    .replace(/\bpi\b/gi, "mathScope.pi")
    .replace(/\be\b/gi, "mathScope.e");

  // Replace functions
  const functions = ['sinh', 'cosh', 'tanh', 'asin', 'acos', 'atan',
                     'sin', 'cos', 'tan', 'sqrt', 'cbrt', 'log2', 'log', 'ln',
                     'exp', 'abs', 'floor', 'ceil', 'round', 'trunc', 'fact'];

  functions.forEach(fn => {
    const regex = new RegExp(`\\b${fn}\\s*\\(`, 'gi');
    processedExpr = processedExpr.replace(regex, `mathScope.${fn}(`);
  });

  // Handle factorial
  processedExpr = processedExpr.replace(/(\d+)\s*!/g, 'mathScope.fact($1)');

  try {
    const fn = new Function('mathScope', `return ${processedExpr}`);
    const result = fn(mathScope);

    if (typeof result !== 'number' || !isFinite(result)) {
      throw new Error("Invalid result");
    }

    return result;
  } catch (error) {
    throw new Error(`Calculation failed: ${error}`);
  }
}

function factorial(n: number): number {
  if (n < 0) throw new Error("Factorial of negative number");
  if (n > 170) throw new Error("Number too large");
  if (n !== Math.floor(n)) throw new Error("Factorial requires integer");

  let result = 1;
  for (let i = 2; i <= n; i++) {
    result *= i;
  }
  return result;
}

function formatResult(result: number): string {
  if (Math.abs(result) >= 1e10 || (Math.abs(result) < 1e-10 && result !== 0)) {
    return result.toExponential(6);
  }

  const rounded = Math.round(result * 1e10) / 1e10;

  if (Number.isInteger(rounded)) {
    return rounded.toString();
  }

  return rounded.toPrecision(10).replace(/\.?0+$/, '');
}

// Parse natural language to math expression
function parseNaturalLanguage(input: string): string | null {
  let expr = input.toLowerCase().trim();

  // Fix common speech recognition errors FIRST
  expr = expr
    .replace(/\bsign\s+of\b/g, "sine of")
    .replace(/\bsign\b/g, "sin")
    .replace(/\bcause\s+of\b/g, "cosine of")
    .replace(/\bcause\b/g, "cos")
    .replace(/\bturn\s+of\b/g, "tangent of")
    .replace(/\bturn\b/g, "tan")
    .replace(/\bcourse\s+of\b/g, "cosine of")
    .replace(/\bcourse\b/g, "cos");

  // Remove question phrases
  expr = expr.replace(/^(?:what\s+is|what's|calculate|compute|solve|find|evaluate)\s+/i, "");
  expr = expr.replace(/\?/g, "");
  expr = expr.trim();

  // Handle factorial FIRST
  if (/factorial\s+of\s+\d+/.test(expr)) {
    expr = expr.replace(/factorial\s+of\s+(\d+)/i, "$1!");
  }
  if (/\d+\s+factorial/.test(expr)) {
    expr = expr.replace(/(\d+)\s+factorial/i, "$1!");
  }

  // Handle square root
  expr = expr.replace(/(?:square\s+root|sqrt)\s+of\s+(\d+(?:\.\d+)?)/gi, "sqrt($1)");
  expr = expr.replace(/√\s*(\d+(?:\.\d+)?)/g, "sqrt($1)");

  // Handle cube root
  expr = expr.replace(/(?:cube\s+root|cbrt)\s+of\s+(\d+(?:\.\d+)?)/gi, "cbrt($1)");

  // Handle trig functions - LONGER NAMES FIRST to avoid partial matches
  // e.g., "cosine" must be processed before "sine" (otherwise "cosine" -> "cosin")
  expr = expr.replace(/(?:cosine|cos)\s+of\s+(\d+(?:\.\d+)?)/gi, "cos($1)");
  expr = expr.replace(/(?:sine|sin)\s+of\s+(\d+(?:\.\d+)?)/gi, "sin($1)");
  expr = expr.replace(/(?:tangent|tan)\s+of\s+(\d+(?:\.\d+)?)/gi, "tan($1)");
  // Also match without "of"
  expr = expr.replace(/\bcos\s+(\d+(?:\.\d+)?)/gi, "cos($1)");
  expr = expr.replace(/\bsin\s+(\d+(?:\.\d+)?)/gi, "sin($1)");
  expr = expr.replace(/\btan\s+(\d+(?:\.\d+)?)/gi, "tan($1)");

  // Handle logs
  expr = expr.replace(/(?:logarithm|log)\s+of\s+(\d+(?:\.\d+)?)/gi, "log($1)");
  expr = expr.replace(/(?:natural\s+log|ln)\s+of\s+(\d+(?:\.\d+)?)/gi, "ln($1)");

  // Handle absolute value
  expr = expr.replace(/(?:absolute\s+value|abs)\s+of\s+(\d+(?:\.\d+)?)/gi, "abs($1)");

  // Handle powers
  expr = expr.replace(/(\d+(?:\.\d+)?)\s+squared/gi, "($1)**2");
  expr = expr.replace(/(\d+(?:\.\d+)?)\s+cubed/gi, "($1)**3");
  expr = expr.replace(/(\d+(?:\.\d+)?)\s+(?:to\s+the\s+power\s+of|raised\s+to)\s+(\d+)/gi, "($1)**$2");

  // Handle percentage
  expr = expr.replace(/(\d+(?:\.\d+)?)\s*%\s*of\s+(\d+(?:\.\d+)?)/gi, "($1/100)*$2");
  expr = expr.replace(/(\d+(?:\.\d+)?)\s*%/gi, "($1/100)");

  // Replace words with operators
  expr = expr.replace(/\bplus\b/gi, "+");
  expr = expr.replace(/\bminus\b/gi, "-");
  expr = expr.replace(/\btimes\b|\bmultiplied\s+by\b/gi, "*");
  expr = expr.replace(/\bdivided\s+by\b|\bover\b/gi, "/");

  // Convert full words to short forms BEFORE removing words (longer names first)
  expr = expr.replace(/\bcosine\b/gi, "cos");
  expr = expr.replace(/\bsine\b/gi, "sin");
  expr = expr.replace(/\btangent\b/gi, "tan");

  // Remove remaining words (non-math text), but KEEP math functions
  expr = expr.replace(/\b([a-z]+)\b/gi, (match: string) => {
    const validFuncs = ['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'sinh', 'cosh', 'tanh',
                        'sqrt', 'cbrt', 'log', 'ln', 'log2', 'exp', 'abs', 'floor', 'ceil',
                        'round', 'trunc', 'min', 'max', 'pow', 'fact', 'pi', 'e'];
    if (validFuncs.includes(match.toLowerCase())) {
      return match;
    }
    return '';
  });

  // Clean up
  expr = expr.replace(/\s+/g, "");

  if (!expr) return null;
  return expr;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { expression, natural } = body;

    let calcExpression: string | null = expression;

    if (natural) {
      calcExpression = parseNaturalLanguage(natural);
      console.log("[Calculator] Parsed:", natural, "->", calcExpression);
    }

    if (!calcExpression) {
      return NextResponse.json({ error: "Could not parse expression" }, { status: 400 });
    }

    const result = evaluateMath(calcExpression);
    const formatted = formatResult(result);

    return NextResponse.json({
      success: true,
      expression: calcExpression,
      result,
      formatted,
    });
  } catch (error) {
    console.error("[Calculator] Error:", error);
    return NextResponse.json(
      { error: "Calculation error", message: String(error) },
      { status: 400 }
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const expr = searchParams.get("expr");

    if (!expr) {
      return NextResponse.json({ error: "Expression required" }, { status: 400 });
    }

    const result = evaluateMath(expr);

    return NextResponse.json({
      success: true,
      expression: expr,
      result,
      formatted: formatResult(result),
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Calculation error", message: String(error) },
      { status: 400 }
    );
  }
}
