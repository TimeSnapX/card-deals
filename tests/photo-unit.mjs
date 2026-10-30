// Unit tests for the photo text parser (no browser, no network).
import assert from "node:assert/strict";
import { parseOcr, nameScore } from "../js/photo.js";
let n = 0;
const t = (name, fn) => { fn(); n++; console.log("ok -", name); };
t("pokemon number + name", () => {
  const r = parseOcr("es , Evolves from Ci Put Charizard on the Stage | card\nJ 155» Charizard 120 HP®\nFire Spin\n4/102 ©1999 Wizards");
  assert.equal(r.game, "pokemon"); assert.equal(r.number, "4"); assert.equal(r.total, "102");
  assert.ok(nameScore("Charizard", r.nameLines.join(" ")) > 0.95);
});
t("magic set code + collector number", () => {
  const r = parseOcr("ll Lightning Bolt @)\nInstant\n141/249 U ™ & © 2018 Wizards of the Coast\nA25 + EN % CHRISTOPHE");
  assert.equal(r.game, "mtg"); assert.equal(r.mtgSet, "A25"); assert.equal(r.number, "141");
});
t("yugioh set code", () => { const r = parseOcr("Blue-Eyes White Dragon\nLOB-EN001\nATK/3000 DEF/2500"); assert.equal(r.game, "ygo"); assert.equal(r.setCode, "LOB-EN001"); });
t("PSA slab: grade word + number + cert", () => {
  const r = parseOcr("2023 POKEMON PAL EN #203\nMAGIKARP\nILLUSTRATION RARE\nGEM MT 10\n81234567\nPSA");
  assert.equal(r.grader, "PSA"); assert.equal(r.grade, "10"); assert.equal(r.cert, "81234567"); assert.equal(r.number, "203");
});
t("PSA qualifier", () => { const r = parseOcr("PSA\nT206 SWEET CAPORAL\nHONUS WAGNER EX\n5(MC)\n15385994"); assert.equal(r.grade, "5"); assert.equal(r.gradeQualifier, "MC"); assert.equal(r.game, "sports"); });
t("BGS half grade", () => { const r = parseOcr("BECKETT 9.5 GEM MINT\nCharizard\n0012345678"); assert.equal(r.grader, "BGS"); assert.equal(r.grade, "9.5"); });
t("grade word only, digit lost", () => { const r = parseOcr("T2086 SWEET CAPORAL\nHONUS WAGNER EX IF\nCLEC 16385994"); assert.equal(r.grade, "5"); assert.equal(r.cert, "16385994"); });
console.log(`\n${n} photo parser tests passed`);
