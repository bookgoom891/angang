/* global Decimal */

const display = document.getElementById("display");
const preview = document.getElementById("preview");
const message = document.getElementById("message");
const precisionChip = document.getElementById("precision-chip");
const angleChip = document.getElementById("angle-chip");
const xInput = document.getElementById("x-value");

let angleMode = "DEG";
let precisionMode = "decimal";
let lastResult = "0";

Decimal.set({ precision: 60, rounding: Decimal.ROUND_HALF_UP });

const CONSTANTS = {
  pi: "3.14159265358979323846264338327950288419716939937510",
  e: "2.71828182845904523536028747135266249775724709369996",
};

const OPERATORS = {
  "+": { prec: 1, assoc: "L", arity: 2 },
  "-": { prec: 1, assoc: "L", arity: 2 },
  "*": { prec: 2, assoc: "L", arity: 2 },
  "/": { prec: 2, assoc: "L", arity: 2 },
  "neg": { prec: 3, assoc: "R", arity: 1 },
  "^": { prec: 4, assoc: "R", arity: 2 },
  "!": { prec: 5, assoc: "L", arity: 1, postfix: true },
  "%": { prec: 5, assoc: "L", arity: 1, postfix: true },
};

const FUNCTIONS = new Set(["sin", "cos", "tan", "log", "ln", "sqrt", "abs"]);

function normalizeExpression(expr) {
  return expr
    .replace(/×/g, "*")
    .replace(/÷/g, "/")
    .replace(/−/g, "-")
    .replace(/π/g, "pi")
    .replace(/√/g, "sqrt");
}

function tokenize(expr) {
  const tokens = [];
  const input = normalizeExpression(expr);
  let i = 0;

  while (i < input.length) {
    const char = input[i];

    if (/\s/.test(char)) {
      i += 1;
      continue;
    }

    if (/[0-9.]/.test(char)) {
      let num = "";
      let hasDot = false;
      while (i < input.length && /[0-9.]/.test(input[i])) {
        if (input[i] === ".") {
          if (hasDot) break;
          hasDot = true;
        }
        num += input[i];
        i += 1;
      }

      if (/e|E/.test(input[i])) {
        let exp = input[i];
        let j = i + 1;
        if (input[j] === "+" || input[j] === "-") {
          exp += input[j];
          j += 1;
        }
        let expDigits = "";
        while (j < input.length && /[0-9]/.test(input[j])) {
          expDigits += input[j];
          j += 1;
        }
        if (expDigits.length > 0) {
          num += exp + expDigits;
          i = j;
        }
      }

      tokens.push({ type: "number", value: num });
      continue;
    }

    if (/[a-zA-Z]/.test(char)) {
      let name = "";
      while (i < input.length && /[a-zA-Z]/.test(input[i])) {
        name += input[i];
        i += 1;
      }
      tokens.push({ type: "ident", value: name.toLowerCase() });
      continue;
    }

    if (char === "(" || char === ")") {
      tokens.push({ type: char === "(" ? "lparen" : "rparen", value: char });
      i += 1;
      continue;
    }

    if (["+", "-", "*", "/", "^", "!", "%"].includes(char)) {
      tokens.push({ type: "operator", value: char });
      i += 1;
      continue;
    }

    throw new Error(`알 수 없는 문자: ${char}`);
  }

  return tokens;
}

function isValueToken(token) {
  return (
    token.type === "number" ||
    token.type === "constant" ||
    token.type === "rparen" ||
    (token.type === "operator" && OPERATORS[token.value]?.postfix)
  );
}

function isLeadingToken(token) {
  return token.type === "number" || token.type === "constant" || token.type === "lparen" || token.type === "func";
}

function insertImplicitMultiplication(tokens) {
  const result = [];

  for (let i = 0; i < tokens.length; i += 1) {
    const current = tokens[i];
    const next = tokens[i + 1];
    result.push(current);

    if (!next) continue;

    if (isValueToken(current) && isLeadingToken(next)) {
      result.push({ type: "operator", value: "*" });
    }
  }

  return result;
}

