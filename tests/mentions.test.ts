import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const m = createRequire(import.meta.url)("../public/workspace/mentions.js");
const escape = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
test("stable references keep Unicode labels, print as readable names and escape hostile HTML", () => {
  const token = m.token("contact", "person-id", "Аркадий ] <img src=x>");
  assert.equal(m.plain("Уточнить " + token), "Уточнить @Аркадий ] <img src=x>");
  const html = m.html("<script>bad()</script>" + token, escape);
  assert(!html.includes("<script>"));
  assert(!html.includes("<img"));
  assert(html.includes('data-mention-id="person-id"'));
  assert.throws(() => m.token("contact", "../../x", "A"));
  assert.throws(() => m.token("javascript", "id", "A"));
  const raw =
    "Описание\n\n:::contact person-id\nКонтактные данные: " +
    token +
    "\nТелефоны: 123\n:::\n\nДалее";
  assert.equal(m.withoutContacts(raw), "Описание\n\nДалее");
  assert(!m.plain(raw).includes(":::"));
  assert(m.html(raw, escape).includes('data-contact-block="person-id"'));
});
