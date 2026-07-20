package livesync

import "sync"

// Event is a single filesystem change, already reindexed, ready to notify
// UI clients about. Op is one of "create", "modify", "delete".
type Event struct {
	SourceID string `json:"sourceId"`
	Path     string `json:"path"`
	Op       string `json:"op"`
}

const subscriberBuffer = 16

// Hub is an in-memory, per-process pub/sub of Events keyed by workspace ID.
// It has no durability: a subscriber that isn't connected when Publish runs
// simply misses that event. Callers needing to recover from gaps (e.g. after
// a dropped SSE connection) resync by refetching current state instead.
type Hub struct {
	mu   sync.Mutex
	subs map[string]map[chan Event]struct{}
}

func NewHub() *Hub {
	return &Hub{subs: make(map[string]map[chan Event]struct{})}
}

// Publish fans ev out to every subscriber of workspaceID. A subscriber whose
// buffer is full has its oldest pending event dropped to make room, rather
// than blocking this call — the resync-on-reconnect path in the SSE handler
// covers gaps this can create.
func (h *Hub) Publish(workspaceID string, ev Event) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for ch := range h.subs[workspaceID] {
		select {
		case ch <- ev:
		default:
			select {
			case <-ch:
			default:
			}
			select {
			case ch <- ev:
			default:
			}
		}
	}
}

// Subscribe registers a new listener for workspaceID. The returned cancel
// func must be called (typically via defer) to unregister it; failing to
// call it leaks the channel's map entry for the lifetime of the process.
func (h *Hub) Subscribe(workspaceID string) (<-chan Event, func()) {
	ch := make(chan Event, subscriberBuffer)

	h.mu.Lock()
	if h.subs[workspaceID] == nil {
		h.subs[workspaceID] = make(map[chan Event]struct{})
	}
	h.subs[workspaceID][ch] = struct{}{}
	h.mu.Unlock()

	cancel := func() {
		h.mu.Lock()
		delete(h.subs[workspaceID], ch)
		if len(h.subs[workspaceID]) == 0 {
			delete(h.subs, workspaceID)
		}
		h.mu.Unlock()
	}
	return ch, cancel
}
