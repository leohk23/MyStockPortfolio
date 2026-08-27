# The AI pot — design and decision log

Companion to [strategy.md](strategy.md). That file holds the **rules** (what to buy). This one
holds the **system** (how it runs) and a record of what has been decided, by whom, and why.

Append as we go. Every decision gets a status:

| Status | Meaning |
|---|---|
| **DECIDED** | Leo said it. Settled unless he reopens it. |
| **AGREED** | Proposed and accepted. Settled, but a design choice rather than a requirement. |
| **OPEN** | Still a question. Nothing should be built on it. |
| **REJECTED** | Considered and dropped. The reason matters more than the verdict. |

Nothing here is built yet. This is the plan, written down before the code so the code can be
checked against it.

---

## 1. Decision log

### DECIDED — the requirements

| # | Decision | Date |
|---|---|---|
| D1 | A separate pot, funded **£250/month**, managed on AI recommendations, run in parallel to the human book. | 26 Aug 2026 |
| D2 | **Execution is manual.** The system produces instructions; Leo places the orders. Nothing automated ever touches a broker. | 26 Aug 2026 |
| D3 | **No metered API spend.** The LLM runs through an existing subscription on the always-on PC, not a pay-per-token key. | 26 Aug 2026 |
| D4 | This dashboard must **track the pot's performance separately**, alongside the human-managed book. | 26 Aug 2026 |
| D5 | The universe is unrestricted — new names *or* existing holdings. | 26 Aug 2026 |
| D6 | **The monthly £250 is a funding cadence, not a decision cadence.** Recommendations must be timely and event-driven, produced when there is a reason, not on a calendar. | 27 Aug 2026 |
| D7 | Decisions get documented as they are made — this file. | 27 Aug 2026 |

### AGREED — the design

| # | Decision | Rationale |
|---|---|---|
| A1 | **Three lanes** — Scan (free, continuous), Sweep (LLM, scheduled), Deep dive (LLM, on demand). See §2. | A single lane cannot do both "never miss a known thing" and "discover an unknown thing". |
| A2 | **The Sweep produces universe, not orders.** Its output is watchlist candidates with a one-line reason; only a Deep dive may produce an executable instruction. | Puts the noisy generative step where its worst case is a cluttered watchlist rather than a bad trade. It also enforces patience mechanically: a name found mid-hype is *added*, and the buy trigger may not fire for months. |
| A3 | **Every proposed name enters `watchlist.json`,** so CI fetches its real fundamentals within the hour and the agent's claimed figures can be contradicted by an independent source before any money moves. | The repo already owns a fact-checker for its own LLM. Not using it would be perverse. |
| A4 | The pot's return is measured **including idle cash**. | Cash accumulating between decisions is a position. Excluding it would rig the comparison against a fully-invested book. |
| A5 | Scored **three ways** — pot TWR, human book TWR, a passive index — over the pot's own window. | Two is a trap: if the pot beats the human book and both lose to the index, that is the finding. |

### OPEN

| # | Question | Blocking |
|---|---|---|
| O1 | All 31 answers in [strategy.md](strategy.md). | Everything. No rule can be coded until the rules exist. |
| O2 | Broker and wrapper. Suggested T212 inside an ISA — commission-free, fractional, and only 7 of 335 existing trades sit there, so it is nearly a clean slate. | Pot accounting (§5). |
| O3 | How the pot's trades are tagged: a new Tradelog column, or a dedicated broker account that implies it. | Pot accounting. |
| O4 | Sweep cadence. Weekly is the suggestion; nothing tested. | Scheduling (§4). |
| O5 | Whether the Deep dive drafts automatically or waits to be asked. See §4.4 — the recommendation is auto-draft, human-read. | Scheduling. |

### REJECTED

| # | Rejected | Why |
|---|---|---|
| R1 | A monthly "spend this month's £250" cycle. | Superseded by D6. Forcing money out on a calendar buys the least-bad idea available rather than a good one. |
| R2 | LLM calls inside GitHub Actions. | Violates D3 — CI has no subscription auth, only a metered key would work there. CI stays LLM-free and deterministic, as it is today. |
| R3 | Comparing the pot to the human book alone. | Superseded by A5. |

