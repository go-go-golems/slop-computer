package actor

// use('fs') / require('fs') (SLOP3-012 phase 5b): go-go-goja's fs API over
// an in-memory tree the actor owns, never the host's disk. It is an own
// module: on by default, configured by a grant (maxBytes, maxFiles). The
// tree lives as long as the actor (a restart empties it) and follows the
// turn: what a turn that rolls back wrote is undone with it, as the store's
// writes are. Errors carry Node's codes (ENOENT, EEXIST, ENOTDIR, EISDIR,
// ENOTEMPTY, ENOSPC), as go-go-goja's do.

import (
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"maps"
	"path"
	"slices"
	"strings"
	"time"

	"github.com/dop251/goja"
)

// FSConfig configures the fs module.
type FSConfig struct {
	MaxBytes int `json:"maxBytes,omitempty"` // total file bytes (0: 8 MiB)
	MaxFiles int `json:"maxFiles,omitempty"` // files and directories (0: 1000)
}

const (
	fsDefaultBytes = 8 << 20
	fsDefaultFiles = 1000
)

// Validate checks an fs configuration.
func (c *FSConfig) Validate() error {
	if c.MaxBytes < 0 || c.MaxBytes > 64<<20 {
		return errors.New("maxBytes is between 0 (8 MiB) and 64 MiB")
	}
	if c.MaxFiles < 0 || c.MaxFiles > 10000 {
		return errors.New("maxFiles is between 0 (1000) and 10000")
	}
	return nil
}

type memFile struct {
	data  []byte // never changed in place: a write stores a new slice
	dir   bool
	mtime int64
}

// memFS is the tree: absolute clean paths to entries; "/" always exists.
type memFS struct {
	cfg   FSConfig
	nodes map[string]*memFile
	bytes int
	// snap is the tree as the current turn found it, taken at the turn's
	// first write; the turn's end keeps or restores it.
	snap      map[string]*memFile
	snapBytes int
	inTurn    func() bool
}

type fsError struct{ code, op, path string }

func (e *fsError) Error() string {
	msgs := map[string]string{"ENOENT": "no such file or directory", "EEXIST": "file already exists", "ENOTDIR": "not a directory",
		"EISDIR": "illegal operation on a directory", "ENOTEMPTY": "directory not empty", "ENOSPC": "the fs module's limit is reached", "EINVAL": "invalid argument"}
	return fmt.Sprintf("%s: %s, %s '%s'", e.code, msgs[e.code], e.op, e.path)
}

func fsErr(code, op, p string) error { return &fsError{code: code, op: op, path: p} }

func newMemFS(cfg FSConfig, inTurn func() bool) *memFS {
	if cfg.MaxBytes == 0 {
		cfg.MaxBytes = fsDefaultBytes
	}
	if cfg.MaxFiles == 0 {
		cfg.MaxFiles = fsDefaultFiles
	}
	return &memFS{cfg: cfg, nodes: map[string]*memFile{"/": {dir: true}}, inTurn: inTurn}
}

// fsPath makes p absolute and clean ("a/b" is "/a/b").
func fsPath(p string) (string, error) {
	if p == "" || strings.ContainsRune(p, 0) {
		return "", fsErr("EINVAL", "open", p)
	}
	return path.Clean("/" + p), nil
}

// touch records the tree before the turn's first change.
func (f *memFS) touch() {
	if f.snap == nil && f.inTurn() {
		f.snap, f.snapBytes = maps.Clone(f.nodes), f.bytes
	}
}

// end finishes a turn: keep what it wrote, or put the tree back.
func (f *memFS) end(ok bool) {
	if f == nil {
		return // the actor never used fs
	}
	if f.snap != nil && !ok {
		f.nodes, f.bytes = f.snap, f.snapBytes
	}
	f.snap = nil
}

// missing is the error for a path that is not in the tree: ENOTDIR when
// it runs through a file, as on a real filesystem, else ENOENT.
func (f *memFS) missing(op, p string) error {
	for d := path.Dir(p); d != "/"; d = path.Dir(d) {
		if n := f.nodes[d]; n != nil && !n.dir {
			return fsErr("ENOTDIR", op, p)
		}
	}
	return fsErr("ENOENT", op, p)
}

