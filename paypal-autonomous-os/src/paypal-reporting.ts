const PAYPAL_SANDBOX_API = "https://api-m.sandbox.paypal.com";
const PAGE_SIZE = 500;
const MAX_RANGE_MS = 31 * 24 * 60 * 60 * 1000;

export interface PayPalSummaryRow {
  date: string;
  status: string;
  statusLabel: string;
  currency: string;
  transactionCount: number;
  totalAmount: string;
}

export interface PayPalTransactionSummary {
  environment: "sandbox";
  dateRange: {
    start: string;
    end: string;
    timezone: "UTC";
  };
  balanceAffectingOnly: true;
  transactionsFetched: number;
  omittedTransactions: number;
  totals: PayPalSummaryRow[];
}

export class PayPalSummaryError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = "PayPalSummaryError";
  }
}

interface DecimalTotal {
  units: bigint;
  scale: number;
  transactionCount: number;
}

const STATUS_LABELS: Record<string, string> = {
  D: "Denied",
  P: "Pending",
  S: "Successful",
  V: "Reversed",
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function parseUtcDate(value: unknown, fieldName: string): Date {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new PayPalSummaryError(`${fieldName} must use YYYY-MM-DD format`, 400);
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new PayPalSummaryError(`${fieldName} is not a valid calendar date`, 400);
  }
  return date;
}

function validateDateRange(startDate: unknown, endDate: unknown): { start: string; end: string } {
  const start = parseUtcDate(startDate, "startDate");
  const end = parseUtcDate(endDate, "endDate");

  if (end < start) {
    throw new PayPalSummaryError("endDate must be on or after startDate", 400);
  }

  const inclusiveEnd = end.getTime() + 24 * 60 * 60 * 1000 - 1;
  if (inclusiveEnd - start.getTime() > MAX_RANGE_MS) {
    throw new PayPalSummaryError("PayPal supports a maximum transaction search range of 31 days", 400);
  }

  return {
    start: `${startDate}T00:00:00.000Z`,
    end: `${endDate}T23:59:59.999Z`,
  };
}

