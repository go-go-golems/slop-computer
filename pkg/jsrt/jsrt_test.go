package jsrt

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/dop251/goja"
)

// A source map that names every position of lines 1–4 outside.ts (new
// Function puts the body on line 3 of the source it builds).
const outsideMap = `{"version":3,"sources":["outside.ts"],"names":[],"mappings":"AAAA;AAAA;AAAA;AAAA"}`

func stack(t *testing.T, vm *goja.Runtime, src string) string {
	t.Helper()
	v, err := vm.RunString(src)
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	return v.String()
}

func TestForAppCodeOpensNoFiles(t *testing.T) {
	path := filepath.Join(t.TempDir(), "outside.map")
	if err := os.WriteFile(path, []byte(outsideMap), 0o600); err != nil {
		t.Fatal(err)
	}
	byFile := "new Error('x').stack\n//# sourceMappingURL=file://" + filepath.ToSlash(path) + "\n"
	programs := map[string]string{
		"a script's last line": byFile,
		"eval":                 "eval(" + strconv.Quote(byFile) + ")",
		"new Function":         "new Function('return ' + " + strconv.Quote(byFile) + ")()",
	}
	for name, src := range programs {
		// The control: goja's default follows the URL to the file.
		if s := stack(t, goja.New(), src); !strings.Contains(s, "outside.ts") {
			t.Fatalf("%s, default runtime: the map was not read, so this test checks nothing: %q", name, s)
		}
		vm := goja.New()
		ForAppCode(vm)
		if s := stack(t, vm, src); strings.Contains(s, "outside.ts") {
			t.Fatalf("%s: the runtime read a file named by the script: %q", name, s)
		}
	}
}

func TestForAppCodeKeepsInlineMaps(t *testing.T) {
	vm := goja.New()
	ForAppCode(vm)
	src := "new Error('x').stack\n//# sourceMappingURL=data:application/json;base64," + base64.StdEncoding.EncodeToString([]byte(outsideMap)) + "\n"
	if s := stack(t, vm, src); !strings.Contains(s, "outside.ts") {
		t.Fatalf("an inline map was not applied: %q", s)
	}
}
