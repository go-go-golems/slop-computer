package actor

// go-go-goja's native modules in slop's catalog (SLOP3-016 design doc 02,
// phase 4). A bridged module is loaded the way goja_nodejs would load it
// (its Loader fills module.exports) but reached only through slop's
// use() and require(), with a class like every catalog module. Only
// synchronous modules are bridged: they touch the VM only while the actor
// calls them, so they run inside turns on either runtime.
//
// What each one was checked for (go-go-goja at 822e67c):
//   - yaml: parse, stringify, validate with gopkg.in/yaml.v3; no globals,
//     no event loop, no I/O.
//   - events: a Go-backed EventEmitter; emit calls listeners synchronously;
//     no globals, no event loop. Its exports are a constructor.
//   - crypto: randomUUID, randomBytes (crypto/rand), createHash (md5, sha1,
//     sha256, sha512); no event loop, no I/O. Bytes come back as Buffers:
//     goja_nodejs looks Buffer up through the global require('buffer'),
//     which slop's require answers with the buffer module below.
//   - buffer: goja_nodejs's Buffer module, as require('buffer'). The global
//     Buffer stays absent (no change visible to existing apps).

import (
	"strings"

	"github.com/dop251/goja"
	"github.com/dop251/goja_nodejs/buffer"
	"github.com/go-go-golems/go-go-goja/modules"
	// The bridged modules register themselves in go-go-goja's default
	// registry when their packages load.
	_ "github.com/go-go-golems/go-go-goja/modules/crypto"
	_ "github.com/go-go-golems/go-go-goja/modules/events"
	_ "github.com/go-go-golems/go-go-goja/modules/yaml"
	"github.com/go-go-golems/go-go-goja/pkg/tsgen/render"
	"github.com/go-go-golems/go-go-goja/pkg/tsgen/spec"
)

// bridged wraps a go-go-goja native module as a catalog module of class.
func bridged(mod modules.NativeModule, class Class, plain bool, extraTS ...string) Module {
	return Module{Name: mod.Name(), Class: class, Doc: strings.TrimSpace(mod.Doc()), Plain: plain,
		TypeScript: typeScriptOf(mod, extraTS...),
		Load: func(s Setup) goja.Value {
			vm := s.Actor.VM()
			obj := vm.NewObject()
			_ = obj.Set("exports", vm.NewObject())
			mod.Loader(vm, obj)
			return obj.Get("exports")
		}}
}

// typeScriptOf renders a module's declaration from go-go-goja's descriptor
// ("" when it has none). extra lines go inside the declare module block.
func typeScriptOf(mod modules.NativeModule, extra ...string) string {
	d, ok := mod.(modules.TypeScriptDeclarer)
	if !ok {
		return ""
	}
	m := *d.TypeScriptModule()
	m.RawDTS = append(append([]string{}, extra...), m.RawDTS...)
	const header = "// bridged from go-go-goja"
	out, err := render.Bundle(&spec.Bundle{HeaderComment: header, Modules: []*spec.Module{&m}})
	if err != nil {
		return ""
	}
	return strings.TrimSpace(strings.TrimPrefix(out, header))
}

// registerBridged adds the bridged modules to the catalog.
func (m *Manager) registerBridged() {
	for _, b := range []struct {
		name  string
		plain bool
		extra []string
	}{
		{"yaml", false, nil},
		{"crypto", false, []string{`import { Buffer } from "buffer";`}},
		{"events", true, nil}, // its exports are a constructor: used as is
	} {
		mod := modules.DefaultRegistry.GetModule(b.name)
		if mod == nil {
			continue // not compiled into this go-go-goja
		}
		m.Register(bridged(mod, ClassData, b.plain, b.extra...))
	}
	m.Register(Module{Name: "buffer", Class: ClassData, Plain: true, TypeScript: bufferTS,
		Doc: "goja_nodejs's Buffer (a Uint8Array with encodings), as require('buffer'); crypto's bytes are Buffers. There is no global Buffer.",
		Load: func(s Setup) goja.Value {
			vm := s.Actor.VM()
			obj := vm.NewObject()
			_ = obj.Set("exports", vm.NewObject())
			buffer.Require(vm, obj)
			return obj.Get("exports")
		}})
}

const bufferTS = `declare module "buffer" {
  type Encoding = "utf8" | "utf-8" | "hex" | "base64";
  export class Buffer extends Uint8Array {
    static from(data: string | ArrayBuffer | ArrayLike<number>, encoding?: Encoding): Buffer;
    static alloc(size: number, fill?: string | number, encoding?: Encoding): Buffer;
    static concat(list: Uint8Array[], totalLength?: number): Buffer;
    toString(encoding?: Encoding, start?: number, end?: number): string;
    equals(other: Uint8Array): boolean;
    write(text: string, offset?: number, length?: number, encoding?: Encoding): number;
  }
}`
