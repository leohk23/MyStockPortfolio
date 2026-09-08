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
> **Verify the edit landed, do not assume it.** A8 through A13 were each announced as recorded and
> not one reached this file. The table had been reformatted with column padding into `| A8      |`
> while the scripted `replace()` anchors still said `| A8 |`; every one matched nothing and failed
> silently, and the console reported "recorded" because the script had *run*, not because the
> content had *arrived*. Six decisions were lost that way over four commits. Grep for the row
> afterwards — the check is one line and it is the difference between a log and a fiction.
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
| D2  | **Execution is manual — for now, and because of us, not by preference.** The system produces instructions; Leo places the orders. *Revised 28 Aug 2026: this is a technical limitation, not a principle. Automating execution is wanted once it can be done safely; until then nothing automated touches a broker, and that constraint is real while it lasts.*                     | 26 Aug, rev 28 Aug 2026 |
| D3  | **No metered API spend — for now.** The LLM runs through an existing subscription on the always-on PC. *Revised 28 Aug 2026: open to metered credits once the pot is stable and showing promise. This is why D12 records tokens: the ledger has to be comparable across the switch.*                                                                                             | 26 Aug, rev 28 Aug 2026 |
| D4  | This dashboard must**track the pot's performance separately**, alongside the human-managed book.                                                                                                                                                      | 26 Aug 2026 |
| D5  | The universe is unrestricted — new names*or* existing holdings.                                                                                                                                                                                          | 26 Aug 2026 |
| D6  | **The monthly £250 is a funding cadence, not a decision cadence.** Recommendations must be timely and event-driven, produced when there is a reason, not on a calendar.                                                                              | 27 Aug 2026 |
| D7  | Decisions get documented as they are made — this file.                                                                                                                                                                                                     | 27 Aug 2026 |
| D8  | Articles Leo reads are an input to the Sweep. Kept in[pot/reading.md](pot/reading.md), one line each, with **why it caught his attention** — the part an agent could not have generated.                                                              | 27 Aug 2026 |
| D9  | **Standing orders exist**: hard rules that fire without any LLM judgement. First one — when `^VIX` closes at or above 40, buy the S&P 500.                                                                                                         | 27 Aug 2026 |
| D10 | **Thesis review is weekly** *(cadence superseded by D30 — every 2 days; the sweep-every-open-thesis principle stands)*, and sweeps every open thesis rather than waiting for the review date each proposal named.                                                                                                                                | 28 Aug 2026 |
| D11 | The VIX order takes**no re-arm** — it fires on every qualifying close, buys with all available cash (**VUAG**), outranks the §4 position limits, and alerts when the pot is empty rather than queueing.                                       | 28 Aug 2026 |
| D12 | What gets recorded per proposal is**provenance, not a score**: model, lane, tokens, wall time. Judgement is already measured by the return; this exists so a later change of model or a move to API credits can be compared against what came before. | 28 Aug 2026 |
| ~~D13~~ | ~~Leo names the ticker for a Deep dive~~ — **superseded by D14.** Held for one day. The reasoning stands and is why the lanes got joined: a Deep dive that reads only signals.json cannot see what the Sweep found.                                                                                                              | 28 Aug 2026 |
| D14 | **The agent picks the ticker(s), from the Sweep's candidates AND the Scan's signals together.** Ranked against Leo's own rules, and it may produce more than one proposal. Leo can still run a Deep dive ad hoc on anything he likes; that is an extra door, not the main one.                                                | 28 Aug 2026 |
| D15 | **A pending proposal is not a position.** Unexecuted drafts in `pot/proposals/` must not change what a later run proposes: if a name is still the best on today's evidence, it is proposed again. Only `pot/positions.json` — cash and what was actually bought — constrains sizing. Lane outputs are stamped `YYYY-MM-DD-HHMM` UTC so repeated test runs never overwrite each other. | 29 Aug 2026 |
| D16 | **Sources are ranked by claim, not by domain — [`pot/sources.md`](pot/sources.md), read by both lanes.** A number the repo holds is quoted from the repo; a company number from that company's filing or IR release; macro from the publishing agency; costs from the broker. Press is for narrative and for finding names, never the sole source of a figure. **No approved-domain list** — that would recreate the Scan/Sweep coupling D15 and A14–A16 exist to prevent. There *is* a short never-cite list of aggregators and promotional sites, on the ground that they are always downstream of something better. Finding a name on one is fine; citing it is not. | 29 Aug 2026 |
| D17 | **A fixed daily cadence, sized against the weekly allowance.** Weekdays **06:30, 12:45, 21:15**; weekends **09:00** (UK local). Replaces a one-time trigger repeating every 9h, which drifted through the clock on a 72-hour cycle and so never landed at a consistent point against either a market session or Leo's own free time. The times are chosen so a cycle **finishes** just before a window he can read it in — before work, at lunch, after the US close — and 12:45 is the only slot that reads a settled Asia close while it is still the freshest event, which matters because the book is HK-heavy. 17 cycles/week at ~5% of the subscription's weekly allowance each ≈ **85%**, against 93% under the old 9h trigger. **This does not reopen D6:** it sets when the lanes *look*, not when they must produce; funding stays monthly and a lane still proposes only when there is a reason. Schedule table, arithmetic and how to change it: **§4.2**. | 1 Sep 2026 |
| D18 | **The lanes see the human book, and it is a disclosure rather than a gate.** `signals.json` gains a `book` block — weights by name, by company and by geography, struck on market value in GBP — so the Sweep can bias toward what Leo is *not* exposed to and the Deep dive can state what a buy does to his combined position. Neither lane may downgrade a rank for overlap: §3.3 permits buying what the main book already holds, and the warning attached to it — *"the more the pots overlap, the less the comparison tells you"* — is Leo's to weigh, not an agent's to enforce. Computed deterministically for the reason A8 moved the macro relations into the Scan: weights are arithmetic, and an agent deriving them from 59 rows of trades will eventually get one wrong. **Known gap:** `holdings.json` has no sector field, so the visible concentration is geographic (66% US) while the real one — the top four names are all US megacap tech — shows only in the name weights. | 4 Sep 2026 |
| D19 | **Whole shares only, and the first £250 is in.** *(The "cannot be bought at all" half is superseded in part by D21/§4.2a: one share is now always bought. The reasoning below is kept because it is why §4.2a exists.)* Leo does not buy fractions, so a position is `floor(allocation ÷ price in GBP)` and a name whose single share costs more than the allocation cannot be bought at all. At the £125 half-allocation that currently rules out INTU (~£246/share) and NVDA (~£170), and leaves TW deploying 63% of it — INTU being the name the Deep dive has proposed most often. Proposals must state the whole-share order, the cash deployed and the remainder left idle. Recording the contribution also exposed that `positions.js` computed `paidIn` and then discarded it (`cashGBP = prev.cashGBP ?? 0`), so cash read £0 with the money already in the account and the Deep dive would have kept sizing against "the next contribution". | 4 Sep 2026 |
| D20 | **P6 names one dominant risk, the thesis may not pre-answer it, and a slow or unfalsifiable one halves the order.** Leo asked why the INTU proposal did not carry the concern he had reached himself — that an AI agent could displace both the bookkeeper and the software — and why, like NVDA's circular financing, the design had not caught it. The answer was uncomfortable: the brief already held the exact rule, cited NVDA as its worked example, and the next proposal breached it identically. INTU's P6 said the risk would bite *"before revenue shows it"* and P3 then tested revenue; its P2 asserted the moat survives AI as an unargued premise. A rule written as prose asking the agent to check did not check. Four structural rules replace it in `brief-deepdive.md`: **(1)** P6 opens with ONE dominant risk on its own line, tagged `financial / competitive / secular / accounting / regulatory`, and "P3 answers P6" binds to that line; **(2)** the thesis may not contain the rebuttal to it — that rebuttal is what P3 tests; **(3)** for `competitive` and `secular` risks the falsifier search extends outside the company's filings to the substitute's adoption figures, a regulator's own programme numbers, disclosed customer counts against price-driven growth, and year-on-year 10-K risk-factor wording; **(4)** if the dominant risk's earliest observable is more than two quarters away or undated, the order is half the §4 size by default, arguable back up in P1. A fifth — reading the strongest public bear case from outside sources — was proposed and **declined**: it points toward exactly the source-quality noise `sources.md` guards against, and Leo chose to keep that reading his own. | 4 Sep 2026 |
| D21 | **One whole share always clears §4.2 — new rule §4.2a, superseding the "unbuyable" half of D19.** D19 recorded that a name whose single share costs more than the allocation cannot be bought, which at the £125 half-allocation deleted INTU (~£246/share) and NVDA (~£170) outright — INTU being the name the Deep dive has proposed most often. Leo's call: buy the minimum one share instead. The reasoning is §11.1.e's, which lets a standing order outrank the position limits because otherwise *"the rule quietly stops working in exactly the conditions it exists for"*; a cap meant to limit concentration was instead deleting candidates by **share price** rather than by any judgement about the business. It is bounded rather than open-ended, because §4.2 binds on **contributed capital to date** and not on current pot value: one INTU share is 98% of £250 today, 49% at £500 and 33% at £750, so both names sit under the cap from the **second** contribution. The pot being small enough for one share to dominate it is precisely the condition §4.2's own rationale anticipated — *"early on the pot is small and any first position is 100% of it."* Coded bounds: one share and never more, it must fit available cash (the pot does not borrow), and P1 must state the resulting concentration and how many contributions unwind it, so a temporary 98% position is a disclosed choice rather than an arithmetic accident. The rest of D19 — whole-share sizing, stating cash deployed and idle — stands unchanged. | 4 Sep 2026 |
| D22 | **Leo's standing views about the world get their own file, `pot/theses.md`, read by the Sweep as a bias and by the Deep dive as a place to look.** Leo's assumption — that Chinese open-weight models keep arriving cheaper and reach rough parity — had nowhere to live. Two candidate homes were rejected: `signals.js`/the Scan, because A8 reserves machines for checkable state and a thesis is interpretation with no field to read; and §11 standing orders, which by definition fire with **no LLM judgement at all** while a thesis is entirely judgement. It goes instead to the two places that already carry a directional prior of the same shape: `brief-sweep.md`'s *What to bias towards, and against*, which already argues that reducing a 66% US concentration is worth more than another good American software company; and `brief-deepdive.md`, whose Rule 3 already sends `competitive` and `secular` risks outside the company's own filings. This is the D20 gap from the other end — D20 forced the dominant risk to be *named*; a thesis file supplies the substitute's name before the agent has to invent it. T1 is the open-weight thesis; T2, promoted from being a mere worked example inside Rule 3, is that AI agents compress the value of seat-priced workflow software — the concern Leo reached himself on INTU and the pipeline never did. Two guards were designed and **parked** at Leo's call while the shape is tested: a dated falsifier per thesis with the Review lane checking it, and a requirement that the Sweep name what each thesis argues against, including inside Leo's own book. Without them the Sweep can be pointed at evidence for a conclusion Leo already holds, which is the failure mode that section of the brief exists to prevent. | 7 Sep 2026 |
| D23 | **The thesis check is unconditional and runs before the dominant risk is named — Rule 0.** D22 hooked `theses.md` into the Deep dive through Rule 3, as *"a thesis that bears on the dominant risk must be engaged in P6"*. That hook could not fire: the agent names the dominant risk first, so the rule then asked whether any thesis bore on a choice already made, and tagging `financial` made the answer no. It is the D20 failure shape rebuilt one level up — a rule asking the agent to check, evaluated by the agent, after the decision it was meant to constrain. Both 7 Sep cycles proved it on the same name: RELX sells LexisNexis and Elsevier, seat-priced information tools to lawyers and scientists, which is the category T2 names outright; both proposals tagged the dominant risk `financial` (a £2.25bn buyback and rising leverage) and neither document contains the words AI displacement anywhere. `theses.md` reached the Sweep output only inside its list of files consulted. Rule 0 replaces the hook: P6 now opens with a `Theses:` line naming which entries bear on the name and why, or the single word `none` — never blank, never omitted — with the dominant risk on the line beneath it. `none` stays a legitimate answer (MWA sells water infrastructure and no thesis touches it), but it is written down rather than silent, and `financial` becomes a conclusion defended against the line above it. The Sweep's hook was left opt-in deliberately: it ranges over a market rather than one name, and parked guard #2 is the right fix there if it proves necessary. | 8 Sep 2026 |
| D24 | **The lane allowlist silently deletes hand edits to anything outside `pot/`, and `pot-design.md` is outside it.** D22 was written to `pot-design.md`, left uncommitted while a cycle ran, and was gone an hour later — never committed, absent from every commit, no stash, unrecoverable from git; it had to be retyped. `run-lane.ps1` reverts everything not matching `$allowed = @('pot/*', 'watchlist.json')` and not already dirty when that lane started, which is correct and is what stops a stray agent edit riding along. But `pot-design.md`, `strategy.md`, `index.html` and every other root file sit outside it, so a human editing them mid-cycle loses the work with no error and no log line — the tree simply reads clean, which is exactly how it was misread as "committed". The rule to take from this is procedural, not code: **commit hand edits before a cycle can start**, because the allowlist cannot tell Leo's edit from an agent's. | 8 Sep 2026 |
| D25 | **Transaction cost is a sizing consideration, not only a 2% gate, and the broker is no longer assumed to be free.** §4.1 already refused any ticket whose first-year costs exceed 2%, and the brief already listed commission, FX spread, stamp duty and ADR custody — so costs were being stated. What was wrong was the number. The 7 Sep MWA proposal costed itself against a Trading 212 ISA at **£0 commission**, reporting total costs of *"0.15% of the ticket"*, because §10's *"no broker constraint as I'm executing"* left the agent to pick one and it picked the free one. Leo actually pays a **flat $1 per US ticket**, which on that £124 order is **0.6%** — four times the reported figure and the largest single cost in it. The second half is Leo's own point: a flat fee makes share count a decision the 2% gate cannot see, because it passes at every size. $1 on 7 MWA shares at $24 is 0.6%, on 10 it is 0.42%, on 20 it is 0.21%; his instinct at that price is 10 shares. So P1 now names the broker it costs against, defaults to $1 per US ticket, states the fee as a percentage of the ticket at the proposed size, and where idle cash could buy another whole share says what that does to the percentage. Deliberately **not** a rule, at Leo's explicit instruction — *"for 7 shares it's acceptable to me but I don't want to create a hard rule here especially the pot is so small"* — so it overrides nothing in §4 and no name is dropped for costing 0.6% instead of 0.4%. What is forbidden is leaving the number unstated or quoting one from a broker he may not be using. | 8 Sep 2026 |
| D26 | **Cheapness a declared thesis would explain is not an opportunity until the discount is argued — Rule 5.** Leo's observation, on RELX: the reason it screens so attractively may be the same existential AI question he had reached on INTU, and he asked whether T2 had not already covered it. T2 covers the category; what nothing covered is the interaction between a thesis and the valuation filter. §4 screens on how cheap a name is against its **own** history, and a live secular thesis is one of the things that makes a name cheap against its own history — so the screen systematically delivers, at the top of the ranking, the names a thesis is attacking, and their cheapness reads as opportunity when it is the market's price for the risk. Rule 0 forces the thesis to be declared and Rule 2 forbids the thesis pre-answering the risk; neither binds the valuation, so a name could declare T2, tag `financial`, and still be bought for being cheap because of T2. RELX is the worked example: 20.2x recurring at the **9.9th percentile** of its own five-year range against a **34.1x median**, down 26% in a year, with a P2 that said *"the market appears to be pricing a sharp fade in that compounding; what it may be missing is that the mix continues to shift toward higher-value analytics"* — stating that a fade is priced, never naming what the market thinks causes it, then asserting the rebuttal. Rule 5: where a name is in the cheapest decile and a declared thesis bears on it, P2 must say what the market is discounting and why that is wrong, with the de-rating quantified; "what the market may be missing" is not an answer on its own. It is Leo's own 7532.T test aimed at the thesis file — is the cheap price the thesis, priced? | 8 Sep 2026 |
| D27 | **Every proposal opens by saying what the company actually does.** Leo's request, and it costs three sentences. §2 records that he buys what he is *familiar enough with*, from first-hand observation — M&S from shopping there, NVDA from using ChatGPT — so a plain-English description of the ordinary course of business is the thing he judges familiarity on, and no section of the §8 contract carried it: P1 is the order, P2 is the argument, and a reader could reach P6 knowing the multiple and the ROIC without ever learning what the company sells. It is deliberately placed **above P1**, outside the numbered contract, so it changes nothing about what a proposal must contain. The second effect is structural rather than editorial: describing the business before arguing about it makes a category-level risk harder to skip, because a document that has just said RELX sells legal research and scientific publishing to lawyers and scientists has already written down the subject of T2. No thesis, no adjectives, no valuation. | 8 Sep 2026 |
| D28 | **The data wishlist is re-keyed by metric, derived rather than declared.** The file's own rule is *"three sweeps reaching for the same series is a case to build it"*, and the file was structured so that rule could never be applied: 81 entries keyed by date and company, so a series wanted nineteen times across nineteen different companies read as nineteen one-offs. Nobody could see the nineteen. `pot/report.js` now counts ENTRIES containing each metric — how many separate sweeps reached for a thing, which is what the rule actually asks — and rewrites a table between markers at the top of the file, where the Sweep will see it when it opens the file to append. Eight metrics are already over the bar and none had been noticed: **cash conversion 19**, margin 13, volume/units 13, leverage 9, backlog 8, inventory 7, capital returns 6, return on capital 3. Keyword-matched, and left crude deliberately: the alternative is asking the Sweep to tag its own entries, which A20 rules out — the count comes from what was written, not from what an agent says it wrote — and a phrasing the list misses is undercounted, never over, so a row showing three reaches has at least three. The chronological log stays exactly as it is; the tally is derived from it and regenerated on every report run. | 8 Sep 2026 |
| D29 | **The Review lane runs fortnightly, not every cycle.** *(Superseded next day by D30: Leo meant every OTHER day. The reasoning below is why the lane is gated at all.)* Leo asked whether review was weekly; it was running unconditionally in every cycle, 17 times a week. Its ordering — before the Sweep, because *"an agent that has just spent an hour finding exciting new names is not the right agent to judge the thesis it wrote last month"* — is right and is unchanged. Its frequency was sized for a model that made it invisible. On gpt-6-astra a review costs ~4% of the weekly allowance, so the lane alone was **68% of the week's budget**, and it was spending it to re-read the same 35 open drafts three times a day against review dates months out, typically concluding *"no proposal state, trading instruction, data file or system rule is changed by this review"*. Leo's second question answered the cost: with 0 positions and 0 accepted proposals it still burned 1.2M tokens because **99.5% of them are input** — 14 turns, context growing 28k to 121k, reloading prices, signals, earnings, holdings and the brief, to write 6,151 tokens of judgement. An empty book saves the output only; the reading is the same size at 0 positions as at 30. Due-ness is derived from the newest filename in `pot/reviews/`, not from a state file that has to be kept in step — the artifact is the record that the lane ran (A20). Saves ~60 points of weekly allowance and changes nothing about what the lane does when it does run. | 8 Sep 2026 |
| D30 | **Lane cadence is a budget decision, and it is now derived: review every 2 days, deep dive daily, sweep still every cycle.** D29 set review to a fortnight; Leo meant every other day, and added the deep dive at once a day. Both go through one `Lane-Due $dir $everyDays` helper rather than two copies of the same date arithmetic — the run-daily/run-lane duplication is exactly what let one copy be fixed while the other kept breaking the repo. Due-ness reads the newest dated filename in the lane's own output directory, so there is no state file to keep in step and a failed run that wrote nothing is correctly still due. The deep dive is safe to gate this way because it always writes a dated file, including the `-none` report when it declines to buy. The reason cadence is the lever at all: lane cost is dominated by INPUT and barely moves with how much there is to do — a review with 0 positions still spent 1.2M tokens, 99.5% of it input, reloading prices, signals, earnings and holdings across 14 turns to write 6,151 tokens. Frequency IS the budget. | 8 Sep 2026 |
| D31 | **Cash conversion comes from EDGAR, because the wishlist said so 19 times.** The tally in D28 made it visible: cash conversion is the single most-reached-for series in the wishlist, ahead of margin (13) and leverage (9), and every one of those reaches was a Sweep fetching it by hand from a filing. Both halves are DURATION facts on the `companyfacts` endpoint the repo already calls for `roic`, `gpa` and `turnover`, so the marginal cost of having it forever is two tag lists. `fetch-filing-dates.js` gains `cfo` (`NetCashProvidedByUsedInOperatingActivities`, plus the ContinuingOperations variant) and `capex` (`PaymentsToAcquirePropertyPlantAndEquipment`, plus `PaymentsToAcquireProductiveAssets` — filers split the tag and taking only the first name loses the whole year). `capitalMetrics` derives `fcf = cfo - capex` and `cashConv = fcf / nic`. **The definition is written into the code on purpose**: analysts differ on cash conversion and an agent left to choose picks a different one each run. The ratio is computed only on a profitable year — against a loss the denominator inverts it, so cash generation would read negative and cash burn positive; a loss year gets `fcf` and no ratio. A filer with cash flow but no ROIC now survives the return test rather than being dropped. This does nothing for 2325.T or any non-US listing: there is no EDGAR for Japan, which is the real reason non-US capital coverage is 56% against 65%. | 8 Sep 2026 |
| D32 | **The wishlist log is a generated table, sorted, and the generator refuses to shrink it.** Leo asked for a cleaner format and noticed the ordering was wrong: the file's header said *newest first* and twelve 7 Sep entries sat below 29 August, because the Sweep appends at the end. Rather than write a rule about where to insert — a rule an agent breaks quietly — `wishlistEntries()` reads whatever is in the section, prose or table, and rewrites it date-sorted. The Sweep keeps appending however it likes and the file heals on the next report run. Two bugs found while building it, both worth recording because both destroyed data before being caught: the first regex required the dash immediately after the date and silently dropped the four entries stamped `2026-09-07 23:45 UTC`; and the worked EXAMPLE inside the header's code fence was being harvested as a real entry, filing a tradingeconomics.com reach nobody made. Fenced blocks are now stripped, and the function **refuses to write if it parsed fewer rows than the file already had** — an untidy file is an acceptable outcome, a shorter one never is. Subject becomes a column and the rest collapses into one cell; splitting prose into source/cadence/rationale columns would need it written to a schema it never was. `wishlistTally()` counts both prose and rows, or it would have reported zero the moment the file tidied itself. | 8 Sep 2026 |
| D33 | **Sweep drops to daily; the constraint was never discovery.** Measured before deciding: the Sweep has added **48 names across 27 runs**, so unlike the Review it is genuinely producing. But the watchlist is **70 names**, the 8 September deep dive ranked **23**, and **7 names have ever been proposed** — 47 names have never been judged at all. Running it three times a day was filling a queue nothing drains, at 17 runs x ~5% = 85% of the weekly allowance, which made it the largest single line in the budget once the Review was cut. Daily costs 35% and loses nothing that was reaching a proposal. Same derived `Lane-Due` gate as the other two lanes. | 8 Sep 2026 |
| D34 | **The ranking must account for every name in `watchlist.json`, not every name the agent considered.** D33's measurement exposed this: 23 of 70 ranked, 47 unmentioned, including names Leo added by hand. The brief already said *"state, in a short table, every name you considered"* — and the agent had considered 23, so it complied. The loophole was that nothing tied the set to the list; "considered" is chosen by the thing being constrained, which is the same failure shape as D20 and D23. Two tiers keep completeness from meaning 70 paragraphs: names clearing §2.4's valuation filter get a full ranked row, everything else gets one `TICKER — reason` line, where the reason may be as short as "31st percentile" or "no data". **Ranked plus excluded must equal the watchlist count, and the count must be stated** — a total that does not add up is visible in a way that silence is not. | 8 Sep 2026 |
| D35 | **A top-up ranks behind a fresh name — new rule §4.5a.** Leo asked what happens after he buys the #1-ranked name: does the next run rank it first again? It does, and deliberately — the brief forbids letting an existing draft or position downgrade a rank, because the 29 August run ranked NVDA first and then refused to write it up, and *"two runs reaching the same conclusion from the same rules is the system working"*. But that left the allocation undecided: §4.5 permits top-ups and §4.2 caps a position at 50%, so the default was to keep buying the same name to the cap and leave the remainder idle. The pot would arrive at a 50% single position with nobody having chosen it — rank order deciding concentration by accident, the same shape as the INTU-versus-MWA funding question. Leo's call: prefer the fresh name. At comparable merit the cash goes to a name the pot does not hold; taking a holding to the cap is still allowed but must be argued in P1, naming the fresh candidates that cleared and why the held name beats all of them. Framed as a preference rather than a veto, matching §3.3's treatment of overlap with the human book — *"owning it already is not a thesis, and it is not a veto either"*. Ranking stays blind to holdings; only the allocation step changes. | 8 Sep 2026 |
| D36 | **The Deep dive is paired to the Sweep, not dated separately.** D33 and D30 gave each lane its own calendar gate, which was right for the Review and wrong for these two. They are not independent: step 5 of the cycle exists solely to fetch local data for the Sweep's new names **before** the Deep dive judges them, and separate dates broke that — on 8 Sep the Sweep was due and the Deep dive was not, so a candidate found that morning would have been ranked a day later by a run that never saw the sweep which found it, against data fetched for a different cycle. The Deep dive now runs if and only if the Sweep ran in the same cycle (`$sweptThisCycle`), so Sweep cadence sets Deep dive cadence and the ordering the briefs assume is restored. Both are daily. The general lesson: a per-lane cadence gate is safe only for a lane whose output nothing downstream consumes in the same cycle. | 8 Sep 2026 |
| D37 | **One-off adjustments the repo can cite get their own store, and a third valuation basis.** The 8 Sep run held cash with ~7 of 13 ranked names blocked on unreconciled earnings, and the cause was measurable: `pePctileRecurring` divides by `norm`, which is **Yahoo's opinion** of what was one-off, restatable and made with hindsight — and across `earnings.json` it sits within 1% of filed net income in **187 of 479 fiscal years**. For two years in five the vendor adjusts nothing, so "recurring" and "headline" are the same number with different labels. LULU's FY2026 `norm` equals its `ni` to the dollar while its own release discloses a $134.5m tariff refund. Leo's observation closed it: the agent is already reading the filing and deriving the adjustment, then throwing the work away every run. `pot/adjustments.json` now stores each one — fiscal year, amount, what it was, and a **mandatory source URL**. This is agent-written data, which A20 normally forbids; the citation is what makes it admissible, and it never replaces filed figures. `fetch-prices.js` subtracts them from filed `ni` to build an **own basis** (`peLowOwn`, `pePctileOwn`) beside reported and vendor, with the entries carried onto the quote so a proposal can cite them. A year with no adjustment falls back to filed `ni`, not to `norm`: the basis is "reported, less what we can prove", which errs toward looking expensive. **Known limit, and the reason this is a start rather than a fix:** one adjustment corrects today's multiple but not the PERCENTILE, which needs a clean figure across ~200 weekly bars. LULU with one adjusted year moves from 8.49x to 8.29x and its percentile does not move at all. It compounds run by run instead of resetting, which is the whole point. | 8 Sep 2026 |
| D38 | **`AGENTS.md` is 63KB against a 32KiB default cap — half of it had never been read by any run.** Leo found the limit in the Codex docs: *"Codex skips empty files and stops adding files once the combined size reaches the limit defined by `project_doc_max_bytes` (32 KiB by default)."* The file is 63,013 bytes, so everything past byte 32,768 had been silently dropped from every run since the file passed that size — no error, no warning. What was being lost is not filler: **Deeper financial history (`backfill-earnings.js`)**, **When annual figures get fetched**, **Yahoo's 4-point cap is PER FIELD**, **Hong Kong: the company's own filing beats Yahoo**, **Japanese rows: the price hides in the formula**, and the whole **Gotchas** section. Those are precisely the sections explaining the earnings data the Deep dive keeps failing to reconcile (D37) and the Japanese quote handling behind 2325.T's thin row. Raised to 65,536 in `~/.codex/config.toml`. Verified by asking a run to count the Gotchas, which begin at byte 59,537: it answered 4, the correct count. **Cost:** AGENTS.md is resent on every turn, so this adds roughly 7,500 tokens per turn — about 5% of a deep dive. Cheap for what was invisible. The docs' other remedy, splitting instructions across nested directories, is the better long-term fix and is not done. | 8 Sep 2026 |
| D39 | **An earnings base that cannot be certified sizes the position, it does not veto it — new rule §7.2a.** Leo's question: is "cannot verify the percentile" actually a rule anywhere? It is not. §7.2 makes the local fact-check mandatory and the brief requires a disagreement to be **disclosed** — *"say which you are using and why"* — and explicitly permits proceeding on the researched figure. The 8 September run held all cash with roughly seven of thirteen ranked names blocked on unreconciled earnings, and that was the agent's own judgement, not a rule firing. Leo's concern was the right one: completeness can never be guaranteed. The percentile spans ~200 weekly bars so a single hand-derived adjustment cannot certify it, and non-US names have no EDGAR to certify from — a standing "unverified ⇒ no order" would look principled while guaranteeing the pot never buys anything. §7.2a therefore mirrors Rule 4's mechanic: state which basis is quoted and how many years carry cited adjustments, give the multiple on each where they differ, and take **half the allocation** where the uncertainty is material. Declining stays legitimate and often right, but it must be argued on the business — the thesis, the dominant risk, the price — because *"the data is incomplete"* will always be true somewhere. | 8 Sep 2026 |
| D40 | **Review and Deep dive get a reading scope; the Sweep deliberately does not.** Leo proposed a core-input table per lane. Two of the three had a real gap: `brief-review.md` named what it reviews but never which files, and `brief-deepdive.md` named no inputs at all beyond a scattered §7.2 coverage check. Both operate over a **closed set** — the Review judges records that already exist, the Deep dive ranks a watchlist someone else built — so naming their inputs is safe. The Sweep is the exception and its own brief records why: a prescribed internal reading list is what broke it before, when it opened with *"read `signals.json` first"* and handed over 17 macro series with *"do not look any of it up"*, and the lane duly reported that *"WTI did not produce a candidate"*. Its question is what exists that we do not know about; a core-input list makes it answer what our files suggest instead. Its table stays labelled *"Read when useful — not in this order, and not first"*. The framing that makes a scope useful rather than harmful is **ceiling, not checklist**: written as "core input" an agent reads all of it, and `strategy.md` alone is 37KB carried on every turn thereafter, so a scope meant to save work would add it. Both new sections say to stop there, and say why — a file opened at turn 5 is resent on every turn after. Also recorded: `AGENTS.md` arrives in `session_meta` at ordinal 0, before the agent acts, yet the 8 Sep deep dive **also opened it with 5 tool calls** — paying for the same bytes twice. Both briefs now say not to. | 8 Sep 2026 |
| D41 | **Four documents claimed four different Review cadences; the gate is authoritative.** Found by reading rather than running: `strategy.md` §0's clock table said **monthly**, §6.5's answer said **weekly**, `run-daily.ps1`'s comment said **fortnightly**, and its actual gate said **2 days**. All four were true at some point and three were never updated. Rule taken from it: **the thing that fires is the source of truth**, and prose describing it is a copy that rots. Reconciled: §0 now says every 2 days, §6.5 keeps Leo's own "sweep them all every week" answer with a note that the built cadence is more frequent so the weekly floor holds, and the runner's comment matches its gate. The same sweep caught four further stale claims — `AGENTS.md` and §4.2 both said the cycle runs *"all three LLM lanes"* when lanes are gated (D30/D33/D36), and both costed a cycle at **~5% of the weekly allowance** when that is the `gpt-5.6-sol` figure and astra is **~14%**. §4.2's arithmetic is now per-model, with the ungated-astra number (238%) stated so the reason the gates exist is on the page, plus the 5-hour limit that actually killed the 8 Sep 06:30 cycle at 99%. D10 and D29 are marked superseded rather than edited, since a decision log is history. | 8 Sep 2026 |

