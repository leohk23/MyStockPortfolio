# Saved article text

Full text of paywalled or rot-prone pieces listed in ../reading.md. One file per article,
named `YYYY-MM-DD-slug.md`. Line 1 carries the source: a URL where there is a usable one, and
otherwise author, publication and date, with a note that it is subscriber-only. A guessed URL
is worse than none.

## Local by default

These are **other people's copyrighted work**, much of it behind a subscription, and this repo
is public. So `.gitignore` excludes this folder by default: the text stays on the machine and
is read by whichever agent is running locally.

Publishing one anyway is a per-file decision, and Leo's alone. Add a `!` line for it in
`.gitignore` and commit it — `2026-04-14-Convexity-Ivan-Li.md` is in on that basis.

What *is* published is `../reading.md` — the citation and the **Why** line. Those are Leo's own
notes about something he read, which is what a reading list is, and the Sweep needs them to
know what he rates and why.

**So a fresh clone will not have these articles.** That is intended. The Sweep reads whatever
is present and says nothing about what is not.
