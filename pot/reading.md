# Reading list — articles as an input to the Sweep

Drop things here as you read them. The Sweep lane reads this file, so anything listed becomes an
input to candidate generation.

## How to add one

One line is enough:

```
- 2026-08-27 · https://example.com/the-article
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
alongside the link:

```
pot/reading/2026-08-27-japanese-shipyards.md
```

Same reason the proposal contract records the numbers as of the day: a thesis you cannot audit
later is a thesis you cannot learn from. A dead link is an unauditable thesis.

---

## Entries

<!-- newest first -->