func (f *memFS) parentDir(op, p string) error {
	parent := f.nodes[path.Dir(p)]
	if parent == nil {
		return f.missing(op, p)
	}
	if !parent.dir {
		return fsErr("ENOTDIR", op, p)
	}
	return nil
}

func (f *memFS) read(p string) ([]byte, error) {
	n := f.nodes[p]
	if n == nil {
		return nil, f.missing("open", p)
	}
	if n.dir {
		return nil, fsErr("EISDIR", "read", p)
	}
	return n.data, nil
}

func (f *memFS) write(p string, data []byte, appendTo bool) error {
	if p == "/" {
		return fsErr("EISDIR", "open", p)
	}
	if err := f.parentDir("open", p); err != nil {
		return err
	}
	old := f.nodes[p]
	if old != nil && old.dir {
		return fsErr("EISDIR", "open", p)
	}
	if appendTo && old != nil {
		data = append(slices.Clip(old.data), data...)
	}
	size := f.bytes + len(data)
	if old != nil {
		size -= len(old.data)
	} else if len(f.nodes) >= f.cfg.MaxFiles {
		return fsErr("ENOSPC", "open", p)
	}
	if size > f.cfg.MaxBytes {
		return fsErr("ENOSPC", "write", p)
	}
	f.touch()
	f.nodes[p] = &memFile{data: slices.Clone(data), mtime: time.Now().UnixMilli()}
	f.bytes = size
	return nil
}

func (f *memFS) mkdir(p string, recursive bool) error {
	if n := f.nodes[p]; n != nil {
		if recursive && n.dir {
			return nil
		}
		return fsErr("EEXIST", "mkdir", p)
	}
	if !recursive {
		if err := f.parentDir("mkdir", p); err != nil {
			return err
		}
	} else if err := f.mkdir(path.Dir(p), true); err != nil {
		return err
	}
	if len(f.nodes) >= f.cfg.MaxFiles {
		return fsErr("ENOSPC", "mkdir", p)
	}
	f.touch()
	f.nodes[p] = &memFile{dir: true, mtime: time.Now().UnixMilli()}
	return nil
}

func (f *memFS) children(p string) []string {
	prefix := strings.TrimSuffix(p, "/") + "/"
	out := []string{}
	for k := range f.nodes {
		if rest, ok := strings.CutPrefix(k, prefix); ok && rest != "" && !strings.Contains(rest, "/") {
			out = append(out, rest)
		}
	}
	slices.Sort(out)
	return out
}

func (f *memFS) readdir(p string) ([]string, error) {
	n := f.nodes[p]
	if n == nil {
		return nil, f.missing("scandir", p)
	}
	if !n.dir {
		return nil, fsErr("ENOTDIR", "scandir", p)
	}
	return f.children(p), nil
}

func (f *memFS) remove(p string, recursive, force bool) error {
	n := f.nodes[p]
	if n == nil {
		if force {
			return nil
		}
		return f.missing("rm", p)
	}
	if p == "/" {
		return fsErr("EINVAL", "rm", p)
	}
	if n.dir && !recursive && len(f.children(p)) > 0 {
		return fsErr("ENOTEMPTY", "rm", p)
	}
	f.touch()
	for k, c := range f.nodes {
		if k == p || strings.HasPrefix(k, p+"/") {
			f.bytes -= len(c.data)
			delete(f.nodes, k)
		}
	}
	return nil
}

func (f *memFS) rename(from, to string) error {
	n := f.nodes[from]
	if n == nil {
		return f.missing("rename", from)
	}
	if from == "/" || to == "/" || strings.HasPrefix(to, from+"/") {
		return fsErr("EINVAL", "rename", from)
	}
	if err := f.parentDir("rename", to); err != nil {
		return err
	}
	if t := f.nodes[to]; t != nil && (t.dir != n.dir || (t.dir && len(f.children(to)) > 0)) {
		if t.dir {
			return fsErr("EISDIR", "rename", to)
		}
		return fsErr("ENOTDIR", "rename", to)
	}
	f.touch()
	if old := f.nodes[to]; old != nil {
		f.bytes -= len(old.data)
	}
	moved := map[string]*memFile{}
	for k, c := range f.nodes {
		if k == from || strings.HasPrefix(k, from+"/") {
			moved[to+strings.TrimPrefix(k, from)] = c
			delete(f.nodes, k)
		}
	}
	maps.Copy(f.nodes, moved)
	return nil
}