---

## 2. The three lanes

| Lane | Job | Universe | Cost | Trigger |
|---|---|---|---|---|
| **Scan** | never miss a known thing | closed — the ~79 tickers already fetched | **free** | every CI run |
| **Sweep** | read the world, find candidates | open | one LLM session | scheduled |
| **Deep dive** | research one name → executable order | a single name | one LLM session | Scan or Sweep fires |

```
     ┌── Sweep (weekly, LLM) ──→ candidates ──→ watchlist.json
     │                                              │
     │                                    CI fetches fundamentals
     │                                              ↓
     └──────────────────────────────→ Scan (free, every 15 min)
                                                    │
                                          something fires
                                                    ↓
                                         Deep dive (LLM) ──→ pot/proposals/
                                                    ↓
                                            Leo reads, executes, logs
```

The expensive lane is gated behind the free one. The free lane's coverage grows every time the
Sweep runs, so the zero-cost surface compounds.

**The Scan's most valuable output is silence.** "Nothing fired" is information, and it costs nothing
to produce.

---

## 3. What "an LLM session" actually means

A session is one run of a coding agent: it reads context, uses tools (read files, run commands,
search the web), and writes output. It is the same thing as a Claude Code or Codex conversation —
the only question is whether a human types the prompt or a scheduler does.

**Verified on this machine, 27 Aug 2026:**

| | Path | Non-interactive form |
|---|---|---|
| Claude Code | `C:\Users\leohk\.local\bin\claude` | `claude -p "<prompt>"` — `--print` runs and exits. Also `--permission-mode`, `--output-format`. |
| Codex | `C:\Users\leohk\AppData\Roaming\npm\codex` | `codex exec "<prompt>"` — documented as "Run Codex non-interactively". Also `--sandbox`, `--cd`, `--json`, `--output-last-message <FILE>`. |

Both authenticate against a **subscription**, which satisfies D3. Note the consequence: a scheduled
run draws on the *same allowance* as interactive use. A weekly Sweep is negligible; a daily one
would start competing with normal work.

The brief itself stays a **markdown file in this repo**, not agent-specific config, so either tool
can execute it and neither one locks the design in.

---

## 4. Can it run without being triggered manually?

**Yes for the Scan and the Sweep. For the Deep dive, yes to the draft — but not to the decision.**

### 4.1 Scan — fully automatic, no LLM

Plain JavaScript over files CI already produces (`prices.json`, `earnings.json`, `peBands`,
`history.json`, `holdings.json`). It runs as a step in the existing workflow and writes
`signals.json`. No agent, no auth, no cost, no new failure mode.

### 4.2 Sweep — fully automatic

A Windows Task Scheduler entry on the always-on PC:

```
codex exec --cd C:\Users\leohk\MyStockPortfolio \
           --output-last-message pot\sweeps\latest.md \
           "Follow pot/brief-sweep.md"
```

Weekly. Its output is candidates, so an off day costs a cluttered watchlist, nothing more.

### 4.3 Getting told about it

No new notification system. Proposals and signals are **files in the repo**, and the dashboard is
already the thing you open. A "Pot" view beside Calendar shows open theses, pending proposals and
what the Scan last flagged.

The staleness idiom already exists too: `signals.json` carries a timestamp, and the page shows its
age the same way it shows "Prices as of …". If a scheduled task dies quietly, the page says so —
which matters, because **the failure mode of an automated lane is silence, and silence is exactly
what a healthy Scan also looks like.**

### 4.4 Deep dive — automate the draft, not the decision

The line worth holding. An unattended Sweep adding names to a watchlist is low-risk. An unattended
Deep dive producing a buy instruction that gets executed unread is not — and it would quietly
undo D2, which is the point of the whole arrangement.