function toTokenStream(rawTokens) {
  return rawTokens.map((token) => {
    if (token.type === "ident") {
      if (FUNCTIONS.has(token.value)) return { type: "func", value: token.value };
      if (token.value === "pi" || token.value === "e" || token.value === "ans" || token.value === "x") {
        return { type: "constant", value: token.value };
      }
      throw new Error(`알 수 없는 식별자: ${token.value}`);
    }
    return token;
  });
}

function toRPN(tokens) {
  const output = [];
  const stack = [];
  let prevType = null;

  tokens.forEach((token) => {
    if (token.type === "number" || token.type === "constant") {
      output.push(token);
      prevType = "value";
      return;
    }

    if (token.type === "func") {
      stack.push(token);
      prevType = "func";
      return;
    }

    if (token.type === "lparen") {
      stack.push(token);
      prevType = "lparen";
      return;
    }

    if (token.type === "rparen") {
      while (stack.length && stack[stack.length - 1].type !== "lparen") {
        output.push(stack.pop());
      }
      if (!stack.length) throw new Error("괄호가 맞지 않습니다.");
      stack.pop();
      if (stack.length && stack[stack.length - 1].type === "func") {
        output.push(stack.pop());
      }
      prevType = "value";
      return;
    }

    if (token.type === "operator") {
      let op = token.value;

      if ((op === "+" || op === "-") && (prevType === null || prevType === "operator" || prevType === "lparen" || prevType === "func")) {
        if (op === "+") {
          return;
        }
        op = "neg";
      }

      const opInfo = OPERATORS[op];
      if (!opInfo) throw new Error(`알 수 없는 연산자: ${op}`);

      while (stack.length) {
        const top = stack[stack.length - 1];
        if (top.type !== "operator") break;
        const topInfo = OPERATORS[top.value];
        if (!topInfo) break;

        const shouldPop =
          (opInfo.assoc === "L" && opInfo.prec <= topInfo.prec) ||
          (opInfo.assoc === "R" && opInfo.prec < topInfo.prec);

        if (!shouldPop) break;
        output.push(stack.pop());
      }

      stack.push({ type: "operator", value: op });
      prevType = "operator";
    }
  });

  while (stack.length) {
    const op = stack.pop();
    if (op.type === "lparen" || op.type === "rparen") {
      throw new Error("괄호가 맞지 않습니다.");
    }
    output.push(op);
  }

  return output;
}

function decimalFrom(value) {
  return new Decimal(value);
}

function toNumber(decimal) {
  return typeof decimal === "number" ? decimal : decimal.toNumber();
}

function factorialDecimal(value) {
  const decimal = decimalFrom(value);
  if (!decimal.isInteger() || decimal.isNegative()) {
    throw new Error("팩토리얼은 0 이상의 정수만 가능합니다.");
  }
  const limit = decimal.gt(5000);
  if (limit) throw new Error("팩토리얼 입력이 너무 큽니다 (<= 5000). ");

  let n = BigInt(decimal.toString());
  let result = 1n;
  for (let i = 2n; i <= n; i += 1n) {
    result *= i;
  }
  return decimalFrom(result.toString());
}

function applyOperator(op, stack) {
  const info = OPERATORS[op];
  if (info.arity === 2) {
    const b = stack.pop();
    const a = stack.pop();
    if (a === undefined || b === undefined) throw new Error("식이 올바르지 않습니다.");
    if (precisionMode === "number") {
      const na = toNumber(a);
      const nb = toNumber(b);
      switch (op) {
        case "+":
          return stack.push(na + nb);
        case "-":
          return stack.push(na - nb);
        case "*":
          return stack.push(na * nb);
        case "/":
          if (nb === 0) throw new Error("0으로 나눌 수 없습니다.");
          return stack.push(na / nb);
        case "^":
          return stack.push(Math.pow(na, nb));
        default:
          throw new Error("지원하지 않는 연산입니다.");
      }
    }
    const da = decimalFrom(a);
    const db = decimalFrom(b);
    switch (op) {
      case "+":
        return stack.push(da.plus(db));
      case "-":
        return stack.push(da.minus(db));
      case "*":
        return stack.push(da.times(db));
      case "/":
        if (db.isZero()) throw new Error("0으로 나눌 수 없습니다.");
        return stack.push(da.div(db));
      case "^":
        return stack.push(da.pow(db));
      default:
        throw new Error("지원하지 않는 연산입니다.");
    }
  }

  if (info.arity === 1) {
    const value = stack.pop();
    if (value === undefined) throw new Error("식이 올바르지 않습니다.");

    if (op === "neg") {
      return stack.push(precisionMode === "number" ? -toNumber(value) : decimalFrom(value).neg());
    }

    if (op === "!") {
      return stack.push(factorialDecimal(value));
    }

    if (op === "%") {
      return stack.push(precisionMode === "number" ? toNumber(value) / 100 : decimalFrom(value).div(100));
    }
  }

  throw new Error("지원하지 않는 연산입니다.");
}

