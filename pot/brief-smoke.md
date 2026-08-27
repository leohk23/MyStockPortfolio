# Smoke test brief

A deliberately trivial task whose answer is independently checkable. It exists to prove the
plumbing of an unattended agent run — authentication, reading repo files, writing output to a
known path — **not** to produce any investment view. Delete it once the real briefs exist.

## Task

1. Read `prices.json` and `holdings.json` from the repository root.
2. Find the **five largest one-day movers** across `quotes`, ranked by the **absolute** value of
   each quote's `1d` field (it is a fraction: 0.0887 means +8.87%).
3. For each, say whether the ticker appears in `holdings.json` (`HELD`) or not (`watchlist`).
4. Write the result to `pot/sweeps/smoke.md`, exactly in this shape:

```
# Smoke test — <the `updated` timestamp from prices.json>

| # | Ticker | 1d | Held? |
|---|--------|-----|-------|
| 1 | XXXX   | +0.00% | HELD |
...

Read 79 quotes from prices.json.
```

## Rules

- Use only the two files named above. Do not fetch anything from the network.
- Do not modify any file other than `pot/sweeps/smoke.md`.
- If a figure is not in those files, write `–` rather than supplying it from memory.
