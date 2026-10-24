import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const SANDBOX_API = "https://api-m.sandbox.paypal.com";
const LIVE_API = "https://api-m.paypal.com";
const MAX_RANGE_MS = 31 * 24 * 60 * 60 * 1000;
const PAGE_SIZE = 500;

type Environment = "sandbox" | "live";

interface CliOptions {
  startDate: string;
  endDate: string;
  environment: Environment;
  outputPath?: string;
  balanceAffectingOnly: boolean;
}

interface PayPalAmount {
  value?: unknown;
  currency_code?: unknown;
}

interface PayPalTransactionInfo {
  transaction_initiation_date?: unknown;
  transaction_status?: unknown;
  transaction_amount?: PayPalAmount;
}

interface PayPalTransaction {
  transaction_info?: PayPalTransactionInfo;
}

interface PayPalSearchResponse {
  transaction_details?: unknown;
  total_pages?: unknown;
}

interface SummaryRow {
  date: string;
  status: string;
  statusLabel: string;
  currency: string;
  transactionCount: number;
  totalAmount: string;
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

function printHelp(): void {
  process.stdout.write(
    [
      "PayPal transaction summary",
      "",
      "Usage:",
      "  pnpm --filter @workspace/scripts paypal:summary -- --start YYYY-MM-DD --end YYYY-MM-DD [options]",
      "",
      "Required:",
      "  --start YYYY-MM-DD   First UTC date to include",
      "  --end YYYY-MM-DD     Last UTC date to include (inclusive; max 31 days)",
      "",
      "Options:",
      "  --env sandbox|live   PayPal environment (default: sandbox)",
      "  --out <file>         Also save the summary as JSON",
      "  --include-non-balance Include non-balance-affecting records",
      "  --help               Show this help",
      "",
      "Credentials are read from PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET Replit Secrets.",
      "Dates are grouped in UTC. PayPal may take up to three hours to show recent transactions.",
      "",
    ].join("\n"),
  );
}

function parseOptions(args: string[]): CliOptions | "help" {
  const cliArgs = args[0] === "--" ? args.slice(1) : args;
  const values = new Map<string, string>();
  let includeNonBalance = false;

  for (let index = 0; index < cliArgs.length; index += 1) {
    const arg = cliArgs[index];
    if (arg === "--help" || arg === "-h") return "help";
    if (arg === "--include-non-balance") {
      includeNonBalance = true;
      continue;
    }
    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected argument: ${arg}`);
    }

    const value = cliArgs[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }
    if (values.has(arg)) {
      throw new Error(`Option ${arg} was provided more than once`);
    }
    values.set(arg, value);
    index += 1;
  }

  const allowedOptions = new Set(["--start", "--end", "--env", "--out"]);
  for (const option of values.keys()) {
    if (!allowedOptions.has(option)) {
      throw new Error(`Unknown option: ${option}`);
    }
  }

  const startDate = values.get("--start");
  const endDate = values.get("--end");
  if (!startDate || !endDate) {
    throw new Error("Both --start and --end are required");
  }

  const environment = values.get("--env") ?? "sandbox";
  if (environment !== "sandbox" && environment !== "live") {
    throw new Error("--env must be either sandbox or live");
  }

  validateDateRange(startDate, endDate);

  return {
    startDate,
    endDate,
    environment,
    outputPath: values.get("--out"),
    balanceAffectingOnly: !includeNonBalance,
  };
}

function parseUtcDate(value: string, optionName: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${optionName} must use YYYY-MM-DD format`);
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`${optionName} is not a valid calendar date`);
  }
  return parsed;
}

