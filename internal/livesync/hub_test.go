package livesync

import "testing"

func TestHub_PublishDeliversToSubscriber(t *testing.T) {
	h := NewHub()
	ch, cancel := h.Subscribe("ws")
	defer cancel()

	h.Publish("ws", Event{SourceID: "local", Path: "guide.md", Op: "modify"})

	select {
	case ev := <-ch:
		if ev.SourceID != "local" || ev.Path != "guide.md" || ev.Op != "modify" {
			t.Fatalf("event = %+v", ev)
		}
	default:
		t.Fatal("expected event to be delivered synchronously (buffered channel)")
	}
}

func TestHub_PublishDoesNotCrossWorkspaces(t *testing.T) {
	h := NewHub()
	chA, cancelA := h.Subscribe("a")
	defer cancelA()
	chB, cancelB := h.Subscribe("b")
	defer cancelB()

	h.Publish("a", Event{SourceID: "local", Path: "x.md", Op: "modify"})

	select {
	case <-chA:
	default:
		t.Fatal("expected workspace a to receive its event")
	}
	select {
	case ev := <-chB:
		t.Fatalf("workspace b should not receive workspace a's event, got %+v", ev)
	default:
	}
}

func TestHub_MultipleSubscribersAllReceive(t *testing.T) {
	h := NewHub()
	ch1, cancel1 := h.Subscribe("ws")
	defer cancel1()
	ch2, cancel2 := h.Subscribe("ws")
	defer cancel2()

	h.Publish("ws", Event{SourceID: "local", Path: "x.md", Op: "create"})

	for _, ch := range []<-chan Event{ch1, ch2} {
		select {
		case <-ch:
		default:
			t.Fatal("expected all subscribers to receive the event")
		}
	}
}

func TestHub_CancelStopsDelivery(t *testing.T) {
	h := NewHub()
	ch, cancel := h.Subscribe("ws")
	cancel()

	h.Publish("ws", Event{SourceID: "local", Path: "x.md", Op: "delete"})

	select {
	case ev, ok := <-ch:
		if ok {
			t.Fatalf("expected no event after cancel, got %+v", ev)
		}
	default:
	}
}

func TestHub_SlowSubscriberDropsOldestRatherThanBlocking(t *testing.T) {
	h := NewHub()
	ch, cancel := h.Subscribe("ws")
	defer cancel()

	// Publish more than the internal buffer (16) without draining.
	for i := 0; i < 17; i++ {
		h.Publish("ws", Event{SourceID: "local", Path: itoaPath(i), Op: "modify"})
	}

	var got []Event
	for {
		select {
		case ev := <-ch:
			got = append(got, ev)
		default:
			goto done
		}
	}
done:
	if len(got) != 16 {
		t.Fatalf("buffered event count = %d, want 16", len(got))
	}
	if got[0].Path != itoaPath(1) {
		t.Fatalf("oldest retained event = %q, want %q (event 0 should have been dropped)", got[0].Path, itoaPath(1))
	}
	if got[15].Path != itoaPath(16) {
		t.Fatalf("newest retained event = %q, want %q", got[15].Path, itoaPath(16))
	}
}

func itoaPath(i int) string {
	digits := "0123456789"
	if i < 10 {
		return string(digits[i]) + ".md"
	}
	return string(digits[i/10]) + string(digits[i%10]) + ".md"
}
