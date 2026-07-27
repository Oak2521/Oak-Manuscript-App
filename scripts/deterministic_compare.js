"use strict";

// Locale collation varies by operating system, ICU build, and user locale.
// JavaScript's relational string comparison is instead defined over UTF-16
// code units, so it gives manifest generators and verifiers one stable order.
function compareUtf16(left, right) {
  if (typeof left !== "string" || typeof right !== "string") {
    throw new TypeError("compareUtf16 只接受字符串");
  }
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

module.exports = { compareUtf16 };
