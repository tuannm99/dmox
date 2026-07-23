package config

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"gopkg.in/yaml.v3"
)

type Config struct {
	Workspaces []Workspace      `yaml:"workspaces"`
	Embeddings EmbeddingsConfig `yaml:"embeddings"`
	Render     RenderConfig     `yaml:"render"`
	Server     ServerConfig     `yaml:"server"`
	DataDir    string           `yaml:"data_dir"`
	// WorkspaceRoot is the base directory that relative local-source paths
	// resolve against, decoupling them from the process working dir (which
	// under Docker is WORKDIR /app, forcing a hand-written mount per source).
	// The DMOX_WORKSPACE_ROOT env var overrides this so one config.yaml works
	// unchanged on the host and in the container. Empty means "resolve against
	// the working dir", the original behaviour.
	WorkspaceRoot string            `yaml:"workspace_root"`
	Keymap        map[string]string `yaml:"keymap"`
}

type Workspace struct {
	ID      string   `yaml:"id"`
	Name    string   `yaml:"name"`
	Sources []Source `yaml:"sources"`
}

type Source struct {
	ID         string           `yaml:"id"`
	Type       string           `yaml:"type"` // "local" | "git"
	Path       string           `yaml:"path,omitempty"`
	URL        string           `yaml:"url,omitempty"`
	Branch     string           `yaml:"branch,omitempty"`
	Embeddings SourceEmbeddings `yaml:"embeddings"`
}

type SourceEmbeddings struct {
	Enabled bool `yaml:"enabled"`
}

type EmbeddingsConfig struct {
	Provider  string `yaml:"provider"` // "none" | "openai"
	APIKeyEnv string `yaml:"api_key_env"`
	Model     string `yaml:"model"`
}

type RenderConfig struct {
	PlantUML PlantUMLConfig `yaml:"plantuml"`
}

type PlantUMLConfig struct {
	JarPath string `yaml:"jar_path"`
}

type ServerConfig struct {
	Addr string `yaml:"addr"`
}

func Load(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read config %s: %w", path, err)
	}
	var cfg Config
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("parse config %s: %w", path, err)
	}
	cfg.applyDefaults()
	if err := cfg.validate(); err != nil {
		return nil, fmt.Errorf("invalid config: %w", err)
	}
	return &cfg, nil
}

func (c *Config) applyDefaults() {
	if c.Server.Addr == "" {
		c.Server.Addr = ":8080"
	}
	if c.Embeddings.Provider == "" {
		c.Embeddings.Provider = "none"
	}
	if c.DataDir == "" {
		home, err := os.UserHomeDir()
		if err == nil {
			c.DataDir = home + "/.dmox"
		} else {
			c.DataDir = ".dmox"
		}
	}
	c.DataDir = expandHome(c.DataDir)

	// DMOX_WORKSPACE_ROOT overrides the file's workspace_root so the same
	// config.yaml resolves correctly on the host and inside the container.
	root := c.WorkspaceRoot
	if env := os.Getenv("DMOX_WORKSPACE_ROOT"); env != "" {
		root = env
	}
	root = expandHome(root)

	for wi := range c.Workspaces {
		for si := range c.Workspaces[wi].Sources {
			s := &c.Workspaces[wi].Sources[si]
			if s.Type == "git" && s.Branch == "" {
				s.Branch = "main"
			}
			// Anchor a relative local path to the workspace root; absolute
			// paths (and every path when no root is set) are left untouched.
			if s.Type == "local" && root != "" && s.Path != "" && !filepath.IsAbs(s.Path) {
				s.Path = filepath.Join(root, s.Path)
			}
		}
	}
}

// expandHome expands a leading "~" or "~/" in path to the user's home
// directory. Paths that don't start with "~" are returned unchanged.
func expandHome(path string) string {
	if path == "~" {
		home, err := os.UserHomeDir()
		if err != nil {
			return path
		}
		return home
	}
	if strings.HasPrefix(path, "~/") {
		home, err := os.UserHomeDir()
		if err != nil {
			return path
		}
		return filepath.Join(home, path[2:])
	}
	return path
}

func (c *Config) validate() error {
	seenWS := map[string]bool{}
	if len(c.Workspaces) == 0 {
		return fmt.Errorf("at least one workspace is required")
	}
	for _, w := range c.Workspaces {
		if w.ID == "" {
			return fmt.Errorf("workspace missing id")
		}
		if seenWS[w.ID] {
			return fmt.Errorf("duplicate workspace id %q", w.ID)
		}
		seenWS[w.ID] = true

		seenSrc := map[string]bool{}
		if len(w.Sources) == 0 {
			return fmt.Errorf("workspace %q has no sources", w.ID)
		}
		for _, s := range w.Sources {
			if s.ID == "" {
				return fmt.Errorf("workspace %q: source missing id", w.ID)
			}
			if seenSrc[s.ID] {
				return fmt.Errorf("workspace %q: duplicate source id %q", w.ID, s.ID)
			}
			seenSrc[s.ID] = true
			switch s.Type {
			case "local":
				if s.Path == "" {
					return fmt.Errorf("workspace %q source %q: local source requires path", w.ID, s.ID)
				}
			case "git":
				if s.URL == "" {
					return fmt.Errorf("workspace %q source %q: git source requires url", w.ID, s.ID)
				}
			default:
				return fmt.Errorf("workspace %q source %q: unknown type %q", w.ID, s.ID, s.Type)
			}
		}
	}
	if c.Embeddings.Provider != "none" && c.Embeddings.Provider != "openai" {
		return fmt.Errorf("unknown embeddings provider %q", c.Embeddings.Provider)
	}
	return nil
}
