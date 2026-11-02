// Command slop is the slop server and its command-line client.
package main

import (
	"fmt"
	"os"

	"github.com/go-go-golems/slop-computer/cmd/slop/cmds"
)

func main() {
	if err := cmds.Root().Execute(); err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
}
