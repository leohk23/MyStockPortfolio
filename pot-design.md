# The AI pot — design and decision log

Companion to [strategy.md](strategy.md). That file holds the **rules** (what to buy). This one
holds the **system** (how it runs) and a record of what has been decided, by whom, and why.

> **Standing rule, while this is still early: update this file in the same change.**
>
> Not afterwards, not at the end of the session. A decision made and not written down is a decision
> that gets silently re-made differently a week later, and this whole design has already been
> corrected twice by its own written record — A6 said a standing order needs re-arm logic until D11
> said it does not, and A1 said three lanes until Review became a fourth. Neither contradiction
> would have been visible if the file had been kept in someone's head.
>
> Concretely, a change to the pot is not finished until: any new **DECIDED / AGREED** row is in §1,
> anything it settles is struck through in **OPEN**, anything it overturns is marked **superseded**
> rather than deleted, and §5 says what is now built. The reason a rejected or superseded item
> keeps its reasoning is that the reasoning is the part worth having later.

Append as we go. Every decision gets a status:

| Status             | Meaning                                                                        |
| ------------------ | ------------------------------------------------------------------------------ |
| **DECIDED**  | Leo said it. Settled unless he reopens it.                                     |
| **AGREED**   | Proposed and accepted. Settled, but a design choice rather than a requirement. |
| **OPEN**     | Still a question. Nothing should be built on it.                               |
| **REJECTED** | Considered and dropped. The reason matters more than the verdict.              |

Nothing here is built yet. This is the plan, written down before the code so the code can be
checked against it.

---

## 1. Decision log

### DECIDED — the requirements

| #   | Decision                                                                                                                                                                                                                                                    | Date        |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| D1  | A separate pot, funded**£250/month**, managed on AI recommendations, run in parallel to the human book.                                                                                                                                              | 26 Aug 2026 |
| D2  | **Execution is manual.** The system produces instructions; Leo places the orders. Nothing automated ever touches a broker.                                                                                                                            | 26 Aug 2026 |
| D3  | **No metered API spend.** The LLM runs through an existing subscription on the always-on PC, not a pay-per-token key.                                                                                                                                 | 26 Aug 2026 |
| D4  | This dashboard must**track the pot's performance separately**, alongside the human-managed book.                                                                                                                                                      | 26 Aug 2026 |
| D5  | The universe is unrestricted — new names*or* existing holdings.                                                                                                                                                                                          | 26 Aug 2026 |
| D6  | **The monthly £250 is a funding cadence, not a decision cadence.** Recommendations must be timely and event-driven, produced when there is a reason, not on a calendar.                                                                              | 27 Aug 2026 |
| D7  | Decisions get documented as they are made — this file.                                                                                                                                                                                                     | 27 Aug 2026 |
| D8  | Articles Leo reads are an input to the Sweep. Kept in[pot/reading.md](pot/reading.md), one line each, with **why it caught his attention** — the part an agent could not have generated.                                                              | 27 Aug 2026 |
| D9  | **Standing orders exist**: hard rules that fire without any LLM judgement. First one — when `^VIX` closes at or above 40, buy the S&P 500.                                                                                                         | 27 Aug 2026 |
| D10 | **Thesis review is weekly**, and sweeps every open thesis rather than waiting for the review date each proposal named.                                                                                                                                | 28 Aug 2026 |
| D11 | The VIX order takes**no re-arm** — it fires on every qualifying close, buys with all available cash (**VUAG**), outranks the §4 position limits, and alerts when the pot is empty rather than queueing.                                       | 28 Aug 2026 |
| D12 | What gets recorded per proposal is**provenance, not a score**: model, lane, tokens, wall time. Judgement is already measured by the return; this exists so a later change of model or a move to API credits can be compared against what came before. | 28 Aug 2026 |
| D13 | **Leo names the ticker for a Deep dive.** The Sweep proposes, he picks, the agent researches what it is given — it may argue against the pick in §6 but may not substitute another.                                                                 | 28 Aug 2026 |

