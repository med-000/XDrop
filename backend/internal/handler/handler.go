package handler

import (
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/med-000/xdrop/internal/model"
)

var rooms = map[string][]*model.Client{}

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
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
		clients := rooms[roomId]
        newClients := []*model.Client{}
    
        for _, c := range clients {
          if c.Conn != conn {
            newClients = append(newClients, c)
          }
        }
    
        if len(newClients) == 0 {
          delete(rooms, roomId)
        } else {
          rooms[roomId] = newClients
        }
    
        fmt.Println("closed & removed from room:", roomId)
	}()

	client := &model.Client{
		ID:   uuid.New().String(),
		Conn: conn,
		RoomId: roomId,
	}

	//二人以上入ってきたら強制切断
	if len(rooms[roomId]) >= 2 {
		conn.Close()
		fmt.Println("Invalid connection: Only two users are allowed.")
		return
	}
	//roomにclientを追加
	rooms[roomId] = append(rooms[roomId], client)

	
	//最初に役割を割り振る
	if len(rooms[roomId]) == 1 {
	    // 1人目 → offer役
	    conn.WriteJSON(map[string]string{
	        "type": "role",
	        "role": "offer",
	    })
	} else {
	    // 2人目 → answer役
	    conn.WriteJSON(map[string]string{
	        "type": "role",
	        "role": "answer",
	    })
	}
	if len(rooms[roomId]) == 2 {
	  // 2人揃ったら両方に通知
	  for _, c := range rooms[roomId] {
	    c.Conn.WriteJSON(map[string]string{
	      "type": "ready",
	    })
	  }
	}

	for{
		_,msg, err := conn.ReadMessage()
		if err != nil {
			fmt.Println("Read Message Error:",err)
			break
		}


		//roomIdの中の数だけ実行
		for _, c := range rooms[roomId] {
			//入ってきた人の処理
			if c.Conn != conn {
				fmt.Println("send:",c.ID,string(msg))
			}
			//入ってきた人じゃなければ入ってきてない人にmessageを送る
			if c.Conn != conn {
				c.Conn.WriteMessage(websocket.TextMessage,msg)
				fmt.Println("recv:",c.ID,string(msg))
			}
		}
	}
}