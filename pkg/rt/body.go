package rt

import (
	"bytes"
	"encoding/json"
	"errors"
)

// ErrBody is a document body the contract refuses: not a JSON object, over
// 256 KiB serialized or deeper than 32 levels.
var ErrBody = errors.New("a document body is a JSON object of at most 256 KiB and 32 levels")

// ParseBody checks a document body and decodes it.
func ParseBody(raw []byte) (map[string]any, error) {
	if len(raw) > MaxDocBytes {
		return nil, ErrBody
	}
	var body map[string]any
	dec := json.NewDecoder(bytes.NewReader(raw))
	if err := dec.Decode(&body); err != nil || body == nil || dec.More() {
		return nil, ErrBody
	}
	if Depth(body) > MaxDocDepth {
		return nil, ErrBody
	}
	return body, nil
}

// EncodeBody serializes a body and checks the size limit.
func EncodeBody(body map[string]any) ([]byte, error) {
	raw, err := json.Marshal(body)
	if err != nil || len(raw) > MaxDocBytes || Depth(body) > MaxDocDepth {
		return nil, ErrBody
	}
	return raw, nil
}

// Depth is the nesting depth of a JSON value: a scalar is 0, {} is 1.
func Depth(v any) int {
	d := 0
	switch x := v.(type) {
	case map[string]any:
		for _, e := range x {
			d = max(d, Depth(e))
		}
		return d + 1
	case []any:
		for _, e := range x {
			d = max(d, Depth(e))
		}
		return d + 1
	}
	return 0
}

// Merge is the contract's update: nested objects merge recursively,
// anything else (arrays included) replaces the field. cur is not modified.
func Merge(cur, patch map[string]any) map[string]any {
	out := make(map[string]any, len(cur)+len(patch))
	for k, v := range cur {
		out[k] = v
	}
	for k, v := range patch {
		if pv, ok := v.(map[string]any); ok {
			if cv, ok := out[k].(map[string]any); ok {
				out[k] = Merge(cv, pv)
				continue
			}
		}
		out[k] = v
	}
	return out
}
