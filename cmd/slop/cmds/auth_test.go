package cmds

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/go-go-golems/slop-computer/pkg/client"
)

// A device login waits through a server that does not answer (a deploy: the
// ingress says 503) and stops on a real refusal (SLOP-013).
func TestPollDeviceWaitsThroughRestarts(t *testing.T) {
	devicePollFloor = time.Millisecond
	defer func() { devicePollFloor = time.Second }()

	poll := func(answer func(n int32, w http.ResponseWriter), expiresIn int) (client.DeviceToken, error) {
		var n atomic.Int32
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path != "/api/device/token" {
				http.NotFound(w, r)
				return
			}
			answer(n.Add(1), w)
		}))
		defer srv.Close()
		return pollDevice(context.Background(), client.New(srv.URL, ""), client.DeviceCode{DeviceCode: "sdc_x", ExpiresIn: expiresIn})
	}
	fail := func(w http.ResponseWriter, status int, body string) {
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}

	tok, err := poll(func(n int32, w http.ResponseWriter) {
		switch {
		case n <= 2:
			fail(w, 503, "no available server")
		case n == 3:
			fail(w, 429, `{"error":{"code":"rate_limited","message":"Too many polls"}}`)
		case n == 4:
			fail(w, 400, `{"error":{"code":"authorization_pending","message":"waiting"}}`)
		default:
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"token":"slp_ok"}`))
		}
	}, 60)
	if err != nil || tok.Token != "slp_ok" {
		t.Fatalf("through 503 and 429: %+v %v", tok, err)
	}

	_, err = poll(func(_ int32, w http.ResponseWriter) {
		fail(w, 403, `{"error":{"code":"forbidden","message":"no"}}`)
	}, 60)
	if !client.IsCode(err, "forbidden") {
		t.Fatalf("a refusal stops the wait: %v", err)
	}

	_, err = poll(func(_ int32, w http.ResponseWriter) { fail(w, 503, "no available server") }, 0)
	if err == nil || !strings.Contains(err.Error(), "the code expired") {
		t.Fatalf("still down at the deadline: %v", err)
	}
}
