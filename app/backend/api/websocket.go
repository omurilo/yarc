package api

import (
	"context"
	"net/http"
	"time"

	"github.com/coder/websocket"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// wsConn holds a live WebSocket connection and the cancel func for its read loop.
type wsConn struct {
	conn   *websocket.Conn
	cancel context.CancelFunc
}

// OpenWebSocket dials a WebSocket and streams its lifecycle to the frontend via Wails events:
// "yarc:ws:<id>:open", ":message" (each inbound frame), ":close", ":error". Returns an error
// string (empty on a successful handshake). Custom headers are supported (the browser's native
// WebSocket cannot set them), which is the reason to route through the backend.
func (s *AppService) OpenWebSocket(connID string, url string, headers []Header) string {
	app := application.Get()
	emit := func(suffix string, data any) {
		if app != nil {
			app.Event.Emit("yarc:ws:"+connID+":"+suffix, data)
		}
	}

	header := http.Header{}
	for _, h := range headers {
		if h.Enabled && h.Key != "" {
			header.Add(h.Key, h.Value)
		}
	}

	dialCtx, dialCancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer dialCancel()
	conn, resp, err := websocket.Dial(dialCtx, url, &websocket.DialOptions{HTTPHeader: header})
	if err != nil {
		return err.Error()
	}
	conn.SetReadLimit(10 << 20) // 10 MiB frames

	status := ""
	if resp != nil {
		status = resp.Status
	}

	readCtx, cancel := context.WithCancel(context.Background())
	s.wsConns.Store(connID, &wsConn{conn: conn, cancel: cancel})
	emit("open", map[string]any{"status": status})

	go func() {
		defer s.wsConns.Delete(connID)
		for {
			_, data, readErr := conn.Read(readCtx)
			if readErr != nil {
				if readCtx.Err() != nil {
					emit("close", map[string]any{"reason": "closed"})
				} else {
					emit("close", map[string]any{"reason": readErr.Error()})
				}
				return
			}
			emit("message", string(data))
		}
	}()

	return ""
}

// SendWebSocket writes a text frame to an open connection. Returns an error string.
func (s *AppService) SendWebSocket(connID string, payload string) string {
	value, ok := s.wsConns.Load(connID)
	if !ok {
		return "connection is not open"
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := value.(*wsConn).conn.Write(ctx, websocket.MessageText, []byte(payload)); err != nil {
		return err.Error()
	}
	return ""
}

// CloseWebSocket closes an open connection and stops its read loop.
func (s *AppService) CloseWebSocket(connID string) {
	if value, ok := s.wsConns.Load(connID); ok {
		c := value.(*wsConn)
		c.cancel()
		_ = c.conn.Close(websocket.StatusNormalClosure, "")
	}
}
