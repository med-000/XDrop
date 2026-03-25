package main

import (
	"github.com/gin-gonic/gin"
	"github.com/med-000/xdrop/internal/server"
)

func main(){
	r := gin.Default()
	server.Server(r)
	r.Run()
}