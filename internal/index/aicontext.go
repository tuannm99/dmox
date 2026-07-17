package index

import (
	"path"
	"strings"
)

var defaultAIContextNames = map[string]bool{
	"CLAUDE.md":    true,
	"AGENTS.md":    true,
	".cursorrules": true,
}

func IsAIContextFile(p string) bool {
	base := path.Base(p)
	if defaultAIContextNames[base] {
		return true
	}
	return strings.Contains(p, ".cursor/rules/")
}