function applyFunction(name, stack) {
  const value = stack.pop();
  if (value === undefined) throw new Error("식이 올바르지 않습니다.");

  const numberValue = toNumber(value);

  if (name === "sqrt") {
    if (precisionMode === "number") {
      if (numberValue < 0) throw new Error("음수의 제곱근은 지원되지 않습니다.");
      return stack.push(Math.sqrt(numberValue));
    }
    return stack.push(decimalFrom(value).sqrt());
  }

  if (name === "abs") {
    return stack.push(precisionMode === "number" ? Math.abs(numberValue) : decimalFrom(value).abs());
  }

  if (name === "ln") {
    if (precisionMode === "number") {
      return stack.push(Math.log(numberValue));
    }
    return stack.push(decimalFrom(value).ln());
  }

  if (name === "log") {
    if (precisionMode === "number") {
      return stack.push(Math.log10(numberValue));
    }
    const ln10 = new Decimal(10).ln();
    return stack.push(decimalFrom(value).ln().div(ln10));
  }

  const angle = angleMode === "DEG" ? (numberValue * Math.PI) / 180 : numberValue;

  switch (name) {
    case "sin":
      return stack.push(Math.sin(angle));
    case "cos":
      return stack.push(Math.cos(angle));
    case "tan":
      return stack.push(Math.tan(angle));
    default:
      throw new Error("지원하지 않는 함수입니다.");
  }
}

function evaluateExpression(expr) {
  if (!expr.trim()) return { text: "", raw: "" };

  const tokens = insertImplicitMultiplication(toTokenStream(tokenize(expr)));
  const rpn = toRPN(tokens);
  const stack = [];

  rpn.forEach((token) => {
    if (token.type === "number") {
      stack.push(precisionMode === "number" ? Number(token.value) : decimalFrom(token.value));
      return;
    }
    if (token.type === "constant") {
      if (token.value === "ans") {
        stack.push(precisionMode === "number" ? Number(lastResult) : decimalFrom(lastResult));
        return;
      }
      if (token.value === "x") {
        const value = xInput.value.trim();
        if (!value) throw new Error("x 값이 비어 있습니다.");
        stack.push(precisionMode === "number" ? Number(value) : decimalFrom(value));
        return;
      }
      const constant = CONSTANTS[token.value];
      stack.push(precisionMode === "number" ? Number(constant) : decimalFrom(constant));
      return;
    }
    if (token.type === "operator") {
      applyOperator(token.value, stack);
      return;
    }
    if (token.type === "func") {
      applyFunction(token.value, stack);
    }
  });

  if (stack.length !== 1) {
    throw new Error("식이 올바르지 않습니다.");
  }

  const result = stack[0];
  const text = precisionMode === "number" ? String(result) : result.toString();
  return { text, raw: result };
}

function setPreview() {
  try {
    const { text } = evaluateExpression(display.value);
    preview.textContent = text ? `≈ ${text}` : "결과 미리보기";
    message.textContent = "";
  } catch (err) {
    preview.textContent = "결과 미리보기";
    message.textContent = err.message;
  }
}

function setResult() {
  try {
    const { text } = evaluateExpression(display.value);
    if (!text) return;
    display.value = text;
    lastResult = text;
    preview.textContent = `≈ ${text}`;
    message.textContent = "";
  } catch (err) {
    message.textContent = err.message;
  }
}

