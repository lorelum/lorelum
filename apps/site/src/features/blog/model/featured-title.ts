export function featuredTitleParts(title: string): string[] {
  return title.split(/((?:系统|测量|注入)[，、：；,.!?]?|Practice)/u).filter((part) => part.length > 0);
}

export function keepTitlePartTogether(part: string): boolean {
  return /^(?:(?:系统|测量|注入)[，、：；,.!?]?|Practice)$/u.test(part);
}
