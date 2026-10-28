// Copied from github.com/go-go-golems/francois@106776a pkg/catalog/client/errors.go.
package client

import (
	"encoding/json"
	"errors"
	"strconv"
	"strings"
)

// Check is one validation finding on a release.
type Check struct {
	Code    string `json:"code"`
	Level   string `json:"level"`
	Message string `json:"message"`
}

// Error is an API error: the server's {"error":{"code","message"}} envelope.
// Code is the stable contract; Message is for people.
type Error struct {
	Status  int
	Code    string
	Message string
	Checks  []Check // release uploads only
}

func (e *Error) Error() string { return e.Code + ": " + e.Message }

// IsCode reports whether err is an API error with this code.
func IsCode(err error, code string) bool {
	var e *Error
	return errors.As(err, &e) && e.Code == code
}

// IsNotFound reports whether err is an API 404.
func IsNotFound(err error) bool {
	var e *Error
	return errors.As(err, &e) && e.Status == 404
}

func decodeError(status int, raw []byte) error {
	var f struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
		Checks []Check `json:"checks"`
	}
	_ = json.Unmarshal(raw, &f)
	if f.Error.Code == "" {
		f.Error.Code, f.Error.Message = "http_"+strconv.Itoa(status), strings.TrimSpace(string(raw))
	}
	return &Error{Status: status, Code: f.Error.Code, Message: f.Error.Message, Checks: f.Checks}
}
