/* Stable inline references and supported formatting in existing text fields. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.WorkspaceMentions = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const pattern =
    /@\[([^\]\r\n]*)\]\((contact|item|project):([a-zA-Z0-9_-]{1,100})\)/g;
  const decode = (s) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  };
  const token = (kind, id, label) => {
    if (
      !/^(contact|item|project)$/.test(kind) ||
      !/^[a-zA-Z0-9_-]{1,100}$/.test(id)
    )
      throw Error("Invalid reference");
    return "@[" + encodeURIComponent(label) + "](" + kind + ":" + id + ")";
  };
  const withoutContacts = (s) =>
    String(s || "").replace(
      /:::contact [a-zA-Z0-9_-]+\n[\s\S]*?\n:::(?:\n\n)?/g,
      "",
    );
  const formatToken = /\uE000(\/?[biu]|!)\uE001/g;
  const tag = { b: "strong", i: "em", u: "u" };
  const control = (code) => "\uE000" + code + "\uE001";
  function runs(raw) {
    const result = [],
      active = [];
    let start = 0;
    const add = (text) => {
      if (text) result.push({ text, marks: [...new Set(active)] });
    };
    for (const match of raw.matchAll(formatToken)) {
      add(raw.slice(start, match.index));
      const code = match[1];
      if (code === "!") add("\uE000");
      else if (code.startsWith("/")) {
        const index = active.lastIndexOf(code[1]);
        if (index !== -1) active.splice(index, 1);
      } else active.push(code);
      start = match.index + match[0].length;
    }
    add(raw.slice(start));
    return result;
  }
  function printRuns(raw) {
    const text = String(raw || "")
      .replace(/^:::contact [a-zA-Z0-9_-]+\n/gm, "")
      .replace(/^:::$/gm, "");
    return runs(text).map((run) => ({
      ...run,
      text: run.text.replace(pattern, (_, label) => "@" + decode(label)),
    }));
  }
  const plain = (s) =>
    printRuns(s)
      .map((run) => run.text)
      .join("");
  function renderRuns(list, render) {
    return list
      .map(({ text, marks }) =>
        marks.reduceRight(
          (html, mark) =>
            tag[mark]
              ? "<" + tag[mark] + ">" + html + "</" + tag[mark] + ">"
              : html,
          render(text),
        ),
      )
      .join("");
  }
  function mentionHtml(raw, E) {
    let result = "",
      last = 0;
    for (const match of String(raw || "").matchAll(pattern)) {
      result += E(raw.slice(last, match.index)).replace(/\n/g, "<br>");
      const label = decode(match[1]);
      result +=
        '<span class="mention-link" role="link" tabindex="0" contenteditable="false" data-mention-kind="' +
        match[2] +
        '" data-mention-id="' +
        match[3] +
        '" data-mention-label="' +
        E(label) +
        '">@' +
        E(label) +
        "</span>";
      last = match.index + match[0].length;
    }
    return result + E(String(raw || "").slice(last)).replace(/\n/g, "<br>");
  }
  const tokensHtml = (raw, E) =>
    renderRuns(runs(raw), (s) => mentionHtml(s, E));
  function html(raw, E) {
    raw = String(raw || "");
    let result = "",
      last = 0;
    const blocks = /:::contact ([a-zA-Z0-9_-]+)\n([\s\S]*?)\n:::/g;
    for (const m of raw.matchAll(blocks)) {
      result += tokensHtml(raw.slice(last, m.index), E);
      result +=
        '<div class="contact-data-block" data-contact-block="' +
        m[1] +
        '">' +
        tokensHtml(m[2], E) +
        "</div>";
      last = m.index + m[0].length;
    }
    return result + tokensHtml(raw.slice(last), E);
  }
  function serialize(editor) {
    const children = (parent) => {
      let out = "";
      for (const child of parent.childNodes) {
        if (
          child.nodeType === 1 &&
          ["DIV", "P", "LI"].includes(child.tagName) &&
          out &&
          !out.endsWith("\n")
        )
          out += "\n";
        out += walk(child);
      }
      return out;
    };
    const walk = (node) => {
      if (node.nodeType === 3)
        return node.textContent.replace(/\uE000/g, control("!"));
      if (node.nodeType !== 1) return "";
      if (node.dataset?.mentionId)
        return token(
          node.dataset.mentionKind,
          node.dataset.mentionId,
          node.dataset.mentionLabel,
        );
      if (node.tagName === "BR") return "\n";
      let text = children(node);
      if (node.dataset?.contactBlock)
        return (
          ":::contact " +
          node.dataset.contactBlock +
          "\n" +
          text.replace(/\n$/, "") +
          "\n:::"
        );
      const style = node.style;
      const marks = [];
      if (
        ["B", "STRONG"].includes(node.tagName) ||
        /^(bold|[6-9]00)$/.test(style?.fontWeight || "")
      )
        marks.push("b");
      if (
        ["I", "EM"].includes(node.tagName) ||
        /^(italic|oblique)$/.test(style?.fontStyle || "")
      )
        marks.push("i");
      if (
        node.tagName === "U" ||
        /\bunderline\b/.test(
          style?.textDecorationLine || style?.textDecoration || "",
        )
      )
        marks.push("u");
      if (text.trim())
        for (const mark of marks)
          text = control(mark) + text + control("/" + mark);
      return (
        text +
        (["DIV", "P", "LI"].includes(node.tagName) && node.nextSibling
          ? "\n"
          : "")
      );
    };
    return children(editor).replace(/\u00a0/g, " ");
  }
  return {
    token,
    plain,
    html,
    serialize,
    withoutContacts,
    printRuns,
    renderRuns,
  };
});
