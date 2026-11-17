package client

// The dev loop from a terminal (SLOP3-022 C.5, `slop dev`): push a folder to
// an app's draft ref whenever it changes, bring the person's dev instance of
// the app up on each new snapshot, and say how that went, with the
// instance's new log lines. Production keeps running main; publishing is
// `slop ref move <app> main <n>`.

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// DevOptions configure Dev.
type DevOptions struct {
	App      string        // the app store
	Instance string        // the dev instance (default DevInstanceID(App, you))
	Every    time.Duration // how often the folder is looked at (default 500ms)
	Once     bool          // push once, report, and return
	Out      io.Writer
}

// DevInstanceID is a person's dev instance of an app: <app>-dev-<the first
// six characters of their id>, within a store id's 63 characters.
func DevInstanceID(app, person string) string {
	suf := strings.ToLower(strings.TrimPrefix(person, "usr_"))
	if len(suf) > 6 {
		suf = suf[:6]
	}
	tail := "-dev-" + suf
	if len(app)+len(tail) > 63 {
		app = app[:63-len(tail)]
	}
	return app + tail
}

// Dev runs the loop until ctx ends (or once, with o.Once).
func (c *Client) Dev(ctx context.Context, dir string, o DevOptions) error {
	if o.App == "" {
		return errors.New("which app? (--app)")
	}
	if o.Every <= 0 {
		o.Every = 500 * time.Millisecond
	}
	if o.Out == nil {
		o.Out = io.Discard
	}
	if o.Instance == "" {
		who, err := c.Call("whoami", map[string]any{})
		if err != nil {
			return err
		}
		id, _ := who.(map[string]any)["id"].(string)
		if id == "" {
			return errors.New("whoami: no id")
		}
		o.Instance = DevInstanceID(o.App, id)
	}
	stamp, err := folderStamp(dir)
	if err != nil {
		return err
	}
	// The first push makes draft exist; then the instance can follow it.
	n, printed, err := c.devPush(dir, o)
	if err != nil {
		return err
	}
	if err := c.devInstance(o, manifestType(dir)); err != nil {
		return err
	}
	if !printed { // the instance did not exist yet, or followed another ref
		st, err := c.Call("app.status", map[string]any{"store": o.Instance})
		if err != nil {
			return err
		}
		m, _ := st.(map[string]any)
		devLine(o, n, map[string]any{"n": m["n"], "broken": m["broken"]})
	}
	_, _ = fmt.Fprintf(o.Out, "dev instance %s follows %s@draft; publish with: slop ref move %s main %d\n", o.Instance, o.App, o.App, n)
	if o.Once {
		return nil
	}
	since := time.Now().UnixMilli()
	tick := time.NewTicker(o.Every)
	defer tick.Stop()
	// pending: the folder changed since the last push that went through. A
	// failed push stays pending and is retried after a backoff (1s, doubling
	// to 30s), or at once when the folder changes again; the same error is
	// printed once.
	pending, lastErr := false, ""
	var retryAt time.Time
	var backoff time.Duration
	for i := 0; ; i++ {
		select {
		case <-ctx.Done():
			return nil
		case <-tick.C:
		}
		pushed := false
		s, err := folderStamp(dir)
		switch {
		case err != nil:
			lastErr = devErr(o, lastErr, "reading "+dir, err)
		case s != stamp:
			stamp, pending, retryAt = s, true, time.Time{}
		}
		if pending && !time.Now().Before(retryAt) {
			if _, _, err := c.devPush(dir, o); err != nil {
				lastErr = devErr(o, lastErr, "push failed, will retry", err)
				backoff = min(max(2*backoff, time.Second), 30*time.Second)
				retryAt = time.Now().Add(backoff)
			} else {
				pending, pushed, lastErr, backoff = false, true, "", 0
			}
		}
		if pushed || i%4 == 0 { // the log about every 2 s, and right after a push
			since = c.devLogs(o, since)
		}
	}
}

// devErr prints what went wrong unless it is the error printed last, and
// returns the message to compare the next error with.
func devErr(o DevOptions, last, what string, err error) string {
	msg := what + ": " + err.Error()
	if msg != last {
		_, _ = fmt.Fprintln(o.Out, msg)
	}
	return msg
}

// manifestType is the type declared in the folder's app.json: the type a
// new dev instance gets, so the app's typed mounts serve it. The app store
// may have no main yet, so its own status cannot say.
func manifestType(dir string) string {
	b, err := os.ReadFile(filepath.Join(dir, "app.json"))
	if err != nil {
		return ""
	}
	var m struct {
		Type string `json:"type"`
	}
	_ = json.Unmarshal(b, &m)
	return m.Type
}