function insertText(text) {
  const start = display.selectionStart ?? display.value.length;
  const end = display.selectionEnd ?? display.value.length;
  const before = display.value.slice(0, start);
  const after = display.value.slice(end);
  display.value = `${before}${text}${after}`;
  const cursor = start + text.length;
  display.focus();
  display.setSelectionRange(cursor, cursor);
  setPreview();
}

function deleteText() {
  const start = display.selectionStart ?? display.value.length;
  const end = display.selectionEnd ?? display.value.length;
  if (start !== end) {
    display.value = display.value.slice(0, start) + display.value.slice(end);
    display.setSelectionRange(start, start);
    setPreview();
    return;
  }
  if (start === 0) return;
  display.value = display.value.slice(0, start - 1) + display.value.slice(end);
  display.setSelectionRange(start - 1, start - 1);
  setPreview();
}

function updateChips() {
  precisionChip.textContent = `Precision: ${precisionMode === "decimal" ? "Decimal (60)" : "Number"}`;
  angleChip.textContent = `Angle: ${angleMode}`;
}

function updateSegmented(action, value) {
  document.querySelectorAll(`[data-action='${action}']`).forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.value === value);
  });
}

const valueButtonMap = new Map();
const actionButtonMap = new Map();

document.querySelectorAll(".keypad .key").forEach((button) => {
  if (button.dataset.value) valueButtonMap.set(button.dataset.value, button);
  if (button.dataset.action) actionButtonMap.set(button.dataset.action, button);
});

function flashButton(button) {
  if (!button) return;
  button.classList.add("is-pressed");
  setTimeout(() => button.classList.remove("is-pressed"), 120);
}

document.querySelectorAll(".keypad .key").forEach((button) => {
  button.addEventListener("click", () => {
    const action = button.dataset.action;
    const value = button.dataset.value;

    if (action === "clear") {
      display.value = "";
      message.textContent = "";
      preview.textContent = "결과 미리보기";
      return;
    }

    if (action === "delete") {
      deleteText();
      return;
    }

    if (action === "evaluate") {
      setResult();
      return;
    }

    if (action === "ans") {
      insertText("ans");
      return;
    }

    if (value) {
      insertText(value);
    }
  });
});

document.querySelectorAll("[data-action='angle']").forEach((button) => {
  button.addEventListener("click", () => {
    angleMode = button.dataset.value;
    updateSegmented("angle", angleMode);
    updateChips();
    setPreview();
  });
});

document.querySelectorAll("[data-action='precision']").forEach((button) => {
  button.addEventListener("click", () => {
    precisionMode = button.dataset.value;
    updateSegmented("precision", precisionMode);
    updateChips();
    setPreview();
  });
});

display.addEventListener("input", () => {
  setPreview();
});

display.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    setResult();
    flashButton(actionButtonMap.get("evaluate"));
    return;
  }

  if (event.key === "Backspace") {
    setTimeout(setPreview, 0);
  }

  if (event.ctrlKey || event.metaKey) {
    const key = event.key.toLowerCase();
    const shortcutMap = {
      s: "sin(",
      c: "cos(",
      t: "tan(",
      l: "log(",
      n: "ln(",
      r: "sqrt(",
      a: "abs(",
      p: "pi",
      e: "e",
      x: "x",
    };

    if (shortcutMap[key]) {
      event.preventDefault();
      insertText(shortcutMap[key]);
      flashButton(valueButtonMap.get(shortcutMap[key]));
    }
  }
});

document.addEventListener("keydown", (event) => {
  if (event.target !== display && event.target !== xInput) return;
  const keyMap = {
    "+": "+",
    "-": "-",
    "*": "*",
    "/": "/",
    "^": "^",
    "%": "%",
    "(": "(",
    ")": ")",
  };

  if (keyMap[event.key]) {
    flashButton(valueButtonMap.get(keyMap[event.key]));
  }
});

xInput.addEventListener("input", () => {
  setPreview();
});

updateChips();
setPreview();
