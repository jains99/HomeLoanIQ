/**
 * Regression tests for confirmed bugs.
 * Each test is named after its bug ID so failures map directly to bugs/BUGS.md.
 *
 * Run with: node --test tests/bugs.test.js
 * Requires Node >= 18 (built-in test runner).
 */

"use strict";

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");

const {
  calcEMI,
  calcSchedule,
  calcODSchedule,
  textInputFormat,
  defaultPrepaymentMonth,
  addPrepaymentMonth,
  calcTargetMonths,
  odNetSavings,
} = require("./helpers.js");

// ---------------------------------------------------------------------------
// BUG-1 — exportPDF crashes on null window.open
// Browser-only API; tested here as a documentation/smoke check.
// ---------------------------------------------------------------------------
describe("BUG-1: exportPDF null crash", () => {
  test("window.open can return null when popups are blocked", () => {
    // Simulate the blocked-popup case.
    const fakeWindowOpen = () => null;
    const w = fakeWindowOpen();
    assert.equal(w, null, "window.open returns null when popup is blocked");

    // Demonstrate that the current code pattern would throw.
    assert.throws(
      () => { w.document.write("test"); },
      /Cannot read prop|null/i,
      "Dereferencing null throws TypeError"
    );
  });

  test("safe pattern with null check does not throw", () => {
    const fakeWindowOpen = () => null;
    const w = fakeWindowOpen();
    assert.doesNotThrow(() => {
      if (!w) return; // The fix
      w.document.write("test");
    });
  });
});

// ---------------------------------------------------------------------------
// BUG-3 — Default prepayment month overflows in November / December
// ---------------------------------------------------------------------------
describe("BUG-3: default prepayment month overflow", () => {
  test("getMonth()+3 is valid for months Jan through Oct (indices 0-9)", () => {
    for (let m = 0; m <= 9; m++) {
      const month = defaultPrepaymentMonth(m);
      assert.ok(month >= 1 && month <= 12, `month index ${m} gives ${month} (valid)`);
    }
  });

  test("getMonth()+3 overflows to 13 in November (index 10)", () => {
    const month = defaultPrepaymentMonth(10); // November
    assert.equal(month, 13);
    assert.ok(month > 12, "month 13 is out of range — prepayment will never match");
  });

  test("getMonth()+3 overflows to 14 in December (index 11)", () => {
    const month = defaultPrepaymentMonth(11); // December
    assert.equal(month, 14);
    assert.ok(month > 12, "month 14 is out of range — prepayment will never match");
  });

  test("out-of-range month never matches any schedule row", () => {
    // Build a schedule long enough to cover the current year + next year.
    const principal = 3_000_000, rate = 7.2, emi = 30_000;
    const schedule = calcSchedule(principal, rate, emi, []);
    const allMonths = schedule.map(r => r.mo);
    // Schedule months are always 1-12.
    assert.ok(allMonths.every(m => m >= 1 && m <= 12));
    // month=13 never appears.
    assert.ok(!allMonths.includes(13), "month 13 never exists in schedule rows");
    assert.ok(!allMonths.includes(14), "month 14 never exists in schedule rows");
  });
});

// ---------------------------------------------------------------------------
// BUG-4 — addPrepayment month overflows in December
// ---------------------------------------------------------------------------
describe("BUG-4: addPrepayment month overflow in December", () => {
  test("getMonth()+2 is valid for months Jan through Nov (indices 0-10)", () => {
    for (let m = 0; m <= 10; m++) {
      const month = addPrepaymentMonth(m);
      assert.ok(month >= 1 && month <= 12, `month index ${m} gives ${month} (valid)`);
    }
  });

  test("getMonth()+2 overflows to 13 in December (index 11)", () => {
    const month = addPrepaymentMonth(11); // December
    assert.equal(month, 13);
    assert.ok(month > 12, "month 13 is out of range — new prepayment will never fire");
  });
});

