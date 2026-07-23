// Lazy wrapper around highlight.js so it lands in its own chunk, loaded only
// when the first code file is opened.
export async function highlightCode(code: string, language: string): Promise<string | null> {
  const { default: hljs } = await import('highlight.js/lib/common');
  if (!language || !hljs.getLanguage(language)) return null;
  try {
    return hljs.highlight(code, { language }).value;
  } catch {
    return null;
  }
}
