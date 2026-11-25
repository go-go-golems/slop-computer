// Command slop is the slop server and its command-line client.
package main

import (
	"fmt"
	"os"

	"github.com/go-go-golems/slop-computer/cmd/slop/cmds"
)

func main() {
	err := cmds.Root().Execute()
	if err != nil {
		// An app's alias this machine has not learned yet: ask the server.
		if handled, aerr := cmds.RunUnknownAlias(err, os.Args[1:]); handled {
			err = aerr
		}
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", cmds.Explain(err))
		os.Exit(1)
	}
}
