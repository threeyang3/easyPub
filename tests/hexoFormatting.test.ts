import assert from "node:assert/strict";
import { formatHexoMarkdown } from "../utils/hexoFormatting";

export function runHexoFormattingTests() {
  const input = '---\ntitle: 保持原样  \ncustom: [a, b]\n---\n第一行  \n第二行\n第三行\n\n\n';
  const result = formatHexoMarkdown(input);
  assert.equal(result.content, '---\ntitle: 保持原样  \ncustom: [a, b]\n---\n第一行\n\n第二行\n\n第三行\n');
  assert.equal(result.addedBreaks, 2); assert.equal(result.trimmedLines, 1);
  assert.equal(formatHexoMarkdown(result.content).content, result.content);
  const structures = [
    '```md\n第一行  \n第二行\n```',
    '- 第一项\n  续行  \n- 第二项',
    '> 引用\n> 续行  ',
    '| 列一 | 列二 |\n| --- | --- |\n| a | b |',
    '<div>\n第一行  \n第二行\n</div>',
    '{% note info %}\n第一行  \n第二行\n{% endnote %}',
    '{% raw %}\n{% note %}\n第一行  \n第二行\n{% endnote %}\n{% endraw %}',
    '$$\na + b  \n= c\n$$',
    '%%\n第一行  \n第二行\n%%',
    '    code  \n    next',
    '标题\n====',
    '文字 `代码\n换行` 结束',
    '[链接\n名称](https://example.com)',
    '{% custom %}\n\n甲  \n乙\n\n{% endcustom %}',
  ];
  for (const block of structures) {
    assert.equal(formatHexoMarkdown(`${block}\n\n`).content, block + '\n', block);
    const wrapped = `前文\n续行\n\n${block}\n\n后文\n续行\n`;
    assert.ok(formatHexoMarkdown(wrapped).content.includes(block));
  }
  const paddedHeader = '---\ntitle: 原样保留\nauthor: 某人\n\ndescription: >\n  first\n  second\n---   \n';
  assert.equal(formatHexoMarkdown(paddedHeader + '甲\n乙').content, paddedHeader + '甲\n\n乙\n');
  assert.equal(formatHexoMarkdown('---\n---\n甲\n乙').content, '---\n---\n甲\n\n乙\n');
  const crlf = '---\r\ntitle: x\r\n---\r\n甲  \r\n乙\r\n\r\n';
  assert.equal(formatHexoMarkdown(crlf).content, '---\r\ntitle: x\r\n---\r\n甲\r\n\r\n乙\r\n');
  assert.equal(formatHexoMarkdown('甲\\\n乙').content, '甲\n\n乙\n');
  assert.equal(formatHexoMarkdown('').content, '');
  const unclosed = '```ts\ncode  \n\n';
  assert.equal(formatHexoMarkdown(unclosed).content, unclosed);
  assert.equal(formatHexoMarkdown('$$x$$\n\n甲\n乙').addedBreaks, 1);
  const json = '---json\n{\n  "title": "x"\n}\n---\n甲\n乙';
  assert.equal(formatHexoMarkdown(json).content, json.replace('甲\n乙', '甲\n\n乙\n'));
  assert.equal(formatHexoMarkdown('```md\n{% raw %}\n```\n\n甲\n乙').addedBreaks, 1);
  assert.equal(formatHexoMarkdown('甲\n\n乙\n').addedBreaks, 0);
  console.log('Hexo formatting tests passed');
}
