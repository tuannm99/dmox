package render

import "regexp"

type FileView struct {
	Path        string         `json:"path"`
	Title       string         `json:"title"`
	Frontmatter map[string]any `json:"frontmatter"`
	Body        string         `json:"body"`
	Headings    []Heading      `json:"headings"`
	IsAIContext bool           `json:"is_ai_context"`
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
