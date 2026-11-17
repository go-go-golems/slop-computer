// Package jsrt holds what every goja runtime slop creates for app code must
// share: actors, slop eval, and app verbs in the CLI.
package jsrt

import (
	"github.com/dop251/goja"
	"github.com/dop251/goja/parser"
)

// ForAppCode configures vm for code that slop did not write.
//
// goja reads a source map wherever a script's last line points
// (//# sourceMappingURL=…), and its default loader resolves that URL on the
// process's file system. App code, whether a file's last line or a string
// passed to eval or new Function, must never make slop open a file. With this
// loader only inline maps are used (data: URLs, which goja decodes without a
// loader); any other URL yields no map, and the script runs without one.
func ForAppCode(vm *goja.Runtime) {
	vm.SetParserOptions(parser.WithSourceMapLoader(noFiles))
}

func noFiles(string) ([]byte, error) { return nil, nil }
