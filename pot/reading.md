# Reading list — articles as an input to the Sweep

Drop things here as you read them. The Sweep lane reads this file, so anything listed becomes an
input to candidate generation.

## How to add one

One line is enough:

```
- 2026-08-27, https://example.com/the-article
  Why: shipbuilding order books are the tightest since 2008 and nobody links it to Japanese yards.
```

**The `Why:` line is the point of this file.** An agent can read the article perfectly well on its
own — what it cannot know is why *you* stopped on it. That single sentence carries your judgement,
and it is the only part of an entry that could not have been generated. If you write nothing else,
write that.

Keep it to what genuinely caught you. A list of everything you read is a list the Sweep has to
wade through; a list of things that made you think is a list it can work from.

## Rules the Sweep must follow when reading these

- **An article is a lead, never a thesis.** It goes toward `watchlist.json`, not toward an order.
  A name that arrives from here is checked against independently fetched fundamentals like any
  other — the same rule that governs everything else in this repo.
- **Date it and age it.** A piece from three months ago has had three months to be priced in. The
  Sweep should say what has happened to the price *since* the article, not restate its argument.
- **Say when the article is wrong.** These are things you found interesting, not things you
  endorsed. If the numbers do not support it, that is the useful finding.

## Paywalls and link rot

If a piece is paywalled, or matters enough that you will want it in two years, save the text
alongside the link — and where there is no link worth keeping, because the piece sits entirely
behind a subscription, say so and let the saved text be the record. Author, publication and date
are the citation then. A guessed URL is worse than none.

```
pot/reading/2026-08-27-japanese-shipyards.md
```

Same reason the proposal contract records the numbers as of the day: a thesis you cannot audit
later is a thesis you cannot learn from. A dead link is an unauditable thesis.

---

## Entries

<!-- newest first -->

- 2026-03-11, Michael Burry, *Cassandra Unchained*, "Hong Kong Stocks: Structure & Strategy —
  Common Stocks & Uncommon Value", subscriber-only, no public URL
 , saved: [`reading/2026-03-11-HKS2-Michael-Burry.md`](reading/2026-03-11-HKS2-Michael-Burry.md)
  **Why:** one fact stopped me — the Hang Seng Tech Index is the only major index in recorded
  history whose companies' revenue and earnings **grew** through a 1929-style collapse in the share
  prices. That is a sentiment de-rating, not a business failure — and I own the index itself
  (**3067.HK**, iShares Hang Seng TECH, 1,000 units, HK$9.73 and −20.3% over the year), so this is
  the thesis for a position I already hold rather than an observation about someone else's market.
  If he is right, what I am holding through is the de-rating and not a deterioration, and the
  question is only whether I keep adding while sentiment is still against it.
  It also prices the single names: he rates **BYD (1211.HK) 7/10, full position at HK$75**, and I
  hold it at HK$91.95 — 23% above his level, which says that position is a hold, not an add.
  Haidilao (6862.HK) 8/10 at HK$17 and PDD 6/10 with no target are names to check for myself,
  not to buy on his say-so.
  target are names to check for myself, not to buy on his say-so.

- 2026-02-26, Michael Burry, *Cassandra Unchained*, "Hong Kong Stocks: Structure & Strategy —
  VIEs: Vulnerability, Virtue & Value", subscriber-only, no public URL
 , saved: [`reading/2026-02-26-HKS1-Michael-Burry.md`](reading/2026-02-26-HKS1-Michael-Burry.md)
  **Why:** I own Chinese tech through VIEs without ever having read what I actually hold. His point
  2 is the one to keep: **buying these shares means I do not own shares in the operating business.**
  The structure is technically illegal under Chinese law, Beijing has never blessed it, and in 2011
  Jack Ma moved Alipay out of Alibaba's VIE without telling shareholders. Voting rights are
  practically irrelevant, and since the SAMR database closed there is no independent way to verify
  the revenue. What I want to take from it is the **tiering**: Tier 1, full kinetic war, cannot be
  hedged by stock picking at all — only by how much I hold. Tier 2 is survivable, and forces a
  rotation of Western money into the small free float of clean non-VIE Hong Kong listings. So VIE
  exposure is a **sizing** decision, not a research one, and that is the part that changes what I do.

- 2026-04-14, Ivan Li 李聲揚, 狼耳街華人, subscriber-only, no public URL
 , saved: [`reading/2026-04-14-Convexity-Ivan-Li.md`](reading/2026-04-14-Convexity-Ivan-Li.md)
  **Why:** it reinforces the philosophy. Convexity — a share can only fall 100%, but it can rise
  many multiples of that — is the argument against two instincts I want to resist: **rushing to cut
  a loss**, and **refusing to spray**. A loser caps itself; a winner does not, so the total
  portfolio still gains. Empirically even the S&P 500's value is driven by only a few names, and I
  cannot know in advance which of mine they are.
