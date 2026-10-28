// Copied from github.com/go-go-golems/francois@106776a pkg/catalog/httpx/httpx.go.
// Package httpx holds slop's JSON request/response conventions.
package httpx

import (
	"encoding/json"
	"io"
	"net/http"

	"github.com/pkg/errors"
)

type Failure struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Text    string `json:"text,omitempty"`
}

// JSON writes v with private, non-cacheable headers.
func JSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func OK(w http.ResponseWriter, v any) { JSON(w, http.StatusOK, v) }

// Fail writes the uniform {"error":{"code","message"}} shape.
func Fail(w http.ResponseWriter, status int, code, message string) {
	JSON(w, status, map[string]any{"error": Failure{Code: code, Message: message}})
}

// Read decodes exactly one bounded JSON value.
func Read(w http.ResponseWriter, r *http.Request, dst any, limit int64) error {
	r.Body = http.MaxBytesReader(w, r.Body, limit)
	d := json.NewDecoder(r.Body)
	if err := d.Decode(dst); err != nil {
		return errors.Wrap(err, "invalid JSON body")
	}
	var more any
	if d.Decode(&more) != io.EOF {
		return errors.New("expected one JSON value")
	}
	return nil
}
