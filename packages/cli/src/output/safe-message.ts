/** One safe, bounded message is shared by JSON and terminal presentation. */
export function safeErrorMessage(value: string, maxLength = 400): string {
  let visible = "";
  for (const character of value) {
    const point = character.codePointAt(0)!;
    const unsafe =
      point <= 0x1f ||
      (point >= 0x7f && point <= 0x9f) ||
      (point >= 0x2028 && point <= 0x202e) ||
      (point >= 0x2066 && point <= 0x2069);
    const segment = unsafe ? `\\u${point.toString(16).padStart(4, "0")}` : character;
    if (visible.length + segment.length > maxLength - 3) return `${visible}...`;
    visible += segment;
  }
  return visible;
}