So: the Deep dive may draft automatically when the Scan fires, writing to `pot/proposals/`. It is
never executed unread. Leo's own framing — *"execution I can do it myself as long as I have the
instructions provided"* — already draws this line in the right place.

### 4.5 Safety posture for unattended runs

- **Never** `--dangerously-bypass-approvals-and-sandbox` on a machine holding git credentials. Use
  `--sandbox` with workspace write only.
- The automated lanes may write **only** to `pot/**` and `watchlist.json`. Nothing else, ever.
- Publishing is a **separate deterministic script**, not the agent: commit and push those two paths
  and no others. An agent that can write files is fine; an agent that can push anything it likes is
  a different risk.
- No lane touches a broker. D2 is structural, not a policy anyone has to remember.

### 4.6 What automation does not fix

- **Non-determinism.** Two runs of the same Sweep give different answers. Acceptable for candidate
  generation; the rules in [strategy.md](strategy.md) are what constrain the spread.
- **Quality drift with nobody watching.** The monthly thesis review is the human checkpoint, and it
  should stay one.
- **Hype bias.** An LLM reading news surfaces what is most written about, which correlates with
  what is already priced in. The Sweep brief must push the other way — toward stories that have
  gone *quiet*, second-order effects of macro shifts, and a standing "what changed in the world of
  what I already own" pass.

---

## 5. What has to be built

Nothing yet. In dependency order:

| Phase | What | Depends on |
|---|---|---|
| 1 | Answers in [strategy.md](strategy.md) | Leo |
| 2 | Pot accounting: trade tagging, **cash balance**, a third cohort, the three-way comparison | O2, O3 |
| 3 | `npm run signals` — the free Scan, plus `signals.json` | O1 |
| 4 | `pot/brief-sweep.md` and `pot/brief-deepdive.md`, agent-agnostic | O1 |
| 5 | Scheduled tasks and the publish script | 3, 4 |
| 6 | The "Pot" view on the dashboard | 2, 3 |

The only genuinely new machinery is **cash**. `tradeFlow` computes a trade's cash flow for TWR, but
nothing tracks a balance — and under D6 the pot will hold cash for months at a time.

---

## 6. Evidence recorded so far

Kept because it was measured rather than assumed, and because the defaults in
[strategy.md](strategy.md) were derived from it.

**The book, 27 Aug 2026** — $174,972 across 55 companies. Top 5 = 42%, top 10 = 61%, and a tail of
**29 names under 1% each** totalling 13.5%. Median position 0.9% (~$1,600); median holding age 1.7y;
yield 0.94%. US 65% · Japan 8.8% · Old HK 8.5% · China 7.3% · Europe 6.7%.

→ The book is a barbell, and £250/month naturally produces more tail. Hence the £400 minimum
position: two months' saving, not a thirtieth sub-1% holding. £3,000/year against a median position
of $1,600 funds **two to three positions a year**, not a dozen.

**Scan signals, run live 27 Aug 2026** — all three fired on real things, at zero cost:

- *Near its own cheapest-ever multiple*: 0006.HK at 7.2× against an own-floor of 12.4×; GME 13.5 vs
  23.3; AMZN 21.0 vs 29.3. **Tuning noted:** a 20% band fired on 12 holdings — too loose — and
  "below its own floor" is a stronger, distinct signal from "near it". Split them.
- *Price down, earnings up*: XIACY −47% over a year while net income went 23.7B → 41.6B (+76%);
  NTDOY −39% with net income +52%; 9961.HK −36% with +95%.
- *Results inside 14 days*: 1211.HK 28 Aug, AVGO 2 Sep, both confirmed.

**Macro is free too** — verified on the same no-crumb endpoint the repo already uses: `^TNX` 4.68
(+18% in 6m), `^VIX` 14.64, `DX-Y.NYB` 99.17, `GC=F` 4659 (−10.9%), `CL=F` 83.91 (+25.2%), `HG=F`,
`GBPUSD=X`, `^N225`.

→ Machines for macro **state**, LLM for macro **interpretation**. The Sweep should be handed the
dashboard, not asked to fetch it.
