package embedprovider

import (
	"context"
	"errors"
)

type Provider interface {
	Embed(ctx context.Context, texts []string) ([][]float32, error)
	Dimensions() int
}

type NoopProvider struct{}

func (NoopProvider) Embed(ctx context.Context, texts []string) ([][]float32, error) {
	return nil, errors.New("embeddings disabled")
}
func (NoopProvider) Dimensions() int { return 0 }
