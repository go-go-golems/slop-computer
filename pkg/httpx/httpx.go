// Package httpx has small JSON helpers for handlers.
package httpx

import (
	"encoding/json"
	"io"
	"net/http"
)

// JSON writes v with a status.
func JSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(v)
}

// Fail writes {"error": {"code", "message"}}.
func Fail(w http.ResponseWriter, status int, code, message string) {
	JSON(w, status, map[string]any{"error": map[string]any{"code": code, "message": message}})
}

// Read decodes a JSON body of at most limit bytes.
func Read(r *http.Request, v any, limit int64) error {
	dec := json.NewDecoder(io.LimitReader(r.Body, limit))
	dec.UseNumber()
	return dec.Decode(v)
}