### AGREED — the design

| #       | Decision                                                                                                                                                                                                          | Rationale                                                                                                                                                                                                                     |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1      | **Four lanes** — Scan (free, continuous), Sweep (LLM, weekly), Review (LLM, weekly), Deep dive (LLM, on demand). See §2.                                                                                  | A single lane cannot do both "never miss a known thing" and "discover an unknown thing".                                                                                                                                      |
| A2      | **The Sweep produces universe, not orders.** Its output is watchlist candidates with a one-line reason; only a Deep dive may produce an executable instruction.                                             | Puts the noisy generative step where its worst case is a cluttered watchlist rather than a bad trade. It also enforces patience mechanically: a name found mid-hype is*added*, and the buy trigger may not fire for months. |
| A3      | **Every proposed name enters `watchlist.json`,** so CI fetches its real fundamentals within the hour and the agent's claimed figures can be contradicted by an independent source before any money moves. | The repo already owns a fact-checker for its own LLM. Not using it would be perverse.                                                                                                                                         |
| A4      | The pot's return is measured**including idle cash**.                                                                                                                                                        | Cash accumulating between decisions is a position. Excluding it would rig the comparison against a fully-invested book.                                                                                                       |
| A5      | Scored**three ways** — pot TWR, human book TWR, a passive index — over the pot's own window.                                                                                                              | Two is a trap: if the pot beats the human book and both lose to the index, that is the finding.                                                                                                                               |
| ~~A6~~ | ~~A standing order needs **re-arm logic**~~ — **superseded by D11**, which takes no re-arm. The measurement stands and is why the question was put; the answer went the other way.                  | Measured, not assumed:`^VIX` has closed ≥ 40 on **208 days** since 1990. A per-day rule would have bought 125 times through 2008 alone and emptied the pot inside one episode. See §6.                              |
| A7      | The Scan may emit an**instruction**, not only a signal, when a standing order's condition is met.                                                                                                           | A standing order has no judgement in it by definition, so routing it through an LLM adds latency and a chance to argue with a rule already decided.                                                                           |

### OPEN

| #       | Question                                                                                                                                                     | Blocking                                           |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| ~~O1~~ | ~~All 31 answers in strategy.md~~ — **closed 28 Aug 2026**, all 34 answered.                                                                         | —                                                 |
| O2      | Broker and wrapper. Suggested T212 inside an ISA — commission-free, fractional, and only 7 of 335 existing trades sit there, so it is nearly a clean slate. | Pot accounting (§5).                              |
| ~~O3~~ | ~~How the pot's trades are tagged~~ — **closed**: §10 rules out identifying them by account, so the Tradelog gains a `Pot` column.                | —                                                 |
| ~~O4~~ | ~~Sweep cadence~~ — **closed 28 Aug 2026**: weekly, alongside the Review.                                                                            | —                                                 |
| O5      | Whether the Deep dive drafts automatically or waits to be asked. See §4.4 — the recommendation is auto-draft, human-read.                                  | Scheduling.                                        |
| ~~O6~~ | ~~The VIX standing order's five parameters~~ — **closed 28 Aug 2026**, see D11.                                                                      | —                                                 |
| O7      | Whether the Sweep can reach the web under`--sandbox workspace-write`. Untested — the smoke run needed no network.                                         | The Sweep lane. It may decide which agent runs it. |

### REJECTED

| #  | Rejected                                    | Why                                                                                                                                   |
| -- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| R1 | A monthly "spend this month's £250" cycle. | Superseded by D6. Forcing money out on a calendar buys the least-bad idea available rather than a good one.                           |
| R2 | LLM calls inside GitHub Actions.            | Violates D3 — CI has no subscription auth, only a metered key would work there. CI stays LLM-free and deterministic, as it is today. |
| R3 | Comparing the pot to the human book alone.  | Superseded by A5.                                                                                                                     |

---

## 2. The lanes

