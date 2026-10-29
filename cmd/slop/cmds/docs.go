package cmds

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"

	glazed "github.com/go-go-golems/glazed/pkg/cmds"
	"github.com/go-go-golems/glazed/pkg/cmds/values"
	"github.com/go-go-golems/glazed/pkg/middlewares"
	"github.com/go-go-golems/glazed/pkg/types"
	"github.com/go-go-golems/slop-computer/pkg/client"
	"github.com/pkg/errors"
)

// Live documents of a design (a Pinup file): what an agent reads and writes
// to work on a design while people have it open. See `slop help pinup`.

type docsListCmd struct{ *glazed.CommandDescription }

var _ glazed.GlazeCommand = (*docsListCmd)(nil)

func (c *docsListCmd) RunIntoGlazeProcessor(ctx context.Context, v *values.Values, out middlewares.Processor) error {
	a := in{v}
	api, err := apiClient(ctx, a)
	if err != nil {
		return err
	}
	docs, _, err := api.Docs(ctx, a.S("design"), a.S("prefix"), 0)
	if err != nil {
		return loginHint(err)
	}
	for _, d := range docs {
		by := ""
		if d.By != nil {
			by = *d.By
		}
		if err := out.AddRow(ctx, types.NewRow(types.MRP("path", d.Path), types.MRP("rev", d.Rev), types.MRP("bytes", len(d.Data)),
			types.MRP("by", by), types.MRP("at", d.At))); err != nil {
			return err
		}
	}
	return nil
}

type docsCmd struct {
	*glazed.CommandDescription
	action string
}

var _ glazed.BareCommand = (*docsCmd)(nil)

func (c *docsCmd) Run(ctx context.Context, v *values.Values) error {
	a := in{v}
	api, err := apiClient(ctx, a)
	if err != nil {
		return err
	}
	design, path := a.S("design"), a.S("path")
	switch c.action {
	case "get":
		d, err := api.Doc(ctx, design, path)
		if err != nil {
			return loginHint(err)
		}
		return printJSON(d.Data)
	case "put":
		raw, err := readInput(a.S("file"))
		if err != nil {
			return err
		}
		if !json.Valid(raw) {
			return errors.New("the document is not valid JSON")
		}
		rev, err := api.PutDoc(ctx, design, path, raw)
		if err != nil {
			return loginHint(err)
		}
		fmt.Printf("%s %s rev %d\n", design, path, rev)
	case "rm":
		rev, err := api.DeleteDoc(ctx, design, path)
		if err != nil {
			return loginHint(err)
		}
		fmt.Printf("%s %s deleted (rev %d)\n", design, path, rev)
	case "watch":
		enc := json.NewEncoder(os.Stdout)
		return api.WatchDocs(ctx, design, int64(a.I("after")), func(ev client.DocEvent) error {
			if ev.Type == "ready" && a.B("until-ready") {
				return io.EOF
			}
			if p := a.S("prefix"); p != "" && ev.Type == "doc" && (len(ev.Path) < len(p) || ev.Path[:len(p)] != p) {
				return nil
			}
			return enc.Encode(map[string]any{"type": ev.Type, "event": ev.Raw})
		})
	}
	return nil
}

func readInput(file string) ([]byte, error) {
	if file == "" || file == "-" {
		return io.ReadAll(io.LimitReader(os.Stdin, 1<<20))
	}
	return os.ReadFile(file) // #nosec G304 -- a file the user names
}

func printJSON(raw json.RawMessage) error {
	var v any
	if err := json.Unmarshal(raw, &v); err != nil {
		return err
	}
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	fmt.Println(string(b))
	return nil
}

func docsCommands() []glazed.Command {
	design := arg("design", "Design artifact (a data artifact of type pinup)")
	path := arg("path", "Document path collection/id, e.g. meta/file, nodes/k9TzQ, inbox/s1")
	return []glazed.Command{
		&docsListCmd{glazed.NewCommandDescription("ls", glazed.WithShort("List a design's live documents"),
			glazed.WithFlags(append(serverFlags(), design, optArg("prefix", "Only paths starting with this, e.g. nodes/"))...))},
		&docsCmd{glazed.NewCommandDescription("get", glazed.WithShort("Print one live document"),
			glazed.WithFlags(append(serverFlags(), design, path)...)), "get"},
		&docsCmd{glazed.NewCommandDescription("put", glazed.WithShort("Write a live document (JSON object) from a file or stdin"),
			glazed.WithLong("Examples:\n  slop docs put design-pace-club inbox/s1 step.json   # a Pinup step: see slop help pinup\n  echo '{\"html\":\"<div …>\"}' | slop docs put design-pace-club inbox/h1"),
			glazed.WithFlags(append(serverFlags(), design, path, optArg("file", "JSON file (default: stdin)"))...)), "put"},
		&docsCmd{glazed.NewCommandDescription("rm", glazed.WithShort("Delete a live document"),
			glazed.WithFlags(append(serverFlags(), design, path)...)), "rm"},
		&docsCmd{glazed.NewCommandDescription("watch", glazed.WithShort("Follow a design's changes and presence as JSON lines"),
			glazed.WithFlags(append(serverFlags(), design, flag("prefix", "Only documents under this prefix"),
				integer("after", 0, "Replay changes after this rev (0: every live document first)"),
				boolean("until-ready", "Stop after the replay"))...)), "watch"},
	}
}
