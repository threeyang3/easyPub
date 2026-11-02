import assert from "node:assert/strict";
import { formatMarkdownBody } from "../utils/markdownFormatting";

export function runMarkdownFormattingTests() {
  const indent = {indentParagraphs: true, separateParagraphs: false};
  const separate = {indentParagraphs: false, separateParagraphs: true};
  const both = {indentParagraphs: true, separateParagraphs: true};
  const header = '---\r\ntitle: 保留注释与格式 # comment\r\ncustom: [a, b]\r\n---   \r\n';
  const input = header + '第一段第一行\r\n这是同段续行\r\n\r\n　第二段\r\n\r\n　　　第三段\r\n';
  const result = formatMarkdownBody(input, indent);
  assert.equal(result.content, header + '　　第一段第一行\r\n这是同段续行\r\n\r\n　　第二段\r\n\r\n　　第三段\r\n');
  assert.equal(result.indentedParagraphs, 3);
  assert.equal(result.addedBreaks, 0);
  assert.deepEqual(formatMarkdownBody(result.content, indent), {...result, indentedParagraphs: 0});
  assert.equal(formatMarkdownBody('甲\n乙\n\n丙', both).content, '　　甲\n\n　　乙\n\n　　丙\n');
  const split = formatMarkdownBody('甲  \n乙\\\n丙\n\n丁\n', separate);
  assert.equal(split.content, '甲\n\n乙\n\n丙\n\n丁\n');
  assert.equal(split.addedBreaks, 2);
  assert.equal(split.trimmedLines, 1);
  assert.equal(split.indentedParagraphs, 0);
  assert.equal(formatMarkdownBody(split.content, separate).content, split.content);
  const aligned = '　　甲\n\n　　乙\n';
  assert.deepEqual(formatMarkdownBody(aligned, both), {content: aligned, indentedParagraphs: 0, addedBreaks: 0, trimmedLines: 0});
  assert.equal(formatMarkdownBody('甲无末尾换行', indent).content, '　　甲无末尾换行');
  assert.equal(formatMarkdownBody('  甲\n', indent).content, '　　甲\n');
  assert.equal(formatMarkdownBody('甲\r\n乙', both).content, '　　甲\r\n\r\n　　乙\r\n');
  for (const literal of [
    '- item\n\n  ```ts\n  code\n\n\n',
    '> quote\n>\n> ```ts\n> code\n>\n>\n',
    '<pre>\nline\n\n\n',
    '<script>\nconst example = "text";\n\n\n',
  ]) {
    for (const options of [separate, both]) {
      const formatted = formatMarkdownBody(literal, options).content;
      assert.equal(formatted, literal, `Literal tail changed: ${literal}`);
      assert.equal(formatMarkdownBody(formatted, options).content, literal);
    }
  }
  const structures = [
    '# 标题', '标题\n====',
    '```md\n甲  \n乙\n```', '    code  \n    next', '```ts\nunclosed  \n\n',
    '- 第一项\n  续行  \n- 第二项', '> 引用\n> 续行  ',
    '| 列一 | 列二 |\n| --- | --- |\n| a | b |',
    '<div>\n第一行  \n第二行\n</div>', '文字 <span>原始样式</span> 保留',
    '{% note info %}\n甲  \n乙\n{% endnote %}',
    '{% raw %}\n{% note %}\n甲  \n乙\n{% endnote %}\n{% endraw %}',
    '{% custom %}\n\n甲  \n乙\n\n{% endcustom %}',
    '$$\na + b  \n= c\n$$', '\\[\na + b  \n= c\n\\]',
    '%%\n甲  \n乙\n%%', '文字 `代码\n换行` 结束', '[链接\n名称](https://example.com)',
    '![甲](assets/a.png)\n![乙](assets/b.png)', '![甲](assets/a.png)  \n![乙](assets/b.png)', '![[assets/a.png]]\n![[assets/b.png]]',
  ];
  for (const block of structures) {
    assert.equal(formatMarkdownBody(block, indent).content, block, `缩进改变了结构：${block}`);
    // Blank-line cleanup may ensure a terminating newline, but cannot alter the block itself.
    assert.ok(formatMarkdownBody(block, both).content.startsWith(block), `分段改变了结构：${block}`);
    if (!block.includes('unclosed')) {
      const wrapped = `前文\n续行\n\n${block}\n\n后文\n续行\n`;
      const formatted = formatMarkdownBody(wrapped, both);
      assert.ok(formatted.content.includes(block), `混排结构被修改：${block}`);
      assert.equal(formatMarkdownBody(formatted.content, both).content, formatted.content);
      assert.ok(formatted.content.startsWith('　　前文\n\n　　续行\n\n'));
      assert.ok(formatted.content.endsWith('　　后文\n\n　　续行\n'));
    }
  }
  const untouched = header + '甲  \r\n\r\n\r\n';
  assert.equal(formatMarkdownBody(untouched, {indentParagraphs: false, separateParagraphs: false}).content, untouched);
  assert.equal(formatMarkdownBody('', both).content, '');
  const json = '---json\n{\n  "title": "x"\n}\n---\n';
  assert.equal(formatMarkdownBody(json + '甲\n乙', both).content, json + '　　甲\n\n　　乙\n');
  assert.doesNotMatch(formatMarkdownBody('甲\n乙', both).content, /<(?:style|span|section|p)\b/);
  console.log('Basic Markdown formatting: fullwidth indent, paragraph spacing, structure fidelity, front matter, EOL and idempotence passed');
}
