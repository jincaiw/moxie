const JSZip = require("jszip");

const wordNamespace =
  "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const relationshipNamespace =
  "http://schemas.openxmlformats.org/package/2006/relationships";

function parseNotes(section) {
  const orderedList = /<ol\b[^>]*>/i.exec(section);
  const listStart = orderedList?.index ?? -1;
  const listEnd = section.lastIndexOf("</ol>");
  if (listStart < 0 || listEnd < listStart) return null;
  const list = section.slice(listStart + orderedList[0].length, listEnd);
  const notes = [];
  const tags = /<li\b([^>]*)>|<\/li\s*>/gi;
  let depth = 0;
  let start = -1;
  let id = null;
  for (const match of list.matchAll(tags)) {
    if (/^<li\b/i.test(match[0])) {
      if (depth === 0) {
        const found = /\bid=["']fn-(\d+)["']/i.exec(match[1]);
        if (!found) return null;
        id = Number(found[1]);
        start = match.index + match[0].length;
      }
      depth++;
    } else {
      if (!depth) return null;
      depth--;
      if (!depth) {
        notes.push({ id, html: list.slice(start, match.index) });
        id = null;
      }
    }
  }
  return depth === 0 && notes.length ? notes : null;
}

function paragraphs(documentXml) {
  const body = /<w:body\b[^>]*>([\s\S]*?)<\/w:body>/.exec(documentXml)?.[1];
  if (!body) return null;
  const result = body.match(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g) || [];
  return result.length ? result : null;
}

function withoutNumbering(paragraph) {
  return paragraph.replace(/<w:numPr\b[^>]*>[\s\S]*?<\/w:numPr>/g, "");
}

function relationshipAttributes(xml) {
  return Object.fromEntries(
    [...xml.matchAll(/\b(Id|Type|Target|TargetMode)="([^"]*)"/g)].map(
      (match) => [match[1], match[2]],
    ),
  );
}

