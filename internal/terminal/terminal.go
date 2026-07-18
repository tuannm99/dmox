// Package terminal spawns a real PTY-backed shell for the in-browser
// terminal feature. This is a local-first, no-auth capability: dmox serve is
// expected to run on localhost only (see README) — a PTY exposed over HTTP
// is a genuine remote-code-execution surface if the server is ever exposed
// beyond localhost.
package terminal

import (
	"os"
	"os/exec"

	"github.com/creack/pty"
)

type Session struct {
	cmd *exec.Cmd
	pty *os.File
}

// Start spawns the user's shell (from $SHELL, falling back to /bin/bash)
// as an interactive PTY session rooted at cwd.
func Start(cwd string) (*Session, error) {
	shell := os.Getenv("SHELL")
	if shell == "" {
		shell = "/bin/bash"
	}
	cmd := exec.Command(shell)
	cmd.Dir = cwd
	cmd.Env = append(os.Environ(), "TERM=xterm-256color")

	f, err := pty.Start(cmd)
	if err != nil {
		return nil, err
	}
	return &Session{cmd: cmd, pty: f}, nil
}

func (s *Session) Read(p []byte) (int, error)  { return s.pty.Read(p) }
func (s *Session) Write(p []byte) (int, error) { return s.pty.Write(p) }

func (s *Session) Resize(rows, cols uint16) error {
	return pty.Setsize(s.pty, &pty.Winsize{Rows: rows, Cols: cols})
}

func (s *Session) Close() error {
	_ = s.pty.Close()
	if s.cmd.Process != nil {
		_ = s.cmd.Process.Kill()
	}
	return s.cmd.Wait()
}