// --- the JavaScript module ----------------------------------------------

func (a *Actor) fsModule(cfg FSConfig) goja.Value {
	if a.fs == nil {
		a.fs = newMemFS(cfg, func() bool { return a.cur != nil })
	}
	f, vm := a.fs, a.vm
	// sync wraps an operation for JavaScript; async returns a promise of it.
	throwFS := func(err error) {
		var fe *fsError
		if errors.As(err, &fe) {
			obj := vm.NewGoError(err)
			_ = obj.Set("code", fe.code)
			_ = obj.Set("syscall", fe.op)
			_ = obj.Set("path", fe.path)
			panic(obj)
		}
		a.throw(fail("invalid_argument", "%v", err))
	}
	argPath := func(v goja.Value) string {
		p, err := fsPath(v.String())
		if err != nil {
			throwFS(err)
		}
		return p
	}
	ops := map[string]func(call goja.FunctionCall) goja.Value{
		"readFile": func(call goja.FunctionCall) goja.Value {
			b, err := f.read(argPath(call.Argument(0)))
			if err != nil {
				throwFS(err)
			}
			return a.encodeBytes(b, encodingArg(call.Argument(1)))
		},
		"writeFile": func(call goja.FunctionCall) goja.Value {
			if err := f.write(argPath(call.Argument(0)), a.dataBytes(call.Argument(1), encodingArg(call.Argument(2))), false); err != nil {
				throwFS(err)
			}
			return goja.Undefined()
		},
		"appendFile": func(call goja.FunctionCall) goja.Value {
			if err := f.write(argPath(call.Argument(0)), a.dataBytes(call.Argument(1), encodingArg(call.Argument(2))), true); err != nil {
				throwFS(err)
			}
			return goja.Undefined()
		},
		"exists": func(call goja.FunctionCall) goja.Value {
			p, err := fsPath(call.Argument(0).String())
			return vm.ToValue(err == nil && f.nodes[p] != nil)
		},
		"mkdir": func(call goja.FunctionCall) goja.Value {
			if err := f.mkdir(argPath(call.Argument(0)), optBool(call.Argument(1), "recursive")); err != nil {
				throwFS(err)
			}
			return goja.Undefined()
		},
		"readdir": func(call goja.FunctionCall) goja.Value {
			names, err := f.readdir(argPath(call.Argument(0)))
			if err != nil {
				throwFS(err)
			}
			return a.toJS(names)
		},
		"stat": func(call goja.FunctionCall) goja.Value {
			p := argPath(call.Argument(0))
			n := f.nodes[p]
			if n == nil {
				throwFS(f.missing("stat", p))
				return goja.Undefined() // not reached: throwFS panics
			}
			o := vm.NewObject()
			_ = o.Set("size", len(n.data))
			_ = o.Set("mtimeMs", n.mtime)
			_ = o.Set("isFile", func() bool { return !n.dir })
			_ = o.Set("isDirectory", func() bool { return n.dir })
			return o
		},
		"unlink": func(call goja.FunctionCall) goja.Value {
			p := argPath(call.Argument(0))
			if n := f.nodes[p]; n != nil && n.dir {
				throwFS(fsErr("EISDIR", "unlink", p))
			}
			if err := f.remove(p, false, false); err != nil {
				throwFS(err)
			}
			return goja.Undefined()
		},
		"rm": func(call goja.FunctionCall) goja.Value {
			if err := f.remove(argPath(call.Argument(0)), optBool(call.Argument(1), "recursive"), optBool(call.Argument(1), "force")); err != nil {
				throwFS(err)
			}
			return goja.Undefined()
		},
		"rename": func(call goja.FunctionCall) goja.Value {
			if err := f.rename(argPath(call.Argument(0)), argPath(call.Argument(1))); err != nil {
				throwFS(err)
			}
			return goja.Undefined()
		},
		"copyFile": func(call goja.FunctionCall) goja.Value {
			b, err := f.read(argPath(call.Argument(0)))
			if err == nil {
				err = f.write(argPath(call.Argument(1)), b, false)
			}
			if err != nil {
				throwFS(err)
			}
			return goja.Undefined()
		},
	}
	o := vm.NewObject()
	for name, op := range ops {
		op := op
		_ = o.Set(name+"Sync", op)
		// The promise form settles at once: there is no I/O to wait for.
		_ = o.Set(name, func(call goja.FunctionCall) goja.Value {
			p, resolve, reject := vm.NewPromise()
			if v, ok := a.catch(func() goja.Value { return op(call) }); ok {
				_ = resolve(v)
			} else {
				_ = reject(v)
			}
			return vm.ToValue(p)
		})
	}
	_ = o.Set("isReadOnly", func() bool { return false })
	return o
}