// devPush pushes the folder to draft, activating the instance, and prints
// the outcome when the instance follows draft; it returns the new snapshot
// and whether it printed. The folder replaces draft as it is when the push
// is made (Push reads it for ifAt): a write landing between that read and
// the push is a conflict, and the loop retries.
func (c *Client) devPush(dir string, o DevOptions) (int64, bool, error) {
	res, err := c.Push(o.App, dir, map[string]any{"ref": "draft", "message": "slop dev", "activate": []string{o.Instance}})
	if err != nil {
		return 0, false, err
	}
	m, _ := res.(map[string]any)
	n := toInt(m["n"])
	if acts, _ := m["activated"].([]any); len(acts) == 1 {
		if a, _ := acts[0].(map[string]any); a != nil && a["error"] == nil && a["ref"] == "draft" {
			devLine(o, n, a)
			return n, true, nil
		}
	}
	return n, false, nil
}

// devLine is one line per push: the draft snapshot, and where the instance is.
func devLine(o DevOptions, n int64, a map[string]any) {
	on := toInt(a["n"])
	b, _ := a["broken"].(string)
	switch {
	case b != "":
		_, _ = fmt.Fprintf(o.Out, "draft %d · %s stays on %d · broken: %s\n", n, o.Instance, on, b)
	case on != n:
		_, _ = fmt.Fprintf(o.Out, "draft %d · %s on %d\n", n, o.Instance, on)
	default:
		_, _ = fmt.Fprintf(o.Out, "draft %d · %s on %d · ok\n", n, o.Instance, on)
	}
}

// devInstance makes sure the dev instance exists (of type typ when it is
// made), runs the app, and follows draft.
func (c *Client) devInstance(o DevOptions, typ string) error {
	st, err := c.Call("app.status", map[string]any{"store": o.Instance})
	var ae *APIError
	if errors.As(err, &ae) && ae.Code == "not_found" {
		if _, err := c.Call("store.new", map[string]any{"id": o.Instance, "app": o.App, "type": typ}); err != nil {
			return err
		}
		_, _ = fmt.Fprintf(o.Out, "made dev instance %s (runs %s)\n", o.Instance, o.App)
		_, err = c.Call("app.follow", map[string]any{"store": o.Instance, "ref": "draft"})
		return err
	}
	if err != nil {
		return err
	}
	m, _ := st.(map[string]any)
	if app, _ := m["app"].(string); app != o.App {
		return fmt.Errorf("%s runs %s, not %s: pass --instance", o.Instance, app, o.App)
	}
	if ref, _ := m["ref"].(string); ref != "draft" {
		_, err = c.Call("app.follow", map[string]any{"store": o.Instance, "ref": "draft"})
	}
	return err
}

// devLogs prints the instance's log lines newer than since and returns the
// newest time printed.
func (c *Client) devLogs(o DevOptions, since int64) int64 {
	res, err := c.Call("app.logs", map[string]any{"store": o.Instance})
	if err != nil {
		return since
	}
	lines, _ := res.(map[string]any)["lines"].([]any)
	newest := since
	for _, l := range lines {
		m, _ := l.(map[string]any)
		at := toInt(m["at"])
		if at <= since {
			continue
		}
		_, _ = fmt.Fprintf(o.Out, "  log %-5v %v\n", m["level"], m["text"])
		if at > newest {
			newest = at
		}
	}
	return newest
}

// folderStamp is a hash of what ReadDir would push (paths, sizes and
// modification times), cheap enough to take twice a second.
func folderStamp(dir string) (string, error) {
	h := sha256.New()
	err := filepath.WalkDir(dir, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if p != dir && strings.HasPrefix(d.Name(), ".") {
			if d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if d.IsDir() || !d.Type().IsRegular() {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return err
		}
		_, _ = fmt.Fprintf(h, "%s\x00%d\x00%d\n", p, info.Size(), info.ModTime().UnixNano())
		return nil
	})
	return hex.EncodeToString(h.Sum(nil)), err
}

// toInt reads a number from a decoded answer (the client decodes numbers
// as json.Number).
func toInt(v any) int64 {
	switch x := v.(type) {
	case json.Number:
		n, _ := x.Int64()
		return n
	case float64:
		return int64(x)
	case int64:
		return x
	case int:
		return int64(x)
	}
	return 0
}
