package livesync

import "sync"

type diffKey struct {
	workspaceID string
	sourceID    string
	path        string
}

type diffEntry struct {
	oldBody string
	newBody string
}

// DiffCache holds, per (workspace, source, path), the content just before
// the most recent unconsumed change and the content after it — enough to
// render a diff on demand. Entries are cleared on Consume; a repeated
// Record before Consume extends newBody while keeping the original oldBody,
// so the diff always covers everything since the last time it was actually
// viewed. In-memory only: it does not survive a process restart.
type DiffCache struct {
	mu      sync.Mutex
	cap     int
	entries map[diffKey]diffEntry
	order   map[string][]diffKey // per-workspace insertion order, oldest first
}

func NewDiffCache(cap int) *DiffCache {
	return &DiffCache{
		cap:     cap,
		entries: make(map[diffKey]diffEntry),
		order:   make(map[string][]diffKey),
	}
}

func (c *DiffCache) Record(workspaceID, sourceID, path, oldBody, newBody string) {
	c.mu.Lock()
	defer c.mu.Unlock()

	key := diffKey{workspaceID, sourceID, path}
	if existing, ok := c.entries[key]; ok {
		existing.newBody = newBody
		c.entries[key] = existing
		return
	}

	if c.cap > 0 && len(c.order[workspaceID]) >= c.cap {
		oldest := c.order[workspaceID][0]
		c.order[workspaceID] = c.order[workspaceID][1:]
		delete(c.entries, oldest)
	}

	c.entries[key] = diffEntry{oldBody: oldBody, newBody: newBody}
	c.order[workspaceID] = append(c.order[workspaceID], key)
}

func (c *DiffCache) Consume(workspaceID, sourceID, path string) (oldBody, newBody string, available bool) {
	c.mu.Lock()
	defer c.mu.Unlock()

	key := diffKey{workspaceID, sourceID, path}
	entry, ok := c.entries[key]
	if !ok {
		return "", "", false
	}
	delete(c.entries, key)

	order := c.order[workspaceID]
	for i, k := range order {
		if k == key {
			c.order[workspaceID] = append(order[:i], order[i+1:]...)
			break
		}
	}

	return entry.oldBody, entry.newBody, true
}
