package api

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/tuannm99/dmox/internal/app"
)

func handleKeymap(a *app.App) gin.HandlerFunc {
	return func(c *gin.Context) {
		overrides := a.Cfg.Keymap
		if overrides == nil {
			overrides = map[string]string{}
		}
		c.JSON(http.StatusOK, overrides)
	}
}