// catch runs fn and returns its value, or what it threw as a JavaScript
// value (ok false).
func (a *Actor) catch(fn func() goja.Value) (goja.Value, bool) {
	var out goja.Value
	ok := func() bool { // false after a recovered panic (the zero value)
		defer func() {
			if r := recover(); r != nil {
				switch x := r.(type) {
				case goja.Value:
					out = x
				case *goja.Exception:
					out = x.Value()
				default:
					panic(r)
				}
			}
		}()
		out = fn()
		return true
	}()
	return out, ok
}

func encodingArg(v goja.Value) string {
	if v == nil || goja.IsUndefined(v) || goja.IsNull(v) {
		return ""
	}
	if o, ok := v.(*goja.Object); ok && o.ClassName() == "Object" {
		if e := o.Get("encoding"); e != nil && !goja.IsUndefined(e) && !goja.IsNull(e) {
			return e.String()
		}
		return ""
	}
	return v.String()
}

func optBool(v goja.Value, key string) bool {
	o, ok := v.(*goja.Object)
	if !ok {
		return false
	}
	b := o.Get(key)
	return b != nil && b.ToBoolean()
}

// encodeBytes is a file's content for JavaScript: a string in an encoding,
// or a Uint8Array without one.
func (a *Actor) encodeBytes(b []byte, enc string) goja.Value {
	switch strings.ToLower(enc) {
	case "":
		ctor, ok := goja.AssertConstructor(a.vm.Get("Uint8Array"))
		if !ok {
			a.throw(fail("unavailable", "no Uint8Array"))
		}
		arr, err := ctor(nil, a.vm.ToValue(a.vm.NewArrayBuffer(slices.Clone(b))))
		a.check(err)
		return arr
	case "utf8", "utf-8":
		return a.vm.ToValue(string(b))
	case "base64":
		return a.vm.ToValue(base64.StdEncoding.EncodeToString(b))
	case "hex":
		return a.vm.ToValue(hex.EncodeToString(b))
	}
	a.throw(fail("invalid_argument", "unknown encoding %q (utf8, base64, hex)", enc))
	return nil
}

// dataBytes is what JavaScript writes: a string (in an encoding, utf8 by
// default), an ArrayBuffer or a typed array.
func (a *Actor) dataBytes(v goja.Value, enc string) []byte {
	switch x := v.Export().(type) {
	case string:
		switch strings.ToLower(enc) {
		case "", "utf8", "utf-8":
			return []byte(x)
		case "base64":
			b, err := base64.StdEncoding.DecodeString(x)
			if err != nil {
				a.throw(fail("invalid_argument", "not base64: %v", err))
			}
			return b
		case "hex":
			b, err := hex.DecodeString(x)
			if err != nil {
				a.throw(fail("invalid_argument", "not hex: %v", err))
			}
			return b
		}
		a.throw(fail("invalid_argument", "unknown encoding %q (utf8, base64, hex)", enc))
	case goja.ArrayBuffer:
		return x.Bytes()
	case []byte:
		return x
	}
	if o, ok := v.(*goja.Object); ok {
		if buf, ok := o.Get("buffer").Export().(goja.ArrayBuffer); ok {
			off, n := o.Get("byteOffset").ToInteger(), o.Get("byteLength").ToInteger()
			return buf.Bytes()[off : off+n]
		}
	}
	return []byte(v.String())
}
