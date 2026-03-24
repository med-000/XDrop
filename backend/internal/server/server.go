package server

import (
	"github.com/gin-gonic/gin"
	"github.com/med-000/xdrop/internal/handler"
)


func Server(r *gin.Engine){
	r.GET("/ws/:roomId",handler.WsServer)
}