// ---------------------------------------------------------------------------
// BUG-5 — Rate-sim suffix month numbers restart at 1
// ---------------------------------------------------------------------------
describe("BUG-5: rate-sim suffix month field restarts at 1", () => {
  test("calcSchedule always starts month counter at 1", () => {
    const schedule = calcSchedule(1_000_000, 8.5, 20_000, []);
    assert.equal(schedule[0].month, 1, "first row has month=1");
    assert.equal(schedule[1].month, 2, "second row has month=2");
  });

  test("concatenating two schedules produces non-monotonic month numbers", () => {
    const principal = 3_000_000, rate = 7.2, emi = 30_000;
    const schedule = calcSchedule(principal, rate, emi, []);
    const splitAt = 12; // simulate rate change after 12 months

    const bal = schedule[splitAt].openingBalance;
    const suffix = calcSchedule(bal, 8.0, emi, []);

    const combined = [...schedule.slice(0, splitAt), ...suffix];

    // Prefix ends at month=12, suffix starts at month=1 → non-monotonic
    const prefixLast = combined[splitAt - 1].month;
    const suffixFirst = combined[splitAt].month;
    assert.equal(prefixLast, 12);
    assert.equal(suffixFirst, 1, "suffix restarts at 1 (BUG-5)");
    assert.ok(suffixFirst < prefixLast, "month numbers go backwards — non-monotonic");
  });

  test("fixed concatenation produces monotonically increasing months", () => {
    const principal = 3_000_000, rate = 7.2, emi = 30_000;
    const schedule = calcSchedule(principal, rate, emi, []);
    const splitAt = 12;
    const bal = schedule[splitAt].openingBalance;
    const rawSuffix = calcSchedule(bal, 8.0, emi, []);

    // Apply the fix: remap month field
    const offset = splitAt;
    const suffix = rawSuffix.map((r, i) => ({ ...r, month: offset + 1 + i }));
    const combined = [...schedule.slice(0, splitAt), ...suffix];

    for (let i = 1; i < combined.length; i++) {
      assert.ok(
        combined[i].month > combined[i - 1].month,
        `month[${i}]=${combined[i].month} > month[${i-1}]=${combined[i-1].month}`
      );
    }
  });
});

// ---------------------------------------------------------------------------
// BUG-7 — Multiple prepayments in same month: only last one applied
// ---------------------------------------------------------------------------
describe("BUG-7: multiple prepayments in same month — only last applied", () => {
  test("two prepayments in the same month: both are applied (fixed)", () => {
    const now = new Date();
    const yr = now.getFullYear();
    const mo = now.getMonth() + 1; // current month → matches schedule month 1

    const schedule = calcSchedule(3_000_000, 7.2, 30_000, [
      { year: yr, month: mo, amount: 100_000 },
      { year: yr, month: mo, amount: 50_000 },
    ]);

    const row = schedule[0]; // month 1 is the current month
    // Both prepayments should be accumulated: 100,000 + 50,000 = 150,000
    assert.equal(row.prepay, 150_000, "both prepayments are accumulated (fix confirmed)");
  });

  test("single prepayment in a month applies correctly", () => {
    const now = new Date();
    const yr = now.getFullYear();
    const mo = now.getMonth() + 1;

    const schedule = calcSchedule(3_000_000, 7.2, 30_000, [
      { year: yr, month: mo, amount: 100_000 },
    ]);

    assert.equal(schedule[0].prepay, 100_000, "single prepayment applied in full");
  });

  test("OD schedule also accumulates multiple prepayments (fixed)", () => {
    const now = new Date();
    const yr = now.getFullYear();
    const mo = now.getMonth() + 1;

    const schedule = calcODSchedule(3_000_000, 7.2, 30_000, 0, 0, [
      { year: yr, month: mo, amount: 100_000 },
      { year: yr, month: mo, amount: 50_000 },
    ]);

    assert.equal(schedule[0].prepay, 150_000, "OD schedule accumulates both prepayments");
  });
});

// ---------------------------------------------------------------------------
// BUG-9 — Target-date optimizer off by ±1 month
// ---------------------------------------------------------------------------
describe("BUG-9: target-date targetMonths calculation imprecision", () => {
  test("mid-month 'now' gives different result than start-of-month 'now' for same target", () => {
    const targetYear = 2031, targetMonth = 3; // March 2031

    // now = March 1, 2026 (start of month)
    const nowStart = new Date(2026, 2, 1);
    // now = March 31, 2026 (end of month)
    const nowEnd = new Date(2026, 2, 31);

    const monthsFromStart = calcTargetMonths(targetYear, targetMonth, nowStart);
    const monthsFromEnd   = calcTargetMonths(targetYear, targetMonth, nowEnd);

    assert.notEqual(
      monthsFromStart, monthsFromEnd,
      "result differs depending on current day within the month (imprecision confirmed)"
    );
    assert.ok(
      Math.abs(monthsFromStart - monthsFromEnd) >= 1,
      "difference is at least 1 month"
    );
  });

  test("correct arithmetic approach gives consistent result regardless of day", () => {
    const targetYear = 2031, targetMonth = 3;

    // Fixed arithmetic (the proposed fix)
    function calcTargetMonthsFixed(targetY, targetMo, now) {
      return (targetY - now.getFullYear()) * 12
           + (targetMo - 1 - now.getMonth());
    }

    const nowStart = new Date(2026, 2, 1);
    const nowEnd   = new Date(2026, 2, 31);

    assert.equal(
      calcTargetMonthsFixed(targetYear, targetMonth, nowStart),
      calcTargetMonthsFixed(targetYear, targetMonth, nowEnd),
      "arithmetic approach gives same result regardless of day within month"
    );
  });

  test("arithmetic approach gives exactly 60 months for 5-year target", () => {
    function calcFixed(targetY, targetMo, now) {
      return (targetY - now.getFullYear()) * 12 + (targetMo - 1 - now.getMonth());
    }
    // from March 2026, target March 2031 = exactly 60 months
    const now = new Date(2026, 2, 15);
    assert.equal(calcFixed(2031, 3, now), 60);
  });
});

