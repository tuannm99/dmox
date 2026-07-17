package render

import (
	"context"
	"strings"
	"testing"
)

func TestPlantUMLRenderer_UnavailableWhenNotConfigured(t *testing.T) {
	r := NewPlantUMLRenderer("", t.TempDir())
	if r.Available() {
		t.Fatal("expected Available() == false when jarPath is empty")
	}
	svg, reason := r.RenderSVG(context.Background(), "@startuml\nA -> B\n@enduml")
	if svg != "" || reason == "" {
		t.Fatalf("svg=%q reason=%q, want empty svg and a reason", svg, reason)
	}
}

func TestPlantUMLRenderer_RenderBlocks_UnavailableAddsNotice(t *testing.T) {
	r := NewPlantUMLRenderer("", t.TempDir())
	body := "before\n```plantuml\n@startuml\nA -> B\n@enduml\n```\nafter"
	out := r.RenderBlocks(context.Background(), body)
	if !strings.Contains(out, "@startuml") {
		t.Fatalf("expected raw plantuml source preserved, got: %s", out)
	}
	if !strings.Contains(out, "PlantUML rendering unavailable") {
		t.Fatalf("expected unavailable notice, got: %s", out)
	}
}

func TestCacheFileName_IsStableAndContentAddressed(t *testing.T) {
	a := cacheFileName("@startuml\nA -> B\n@enduml")
	b := cacheFileName("@startuml\nA -> B\n@enduml")
	c := cacheFileName("@startuml\nA -> C\n@enduml")
	if a != b {
		t.Fatalf("same content should hash to same cache filename: %q vs %q", a, b)
	}
	if a == c {
		t.Fatalf("different content should hash to different cache filenames")
	}
}
