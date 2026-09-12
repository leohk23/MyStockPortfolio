# Theses — Leo's standing views about the world

Directional priors the lanes carry into their reading. Not rules, not signals, not orders: a thesis
changes what you go looking for and what you weigh, never what you must conclude.

Read by two lanes:

- **Sweep**, as a bias in *What to bias towards, and against*. The pay-off is second-order — not
  the obvious name the thesis points at, which is already priced, but who gets cheaper inputs and
  whose pricing power goes.
- **Deep dive**, as a standing list of where to look under Rule 3, which already sends
  `competitive` and `secular` risks outside the company's own filings.

**Not** read by the Scan. `signals.json` holds machine-checkable state; a thesis is interpretation,
and A8 keeps those apart. There is nothing here for `signals.js` to compute.

A thesis is a prior, not a conclusion. It earns a mention in the output only where it actually
bears on the name — a candidate that touches no thesis here is not worse for it, and no thesis is
on its own an argument for buying anything.

> **Two guards were designed and parked** (7 Sep 2026), by Leo, deliberately, while the shape is
> tested: a required dated falsifier on every thesis with the Review lane checking it, and a
> requirement that the Sweep name what each thesis argues *against*, including inside Leo's own
> book. Without them this file can become a confirmation-bias engine — the Sweep goes and finds
> the evidence. `brief-deepdive.md` Rule 4 is unaffected and still bites on its own: a dominant
> risk whose earliest observable is undated or more than two quarters out halves the order,
> whatever a thesis says about it.

---

## T1 — Chinese open-weight models reach rough parity with US frontier models at a fraction of the price

More capable open-weight releases out of China, arriving faster and cheaper, good enough for the
majority of production work rather than only for benchmarks.

**Implies**

- *Tailwind* — companies whose AI cost is inference rather than research: application-layer
  software that can swap the model underneath, and buyers of AI rather than sellers of it. Also
  non-US clouds, and anyone serving markets where a US frontier API is expensive or unavailable.
- *Headwind* — pricing power in frontier models, and the premium seats sold on top of them. What
  this thesis attacks is the **margin** assumption, not the demand assumption. Both can be right at
  once: inference volume grows and the price per unit collapses.

**Where it already touches Leo** — the book is ~66% US with megacap tech in the four largest
positions, so this is a headwind to what he already owns before it is an opportunity anywhere else.

**Confidence** — medium. This is Leo's own view and not the consensus one; treat it as a place to
look, not as settled.

---

## T2 — AI agents compress the value of seat-priced workflow software

The work a seat is sold to do — bookkeeping, filing, ticket triage, reconciliation — is the kind an
agent does end-to-end. The category does not have to disappear for this to bite: it is enough that
the buyer needs fewer seats, or pays for an outcome instead of a seat.

**Implies**

- *Headwind* — software priced per seat where the seat maps to a task rather than to a judgement.
  Watch the **pricing model** rather than the product: revenue growth that comes from price and
  mix while unit or customer counts flatten is this thesis arriving early.
- *Tailwind* — the same shift pays whoever sells the outcome, and whoever was never charging by
  the seat in the first place.

**Where to look** — this is the point of the entry, and Rule 3 asks for exactly this:

- a regulator's or a substitute's own adoption figures, published on their own cadence (the IRS
  publishes Direct File take-up annually)
- disclosed customer or unit counts set against price-driven revenue growth, from the company's
  own filing — Intuit's FY2026 release has US TurboTax units **down 2%** with QuickBooks growth
  coming partly from price and mix
- the wording of the 10-K risk factors from one year to the next
- any move in the category from seat pricing to usage or outcome pricing

**Relationship to [T1](#t1--chinese-open-weight-models-reach-rough-parity-with-us-frontier-models-at-a-fraction-of-the-price)** — siblings, not duplicates. T1 attacks the margin of whoever sells the
model; T2 attacks the margin of whoever sells the application on top. Cheap open weights are one
mechanism by which T2 arrives, so evidence for T1 raises the prior on T2, but each has its own
victims and they can be right independently.

**Confidence** — medium, and specifically *not* a verdict on any name. This thesis is a place to
look, not a conclusion to reach: a company can be inside it and still win, and a proposal that
engages it with dated external figures and concludes the moat holds has done what was asked.

---

## T3 — AI agents create a control layer, and regulation makes it compulsory

Every agent is a new non-human identity with credentials, data access and the power to act. Someone
must inventory them, grant and revoke permissions, log what they did and name an accountable human.
That need exists from security risk alone; regulation (EU AI Act obligations phasing in from August
2026, sector regulators in finance and health) turns it from good practice into a line item that
cannot be cut.

**Implies**

- *Tailwind* — identity and permissions for non-human actors, cross-vendor AI governance and audit
  trails, runtime security for models and agents, and independent assurance where a third party is
  actually mandated. Model-neutral positions benefit from T1: the more models a firm runs, the more
  it needs one place to govern them.
- *Headwind* — compliance *advice* priced by the hour (an agent can read a regulation), and point
  tools a platform can bundle for free.

**Mandated is narrower than it sounds.** Under the AI Act most Annex III high-risk systems are
self-assessed under internal control; a notified body is required mainly for biometrics and for
products already covered by sector regulation. Treat "compliance demand" for testing and
certification firms as optionality until a filing shows it, not as the thesis arriving.

**Where it already touches Leo** — NOW is held, and sits inside both
[T2](#t2--ai-agents-compress-the-value-of-seat-priced-workflow-software) (seat-priced ticket triage)
and T3 (AI Control Tower). A proposal on NOW must weigh both, not pick the one it prefers.

**Where to look**

- AI-specific ARR or product revenue disclosed separately in the filing, not in a press release
- non-human identity counts, where a vendor discloses them
- EU notified-body designations under the AI Act (NANDO database), the first enforcement actions,
  and whether the high-risk deadlines have been postponed
- whether assurance revenue at testing and certification firms is reported at all; while it is not
  separately disclosed it is immaterial, whatever the launch release says
- which earnings basis a quoted multiple is on — the source that suggested this thesis put NOW at
  ~29x forward against 82.8x trailing reported in `prices.json`, a gap no single year of growth
  closes

**Relationship to T1 and T2** — T1 and T2 say who loses margin as agents spread; T3 says who is paid
to keep them under control. A name can be hurt by T2 and helped by T3 at the same time.

**Confidence** — medium on the need, low on regulation as the driver. The regulatory calendar is
contested and may slip; the security case does not depend on it.
