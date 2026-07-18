package api

import (
	"io/fs"
	"testing/fstest"

	"github.com/gin-gonic/gin"
)

func MountFrontendForTest(r *gin.Engine) error {
	assets := fstest.MapFS{
		"index.html": &fstest.MapFile{Data: []byte("<html><body>dmox test shell</body></html>")},
	}
	MountFrontend(r, fs.FS(assets))
	return nil
}