| Lane                | Job                                             | Universe                                  | Cost            | Trigger             |
| ------------------- | ----------------------------------------------- | ----------------------------------------- | --------------- | ------------------- |
| **Scan**      | never miss a known thing                        | closed — the ~79 tickers already fetched | **free**  | every CI run        |
| **Sweep**     | read the world, find candidates                 | open                                      | one LLM session | weekly              |
| **Review**    | re-read every open thesis against its falsifier | what the pot holds                        | one LLM session | weekly              |
| **Deep dive** | research one name → executable order           | a single name                             | one LLM session | Scan or Sweep fires |

Sweep and Review are both weekly, which is ~104 sessions a year — negligible against a subscription
at the ~2 minutes each measured in §4. **Worth running as one scheduled session with two ordered
parts: Review first, then Sweep.** Not to save sessions but to protect the Review: an agent that
has just talked itself into three exciting new names is not the one you want grading the theses it
wrote last month. Reviewing before discovering keeps the two apart in the only way that matters.

```
   Sweep (weekly, LLM) ──→ candidates ──→ watchlist.json
                                │                │
                                │      CI fetches fundamentals (< 15 min)
                                │                ↓
                                │      Scan (free, every 15 min)
                                │                │
                                │       fires, maybe months later
                                ↓                ↓
                              LEO PICKS ONE ← ← ←
                                     │
                            Deep dive (LLM) ──→ pot/proposals/
                                     │
                            Leo reads, executes, logs
```

**Two paths in, one gate.** A Sweep candidate can be picked the same week, or wait years until the
Scan finds it cheap. Either way it must be in `watchlist.json` with independently fetched
fundamentals before a Deep dive may touch it — that gate, not a rule against the short path, is
what keeps the discipline. Measured on the first real run: CHRT.L and ROK were swept and fully
covered, four filed years and four P/E bands each, inside one CI pass.

**Leo is the selector (D13), and that was a correction.** The first Deep dive brief told the agent
to take the strongest unflagged signal itself. It produced a proposal for GME — a name that never
appeared in that week's Sweep — because the brief pointed at `signals.json` and nothing pointed at
the Sweep output. The lanes were not joined. The agent obeyed perfectly; the instruction was wrong.

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

|             | Path                                         | Non-interactive form                                                                                                                                  |
| ----------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code | `C:\Users\leohk\.local\bin\claude`         | `claude -p "<prompt>"` — `--print` runs and exits. Also `--permission-mode`, `--output-format`.                                              |
| Codex       | `C:\Users\leohk\AppData\Roaming\npm\codex` | `codex exec "<prompt>"` — documented as "Run Codex non-interactively". Also `--sandbox`, `--cd`, `--json`, `--output-last-message <FILE>`. |

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
- **Quality drift with nobody watching.** The weekly thesis review is the human checkpoint, and it
  should stay one.
- **Hype bias.** An LLM reading news surfaces what is most written about, which correlates with
  what is already priced in. The Sweep brief must push the other way — toward stories that have
  gone *quiet*, second-order effects of macro shifts, and a standing "what changed in the world of
  what I already own" pass.

---

## 5. What is built

Was a plan; now mostly a record. Everything ticked below runs today.

| | What | Command |
|---|---|---|
| ✅ | **The rules** — 34 questions answered | [strategy.md](strategy.md) |
| ✅ | **Scan** — every `[auto]` rule over data CI already fetches. Free, no LLM | `npm run signals` |
| ✅ | **Macro state** — 17 index, rate, currency and commodity series, plus a **Macro view** beside Calendar | part of `npm run fetch` |
| ✅ | **Sweep brief** — discovery. Produces candidates, never orders | `pot/brief-sweep.md` |
| ✅ | **Deep dive brief** — the only lane that may produce an order. Leo names the ticker (D13) | `pot/brief-deepdive.md` |
| ✅ | **Unattended harness** — allowlists what an agent may commit, logs every run | `pot/run-lane.ps1` |
| ✅ | **Reporting** — entry point, dated report per run, cost ledger, readable transcripts | `npm run pot-report` |
| ⬜ | **Pot accounting** — cash, the Tradelog `Pot` column, a third cohort, the three-way TWR | — |
| ⬜ | **Scheduling** — Task Scheduler entries for the weekly Sweep and Review | — |
| ⬜ | **Pot view on the dashboard** — proposals and open theses beside the other views | — |

