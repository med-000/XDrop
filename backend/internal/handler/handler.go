package handler

import (
	"fmt"
	"net/http"
	"sync"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/med-000/xdrop/internal/model"
)

var rooms = map[string][]*model.Client{}
var mu sync.Mutex

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

func syncRoom(clients []*model.Client) {
	fmt.Printf("syncRoom (%d users)\n", len(clients))

	if len(clients) == 0 {
		return
	}

	clients[0].Conn.WriteJSON(map[string]string{
		"type": "role",
		"role": "offer",
	})

	if len(clients) >= 2 {
		clients[1].Conn.WriteJSON(map[string]string{
			"type": "role",
			"role": "answer",
		})

		for _, c := range clients {
			c.Conn.WriteJSON(map[string]string{
				"type": "ready",
			})
		}
	}
}


func WsHandler(c *gin.Context) {
	roomId := c.Param("roomId")
	
	//ws/:roomIdが呼ばれたらwsにupgrade
	conn, err := upgrader.Upgrade(c.Writer,c.Request,nil)
	if err != nil {
		fmt.Println("WebSocket upgrade error:", err)
		return
	}
	fmt.Println("Connected:",roomId)


	//処理が終わったら接続切る
	//roomIDを消す
	defer func() {
		conn.Close()

		mu.Lock()

		clients := rooms[roomId]
        newClients := []*model.Client{}
    
        for _, c := range clients {
          if c.Conn != conn {
            newClients = append(newClients, c)
          }
        }

		var snapshot []*model.Client

    
        if len(newClients) == 0 {
          delete(rooms, roomId)
        } else {
          rooms[roomId] = newClients
		  snapshot = append([]*model.Client{}, newClients...)
        }

		mu.Unlock()
		if len(snapshot) > 0 {
			syncRoom(snapshot)
		}
    
        fmt.Println("closed & removed from room:", roomId)
	}()

	client := &model.Client{
		ID:   uuid.New().String(),
		Conn: conn,
		RoomId: roomId,
	}

	//二人以上入ってきたら強制切断
	mu.Lock()
	if len(rooms[roomId]) >= 2 {
		mu.Unlock()
		conn.Close()
		fmt.Println("Invalid connection: Only two users are allowed.")
		return
	}
	//roomにclientを追加
	rooms[roomId] = append(rooms[roomId], client)
	snapshot := append([]*model.Client{}, rooms[roomId]...)
	mu.Unlock()

	syncRoom(snapshot)

	for{
		_,msg, err := conn.ReadMessage()
		if err != nil {
			fmt.Println("Read Message Error:",err)
			break
		}

		mu.Lock()
		clients := append([]*model.Client{}, rooms[roomId]...)
		mu.Unlock()
		//roomIdの中の数だけ実行
		for _, c := range clients {
			//入ってきた人の処理
			if c.Conn != conn {
				fmt.Println("send:", c.ID, string(msg))
				c.Conn.WriteMessage(websocket.TextMessage, msg)
				fmt.Println("recv:", c.ID, string(msg))
			}
		}

	}
}