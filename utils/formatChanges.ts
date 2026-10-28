/** Formatting preserves nonblank line order. A linear alignment keeps blank-line
 * insertions from turning the rest of a long article into one apparent change. */
export function formattingChanges(before: string, after: string): string {
  // Normalize line separators only for display; never alter the saved strings.
  const oldLines = before.split(/\r?\n/), newLines = after.split(/\r?\n/);
  if (oldLines.length === newLines.length && oldLines.every((line, i) => line === newLines[i])) return "内容无变更";
  const output: string[] = [];
  let left = 0, right = 0, omitted = 0;
  const flush = () => { if (omitted) { output.push(`… ${omitted} 行未变 …`); omitted = 0; } };
  while (left < oldLines.length || right < newLines.length) {
    if (left < oldLines.length && right < newLines.length && oldLines[left] === newLines[right]) {
      omitted++; left++; right++; continue;
    }
    flush();
    output.push(`@@ 原文 ${left + 1} 行 → 结果 ${right + 1} 行 @@`);
    if (left < oldLines.length && right < newLines.length && oldLines[left].trimEnd() === newLines[right].trimEnd()) {
      output.push(`- ${oldLines[left++] || "（空行）"}`, `+ ${newLines[right++] || "（空行）"}`);
    } else if (right < newLines.length && !newLines[right].trim()) {
      output.push(`+ ${newLines[right++] || "（空行）"}`);
    } else if (left < oldLines.length && !oldLines[left].trim()) {
      output.push(`- ${oldLines[left++] || "（空行）"}`);
    } else {
      if (left < oldLines.length) output.push(`- ${oldLines[left++]}`);
      if (right < newLines.length) output.push(`+ ${newLines[right++]}`);
    }
  }
  flush();
  return output.join("\n");
}
