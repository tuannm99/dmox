package livesync

import "testing"

func TestDiffCache_RecordThenConsume(t *testing.T) {
	c := NewDiffCache(200)
	c.Record("ws", "local", "guide.md", "old body", "new body")

	old, new_, available := c.Consume("ws", "local", "guide.md")
	if !available {
		t.Fatal("expected entry to be available")
	}
	if old != "old body" || new_ != "new body" {
		t.Fatalf("old=%q new=%q", old, new_)
	}
}

func TestDiffCache_ConsumeClearsEntry(t *testing.T) {
	c := NewDiffCache(200)
	c.Record("ws", "local", "guide.md", "old", "new")
	c.Consume("ws", "local", "guide.md")

	_, _, available := c.Consume("ws", "local", "guide.md")
	if available {
		t.Fatal("expected entry to be gone after first Consume")
	}
}

func TestDiffCache_ConsumeUnknownKeyIsUnavailable(t *testing.T) {
	c := NewDiffCache(200)
	_, _, available := c.Consume("ws", "local", "nope.md")
	if available {
		t.Fatal("expected unavailable for a key never recorded")
	}
}

func TestDiffCache_RepeatedRecordKeepsOriginalOldExtendsNew(t *testing.T) {
	c := NewDiffCache(200)
	c.Record("ws", "local", "guide.md", "v1", "v2")
	c.Record("ws", "local", "guide.md", "v2", "v3") // second change before anyone viewed the first

	old, new_, available := c.Consume("ws", "local", "guide.md")
	if !available {
		t.Fatal("expected entry to be available")
	}
	if old != "v1" {
		t.Fatalf("old = %q, want %q (original baseline preserved)", old, "v1")
	}
	if new_ != "v3" {
		t.Fatalf("new = %q, want %q (latest content)", new_, "v3")
	}
}

func TestDiffCache_DifferentWorkspacesOrSourcesAreIndependentKeys(t *testing.T) {
	c := NewDiffCache(200)
	c.Record("ws1", "local", "guide.md", "a", "b")
	c.Record("ws2", "local", "guide.md", "x", "y")

	old, new_, available := c.Consume("ws1", "local", "guide.md")
	if !available || old != "a" || new_ != "b" {
		t.Fatalf("ws1 entry = (%q, %q, %v)", old, new_, available)
	}
	old, new_, available = c.Consume("ws2", "local", "guide.md")
	if !available || old != "x" || new_ != "y" {
		t.Fatalf("ws2 entry = (%q, %q, %v)", old, new_, available)
	}
}

func TestDiffCache_EvictsOldestPerWorkspaceWhenOverCap(t *testing.T) {
	c := NewDiffCache(2)
	c.Record("ws", "local", "a.md", "", "a")
	c.Record("ws", "local", "b.md", "", "b")
	c.Record("ws", "local", "c.md", "", "c") // evicts a.md, the oldest unconsumed entry

	if _, _, available := c.Consume("ws", "local", "a.md"); available {
		t.Fatal("expected a.md to have been evicted")
	}
	if _, _, available := c.Consume("ws", "local", "b.md"); !available {
		t.Fatal("expected b.md to still be present")
	}
	if _, _, available := c.Consume("ws", "local", "c.md"); !available {
		t.Fatal("expected c.md to still be present")
	}
}