async function exportDocxWithFootnotes(html, options, converter) {
  const sectionMatch =
    /<section\b(?=[^>]*\bclass=["']footnotes["'])[^>]*>[\s\S]*?<\/section\s*>/i.exec(
      html,
    );
  if (!sectionMatch) return converter(html, null, options);
  const notes = parseNotes(sectionMatch[0]);
  if (!notes) return converter(html, null, options);
  if (
    notes.some((note) =>
      /<(?:img|table|ul|ol|blockquote|hr|div|section)\b/i.test(note.html),
    )
  )
    return converter(html, null, options);

  const noteIds = new Set(notes.map((note) => note.id));
  const references = new Map();
  const prepared = html.replace(
    /<sup\b(?=[^>]*\bid=["']fnref-(\d+)-(\d+)["'])(?=[^>]*\brole=["']doc-noteref["'])[^>]*>[\s\S]*?<\/sup\s*>/gi,
    (_match, id, occurrence) => {
      const number = Number(id);
      if (!noteIds.has(number)) return _match;
      references.set(number, (references.get(number) || 0) + 1);
      return `<sup>MOXIE_DOCX_FOOTNOTE_REF_${number}_${occurrence}</sup>`;
    },
  );
  if (references.size !== noteIds.size) return converter(html, null, options);
  const bodyHtml = prepared.replace(sectionMatch[0], "");
  const output = await JSZip.loadAsync(
    await converter(bodyHtml, null, options),
  );
  const documentFile = output.file("word/document.xml");
  const contentTypesFile = output.file("[Content_Types].xml");
  const documentRelsFile = output.file("word/_rels/document.xml.rels");
  if (!documentFile || !contentTypesFile || !documentRelsFile)
    throw new Error("DOCX 缺少脚注所需的 Word XML 部件");
  let documentXml = await documentFile.async("string");
  const noteParagraphs = [];
  const footnoteRelationships = [];
  let nextFootnoteRelationship = 1;

  for (const note of notes) {
    const noteHtml = note.html.replace(
      /\s*<a\b(?=[^>]*\bclass=["'][^"']*\bfootnote-backref\b)[^>]*>[\s\S]*?<\/a\s*>/gi,
      "",
    );
    const noteBody = /^\s*<p\b[\s\S]*<\/p>\s*$/i.test(noteHtml)
      ? noteHtml
      : `<p>${noteHtml}</p>`;
    const noteZip = await JSZip.loadAsync(
      await converter(`<html><body>${noteBody}</body></html>`, null, options),
    );
    const noteDocument = await noteZip
      .file("word/document.xml")
      .async("string");
    const content = paragraphs(noteDocument);
    if (!content) return converter(html, null, options);
    const rels = await noteZip
      .file("word/_rels/document.xml.rels")
      .async("string");
    const relationshipEntries = [
      ...rels.matchAll(/<Relationship\b[^>]*\/?\s*>/g),
    ];
    let rewritten = content.map(withoutNumbering);
    for (const entry of relationshipEntries) {
      const relation = relationshipAttributes(entry[0]);
      if (
        !relation.Id ||
        !rewritten.some((paragraph) =>
          paragraph.includes(`r:id="${relation.Id}"`),
        )
      )
        continue;
      if (
        !relation.Type?.endsWith("/hyperlink") ||
        relation.TargetMode !== "External"
      )
        return converter(html, null, options);
      const newId = `rId${nextFootnoteRelationship++}`;
      rewritten = rewritten.map((paragraph) =>
        paragraph.replaceAll(`r:id="${relation.Id}"`, `r:id="${newId}"`),
      );
      footnoteRelationships.push(
        `<Relationship Id="${newId}" Type="${relation.Type}" Target="${relation.Target}" TargetMode="External"/>`,
      );
    }
    noteParagraphs.push(
      `<w:footnote w:id="${note.id}"><w:p><w:pPr><w:pStyle w:val="FootnoteText"/></w:pPr><w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteRef/></w:r></w:p>${rewritten.join("")}</w:footnote>`,
    );
  }

  for (const id of noteIds) {
    const marker = new RegExp(
      `<w:r\\b[^>]*>(?:(?!<\\/w:r>)[\\s\\S])*?<w:t\\b[^>]*>MOXIE_DOCX_FOOTNOTE_REF_${id}_\\d+<\\/w:t>(?:(?!<\\/w:r>)[\\s\\S])*?<\\/w:r>`,
    );
    const matches = documentXml.match(new RegExp(marker.source, "g")) || [];
    if (matches.length !== references.get(id))
      return converter(html, null, options);
    documentXml = documentXml.replace(new RegExp(marker.source, "g"), (match) =>
      match.replace(
        /<w:r\b[^>]*>[\s\S]*?<\/w:r>/,
        `<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="${id}"/></w:r>`,
      ),
    );
  }

  const documentRels = await documentRelsFile.async("string");
  const relationIds = [...documentRels.matchAll(/\bId="rId(\d+)"/g)].map(
    (match) => Number(match[1]),
  );
  const footnotesRelationshipId = `rId${Math.max(0, ...relationIds) + 1}`;
  output.file(
    "word/_rels/document.xml.rels",
    documentRels.replace(
      "</Relationships>",
      `<Relationship Id="${footnotesRelationshipId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/></Relationships>`,
    ),
  );
  const contentTypes = await contentTypesFile.async("string");
  output.file(
    "[Content_Types].xml",
    contentTypes.replace(
      "</Types>",
      '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/></Types>',
    ),
  );
  output.file("word/document.xml", documentXml);
  output.file(
    "word/footnotes.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:footnotes xmlns:w="${wordNamespace}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote><w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>${noteParagraphs.join("")}</w:footnotes>`,
  );
  if (footnoteRelationships.length) {
    output.file(
      "word/_rels/footnotes.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${relationshipNamespace}">${footnoteRelationships.join("")}</Relationships>`,
    );
  }
  return output.generateAsync({ type: "nodebuffer" });
}

module.exports = { exportDocxWithFootnotes };
