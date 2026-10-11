export function shouldPrerenderPage(page: { path: string }): boolean {
  return !page.path.includes("?");
}
