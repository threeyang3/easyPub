// Explicit breaks survive editors which discard raw newline whitespace. Keep
// the original newline text too, so local textContent remains byte-for-byte.
export function normalizeWechatCodeBreaks(root: ParentNode): void {
  for (const br of Array.from(root.querySelectorAll('pre br'))) {
    if (br.nextSibling?.nodeType === 3 && br.nextSibling.textContent?.startsWith('\n')) br.remove();
    else br.replaceWith(document.createTextNode('\n'));
  }
}

export function prepareWechatCode(container: HTMLElement): void {
  normalizeWechatCodeBreaks(container);
  for (const code of Array.from(container.querySelectorAll('pre code'))) {
    const text = code.textContent ?? '';
    code.replaceChildren();
    const lines = text.split('\n');
    lines.forEach((line, index) => {
      const span = document.createElement('span'); span.textContent = line; code.append(span);
      if (index < lines.length - 1) code.append(document.createElement('br'), document.createTextNode('\n'));
    });
  }
}
