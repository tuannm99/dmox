// Lazy wrapper around highlight.js so it lands in its own chunk, loaded only
// when the first code file is opened.
export async function highlightCode(code: string, language: string): Promise<string | null> {
  const { default: hljs } = await import('highlight.js/lib/common');
  // highlight.js/lib/common omits dockerfile and groovy — register them
  // explicitly so Dockerfile/Jenkinsfile don't silently fall back to plaintext.
  if (!hljs.getLanguage('dockerfile')) {
    const { default: dockerfile } = await import('highlight.js/lib/languages/dockerfile');
    hljs.registerLanguage('dockerfile', dockerfile);
  }
  if (!hljs.getLanguage('groovy')) {
    const { default: groovy } = await import('highlight.js/lib/languages/groovy');
    hljs.registerLanguage('groovy', groovy);
  }
  if (!language || !hljs.getLanguage(language)) return null;
  try {
    return hljs.highlight(code, { language }).value;
  } catch {
    return null;
  }
}
