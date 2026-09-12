# One-off: choose the holdings passphrase, store it where the scripts look, and seal holdings.json.
#   powershell -ExecutionPolicy Bypass -File tools\set-holdings-key.ps1
#
# Writes the passphrase to .holdings-key (gitignored) for the laptop, and to the HOLDINGS_KEY
# GitHub secret for CI — CI needs it to seal the value history it builds from your trades. Then
# re-extracts holdings.json from Tradelog.xlsx, sealed. Commit with `npm run publish` afterwards.
#
# Keep the passphrase somewhere safe (a password manager). There is no recovery: lose it and the
# sealed data is unreadable — though Tradelog.xlsx on this laptop still re-creates everything.

$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
Set-Location $repo

$plain = { param($s) [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)) }
$a = & $plain (Read-Host 'Passphrase (a PIN works; longer is stronger)' -AsSecureString)
$b = & $plain (Read-Host 'Again' -AsSecureString)
if ($a -ne $b) { throw 'The two entries differ - nothing changed.' }
if ($a.Length -lt 4) { throw 'Use at least 4 characters - nothing changed.' }
# Leo's call (12 Sep): a short PIN is allowed. The sealed file is public and can be guessed offline -
# all 10,000 four-digit PINs take ~9 minutes on an 8-core laptop - so it deters a glance, not an attempt.
if ($a.Length -lt 12) { Write-Warning 'Short passphrase: this hides the numbers from casual viewers, not from someone who tries.' }

# The secret first: if it fails, nothing local has changed either.
$a | gh secret set HOLDINGS_KEY --repo leohk23/MyStockPortfolio
if ($LASTEXITCODE -ne 0) { throw 'gh secret set failed - nothing changed locally.' }
[IO.File]::WriteAllText((Join-Path $repo '.holdings-key'), $a)
Write-Host 'Stored: GitHub secret HOLDINGS_KEY and .holdings-key'

node extract-portfolio.js
if ($LASTEXITCODE -ne 0) { throw 'extract failed - holdings.json not re-sealed.' }
node -e "const h=require('./vault').readHoldings(); if(!h.full||!h.sealed) process.exit(1); console.log('verified: holdings.json is sealed and opens with the stored passphrase ('+h.holdings.length+' holdings)')"
if ($LASTEXITCODE -ne 0) { throw 'verification failed - do not publish.' }
Write-Host 'Next: npm run publish'
