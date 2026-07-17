package render

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
)

type PlantUMLRenderer struct {
	jarPath  string
	cacheDir string
}

func NewPlantUMLRenderer(jarPath, cacheDir string) *PlantUMLRenderer {
	return &PlantUMLRenderer{jarPath: jarPath, cacheDir: cacheDir}
}

func (r *PlantUMLRenderer) Available() bool { return r.jarPath != "" }

func cacheFileName(src string) string {
	hash := sha256.Sum256([]byte(src))
	return hex.EncodeToString(hash[:]) + ".svg"
}

// RenderSVG renders PlantUML source to SVG, caching by content hash. If
// unavailableReason is non-empty, svg is empty and the caller should render
// the raw source with an inline notice instead (spec §5).
func (r *PlantUMLRenderer) RenderSVG(ctx context.Context, src string) (svg string, unavailableReason string) {
	if !r.Available() {
		return "", "no PlantUML renderer configured"
	}
	cachePath := filepath.Join(r.cacheDir, cacheFileName(src))
	if cached, err := os.ReadFile(cachePath); err == nil {
		return string(cached), ""
	}
	if _, err := exec.LookPath("java"); err != nil {
		return "", "java not found on PATH"
	}
	cmd := exec.CommandContext(ctx, "java", "-jar", r.jarPath, "-tsvg", "-pipe")
	cmd.Stdin = strings.NewReader(src)
	var out, stderr bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return "", fmt.Sprintf("plantuml render failed: %v: %s", err, stderr.String())
	}
	_ = os.MkdirAll(r.cacheDir, 0o755)
	_ = os.WriteFile(cachePath, out.Bytes(), 0o644)
	return out.String(), ""
}

var plantumlBlockRe = regexp.MustCompile("(?s)```plantuml\\n(.*?)\\n```")

func (r *PlantUMLRenderer) RenderBlocks(ctx context.Context, body string) string {
	return plantumlBlockRe.ReplaceAllStringFunc(body, func(block string) string {
		m := plantumlBlockRe.FindStringSubmatch(block)
		src := m[1]
		svg, reason := r.RenderSVG(ctx, src)
		if reason != "" {
			return "```plantuml\n" + src + "\n```\n> ⚠️ PlantUML rendering unavailable: " + reason
		}
		encoded := base64.StdEncoding.EncodeToString([]byte(svg))
		return fmt.Sprintf(`<img alt="diagram" src="data:image/svg+xml;base64,%s" />`, encoded)
	})
}
