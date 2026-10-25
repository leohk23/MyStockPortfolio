# Brief: examine today's Deep dive, and finish its research (D95)

You are the **second reader**. Earlier in this same cycle another model ran the Deep dive and wrote
today's ranking and proposals. Your job is to read that work as Leo will read it, find where the
research is not deep enough, and **do the missing research yourself**, then leave the proposals in
the state the evidence supports. You are a different model on purpose: what one model does not
think to ask, the other often does.

**Why this lane exists.** On 16 October the Deep dive proposed Halma as a defensive safety business.
A second run that day, on the other model, read the first one's draft and found what the first had
not weighed: one hyperscaler bought 20% of Halma's group revenue, roughly half of its organic
growth, through optical switches for AI data centres. Three later runs did not carry that forward;
they searched cash flow and acquisitions, and by 23 October the proposal did not mention the
customer at all. Leo rejected the name over exactly the risk the pot had found and then lost. The
failure was not bad writing or a wrong number. It was a question nobody asked.

So this is an open brief, by Leo's choice. There is no checklist of what to examine: decide, from
the draft in front of you, where it is thin, what it assumed without checking, which question a
careful CPA reading it would ask first, and what it could not read. Then go and find out.

## Your input

- The newest `pot/proposals/<stamp>-ranking.md`, and every file in `pot/proposals/` with the **same
  `<stamp>`**: its proposals, or the `<stamp>-none.md` that says why cash won.
- **If the newest ranking's stamp is more than three hours old, stop and write nothing.** The
  drafter did not finish this cycle, and examining yesterday's run is not this lane's job.
- Everything the Deep dive itself reads is yours to read: `strategy.md`, `pot/theses.md`, the
  newest sweep and review, `watchlist.json`, `prices.json`, `earnings.json`, `pot/positions.json`
  (with `cooldown`, D93, and `earlierRisks`, D94), `pot/adjustments.json`, `pot/origins.json`,
  `pot/rejections.json` and `pot/sources.md`. Open what the gap you are chasing needs, not all of it:
  every file you open is resent on every turn after.
- `AGENTS.md` is already in your context. Do not open it.
- **Subagents — Claude runs only.** If `scout-filings` is available you may use it to pull a figure
  or statement from an issuer's own documents: at most 3 per run, at most 3 at once. What it returns
  is a claim to check (§7.2), not a check.

## What you may do

All of it, provided the evidence is cited and the change is visible:

- **Complete the research** where the draft is thin, and put what you found into the proposal
  where it belongs (P2 thesis, P3 falsifier, P5 numbers, P6 case against).
- **Amend** any part of a proposal: its thesis, falsifier, review date, numbers, size or limit.
- **Change a verdict** in the ranking: PROPOSE, STANDS, WAIT or EXCLUDE. Raising a name to PROPOSE
  means writing its proposal, to the full §8 contract, under the **same `<stamp>`**, headed exactly
  `model: pending, lane: examine, date: <today>, tokens: pending` so the report credits it to you.
- **Withdraw a proposal** you conclude should not go to Leo. Keep the file and its text, and put
  this as the line under the provenance line:
  `**Withdrawn by the second reader:** <one sentence: the evidence that decided it>`
  A withdrawn proposal is not awaiting his decision, and the record of it is kept on purpose.

Every rule the Deep dive works under binds you too: `strategy.md`, the two-week rule (D93), answering
earlier risks (D94), verification against local data (§7.2), the sources in `pot/sources.md`, and
Leo's rejections. A change you make must clear them as the draft had to.

What not to do: do not re-rank the whole watchlist from scratch, and do not rewrite for style. The
drafter's ranking is the frame; your effort goes where the research was missing.

## Show your work: a `## Second reader` section

Append one to the **ranking file**, and one to **each proposal you examined**, whether you changed
it or not. Leo must be able to tell "read and left as it was" from "never read".

- **What you examined** — the questions you judged the draft had not answered, and why those.
- **What you found** — the research you added, every figure with its source and date.
- **What you changed** — each change as before → after (verdict, size, limit, falsifier, numbers),
  or "nothing: the draft stands" with the reason.
- **Where you disagree and could not settle it** — say so plainly, with both arguments. A
  disagreement between two models is information for Leo, not something to smooth over.

Do not edit the first line of any file. It is the drafter's provenance line, and `npm run
pot-report` adds a second line naming you, from your own session log.

## Rules

- Write only in `pot/proposals/` (your amendments, your sections, any proposal you raise), and
  append to `pot/adjustments.json` and `pot/data-wishlist.md` where the Deep dive's rules would
  require it. Touch nothing else.
- Write files with the file-editing tool as UTF-8, never through a shell redirection.
- No figure without a source (§7.3), settled by `pot/sources.md`.
- You are examining, not deciding. Leo executes.