### What reporting produces

`npm run pot-report` writes four things, all from the Codex session transcripts rather than from
anything an agent claimed about itself:

- **`pot/SUMMARY.md`** — the entry point. What needs a decision, the pot's state, the latest run of
  each lane, cost so far, and links to everything else. A bookmark that never moves.
- **`pot/summaries/YYYY-MM-DD-HHMM.md`** — the same report, dated, one per run, so the history is a
  history and not the last one only.
- **`pot/runs.md`** — the ledger: model, wall time, fresh vs cached input, output and total, per run.
- **`pot/logs/*.md`** — the transcripts made readable. One deep dive renders from **1,057KB of JSONL
  down to 8KB**: what it was asked, all 17 search queries with the URLs they returned, every command
  with its exit code and duration, the files written, and what it concluded. The raw JSONL stays
  where Codex put it, for when the detail matters.

### Cost, measured rather than estimated

Six runs so far: **16m46s wall, 4,698,617 tokens, of which only 449,905 were fresh input** — the
rest served from cache. **Cash cost £0**: Codex authenticates against a ChatGPT subscription, so
nothing is billed per token; what a run spends is subscription allowance and wall-clock time.

The token columns exist for D12. If this ever moves to metered credits, those are the numbers that
would be charged, and runs either side of the switch stay comparable.

The model is **`gpt-5.6-sol`** at reasoning effort *high* — read from `~/.codex/config.toml` and
confirmed in every transcript. A proposal header reading "GPT-5 Codex" is the agent describing
itself, which is not the same thing, and every header so far says "tokens: unknown" because a model
cannot see its own accounting. That is exactly why the ledger reads the log instead.


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

**The VIX standing order, backtested 27 Aug 2026** — `^VIX` daily closes, 9,233 sessions back to
1990, against `^GSPC`.

Raw threshold: **208 days** closed at or above 40, in 13 episodes. Wildly uneven — 2008 alone
supplied **125** of them, 2020 another 33. A rule that fires per qualifying day would have spent
the pot 125 times over in one drawdown. This is what A6 exists to prevent.

With a re-arm — fire at ≥ 40, then stay disarmed until 10 consecutive closes below 25 — it becomes
**10 fires in 37 years, one every 3.7 years**:

```
FIRED         VIX    S&P     +3m    +12m
1998-08-31   44.3    957    +22%    +38%
2001-09-17   41.8   1039     +8%    −16%
2002-07-22   41.9    820     +8%    +21%
2008-09-29   46.7   1106    −21%     −4%
2010-05-07   41.0   1111     +1%    +21%
2011-08-08   48.0   1119    +12%    +25%
2015-08-24   40.7   1893    +10%    +16%
2020-02-28   40.1   2954     +3%    +32%
2020-10-28   40.3   3271    +14%    +41%
2025-04-04   45.3   5074    +23%    +34%
```

8 of 10 positive at twelve months, median +25%.

**Read that carefully rather than gladly.** Ten observations is an anecdote count, not a sample,
and the index in question is the one that survived. The 2008 fire sat 21% underwater three months
later — the rule buys fear, it does not call bottoms. And at roughly one fire every 3.7 years there
is a real chance it **never fires inside the 24-month review window**, which is an argument for
writing it down now and not for expecting to use it.

One useful consequence: the rule only works if the pot is holding cash when it triggers. That makes
dry powder a deliberate position rather than a failure to act — which is exactly what A4 and
§4.4 of [strategy.md](strategy.md) already say.
