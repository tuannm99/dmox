package source

import (
	"context"
	"fmt"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/fsnotify/fsnotify"
)

type LocalSource struct {
	id   string
	root string
}

func NewLocalSource(id, root string) *LocalSource {
	return &LocalSource{id: id, root: filepath.Clean(root)}
}

func (s *LocalSource) ID() string        { return s.id }
func (s *LocalSource) SupportsGit() bool { return false }
func (s *LocalSource) Root() string      { return s.root }

func (s *LocalSource) Sync(ctx context.Context) error {
	info, err := os.Stat(s.root)
	if err != nil {
		return fmt.Errorf("local source %s: %w", s.id, err)
	}
	if !info.IsDir() {
		return fmt.Errorf("local source %s: %s is not a directory", s.id, s.root)
	}
	return nil
}

func (s *LocalSource) List(ctx context.Context) ([]FileInfo, error) {
	var files []FileInfo
	err := filepath.WalkDir(s.root, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			if strings.HasPrefix(d.Name(), ".") && p != s.root {
				return filepath.SkipDir
			}
			return nil
		}
		if !isDocFile(d.Name()) {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(s.root, p)
		if err != nil {
			return err
		}
		files = append(files, FileInfo{Path: filepath.ToSlash(rel), ModTime: info.ModTime(), Size: info.Size()})
		return nil
	})
	return files, err
}

func (s *LocalSource) Read(ctx context.Context, path string) ([]byte, error) {
	full, err := s.resolve(path)
	if err != nil {
		return nil, err
	}
	return os.ReadFile(full)
}

func (s *LocalSource) resolve(path string) (string, error) {
	full := filepath.Join(s.root, filepath.FromSlash(path))
	rel, err := filepath.Rel(s.root, full)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("path %q escapes source root", path)
	}
	return full, nil
}

func (s *LocalSource) Watch(ctx context.Context) (<-chan ChangeEvent, error) {
	w, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}
	if err := addRecursive(w, s.root); err != nil {
		w.Close()
		return nil, err
	}
	out := make(chan ChangeEvent, 16)
	go debounceWatch(ctx, w, s.root, out)
	return out, nil
}

func addRecursive(w *fsnotify.Watcher, root string) error {
	return filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			if strings.HasPrefix(d.Name(), ".") && p != root {
				return filepath.SkipDir
			}
			return w.Add(p)
		}
		return nil
	})
}

func debounceWatch(ctx context.Context, w *fsnotify.Watcher, root string, out chan<- ChangeEvent) {
	defer w.Close()
	defer close(out)
	pending := map[string]ChangeOp{}
	timer := time.NewTimer(time.Hour)
	if !timer.Stop() {
		<-timer.C
	}
	flush := func() {
		for p, op := range pending {
			select {
			case out <- ChangeEvent{Path: p, Op: op}:
			case <-ctx.Done():
				return
			}
		}
		pending = map[string]ChangeOp{}
	}
	for {
		select {
		case <-ctx.Done():
			return
		case err, ok := <-w.Errors:
			if !ok {
				return
			}
			log.Printf("source: watcher error: %v", err)
		case ev, ok := <-w.Events:
			if !ok {
				return
			}
			rel, err := filepath.Rel(root, ev.Name)
			if err != nil {
				continue
			}
			rel = filepath.ToSlash(rel)
			switch {
			case ev.Op&(fsnotify.Remove|fsnotify.Rename) != 0:
				pending[rel] = ChangeOpDelete
			case ev.Op&fsnotify.Create != 0:
				pending[rel] = ChangeOpCreate
				if info, err := os.Stat(ev.Name); err == nil && info.IsDir() {
					_ = addRecursive(w, ev.Name)
				}
			case ev.Op&fsnotify.Write != 0:
				if _, exists := pending[rel]; !exists {
					pending[rel] = ChangeOpModify
				}
			default:
				continue
			}
			timer.Reset(300 * time.Millisecond)
		case <-timer.C:
			flush()
		}
	}
}

func extLower(name string) string {
	ext := filepath.Ext(name)
	out := make([]byte, len(ext))
	for i := 0; i < len(ext); i++ {
		c := ext[i]
		if c >= 'A' && c <= 'Z' {
			c += 'a' - 'A'
		}
		out[i] = c
	}
	return string(out)
}
