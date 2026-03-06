/**
 * Pure functions extracted from index.html for testing.
 * Keep in sync with index.html whenever those functions change.
 */

"use strict";

function calcEMI(p, r, n) {
  const mr = r / 100 / 12;
  if (mr === 0) return p / n;
  return p * mr * Math.pow(1 + mr, n) / (Math.pow(1 + mr, n) - 1);
}

function calcSchedule(principal, annualRate, emi, prepayments = [], startDate = new Date()) {
  const mr = annualRate / 100 / 12;
  let bal = principal, month = 0, totInt = 0, totPrin = 0;
  const out = [];
  while (bal > 0.5 && month < 600) {
    month++;
    const interest = bal * mr;
    let prin = Math.min(emi - interest, bal);
    if (prin < 0) prin = 0;
    const date = new Date(startDate);
    date.setMonth(date.getMonth() + month - 1);
    const yr = date.getFullYear(), mo = date.getMonth() + 1;
    let prepay = 0;
    prepayments.forEach(p => {
      if (p.year === yr && p.month === mo && Number(p.amount) > 0)
        prepay += Number(p.amount);
    });
    prepay = Math.min(prepay, bal - prin);
    const tp = prin + prepay;
    bal = Math.max(bal - tp, 0);
    totInt += interest; totPrin += tp;
    out.push({
      month, year: yr, mo,
      openingBalance: bal + tp,
      emi, interest, principal: prin, prepay,
      closingBalance: bal, totalInterest: totInt, totalPrincipal: totPrin,
    });
    if (bal <= 0.5) break;
  }
  if (month >= 600 && bal > 0.5) out.truncated = true;
  return out;
}

function calcODSchedule(principal, annualRate, emi, startingOD, monthlyNetCredit, prepayments = []) {
  const mr = annualRate / 100 / 12;
  let bal = principal;
  let odBal = Math.min(startingOD, principal);
  let month = 0, totInt = 0, totPrin = 0;
  const out = [];
  while (bal > 0.5 && month < 600) {
    month++;
    odBal = Math.min(odBal + monthlyNetCredit, bal);
    const effectiveBal = Math.max(bal - odBal, 0);
    const interest = effectiveBal * mr;
    let prin = Math.min(emi - interest, bal);
    if (prin < 0) prin = 0;
    const date = new Date();
    date.setMonth(date.getMonth() + month - 1);
    const yr = date.getFullYear(), mo = date.getMonth() + 1;
    let prepay = 0;
    prepayments.forEach(p => {
      if (p.year === yr && p.month === mo && Number(p.amount) > 0)
        prepay += Number(p.amount);
    });
    prepay = Math.min(prepay, bal - prin);
    const tp = prin + prepay;
    bal = Math.max(bal - tp, 0);
    odBal = Math.min(odBal, bal);
    totInt += interest; totPrin += tp;
    out.push({
      month, year: yr, mo,
      openingBalance: bal + tp,
      emi, interest, principal: prin, prepay,
      closingBalance: bal, odBalance: odBal, effectiveBal,
      totalInterest: totInt, totalPrincipal: totPrin,
    });
    if (bal <= 0.5) break;
  }
  if (month >= 600 && bal > 0.5) out.truncated = true;
  return out;
}

/**
 * The TextInput blur formatter logic from index.html (line 138-142).
 * Returns the display string shown when the input is unfocused.
 */
function textInputFormat(raw) {
  const n = parseFloat(raw);
  if (!raw || raw.trim() === "" || isNaN(n)) return "";
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(n);
}

/**
 * The month defaulting logic used in the initial prepayment state (line 309).
 * Returns the month number as stored in state (may be out of range 1-12).
 */
function defaultPrepaymentMonth(getMonthResult) {
  // getMonthResult is what new Date().getMonth() returns (0-11)
  return getMonthResult + 3;
}

/**
 * The month defaulting logic used in addPrepayment (line 411).
 */
function addPrepaymentMonth(getMonthResult) {
  return getMonthResult + 2;
}

/**
 * The target-date month calculation logic (line 364-366).
 */
function calcTargetMonths(targetDateYear, targetDateMonth, now) {
  const target = new Date(targetDateYear, targetDateMonth - 1);
  return Math.round((target - now) / 1000 / 60 / 60 / 24 / 30.44);
}

/**
 * The OD net savings formula (line 774).
 */
function odNetSavings(odSavedInterest, odTotalInterest, odRatePremium, odEffectiveRate) {
  return odSavedInterest - (odRatePremium > 0
    ? odTotalInterest * (odRatePremium / odEffectiveRate)
    : 0);
}

module.exports = {
  calcEMI,
  calcSchedule,
  calcODSchedule,
  textInputFormat,
  defaultPrepaymentMonth,
  addPrepaymentMonth,
  calcTargetMonths,
  odNetSavings,
};
