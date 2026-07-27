"use strict";

// JSON.parse silently accepts duplicate object keys.  That is unsuitable for
// repository-tracked trust inputs because a reviewer and the runtime could
// attribute different meanings to the same bytes.  Keep this parser small and
// dependency-free so every pre-execution verifier can share the same rule.

function parseJsonStrict(text, label = "JSON") {
  let offset = 0;
  function fail(message) {
    throw new Error(`${label} JSON 非法（字符位置 ${offset}）：${message}`);
  }
  function whitespace() {
    while (text[offset] === " " || text[offset] === "\t" ||
        text[offset] === "\r" || text[offset] === "\n") offset += 1;
  }
  function string() {
    if (text[offset] !== '"') fail("预期字符串");
    const start = offset;
    offset += 1;
    let escaped = false;
    while (offset < text.length) {
      const character = text[offset];
      offset += 1;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') {
        try {
          return JSON.parse(text.slice(start, offset));
        } catch (error) {
          fail(error.message);
        }
      } else if (character.charCodeAt(0) < 0x20) fail("字符串含未转义控制字符");
    }
    fail("字符串未闭合");
  }
  function value() {
    whitespace();
    const character = text[offset];
    if (character === "{") return object();
    if (character === "[") return array();
    if (character === '"') return string();
    for (const [literal, result] of [["true", true], ["false", false], ["null", null]]) {
      if (text.startsWith(literal, offset)) {
        offset += literal.length;
        return result;
      }
    }
    const matched = text.slice(offset).match(
      /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/u,
    );
    if (matched) {
      offset += matched[0].length;
      return Number(matched[0]);
    }
    fail("无法识别的值");
  }
  function object() {
    // A null-prototype object prevents keys such as "__proto__" from invoking
    // inherited setters before an exact-schema validator can reject them.
    const result = Object.create(null);
    const keys = new Set();
    offset += 1;
    whitespace();
    if (text[offset] === "}") {
      offset += 1;
      return result;
    }
    while (offset < text.length) {
      whitespace();
      const key = string();
      if (keys.has(key)) fail(`对象含重复字段 ${key}`);
      keys.add(key);
      whitespace();
      if (text[offset] !== ":") fail("对象字段缺少冒号");
      offset += 1;
      result[key] = value();
      whitespace();
      if (text[offset] === "}") {
        offset += 1;
        return result;
      }
      if (text[offset] !== ",") fail("对象字段之间缺少逗号");
      offset += 1;
    }
    fail("对象未闭合");
  }
  function array() {
    const result = [];
    offset += 1;
    whitespace();
    if (text[offset] === "]") {
      offset += 1;
      return result;
    }
    while (offset < text.length) {
      result.push(value());
      whitespace();
      if (text[offset] === "]") {
        offset += 1;
        return result;
      }
      if (text[offset] !== ",") fail("数组元素之间缺少逗号");
      offset += 1;
    }
    fail("数组未闭合");
  }
  if (typeof text !== "string") throw new TypeError(`${label} JSON 必须是字符串`);
  const result = value();
  whitespace();
  if (offset !== text.length) fail("根值后存在多余内容");
  return result;
}

module.exports = { parseJsonStrict };
