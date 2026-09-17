/**
 * Format minor currency units without floating-point math.
 * Example: minorToMoney(1290, "MYR") => "RM12.90"
 */
export function minorToMoney(value: number, currency: string = "MYR"): string {
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new Error(`minorToMoney expects an integer minor-unit value, got: ${value}`);
  }

  const prefix = currencySymbol(currency);
  const negative = value < 0;
  const abs = negative ? -value : value;
  const major = Math.floor(abs / 100);
  const cents = abs % 100;
  const body = `${major}.${cents.toString().padStart(2, "0")}`;
  return `${negative ? "-" : ""}${prefix}${body}`;
}

/** Plain amount without currency prefix. Example: 1290 => "12.90" */
export function minorToPlain(value: number): string {
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new Error(`minorToPlain expects an integer minor-unit value, got: ${value}`);
  }

  const negative = value < 0;
  const abs = negative ? -value : value;
  const major = Math.floor(abs / 100);
  const cents = abs % 100;
  return `${negative ? "-" : ""}${major}.${cents.toString().padStart(2, "0")}`;
}

/** Cashier TOTAL style: "RM 12.90" */
export function minorToMoneySpaced(value: number, currency: string = "MYR"): string {
  const plain = minorToPlain(value);
  if (currency.toUpperCase() === "MYR") {
    return value < 0 ? `-RM ${plain.replace("-", "")}` : `RM ${plain}`;
  }
  return minorToMoney(value, currency);
}

function currencySymbol(currency: string): string {
  switch (currency.toUpperCase()) {
    case "MYR":
      return "RM";
    default:
      return `${currency.toUpperCase()} `;
  }
}
