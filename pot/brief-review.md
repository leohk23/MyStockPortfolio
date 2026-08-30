# Review — re-read every open thesis against what it promised

The lane that closes the loop. Without it the pot is a pick generator: it writes falsifiers nobody
checks and review dates nobody keeps.

You run **before** the Sweep, and that ordering is deliberate (pot-design §2). An agent that has
just spent an hour discovering exciting new names is not the right agent to judge the thesis it
wrote last month. Judge first, discover afterwards.

## What you review

Every **accepted** proposal in `pot/positions.json` — one that a trade in the Tradelog names, so it
is a position with real money behind it. `signals.json` has already done the arithmetic for you
under `6.5 thesis review`: entry price, price now, move since, quantity, review date, and the
**warning** and **break** conditions copied verbatim from the proposal.

**Sweep them all, every week** (§6.5, D10). Not only the ones whose review date has passed — Leo
was asked that exact question and chose all of them. A review date makes you look harder; it is not
permission to skip the rest.

**If there are no accepted proposals there is still the paper record below**, and that is the whole
of your job that week. Do not invent thesis reviews for positions nobody holds.

## The two tiers, checked separately

Since 30 August a falsifier has two tiers, and you must report on each by name:

- **Warning** — usually a miss against management's own stated guidance. It means the thesis is
  under strain. It is **not** a reason to sell.
- **Break** — the thesis is wrong.

For each, say **tripped / not tripped / cannot tell yet**, with the number and where it came from.
"Cannot tell yet" is a real answer when the next filing has not landed: say when it will.

An older proposal may carry one unlabelled paragraph instead. Treat that as a break, and say the
thesis has no warning tier — that is worth knowing, because it means the first signal you get will
be the last one.

## Verdicts — one per thesis, and nothing else sells

| verdict | when | what follows |
|---|---|---|
| `hold` | neither tier tripped | nothing. Say what you checked and what would change it |
| `warned` | warning tripped | **no sale.** Name what to watch and by when |
| `broken` | break tripped | a SELL instruction, §5.1(1) |
| `played-out` | the thesis's own target has been reached | a SELL instruction, §5.1(2) |
| `breach` | the position broke a §4 limit | a TRIM instruction, §5.1(3) |

**§5.1 is deliberately tight, and you will want to break it.** "It has fallen a long way", "it has
run up", "the multiple has re-rated", "it would be prudent to take some off" — none of these is a
sell reason, and Leo wrote the rule specifically to exclude them. With roughly a dozen decisions a
year, churn is the enemy. If you believe a position should go for a reason not in the table, say so
in prose and produce **no instruction**; that is a proposal for Leo to change §5.1, not a trade.

## The paper record — always, funded or not

`signals.json` carries a `shadow` array: every proposal, executed or not, priced from the close on
the day it was written to the price now. **Report it every run as a short table**, newest first:

| proposal | written | entry | now | move | state |

This is the only measurement that exists before the pot is funded, and it answers the question the
experiment was set up to ask — is the agent's judgement worth money? Waiting for real positions to
find out would throw away everything the first nine proposals could have taught.

Three things to say about it, in no more than a paragraph:

- **Anything that has moved materially against its proposal**, and whether the reason is in the
  thesis or outside it.
- **Where the same name has been proposed repeatedly**, whether the later proposals were better or
  merely later. Four NVDA proposals exist; if they are indistinguishable, say so.
- **Where an entry is missing** — a proposal that named no limit cannot be scored, which is a fault
  in that proposal, not in the record.

Be honest about elapsed time. A proposal written yesterday has no result, and "+0.0% over zero
market days" is a fact about the calendar, not about the judgement. Say that rather than dressing
it up.

## Also report, briefly

- **Any thesis with no break condition at all** — `signals.json` flags these as `noFalsifier`.
  A position that cannot be proven wrong cannot be reviewed, and the fix is a re-proposal.
- **Anything the proposal asserted that has since turned out to be wrong**, even where the
  falsifier is untouched. A thesis can be right about the outcome and wrong about the reason, and
  only this lane will ever notice.
- **A falsifier that cannot see the risk its own P6 names.** If P6 says the danger is financed
  demand and P3 tests gross margin, both tiers will read "not tripped" all the way to the point of
  failure, and this lane will report calm while the thesis rots. Say so, and say what P3 should
  have tested — that is a re-proposal, not a sale.

## Sources

`pot/sources.md` governs, as everywhere: numbers this repo holds come from the repo, company
numbers from that company's own filing or IR release. You will need the newest filing for most
theses — that is the point of the lane, and it is the one thing `signals.json` cannot hand you.

## Write it

To `pot/reviews/YYYY-MM-DD-HHMM.md`, the time in **UTC**. Never reuse a filename.

```
model: pending, lane: review, date: <today>, tokens: pending

# Review — <date>

## <TICKER> — <verdict>

**Held:** <qty> since <date> at <entry>, now <price> (<move since>)
**Warning:** <verbatim> — tripped / not tripped / cannot tell until <date>. <evidence, with source>
**Break:** <verbatim> — tripped / not tripped / cannot tell until <date>. <evidence, with source>
**Since the proposal:** <what has actually happened, one paragraph>
**Verdict:** <hold | warned | broken | played-out | breach>, because <one sentence>

## Instruction        <only if broken, played-out or breach>
**SELL <qty> <TICKER> ... day limit @ <price>.** <costs, and the §5.1 clause invoked>
```

Header your output with the provenance line above. Leave `model` and `tokens` as `pending`:
`npm run pot-report` stamps them from the session log, because a model cannot see its own token
accounting and asking it to try invites a confident wrong answer (D12).

Write only `pot/reviews/…`. Touch nothing else.
