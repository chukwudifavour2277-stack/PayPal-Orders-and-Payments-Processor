# PayPal transaction summary

This standalone Node.js script reads PayPal transaction records and prints gross transaction totals grouped by UTC date, PayPal status, and currency. It uses PayPal's Transaction Search API, which supports date ranges of up to 31 days per run.

## Credentials

Set these in Replit Secrets:

- `PAYPAL_CLIENT_ID`
- `PAYPAL_CLIENT_SECRET`

The script never prints credentials or access tokens. By default it uses the PayPal sandbox. Use `--env live` only with live PayPal app credentials.

## Run

```bash
pnpm --filter @workspace/scripts paypal:summary -- --start 2026-10-01 --end 2026-10-24
```

The start and end dates are UTC calendar dates; the end date is included. PayPal transaction search can take up to three hours to show recently executed transactions.

Options:

```bash
# Save the same summary as JSON
pnpm --filter @workspace/scripts paypal:summary -- --start 2026-10-01 --end 2026-10-24 --out reports/paypal-summary.json

# Use live PayPal credentials
pnpm --filter @workspace/scripts paypal:summary -- --start 2026-10-01 --end 2026-10-24 --env live

# Include non-balance-affecting records
pnpm --filter @workspace/scripts paypal:summary -- --start 2026-10-01 --end 2026-10-24 --include-non-balance
```

By default, PayPal's balance-affecting records are included. The total is the transaction amount reported by PayPal, grouped by the transaction's initiation date and status. Currency amounts are added using decimal arithmetic to avoid floating-point rounding errors.

This reports transaction history; it does not retrieve the current details of individual PayPal order objects.
