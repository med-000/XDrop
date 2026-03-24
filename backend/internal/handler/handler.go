package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

func WsServer(c *gin.Context) {
	roomId := c.Param("roomId")
	c.String(http.StatusOK,"Request %s",roomId)
}