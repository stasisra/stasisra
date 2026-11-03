/* Stable inline references. No HTML from descriptions is trusted. */
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
  const plain = (s) =>
    String(s || "")
      .replace(/^:::contact [a-zA-Z0-9_-]+\n/gm, "")
      .replace(/^:::$/gm, "")
      .replace(pattern, (_, label) => "@" + decode(label));
  function tokensHtml(raw, E) {
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
      if (node.nodeType === 3) return node.textContent;
      if (node.nodeType !== 1) return "";
      if (node.dataset?.mentionId)
        return token(
          node.dataset.mentionKind,
          node.dataset.mentionId,
          node.dataset.mentionLabel,
        );
      if (node.tagName === "BR") return "\n";
      const text = children(node);
      if (node.dataset?.contactBlock)
        return (
          ":::contact " +
          node.dataset.contactBlock +
          "\n" +
          text.replace(/\n$/, "") +
          "\n:::"
        );
      return (
        text +
        (["DIV", "P", "LI"].includes(node.tagName) && node.nextSibling
          ? "\n"
          : "")
      );
    };
    return children(editor).replace(/\u00a0/g, " ");
  }
  return { token, plain, html, serialize, withoutContacts };
});