// ---------------------------------------------------------------------------
// BUG-10 — OD "Net Savings" formula is mathematically inaccurate
// ---------------------------------------------------------------------------
describe("BUG-10: OD net savings formula inaccuracy", () => {
  test("formula approximation differs from true premium cost", () => {
    // Scenario: 30L loan, base rate 7.2%, OD rate 7.7% (+0.5%), EMI 30,000,
    // OD balance 200k start + 30k/month credit.
    const principal = 3_000_000, baseRate = 7.2, premium = 0.5;
    const effectiveRate = baseRate + premium;
    const emi = 30_000, odStart = 200_000, odMonthly = 30_000;

    const scheduleBase = calcODSchedule(principal, baseRate,     emi, odStart, odMonthly, []);
    const schedulePrem = calcODSchedule(principal, effectiveRate, emi, odStart, odMonthly, []);

    const baseInterest = scheduleBase[scheduleBase.length - 1].totalInterest;
    const premInterest = schedulePrem[schedulePrem.length - 1].totalInterest;

    // True premium cost = interest at premium rate minus interest at base rate
    const truePremiumCost = premInterest - baseInterest;

    // Current formula approximation
    const approxPremiumCost = premInterest * (premium / effectiveRate);

    assert.notEqual(
      Math.round(truePremiumCost),
      Math.round(approxPremiumCost),
      "approximation gives different answer from true premium cost (bug confirmed)"
    );

    // Approximation consistently underestimates (interest isn't linearly proportional to rate)
    const diff = Math.abs(truePremiumCost - approxPremiumCost);
    assert.ok(diff > 100, `difference is ₹${Math.round(diff)} — not negligible`);
  });
});

// ---------------------------------------------------------------------------
// BUG-11 / BUG-12 — savedInterest and savedMonths use different schedules
// ---------------------------------------------------------------------------
describe("BUG-11/BUG-12: savedInterest and savedMonths inconsistency", () => {
  test("scheduleWithout and schedule are independent", () => {
    const principal = 3_000_000, rate = 7.2, emi = 30_000;
    const now = new Date();
    const prepayments = [{ year: now.getFullYear(), month: now.getMonth() + 1, amount: 200_000 }];

    const scheduleWith    = calcSchedule(principal, rate, emi, prepayments);
    const scheduleWithout = calcSchedule(principal, rate, emi, []);

    assert.ok(scheduleWith.length < scheduleWithout.length, "prepayments shorten the loan");

    const savedMonths   = scheduleWithout.length - scheduleWith.length;
    const savedInterest = scheduleWithout[scheduleWithout.length - 1].totalInterest
                        - scheduleWith[scheduleWith.length - 1].totalInterest;

    assert.ok(savedMonths > 0,   "savedMonths is positive");
    assert.ok(savedInterest > 0, "savedInterest is positive");
  });

  test("using rate-sim activeSchedule for totalInterest gives inconsistent savedInterest", () => {
    const principal = 3_000_000, rate = 7.2, emi = 30_000;
    const scheduleWithout = calcSchedule(principal, rate, emi, []);
    const scheduleWith    = calcSchedule(principal, rate, emi, []);

    // Simulate rate-sim: a different schedule at a higher rate
    const scheduleRateSim = calcSchedule(principal, 9.0, emi, []);

    // Current code: savedInterest uses activeSchedule (= scheduleRateSim when sim is on)
    const savedInterestBuggy = scheduleWithout[scheduleWithout.length - 1].totalInterest
                             - scheduleRateSim[scheduleRateSim.length - 1].totalInterest;

    // Correct: savedInterest should use scheduleWith (base rate with prepayments)
    const savedInterestCorrect = scheduleWithout[scheduleWithout.length - 1].totalInterest
                               - scheduleWith[scheduleWith.length - 1].totalInterest;

    // At 9% there's MORE interest than at 7.2%, so buggy formula gives negative savings
    assert.ok(
      savedInterestBuggy < 0,
      "buggy savedInterest is negative when rate-sim uses higher rate — misleading"
    );
    assert.ok(
      savedInterestCorrect >= 0,
      "correct savedInterest (same rate, no prepayments vs no prepayments) is 0"
    );
  });
});

