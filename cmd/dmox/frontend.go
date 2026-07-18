package main

import (
	"github.com/gin-gonic/gin"
	"github.com/tuannm99/dmox/internal/api"
	"github.com/tuannm99/dmox/internal/webassets"
)

func mountFrontend(r *gin.Engine) error {
	assets, err := webassets.FS()
	if err != nil {
		return err
	}
	api.MountFrontend(r, assets)
	return nil
}
