# My Stock Portfolio

Static portfolio dashboard, hosted on GitHub Pages. No server, no dependencies.

A GitHub Action fetches quotes and FX rates from Yahoo Finance every hour and commits
`prices.json`. The page reads that file and does the arithmetic in the browser.

## Setup (one time)

1. Push to GitHub.
2. **Settings → Pages → Source: Deploy from a branch → `main` / `/ (root)`**.
3. **Settings → Actions → General → Workflow permissions → Read and write permissions**
   (the workflow commits `prices.json` back to the repo).

Your dashboard: `https://leohk23.github.io/MyStockPortfolio/`

⚠️ A public repo means **your holdings and cost basis are public**. Make the repo private
if that's not what you want — Pages on private repos requires GitHub Pro.

## Editing holdings

Edit `data.js`. `currency` is the currency your **purchase price** is recorded in;
the current price's currency comes from Yahoo, so you don't need to worry about
London tickers quoting in pence or Tokyo tickers in yen.

## Local

```sh
npm start        # serve at localhost:3000
npm run fetch    # refresh prices.json by hand
npm test         # self-check the percent-change math
```
