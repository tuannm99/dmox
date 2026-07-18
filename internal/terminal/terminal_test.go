package terminal

import (
	"os"
	"strings"
	"testing"
	"time"
)

func TestSession_RunsCommandInCwd(t *testing.T) {
	dir := t.TempDir()
	os.Setenv("SHELL", "/bin/bash")

	sess, err := Start(dir)
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	defer sess.Close()

	if _, err := sess.Write([]byte("pwd\n")); err != nil {
		t.Fatalf("Write: %v", err)
	}

	got := readUntil(t, sess, dir, 3*time.Second)
	if !strings.Contains(got, dir) {
		t.Fatalf("expected output to contain cwd %q, got: %q", dir, got)
	}
}

func TestSession_Resize(t *testing.T) {
	dir := t.TempDir()
	os.Setenv("SHELL", "/bin/bash")

	sess, err := Start(dir)
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	defer sess.Close()

	if err := sess.Resize(40, 120); err != nil {
		t.Fatalf("Resize: %v", err)
	}
}

func readUntil(t *testing.T, sess *Session, substr string, timeout time.Duration) string {
	t.Helper()
	done := make(chan string, 1)
	go func() {
		var out strings.Builder
		buf := make([]byte, 4096)
		for {
			n, err := sess.Read(buf)
			if n > 0 {
				out.Write(buf[:n])
				if strings.Contains(out.String(), substr) {
					done <- out.String()
					return
				}
			}
			if err != nil {
				done <- out.String()
				return
			}
		}
	}()
	select {
	case out := <-done:
		return out
	case <-time.After(timeout):
		t.Fatalf("timed out waiting for output containing %q", substr)
		return ""
	}
}
