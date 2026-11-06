package actor

// use('path') / require('path') (SLOP3-012 phase 5b): go-go-goja's path
// API, POSIX only, over strings. A data module: it touches nothing outside
// the VM. resolve() resolves against "/", the root of the fs module.

import (
	"path"
	"strings"

	"github.com/dop251/goja"
)

func (a *Actor) pathModule() goja.Value {
	o := a.vm.NewObject()
	strs := func(args []goja.Value) []string {
		out := make([]string, len(args))
		for i, v := range args {
			out[i] = v.String()
		}
		return out
	}
	_ = o.Set("join", func(call goja.FunctionCall) goja.Value {
		p := path.Join(strs(call.Arguments)...)
		if p == "" {
			p = "."
		}
		return a.vm.ToValue(p)
	})
	_ = o.Set("resolve", func(call goja.FunctionCall) goja.Value {
		p := "/"
		for _, s := range strs(call.Arguments) {
			if strings.HasPrefix(s, "/") {
				p = s
			} else if s != "" {
				p = p + "/" + s
			}
		}
		return a.vm.ToValue(path.Clean(p))
	})
	_ = o.Set("normalize", func(p string) string {
		if p == "" {
			return "."
		}
		c := path.Clean(p)
		if strings.HasSuffix(p, "/") && c != "/" {
			c += "/"
		}
		return c
	})
	_ = o.Set("dirname", path.Dir)
	_ = o.Set("basename", func(p string, ext goja.Value) string {
		b := path.Base(p)
		if ext != nil && !goja.IsUndefined(ext) && b != ext.String() {
			b = strings.TrimSuffix(b, ext.String())
		}
		return b
	})
	_ = o.Set("extname", func(p string) string {
		b := path.Base(p)
		if strings.HasPrefix(b, ".") && strings.Count(b, ".") == 1 {
			return "" // ".profile" has no extension
		}
		return path.Ext(b)
	})
	_ = o.Set("isAbsolute", func(p string) bool { return strings.HasPrefix(p, "/") })
	_ = o.Set("relative", func(from, to string) string { return relPath(from, to) })
	_ = o.Set("sep", "/")
	_ = o.Set("separator", "/")
	_ = o.Set("delimiter", ":")
	return o
}

// relPath is the path from from to to, both resolved against "/".
func relPath(from, to string) string {
	f := strings.Split(strings.Trim(path.Clean("/"+from), "/"), "/")
	t := strings.Split(strings.Trim(path.Clean("/"+to), "/"), "/")
	if f[0] == "" {
		f = nil
	}
	if t[0] == "" {
		t = nil
	}
	i := 0
	for i < len(f) && i < len(t) && f[i] == t[i] {
		i++
	}
	parts := []string{}
	for range f[i:] {
		parts = append(parts, "..")
	}
	parts = append(parts, t[i:]...)
	return strings.Join(parts, "/")
}