function validateDateRange(startDate: string, endDate: string): void {
  const start = parseUtcDate(startDate, "--start");
  const end = parseUtcDate(endDate, "--end");
  const inclusiveEnd = end.getTime() + 24 * 60 * 60 * 1000 - 1;

  if (end < start) {
    throw new Error("--end must be on or after --start");
  }
  if (inclusiveEnd - start.getTime() > MAX_RANGE_MS) {
    throw new Error("PayPal supports a maximum transaction search range of 31 days");
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

async function parsePayPalError(response: Response): Promise<string> {
  let debugId = "";
  try {
    const body = asRecord(await response.json());
    if (typeof body?.debug_id === "string") {
      debugId = ` PayPal debug ID: ${body.debug_id}.`;
    }
  } catch {
    // Keep the error useful without exposing or logging response contents.
  }
  return `PayPal request failed with HTTP ${response.status}.${debugId}`;
}

async function getAccessToken(apiBase: string, clientId: string, clientSecret: string): Promise<string> {
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64");
  const response = await fetch(`${apiBase}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const message = await parsePayPalError(response);
    if (response.status === 401) {
      throw new Error(`${message} Check that the credentials match the selected PayPal environment.`);
    }
    throw new Error(message);
  }

  const body = asRecord(await response.json());
  const token = body?.access_token;
  if (typeof token !== "string" || token.length === 0) {
    throw new Error("PayPal returned a response without an access token");
  }
  return token;
}

function toPayPalTimestamp(date: string, endOfDay = false): string {
  return endOfDay
    ? `${date}T23:59:59.999Z`
    : `${date}T00:00:00.000Z`;
}

async function fetchTransactions(apiBase: string, accessToken: string, options: CliOptions): Promise<PayPalTransaction[]> {
  const allTransactions: PayPalTransaction[] = [];
  let page = 1;
  let totalPages = 1;

  do {
    const query = new URLSearchParams({
      start_date: toPayPalTimestamp(options.startDate),
      end_date: toPayPalTimestamp(options.endDate, true),
      fields: "transaction_info",
      page_size: String(PAGE_SIZE),
      page: String(page),
      balance_affecting_records_only: options.balanceAffectingOnly ? "Y" : "N",
    });

    const response = await fetch(`${apiBase}/v1/reporting/transactions?${query}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "PayPal-Enforce-ISO8601-Format": "true",
      },
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const message = await parsePayPalError(response);
      if (response.status === 403) {
        throw new Error(`${message} Confirm that Transaction Search access is enabled for this PayPal app.`);
      }
      throw new Error(message);
    }

    const body = asRecord(await response.json()) as PayPalSearchResponse | undefined;
    const pageTransactions = body?.transaction_details;
    if (pageTransactions !== undefined && !Array.isArray(pageTransactions)) {
      throw new Error("PayPal returned an unexpected transaction_details response");
    }
    allTransactions.push(...((pageTransactions ?? []) as PayPalTransaction[]));

    if (typeof body?.total_pages === "number" && Number.isInteger(body.total_pages) && body.total_pages > 0) {
      totalPages = body.total_pages;
    }
    page += 1;
  } while (page <= totalPages);

  return allTransactions;
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

  if (scale === 0) {
    return `${negative ? "-" : ""}${digits}`;
  }

  const whole = digits.slice(0, -scale);
  const fraction = digits.slice(-scale);
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

function getUtcDate(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return undefined;
  return parsed.toISOString().slice(0, 10);
}

function summarize(transactions: PayPalTransaction[]): { rows: SummaryRow[]; omittedTransactions: number } {
  const totals = new Map<string, DecimalTotal>();
  let omittedTransactions = 0;

  for (const transaction of transactions) {
    const info = transaction.transaction_info;
    const date = getUtcDate(info?.transaction_initiation_date);
    const amount = info?.transaction_amount;
    const currency = typeof amount?.currency_code === "string" ? amount.currency_code.toUpperCase() : "";
    const amountValue = typeof amount?.value === "string" ? parseDecimal(amount.value) : undefined;

    if (!date || !amountValue || !/^[A-Z]{3}$/.test(currency)) {
      omittedTransactions += 1;
      continue;
    }

    const status = typeof info?.transaction_status === "string" && info.transaction_status.length > 0
      ? info.transaction_status
      : "UNKNOWN";
    const key = `${date}\u0000${status}\u0000${currency}`;
    const total = totals.get(key) ?? { units: 0n, scale: 0, transactionCount: 0 };
    addAmount(total, amountValue);
    totals.set(key, total);
  }

  const rows = [...totals.entries()]
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
    );

  return { rows, omittedTransactions };
}

async function main(): Promise<void> {
  let options: CliOptions | "help";
  try {
    options = parseOptions(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "Invalid command-line options"}\n\n`);
    printHelp();
    process.exitCode = 1;
    return;
  }

  if (options === "help") {
    printHelp();
    return;
  }

  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in Replit Secrets before running this script");
  }

  const apiBase = options.environment === "live" ? LIVE_API : SANDBOX_API;
  const accessToken = await getAccessToken(apiBase, clientId, clientSecret);
  const transactions = await fetchTransactions(apiBase, accessToken, options);
  const { rows, omittedTransactions } = summarize(transactions);

  const summary = {
    environment: options.environment,
    dateRange: { start: options.startDate, end: options.endDate, timezone: "UTC" },
    balanceAffectingOnly: options.balanceAffectingOnly,
    transactionsFetched: transactions.length,
    omittedTransactions,
    totals: rows,
  };

  if (rows.length === 0) {
    process.stdout.write("No transactions matched the selected date range.\n");
  } else {
    console.table(rows);
  }
  process.stdout.write(
    `Fetched ${transactions.length} transaction record(s); ${omittedTransactions} record(s) could not be included because date, amount, or currency data was missing or invalid.\n`,
  );

  if (options.outputPath) {
    const outputPath = resolve(options.outputPath);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
    process.stdout.write(`Saved JSON summary to ${outputPath}\n`);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "PayPal summary failed"}\n`);
  process.exitCode = 1;
});
