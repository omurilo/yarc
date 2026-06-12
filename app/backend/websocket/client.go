package websocket

type Message struct {
	Direction string `json:"direction"`
	Payload   string `json:"payload"`
	Time      string `json:"time"`
}
