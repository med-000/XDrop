package model

import "github.com/gorilla/websocket"

type Client struct {
	ID string
	Conn *websocket.Conn
	RoomId string
}