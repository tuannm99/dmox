package render

import (
	"path"
	"regexp"
)

// MaxHighlightBytes is the size cutoff above which a code file is served raw
// (no syntax highlighting) rather than paying highlight.js's cost on a huge
// file. Shared by the live API (internal/api) and the static build
// (internal/staticbuild) so the two paths can't drift apart.
const MaxHighlightBytes = 1 << 20 // 1 MiB

type FileView struct {
	Path                string         `json:"path"`
	Title               string         `json:"title"`
	Frontmatter         map[string]any `json:"frontmatter"`
	Body                string         `json:"body"`
	Headings            []Heading      `json:"headings"`
	IsAIContext         bool           `json:"is_ai_context"`
	Kind                string         `json:"kind"`
	Language            string         `json:"language,omitempty"`
	TooLargeToHighlight bool           `json:"tooLargeToHighlight,omitempty"`
}

type Heading struct {
	Level int    `json:"level"`
	Text  string `json:"text"`
	Slug  string `json:"slug"`
}

var headingRe = regexp.MustCompile(`(?m)^(#{1,6})\s+(.+)$`)
var slugInvalidRe = regexp.MustCompile(`[^a-z0-9]+`)

func ExtractHeadings(body string) []Heading {
	matches := headingRe.FindAllStringSubmatch(body, -1)
	headings := make([]Heading, 0, len(matches))
	for _, m := range matches {
		text := trimSpace(m[2])
		headings = append(headings, Heading{Level: len(m[1]), Text: text, Slug: slugify(text)})
	}
	return headings
}

func slugify(s string) string {
	s = toLower(s)
	s = slugInvalidRe.ReplaceAllString(s, "-")
	return trimDashes(s)
}

func toLower(s string) string {
	b := []byte(s)
	for i, c := range b {
		if c >= 'A' && c <= 'Z' {
			b[i] = c + ('a' - 'A')
		}
	}
	return string(b)
}

func trimSpace(s string) string {
	start, end := 0, len(s)
	for start < end && (s[start] == ' ' || s[start] == '\t') {
		start++
	}
	for end > start && (s[end-1] == ' ' || s[end-1] == '\t') {
		end--
	}
	return s[start:end]
}

func trimDashes(s string) string {
	start, end := 0, len(s)
	for start < end && s[start] == '-' {
		start++
	}
	for end > start && s[end-1] == '-' {
		end--
	}
	return s[start:end]
}

// CodeFileView builds the view for a non-markdown text file: raw content plus a
// highlight language. Over maxBytes it keeps the full body but signals the
// client to skip (expensive) highlighting and show plaintext.
func CodeFileView(p string, raw []byte, language string, maxBytes int) FileView {
	return FileView{
		Path:                p,
		Title:               path.Base(p),
		Frontmatter:         map[string]any{},
		Body:                string(raw),
		Headings:            []Heading{},
		Kind:                "code",
		Language:            language,
		TooLargeToHighlight: len(raw) > maxBytes,
	}
}
