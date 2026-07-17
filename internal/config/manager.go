package config

import (
	"log"
	"path/filepath"
	"sync"

	"github.com/fsnotify/fsnotify"
)

type Manager struct {
	mu      sync.RWMutex
	cfg     *Config
	path    string
	watcher *fsnotify.Watcher
	subsMu  sync.Mutex
	subs    []chan *Config
}

func NewManager(path string) (*Manager, error) {
	cfg, err := Load(path)
	if err != nil {
		return nil, err
	}
	absDir, err := filepath.Abs(filepath.Dir(path))
	if err != nil {
		return nil, err
	}
	w, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}
	if err := w.Add(absDir); err != nil {
		w.Close()
		return nil, err
	}
	m := &Manager{cfg: cfg, path: path, watcher: w}
	go m.watchLoop()
	return m, nil
}

func (m *Manager) Get() *Config {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.cfg
}

func (m *Manager) Subscribe() <-chan *Config {
	ch := make(chan *Config, 1)
	m.subsMu.Lock()
	m.subs = append(m.subs, ch)
	m.subsMu.Unlock()
	return ch
}

func (m *Manager) watchLoop() {
	target, _ := filepath.Abs(m.path)
	for event := range m.watcher.Events {
		evPath, _ := filepath.Abs(event.Name)
		if evPath != target {
			continue
		}
		if event.Op&(fsnotify.Write|fsnotify.Create) == 0 {
			continue
		}
		cfg, err := Load(m.path)
		if err != nil {
			log.Printf("config: reload failed, keeping previous config: %v", err)
			continue
		}
		m.mu.Lock()
		m.cfg = cfg
		m.mu.Unlock()
		m.subsMu.Lock()
		for _, ch := range m.subs {
			select {
			case ch <- cfg:
			default:
			}
		}
		m.subsMu.Unlock()
	}
}

func (m *Manager) Close() error {
	return m.watcher.Close()
}