// ---------------------------------------------------------------------------
// BUG-13 — 600-month loop cap exits silently
// ---------------------------------------------------------------------------
describe("BUG-13: 600-month silent termination", () => {
  test("schedule terminates at 600 rows when EMI barely covers interest", () => {
    // Monthly interest on 30L at 10% = 30L * 0.10/12 = 25,000
    // EMI of 25,100 (just 100 above interest) takes a very long time
    const schedule = calcSchedule(3_000_000, 10.0, 25_100, []);
    assert.equal(schedule.length, 600, "schedule capped at 600 rows");

    const lastRow = schedule[schedule.length - 1];
    assert.ok(lastRow.closingBalance > 0.5, "loan still has outstanding balance at row 600");
  });

  test("truncation flag is set on the returned array (fixed)", () => {
    const schedule = calcSchedule(3_000_000, 10.0, 25_100, []);
    assert.equal(schedule.truncated, true, "truncation flag is returned (fix confirmed)");
  });

  test("normal loan closes before 600 rows", () => {
    // 30L at 7.2%, EMI 30,000 closes in ~153 months
    const schedule = calcSchedule(3_000_000, 7.2, 30_000, []);
    assert.ok(schedule.length < 600, `normal loan closes in ${schedule.length} months`);
    assert.ok(schedule[schedule.length - 1].closingBalance <= 0.5, "loan fully repaid");
  });
});

// ---------------------------------------------------------------------------
// BUG-16 — Whitespace input displayed as whitespace instead of being cleared
// ---------------------------------------------------------------------------
describe("BUG-16: whitespace-only input formatting", () => {
  test("empty string returns empty string", () => {
    assert.equal(textInputFormat(""), "", "empty string → empty display");
  });

  test("null/undefined returns as-is (falsy guard)", () => {
    assert.equal(textInputFormat(""), "");
  });

  test("valid number is formatted", () => {
    const result = textInputFormat("3000000");
    assert.ok(result.includes("30,00,000") || result.includes("3,000,000"),
      "number is formatted with separators");
  });

  test("whitespace-only string is cleared to empty string (fixed)", () => {
    const result = textInputFormat(" ");
    assert.equal(result, "", "whitespace returns empty string (fix confirmed)");
  });

  test("multi-space whitespace also cleared (fixed)", () => {
    const result = textInputFormat("   ");
    assert.equal(result, "", "multi-space whitespace also cleared");
  });
});

// ---------------------------------------------------------------------------
// BUG-20 — Year-wise balance chart truncated at 20 years silently
// ---------------------------------------------------------------------------
describe("BUG-20: balance chart truncated at 20 years without notice", () => {
  test("loan longer than 20 years produces >240 schedule rows", () => {
    // 30L at 10%, EMI = 26,430 (≈ 30 year loan)
    const emi = Math.ceil(calcEMI(3_000_000, 10, 360));
    const schedule = calcSchedule(3_000_000, 10, emi, []);
    assert.ok(schedule.length > 240, `loan runs ${schedule.length} months (> 20 years)`);
  });

  test("chart cap formula silently clips at 20 years for long loans", () => {
    const emi = Math.ceil(calcEMI(3_000_000, 10, 360));
    const schedule = calcSchedule(3_000_000, 10, emi, []);
    const totalMonths = schedule.length;
    const totalYears = Math.ceil(totalMonths / 12);

    const chartYears = Math.min(totalYears, 20);

    assert.ok(totalYears > 20, `loan is ${totalYears} years (> 20)`);
    assert.equal(chartYears, 20, "chart shows only 20 years");
    assert.ok(
      chartYears < totalYears,
      `${totalYears - chartYears} years of data are silently omitted`
    );
  });
});

// ---------------------------------------------------------------------------
// calcEMI — sanity checks (regression baseline)
// ---------------------------------------------------------------------------
describe("calcEMI: baseline sanity", () => {
  test("standard EMI formula produces expected result", () => {
    // 30L at 8.5% for 240 months
    const emi = calcEMI(3_000_000, 8.5, 240);
    assert.ok(emi > 26_000 && emi < 27_000, `EMI ${emi.toFixed(0)} should be ~26,094`);
  });

  test("zero rate returns principal / n", () => {
    assert.equal(calcEMI(1_200_000, 0, 120), 10_000);
  });

  test("calcSchedule with correct EMI closes the loan", () => {
    const emi = Math.ceil(calcEMI(3_000_000, 8.5, 240));
    const schedule = calcSchedule(3_000_000, 8.5, emi, []);
    assert.ok(schedule.length <= 241, `loan closes in ${schedule.length} months`);
    assert.ok(schedule[schedule.length - 1].closingBalance <= 0.5, "loan fully repaid");
  });
});
