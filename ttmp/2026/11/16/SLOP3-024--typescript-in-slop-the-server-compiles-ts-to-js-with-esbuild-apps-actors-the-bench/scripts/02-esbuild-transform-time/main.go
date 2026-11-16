package main

import (
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/evanw/esbuild/pkg/api"
)

// Times esbuild's per-file TypeScript transform on a directory of .ts files,
// as slop would run it when serving a page file or loading an actor.
func main() {
	files, _ := filepath.Glob(filepath.Join(os.Args[1], "*.ts"))
	for _, format := range []api.Format{api.FormatESModule, api.FormatCommonJS} {
		var total time.Duration
		in, out, errs := 0, 0, 0
		for round := 0; round < 2; round++ {
			total, in, out = 0, 0, 0
			for _, f := range files {
				src, _ := os.ReadFile(f)
				t := time.Now()
				r := api.Transform(string(src), api.TransformOptions{Loader: api.LoaderTS, Format: format, Target: api.ES2020, Sourcefile: filepath.Base(f), Sourcemap: api.SourceMapInline})
				total += time.Since(t)
				in += len(src)
				out += len(r.Code)
				errs += len(r.Errors)
			}
		}
		fmt.Printf("format %d: %d files, %d bytes in, %d bytes out (with inline maps), %v total (warm), %d errors\n", format, len(files), in, out, total.Round(10*time.Microsecond), errs)
	}
}
