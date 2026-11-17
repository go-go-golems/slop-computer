// Package tscompile turns an app's TypeScript into JavaScript (SLOP3-024).
//
// Each file is compiled on its own with esbuild's transform: types are
// removed, nothing is checked and no other file is read. The browser and
// the actor's require already resolve imports file by file, so nothing is
// bundled. Output depends only on the file's name and content, the profile
// (where it runs), the governing tsconfig and the compiler version, so it
// is cached by those and can always be computed again.
package tscompile

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"path"
	"runtime"
	"strings"
	"unicode/utf8"

	"github.com/evanw/esbuild/pkg/api"
	"golang.org/x/sync/singleflight"
)

// Version names the compiler and the options below. It is part of every
// cache key and of the ETag of compiled pages: bump the suffix when an
// option changes. TestVersionMatchesGoMod keeps the esbuild part honest.
const Version = "esbuild-0.25.12.1"

// MaxSource is the largest file compiled.
const MaxSource = 4 << 20

// Profile is where compiled code runs.
type Profile int

const (
	// Page is a browser: an ES module, with a linked source map the browser
	// fetches only when its developer tools are open (<name>.map).
	Page Profile = iota
	// Actor is goja: CommonJS, which the actor's require implements, with an
	// inline source map, so stack traces point at the TypeScript.
	Actor
	// Eval is goja running a program as a script (slop eval).
	Eval
)

func (p Profile) String() string {
	switch p {
	case Page:
		return "page"
	case Actor:
		return "actor"
	case Eval:
		return "eval"
	}
	return "unknown"
}

// Is reports whether slop compiles a file of this name: .ts, .tsx, .mts or
// .cts, but not a declaration file (.d.ts, .d.mts, .d.cts), which is never
// code.
func Is(name string) bool {
	switch path.Ext(name) {
	case ".ts", ".mts", ".cts":
		return !strings.HasSuffix(strings.TrimSuffix(name, path.Ext(name)), ".d")
	case ".tsx":
		return true
	}
	return false
}

// Output is a compiled file.
type Output struct {
	Code []byte // JavaScript; a Page ends with its sourceMappingURL comment
	Map  []byte // the Page source map (nil for the inline profiles)
}

// Error is a file that did not compile. Each message reads
// "path:line:column: text".
type Error struct {
	Messages []string
}

func (e *Error) Error() string { return strings.Join(e.Messages, "\n") }

type result struct {
	out *Output
	err error
}

var (
	cache  = newLRU(64 << 20)
	flight singleflight.Group
	slots  = make(chan struct{}, runtime.GOMAXPROCS(0))
)

// Compile turns one TypeScript file into JavaScript for a profile. tsconfig
// is the raw tsconfig file that governs it (nil for none); esbuild applies
// the options that change what a file compiles to (jsx, jsxImportSource,
// experimentalDecorators, …) and ignores the rest. It does not follow
// "extends". A source that is too large or not UTF-8 is an *Error.
func Compile(name string, src []byte, p Profile, tsconfig []byte) (*Output, error) {
	key := cacheKey(name, src, p, tsconfig)
	if r, ok := cache.get(key); ok {
		return r.out, r.err
	}
	v, _, _ := flight.Do(key, func() (any, error) {
		if r, ok := cache.get(key); ok {
			return r, nil
		}
		slots <- struct{}{}
		out, err := compile(name, src, p, tsconfig)
		<-slots
		r := result{out, err}
		size := len(key) + 64
		if out != nil {
			size += len(out.Code) + len(out.Map)
		}
		cache.put(key, r, size)
		return r, nil
	})
	r := v.(result)
	return r.out, r.err
}

func cacheKey(name string, src []byte, p Profile, tsconfig []byte) string {
	h := sha256.New()
	for _, part := range [][]byte{[]byte(Version), []byte(p.String()), []byte(name), src, tsconfig} {
		_, _ = fmt.Fprintf(h, "%d:", len(part))
		_, _ = h.Write(part)
	}
	return hex.EncodeToString(h.Sum(nil))
}

func compile(name string, src []byte, p Profile, tsconfig []byte) (*Output, error) {
	if len(src) > MaxSource {
		return nil, &Error{Messages: []string{fmt.Sprintf("%s: %d bytes is more than slop compiles (%d)", name, len(src), MaxSource)}}
	}
	if !utf8.Valid(src) {
		return nil, &Error{Messages: []string{name + ": not UTF-8 text"}}
	}
	loader := api.LoaderTS
	if path.Ext(name) == ".tsx" {
		loader = api.LoaderTSX
	}
	opts := api.TransformOptions{
		Loader: loader,
		// A map names its source relative to where the map is (beside the
		// file, or inside it); browsers and goja resolve it that way.
		Sourcefile:  path.Base(name),
		Charset:     api.CharsetUTF8,
		TsconfigRaw: string(tsconfig),
		LogLevel:    api.LogLevelSilent,
	}
	switch p {
	case Page:
		opts.Format = api.FormatESModule
		opts.Target = api.ES2022
		opts.Sourcemap = api.SourceMapExternal
	case Actor:
		opts.Format = api.FormatCommonJS
		opts.Target = api.ES2020
		opts.Sourcemap = api.SourceMapInline
	case Eval:
		opts.Target = api.ES2020
		opts.Sourcemap = api.SourceMapInline
	}
	r := api.Transform(string(src), opts)
	if len(r.Errors) > 0 {
		e := &Error{}
		for _, m := range r.Errors {
			if l := m.Location; l != nil {
				e.Messages = append(e.Messages, fmt.Sprintf("%s:%d:%d: %s", name, l.Line, l.Column+1, m.Text))
			} else {
				e.Messages = append(e.Messages, name+": "+m.Text)
			}
		}
		return nil, e
	}
	out := &Output{Code: r.Code}
	if p == Page {
		out.Map = r.Map
		out.Code = append(out.Code, []byte("//# sourceMappingURL="+path.Base(name)+".map\n")...)
	}
	return out, nil
}

// ErrorModule is JavaScript that throws err when it runs: what a page gets
// for a file that did not compile. A module request that fails with an HTTP
// error shows in the browser only as a network error, without the message;
// a module that throws shows it where page errors already appear.
func ErrorModule(err error) []byte {
	return []byte("throw new SyntaxError(" + jsString(err.Error()) + ");\n")
}

func jsString(s string) string {
	var b strings.Builder
	b.WriteByte('"')
	for _, r := range s {
		switch {
		case r == '"' || r == '\\':
			b.WriteByte('\\')
			b.WriteRune(r)
		case r == '\n':
			b.WriteString(`\n`)
		case r < 0x20 || r == 0x2028 || r == 0x2029 || r == '<':
			fmt.Fprintf(&b, `\u%04x`, r)
		default:
			b.WriteRune(r)
		}
	}
	b.WriteByte('"')
	return b.String()
}
