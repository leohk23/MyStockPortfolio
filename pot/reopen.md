# Reopenings Leo booked

A Deep dive on a name, run by the cycle when a publication lands (D127). The Deep dive books its own
in its ranking's `## Reopen when` table; this file holds the ones Leo asks for, in the same table.
`node pot/deepdive-due.js` reads both and shows what is due, waiting or lapsed. No lane may edit this
file.

- **event:** `10-Q`, `10-K`, `20-F`, `40-F`, `6-K` or `8-K` for a company that files with the SEC,
  under its US ticker; `date` for anything else, set to the day its results are due.
- **from:** the first day a filing counts. **by:** the day to give up.
- **why:** what to read, and where the case is. It goes into the Deep dive's prompt word for word.

## Reopen when

| ticker | event | from | by | why |
|---|---|---|---|---|
| NVDA | 10-Q | 2026-11-17 | 2026-12-01 | Q3 FY2027 10-Q. The case and its tests are in proposal 2026-11-17-2041-none (pot/proposals or its archive): P3's receivable-days warning and break, and the second reader's regulatory reopening test (the legal-proceedings note, and China and Singapore billing against Q2). Leo, 17 Nov: set aside how much of his main book NVDA, and the AI exposure it is part of, already carry |
