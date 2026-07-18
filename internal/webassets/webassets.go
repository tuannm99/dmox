package webassets

import (
	"embed"
	"io/fs"
)

//go:embed all:dist
var distFS embed.FS

func FS() (fs.FS, error) {
	return fs.Sub(distFS, "dist")
}