### AGREED — the design

| #       | Decision                                                                                                                                                                                                          | Rationale                                                                                                                                                                                                                     |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1      | **Four lanes** — Scan (free, continuous), Sweep (LLM, daily), Review (LLM, every 2 days), Deep dive (LLM, daily with the Sweep). See §2.                                                                                  | A single lane cannot do both "never miss a known thing" and "discover an unknown thing".                                                                                                                                      |
| A2      | *(scope corrected by A14 — right about the Sweep's OUTPUT, silent about its INPUT, which is where the coupling crept in.)* **The Sweep produces universe, not orders.** Its output is watchlist candidates with a one-line reason; only a Deep dive may produce an executable instruction.                                             | Puts the noisy generative step where its worst case is a cluttered watchlist rather than a bad trade. It also enforces patience mechanically: a name found mid-hype is*added*, and the buy trigger may not fire for months. |
| A3      | **Every proposed name enters `watchlist.json`,** so CI fetches its real fundamentals within the hour and the agent's claimed figures can be contradicted by an independent source before any money moves. | The repo already owns a fact-checker for its own LLM. Not using it would be perverse.                                                                                                                                         |
| A4      | The pot's return is measured**including idle cash**.                                                                                                                                                        | Cash accumulating between decisions is a position. Excluding it would rig the comparison against a fully-invested book.                                                                                                       |
| A5      | Scored**three ways** — pot TWR, human book TWR, a passive index — over the pot's own window.                                                                                                              | Two is a trap: if the pot beats the human book and both lose to the index, that is the finding.                                                                                                                               |
| ~~A6~~ | ~~A standing order needs **re-arm logic**~~ — **superseded by D11**, which takes no re-arm. The measurement stands and is why the question was put; the answer went the other way.                  | Measured, not assumed:`^VIX` has closed ≥ 40 on **208 days** since 1990. A per-day rule would have bought 125 times through 2008 alone and emptied the pot inside one episode. See §6.                              |
| A7      | The Scan may emit an**instruction**, not only a signal, when a standing order's condition is met.                                                                                                           | A standing order has no judgement in it by definition, so routing it through an LLM adds latency and a chance to argue with a rule already decided.                                                                           |
| A8 | **What the Sweep reasons about macro gets harvested into the Scan.** Its inferences were all RELATIONS between two series — a commodity net of the dollar, a foreign index net of its currency, a long move contradicted by a short one — and a relation is arithmetic. `macroNotes()` computes them for free, and the Macro view reads the same output, so page and agent cannot disagree. | 28 Aug 2026 |
| A9 | **Point-in-time uses real publication dates where they exist.** SEC EDGAR filing dates for US filers (`npm run filings`), the 90-day guess only as a fallback. Leo found this: NVDA's trough read 38.50x on a date that is simply the first bar after the cutoff, when its results had been public since 26 February and the real low was 31.71x. | 28 Aug 2026 |
| A10 | **The multiple is a gate, never the thesis.** §2.4 makes valuation a filter, and a filter screens out — it does not argue you in. The floor comparison belongs in a proposal's numbers; the case has to stand on the business. Leo's own proud buys were NVDA from using ChatGPT and M&S from noticing the food range, not screen results. | 28 Aug 2026 |
| A11 | **A Deep dive allocates the budget, not one ticket.** £250 at a 50% cap supports two £125 positions, so after the first proposal it keeps going while cash remains and a candidate still clears. Leaving cash is fine and must be said; stopping at one because the brief only asked for one is not. | 28 Aug 2026 |
| A12 | **One vocabulary.** The **Scan** is the lane, a **signal** is what it emits; standing orders emit **instructions**, `oneOff`/`epsStale` are **annotations** on a signal, and a rule that ran clean is **quiet** (not the same as **blocked**). strategy.md §6 renamed from "Triggers" to match. | 28 Aug 2026 |
| A13 | **The Scan gets a markdown too** (`pot/scan.md`), like every other lane. One file rewritten per run, not dated: CI scans every fifteen minutes and 96 dated files a day is landfill. The dated record is the summary that quotes it. | 28 Aug 2026 |
| A14 | **The Scan and the Sweep must not bound each other.** Different questions over different universes: the Scan asks whether anything among the ~80 names we track has moved; the Sweep asks what exists that we do not know about. Local data is available to the Sweep as a **fact-check**, never as a starting point or a horizon. Leo's challenge — the brief had said "read signals.json first", "do not look any of it up", and "which series drove which candidate", which made discovery a mirror of the closed lane. | 29 Aug 2026 |
| A15 | **Causation runs Sweep → Scan, never back.** What the Scan holds is set over time by what the Sweep keeps reaching for ([pot/data-wishlist.md](pot/data-wishlist.md); three mentions makes the case for a feed). The Scan's contents never set the Sweep's scope. | 29 Aug 2026 |
| A16 | **Sources unconstrained on the way in, recorded on the way out.** No whitelist — that would recreate the closed-universe problem one level up. The Sweep lists what it consulted, so recurring sources become visible and can be endorsed or dropped. Structure the output, not the input. | 29 Aug 2026 |
| A17 | **World breadth** — 47 single-country ETFs from Leo's Book1.xlsx, ranked by distance below each fund's own all-time high. His revision of the source sheet, and a stronger measure than position in a 1-year range: a market that has fallen for five years sits comfortably inside its recent range while being 60% below its peak. | 29 Aug 2026 |
| A18 | **A monitor, not a buy list.** Deliberately kept out of `watchlist.json` and producing no per-country signal — only a breadth READING for the Scan, because 47 lines nobody intends to own individually would swamp the one table that is about intent. | 29 Aug 2026 |
| A19 | **A wound-up fund keeps its row and says so.** Four of the 47 have been liquidated and Yahoo still serves each one's last price forever — the source spreadsheet has shown Pakistan at 16.79 for 444 days. Dropping the row would look like a failed fetch; marking it dead is a fact about the world. | 29 Aug 2026 |
| A20 | **Provenance is stamped from the session log, not written by the agent.** `npm run pot-report` rewrites each output file's `model:` header with the runtime's exact model, wall time and token breakdown, using the log's own record of which files that run wrote. A model cannot see its own accounting: asked to try, one Sweep headed its output "Codex (GPT-5) · tokens: unknown" where the runtime had `gpt-5.6-sol` and 4,460,184 tokens. | 29 Aug 2026 |
| A21 | **The trough is struck on rolling TTM earnings, the same basis as the headline P/E.** Leo found the contradiction: GameStop showed a "cheapest ever" of 23.21x against a current 13.34x — a cheapest dearer than today is a category error, not a rounding one. Built from SEC quarterly filings (~70 per filer back to 2008, against Yahoo's four), which also deepens the history enormously: AMD 72.6x → 3.5x, MSFT 22.7x → 8.8x, AAPL 19.5x → 8.9x. US filers only; other markets stay on the annual basis and are listed in BACKLOG. | 29 Aug 2026 |
| A22 | **The trough is a five-year percentile, not an all-time minimum.** Leo again: a floor from 2013 is precise and unusable, because a company that has since changed cannot be judged against a price nobody expects to see. §6.1 now fires in the cheapest **10% of a five-year distribution**; 3y, 10y and all-time are computed and kept in `peHistory` as reference. NVDA reads 0th percentile, AAPL 87th — statements the old 8.9x all-time low actively hid. | 29 Aug 2026 |

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
| **Scan**      | emits *signals*; also *instructions* for standing orders | closed — the ~79 tickers already fetched | **free**  | every CI run        |
| **Sweep**     | read the world, find candidates                 | open                                      | one LLM session | weekly              |
| **Review**    | re-read every open thesis against its falsifier | what the pot holds                        | one LLM session | weekly              |
| **Deep dive** | research one name → executable order           | a single name                             | one LLM session | Scan or Sweep fires |

Sweep is daily and Review every 2 days (D30, D33) — ~520 sessions a year. That was negligible at the
~2 minutes each measured in §4 and on a model costing ~5% of the weekly allowance per cycle; on
gpt-6-astra a cycle is ~14% and the cadence IS the budget, which is why the lanes are gated at all.
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

### 4.2 The LLM lanes — one scheduled cycle

**This section is the source of truth for when the pot runs.** The Task Scheduler entry is the
only copy that actually fires; everything below describes it, so change one and change the other.

The three LLM lanes do not run separately. A single Windows Task Scheduler entry on the always-on
PC — **`MyStockPortfolio pot daily`** — runs [`pot/run-daily.ps1`](pot/run-daily.ps1), which does the
book, the Scan, then whichever of Review → Sweep → Deep dive are DUE, in dependency order, then the
report. Lanes are gated by cadence (D30, D33) and the Deep dive runs only if the Sweep did (D36). The order is
a dependency, not a preference (§2); the script's own header says why.

```
powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden
               -File "C:\Users\leohk\MyStockPortfolio\pot\run-daily.ps1"
```

| | 06:30 | 09:00 | 12:45 | 21:15 |
|---|:---:|:---:|:---:|:---:|
| **Mon–Fri** | ● | | ● | ● |
| **Sat–Sun** | | ● | | |

UK local time, four weekly triggers, no repetition interval. A cycle takes 20–35 minutes, so each
one **finishes** just before a window Leo can read it in — he has a full-time job, and a proposal
nobody reads is spent allowance:

| slot | what has settled by then | read when |
|---|---|---|
| **06:30** | last night's US close (21:00); Asia mid-session | before work |
| **12:45** | Asia's close (09:00) — the only slot that reads it fresh, and the book is HK-heavy | lunch break |
| **21:15** | the whole global day: US closed at 21:00, London at 16:30, Asia at 09:00 | evening |
| **Sat/Sun 09:00** | nothing new — markets shut, and CI prices are weekdays only (`*/15 * * * 1-5`) | unhurried, with time to decide |

**The allowance is the binding constraint, not the clock.** Codex runs on a ChatGPT subscription
(D3), so a cycle costs weekly allowance rather than cash. Measured from the `weekly` column of
[`pot/runs.md`](pot/runs.md), which is read from the session transcripts and never from what an
agent says about itself.

**The model changes this arithmetic by about 4x, so the figures below are per-model.** Measured
like for like on the same lane, same `high` effort: **gpt-5.6-sol 4.1 allowance points per million
tokens, gpt-6-astra 13.8** — astra used *fewer* tokens and spent three times the allowance.

| lane | gpt-5.6-sol | gpt-6-astra | runs/week |
|---|---:|---:|---:|
| review | +1% | **+4%** | 3.5 (every 2 days) |
| sweep | +2% | **+5%** | 7 (daily) |
| deep dive | +2% | **+5%** | 7 (daily, paired to the sweep) |
| **full cycle** | ~5% | **~14%** | |

```
astra, as gated:  3.5x4  +  7x5  +  7x5   ≈  84% of the weekly allowance
astra, ungated:   17 x 14%                 =  238%   <- what it was before D30/D33
sol,   ungated:   17 x 5%                  =   85%
```

**This is why the lanes are gated at all.** On sol the schedule fitted with room to spare and the
cadence never mattered; on astra an ungated schedule needs two and a half times the allowance that
exists. The gates (D30, D33, D36) buy that back without giving up the model.

**The 5-hour window is the sharper limit.** One full astra cycle measured **99% of a 5-hour window**
on 8 September — review 27, sweep 35, deep dive 37 — and died mid-deep-dive. Every gap in the
schedule exceeds five hours so cycles do not overlap, but there is no slack for a retry or an
ad-hoc run, and a single lane running when it should not is enough to break it. **Check both columns
of `pot/runs.md` before adding a slot.**

Weekends are deliberately one cycle a day rather than three: prices do not move, so a second
weekend cycle would spend 5% re-reading Friday's closes.

**Changing it.** The triggers, not the script:

```powershell
$wd = @('Monday','Tuesday','Wednesday','Thursday','Friday')
Set-ScheduledTask -TaskName 'MyStockPortfolio pot daily' -Trigger @(
    New-ScheduledTaskTrigger -Weekly -DaysOfWeek $wd        -At (Get-Date '06:30')
    New-ScheduledTaskTrigger -Weekly -DaysOfWeek $wd        -At (Get-Date '12:45')
    New-ScheduledTaskTrigger -Weekly -DaysOfWeek $wd        -At (Get-Date '21:15')
    New-ScheduledTaskTrigger -Weekly -DaysOfWeek Saturday,Sunday -At (Get-Date '09:00')
)
```

`Set-ScheduledTask` has no `-Description`; that one needs `$t = Get-ScheduledTask …; $t.Description
= …; Set-ScheduledTask -InputObject $t`. Read the live schedule back with `Get-ScheduledTask -TaskName
'MyStockPortfolio pot daily'` — `DaysOfWeek` comes back as a bitmask, where **62 = Mon–Fri** and
**65 = Sat+Sun**.

Two settings worth knowing before trusting it: **`LogonType` is Interactive**, so nothing fires
while Leo is logged out, and **`RestartCount` is 0** — a failed cycle waits for the next slot
rather than retrying, on purpose, because a retry re-runs a 30-minute agent cycle and spends 5%
on something that may fail the same way twice.

*Superseded:* this section used to describe the Sweep alone, running weekly via a bare `codex exec`
line. The lanes were joined into one ordered cycle when D14 made the Deep dive read the Sweep's
candidates, and the cadence became a fixed daily one under D17.

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
- No lane touches a broker. That is structural today rather than a policy anyone has to remember — and D2 as revised says it is a limitation, not the goal. When execution is automated it will be a deliberate change to this section, not a side effect of one.

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
| ✅ | **Scheduling** — one Task Scheduler entry runs the whole cycle. Weekdays 06:30/12:45/21:15, weekends 09:00 (D17). **Schedule, arithmetic and how to change it: §4.2** | `pot/run-daily.ps1` |
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