async function getAccessToken(clientId: string, clientSecret: string): Promise<string> {
  const authorization = Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64");
  let response: Response;
  try {
    response = await fetch(`${PAYPAL_SANDBOX_API}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${authorization}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: "grant_type=client_credentials",
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new PayPalSummaryError("Could not reach PayPal Sandbox. Try again shortly.", 502);
  }

  const body = response.ok ? asRecord(await response.json()) : undefined;
  if (!response.ok) {
    if (response.status === 401) {
      throw new PayPalSummaryError("PayPal Sandbox rejected the credentials. Check that they are sandbox credentials.", 502);
    }
    throw new PayPalSummaryError(`PayPal Sandbox authentication failed with HTTP ${response.status}.`, 502);
  }

  if (typeof body?.access_token !== "string" || body.access_token.length === 0) {
    throw new PayPalSummaryError("PayPal Sandbox returned no access token.", 502);
  }
  return body.access_token;
}

function parseDecimal(value: string): { units: bigint; scale: number } | undefined {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) return undefined;

  const [, sign, whole, fraction = ""] = match;
  const unsignedUnits = BigInt(`${whole}${fraction}`);
  return {
    units: sign === "-" ? -unsignedUnits : unsignedUnits,
    scale: fraction.length,
  };
}

function addAmount(total: DecimalTotal, amount: { units: bigint; scale: number }): void {
  if (amount.scale > total.scale) {
    total.units *= 10n ** BigInt(amount.scale - total.scale);
    total.scale = amount.scale;
  }
  total.units += amount.units * 10n ** BigInt(total.scale - amount.scale);
  total.transactionCount += 1;
}

function formatDecimal(units: bigint, scale: number): string {
  const negative = units < 0n;
  const digits = (negative ? -units : units).toString().padStart(scale + 1, "0");
  if (scale === 0) return `${negative ? "-" : ""}${digits}`;

  return `${negative ? "-" : ""}${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
}

function utcDate(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return undefined;
  return date.toISOString().slice(0, 10);
}

function summarize(transactions: unknown[]): { totals: PayPalSummaryRow[]; omittedTransactions: number } {
  const totals = new Map<string, DecimalTotal>();
  let omittedTransactions = 0;

  for (const value of transactions) {
    const transaction = asRecord(value);
    const info = asRecord(transaction?.transaction_info);
    const amount = asRecord(info?.transaction_amount);
    const date = utcDate(info?.transaction_initiation_date);
    const currency = typeof amount?.currency_code === "string" ? amount.currency_code.toUpperCase() : "";
    const parsedAmount = typeof amount?.value === "string" ? parseDecimal(amount.value) : undefined;

    if (!date || !parsedAmount || !/^[A-Z]{3}$/.test(currency)) {
      omittedTransactions += 1;
      continue;
    }

    const status = typeof info?.transaction_status === "string" && info.transaction_status.length > 0
      ? info.transaction_status
      : "UNKNOWN";
    const key = `${date}\u0000${status}\u0000${currency}`;
    const total = totals.get(key) ?? { units: 0n, scale: 0, transactionCount: 0 };
    addAmount(total, parsedAmount);
    totals.set(key, total);
  }

  return {
    omittedTransactions,
    totals: [...totals.entries()]
      .map(([key, total]) => {
        const [date, status, currency] = key.split("\u0000");
        return {
          date,
          status,
          statusLabel: STATUS_LABELS[status] ?? (status === "UNKNOWN" ? "Unknown" : "Other"),
          currency,
          transactionCount: total.transactionCount,
          totalAmount: formatDecimal(total.units, total.scale),
        };
      })
      .sort((left, right) =>
        left.date.localeCompare(right.date)
        || left.status.localeCompare(right.status)
        || left.currency.localeCompare(right.currency),
      ),
  };
}

async function fetchTransactions(accessToken: string, dates: { start: string; end: string }): Promise<unknown[]> {
  const transactions: unknown[] = [];
  let page = 1;
  let totalPages = 1;

  do {
    const query = new URLSearchParams({
      start_date: dates.start,
      end_date: dates.end,
      fields: "transaction_info",
      page_size: String(PAGE_SIZE),
      page: String(page),
      balance_affecting_records_only: "Y",
    });

    let response: Response;
    try {
      response = await fetch(`${PAYPAL_SANDBOX_API}/v1/reporting/transactions?${query}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
          "PayPal-Enforce-ISO8601-Format": "true",
        },
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new PayPalSummaryError("Could not reach PayPal Sandbox while loading transactions.", 502);
    }

    if (!response.ok) {
      if (response.status === 403) {
        throw new PayPalSummaryError("Transaction Search access is not enabled for this PayPal app.", 502);
      }
      throw new PayPalSummaryError(`PayPal Sandbox transaction search failed with HTTP ${response.status}.`, 502);
    }

    const body = asRecord(await response.json());
    const pageTransactions = body?.transaction_details;
    if (pageTransactions !== undefined && !Array.isArray(pageTransactions)) {
      throw new PayPalSummaryError("PayPal Sandbox returned an unexpected transaction response.", 502);
    }
    transactions.push(...((pageTransactions ?? []) as unknown[]));

    if (typeof body?.total_pages === "number" && Number.isInteger(body.total_pages) && body.total_pages > 0) {
      totalPages = body.total_pages;
    }
    page += 1;
    if (page > 10_000) {
      throw new PayPalSummaryError("PayPal Sandbox returned an unexpectedly large number of pages.", 502);
    }
  } while (page <= totalPages);

  return transactions;
}

export async function getPayPalSandboxSummary(
  startDate: unknown,
  endDate: unknown,
): Promise<PayPalTransactionSummary> {
  const dates = validateDateRange(startDate, endDate);
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new PayPalSummaryError("PayPal Sandbox credentials are missing from Replit Secrets.", 503);
  }

  const accessToken = await getAccessToken(clientId, clientSecret);
  const transactions = await fetchTransactions(accessToken, dates);
  const { totals, omittedTransactions } = summarize(transactions);

  return {
    environment: "sandbox",
    dateRange: {
      start: String(startDate),
      end: String(endDate),
      timezone: "UTC",
    },
    balanceAffectingOnly: true,
    transactionsFetched: transactions.length,
    omittedTransactions,
    totals,
  };
}
