package source

// FileClass is how DMOX treats a file by name.
type FileClass int

const (
	// ClassUnsupported is hidden from the tree (binary or unknown).
	ClassUnsupported FileClass = iota
	// ClassDoc is rendered as markdown AND fed to the FTS index.
	ClassDoc
	// ClassText is viewable (raw + syntax highlight) but not indexed in v1.
	ClassText
)

// textExts maps a lowercase extension (with dot) to a highlight.js language
// id. Presence here => ClassText. An empty value means "viewable, but we have
// no highlighter for it" (rendered as plaintext).
var textExts = map[string]string{
	".txt": "", ".rst": "", ".adoc": "", ".mdx": "markdown",
	".go": "go", ".rs": "rust", ".ts": "typescript", ".tsx": "typescript",
	".js": "javascript", ".jsx": "javascript", ".mjs": "javascript", ".cjs": "javascript",
	".py": "python", ".java": "java", ".c": "c", ".h": "c",
	".cpp": "cpp", ".cc": "cpp", ".hpp": "cpp", ".hh": "cpp",
	".yaml": "yaml", ".yml": "yaml", ".json": "json", ".toml": "ini",
	".xml": "xml", ".sql": "sql", ".sh": "bash", ".bash": "bash", ".zsh": "bash",
	".mmd": "", ".puml": "", ".plantuml": "",
}

// textNames maps a whole basename (extensionless config files) to a language.
var textNames = map[string]string{
	"Dockerfile": "dockerfile", "Makefile": "makefile", "Jenkinsfile": "groovy",
}

func docExt(ext string) bool { return ext == ".md" || ext == ".markdown" }

// Classify decides how a filename is treated. Case-insensitive on extension;
// basename rules are case-sensitive (Dockerfile, not dockerfile).
func Classify(name string) FileClass {
	base := baseName(name)
	if _, ok := textNames[base]; ok {
		return ClassText
	}
	ext := extLower(name)
	if docExt(ext) {
		return ClassDoc
	}
	if _, ok := textExts[ext]; ok {
		return ClassText
	}
	return ClassUnsupported
}

// IsViewable reports whether the file may appear in the tree and be opened.
func IsViewable(name string) bool { return Classify(name) != ClassUnsupported }

// IsIndexed reports whether the file is fed to the FTS index. Docs only in v1;
// widen this (e.g. to include ClassText) behind a config flag later.
func IsIndexed(name string) bool { return Classify(name) == ClassDoc }

// HighlightLanguage returns the highlight.js language id for a file, or "" when
// unknown (render as plaintext).
func HighlightLanguage(name string) string {
	if lang, ok := textNames[baseName(name)]; ok {
		return lang
	}
	return textExts[extLower(name)]
}
