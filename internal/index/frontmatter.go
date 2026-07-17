package index

import (
	"log"
	"regexp"
	"strings"

	"gopkg.in/yaml.v3"
)

type ParsedDoc struct {
	Frontmatter map[string]any
	Title       string
	Body        string
}

var frontmatterRe = regexp.MustCompile(`(?s)^---\r?\n(.*?)\r?\n---\r?\n?`)
var firstHeadingRe = regexp.MustCompile(`(?m)^#\s+(.+)$`)

func Parse(raw []byte, fallbackTitle string) ParsedDoc {
	content := string(raw)
	fm := map[string]any{}
	if m := frontmatterRe.FindStringSubmatch(content); m != nil {
		if err := yaml.Unmarshal([]byte(m[1]), &fm); err != nil {
			log.Printf("index: malformed frontmatter, indexing with raw content: %v", err)
		}
		content = content[len(m[0]):]
	}
	title := fallbackTitle
	body := content
	if t, ok := fm["title"].(string); ok && t != "" {
		title = t
	} else if h := firstHeadingRe.FindStringSubmatch(content); h != nil {
		title = strings.TrimSpace(h[1])
		// Remove the heading line from body (first match only)
		idx := firstHeadingRe.FindStringIndex(content)
		if idx != nil {
			body = content[:idx[0]] + content[idx[1]:]
			body = strings.TrimPrefix(body, "\n")
		}
	}
	return ParsedDoc{Frontmatter: fm, Title: title, Body: body}
}
