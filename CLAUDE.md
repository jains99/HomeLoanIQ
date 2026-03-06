# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single-file standalone Home Loan Calculator web app. No build step, no dependencies to install — open `index.html` directly in a browser.

- `home.jsx` — the original React component (source of truth for logic)
- `index.html` — the deployable standalone page (React + Babel loaded via CDN)

All changes should be made to `index.html`. `home.jsx` is kept as a reference but is not used at runtime.

## Architecture

`index.html` is a single `<script type="text/babel">` block that Babel transpiles in the browser at load time. All logic, components, and state live in that one script.

**Key functions:**
- `calcSchedule(principal, rate, emi, prepayments)` — standard amortization loop; returns month-by-month rows
- `calcODSchedule(principal, rate, emi, startingOD, monthlyNetCredit, prepayments)` — same but interest is charged on `loan balance − OD account balance`; OD balance grows by `monthlyNetCredit` each month, capped at outstanding
- `calcEMI(p, r, n)` — standard EMI formula

**State in `HomeLoanCalculator`:**
- Core inputs: `outstandingRaw`, `rateRaw`, `emiRaw`
- Prepayments: array `[{id, year, month, amount}]`
- Rate simulator: `showRateSim`, `newRateRaw`, `rateChangeMonth/Year`
- EMI optimizer: `showOptimizer`, `targetMonthsRaw` or `targetDateMonth/Year`, `optimizerMode`
- OD comparison: `showOD`, `odStartRaw`, `odMonthlyRaw`, `odRatePremiumRaw`

**Palette** is defined in the `C` constant at the top — use only these tokens for colors, never add gradients.

## Conventions

- All monetary inputs use `TextInput` (formats with Indian number system on blur, raw value on focus).
- Collapsible sections use `SectionToggle` + conditional render.
- Stat boxes use `StatCard`. Cards use `Card`.
- All formatting goes through `formatINR` (currency) or `formatNum` (plain).
- Light theme only — no `linear-gradient` anywhere in the file.
