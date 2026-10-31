/* Local, bounded document parsing. No document data is sent to external services. */
"use strict";
function checkArchive(buffer) {
  const v = new DataView(buffer);
  if (v.byteLength < 4 || v.getUint32(0, true) !== 0x04034b50) return;
  let end = -1;
  for (let i = v.byteLength - 22; i >= Math.max(0, v.byteLength - 65557); i--)
    if (v.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  if (end < 0) throw Error("archive");
  const count = v.getUint16(end + 10, true);
  if (count > 10000) throw Error("archive-size");
  let offset = v.getUint32(end + 16, true),
    total = 0;
  for (let n = 0; n < count; n++) {
    if (offset + 46 > v.byteLength || v.getUint32(offset, true) !== 0x02014b50)
      throw Error("archive");
    total += v.getUint32(offset + 24, true);
    if (total > 100 * 1024 * 1024) throw Error("archive-size");
    offset +=
      46 +
      v.getUint16(offset + 28, true) +
      v.getUint16(offset + 30, true) +
      v.getUint16(offset + 32, true);
  }
}
self.onmessage = async (event) => {
  try {
    const { buffer, name } = event.data;
    checkArchive(buffer);
    if (/\.docx$/i.test(name)) {
      importScripts("/workspace/vendor/mammoth.browser.min.js");
      const result = await self.mammoth.convertToHtml(
        { arrayBuffer: buffer },
        {
          externalFileAccess: false,
          convertImage: self.mammoth.images.imgElement(async (image) => ({
            src: `data:${image.contentType};base64,${await image.read("base64")}`,
          })),
        },
      );
      if (result.value.length > 5 * 1024 * 1024) throw Error("document-size");
      self.postMessage({ html: result.value });
    } else {
      importScripts("/workspace/vendor/xlsx.full.min.js");
      const book = self.XLSX.read(buffer, {
        type: "array",
        cellHTML: false,
        cellNF: true,
        cellText: true,
        cellStyles: false,
        cellFormula: false,
        bookVBA: false,
      });
      if (!book.SheetNames.length) throw Error("empty-book");
      let cells = 0;
      for (const name of book.SheetNames) {
        cells += Object.keys(book.Sheets[name]).length;
        if (cells > 250000) throw Error("document-size");
      }
      self.postMessage({ book });
    }
  } catch {
    self.postMessage({
      error:
        "Не удалось прочитать файл: он повреждён, защищён паролем или слишком велик для встроенного просмотра. Оригинал можно скачать.",
    });
  }
};
