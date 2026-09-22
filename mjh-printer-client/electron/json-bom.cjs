"use strict";

/**
 * Strip UTF-8 BOM (\uFEFF) so JSON.parse accepts PowerShell / Notepad UTF-8 files.
 * @param {string} text
 * @returns {string}
 */
function stripBom(text) {
  if (typeof text !== "string" || text.length === 0) return text;
  if (text.charCodeAt(0) === 0xfeff) return text.slice(1);
  return text;
}

/**
 * @param {string} filePath
 * @returns {string}
 */
function readTextFileStripBom(filePath) {
  const fs = require("node:fs");
  return stripBom(fs.readFileSync(filePath, "utf8"));
}

/**
 * @param {string} text
 * @returns {unknown}
 */
function parseJsonText(text) {
  return JSON.parse(stripBom(text));
}

module.exports = {
  stripBom,
  readTextFileStripBom,
  parseJsonText,
};
