package cmds

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strings"

	glazed "github.com/go-go-golems/glazed/pkg/cmds"
	"github.com/go-go-golems/glazed/pkg/cmds/fields"
	"github.com/go-go-golems/glazed/pkg/cmds/values"
	"github.com/go-go-golems/slop-computer/pkg/client"
	"github.com/pkg/errors"
)

// An app's documents, as Claude's ArtifactData tool sees them on claude.ai:
// `slop data` reads and writes a target's db through the same rules and
// events as the pages open on it. `slop room` makes the agent a room peer.
// See `slop help runtime`.

type dataCmd struct {
	*glazed.CommandDescription
	op string
}

var _ glazed.BareCommand = (*dataCmd)(nil)

func (c *dataCmd) Run(ctx context.Context, v *values.Values) error {
	a := in{v}
	api, err := apiClient(ctx, a)
	if err != nil {
		return err
	}
	req := map[string]any{"op": c.op}
	if l := a.S("as-level"); l != "" {
		req["as_level"] = l
	}
	if iv := a.I("if-version"); iv >= 0 && c.op != "get" && c.op != "list" && c.op != "query" && c.op != "batch" {
		req["if_version"] = iv
	}
	switch c.op {
	case "get", "delete":
		req["path"] = a.S("path")
	case "list", "query":
		req["collection"] = a.S("collection")
		req["limit"] = a.I("limit")
		if c.op == "query" {
			q, err := queryOf(a.L("where"), a.S("order"))
			if err != nil {
				return err
			}
			q["limit"] = a.I("limit")
			req["query"] = q
		}
	case "set", "update":
		req["path"] = a.S("path")
		raw, err := dataArg(a.S("data"), a.S("file"))
		if err != nil {
			return err
		}
		req["data"] = raw
	case "str_replace":
		req["path"], req["field"], req["old"], req["new"] = a.S("path"), a.S("field"), a.S("old"), a.S("new")
	case "batch":
		raw, err := readInput(a.S("file"))
		if err != nil {
			return err
		}
		var ops []json.RawMessage
		if err := json.Unmarshal(raw, &ops); err != nil {
			return errors.Wrap(err, "a batch file is a JSON array of {op, path, data?, if_version?}")
		}
		req["ops"] = ops
	}
	var out json.RawMessage
	if err := api.DB(ctx, a.S("target"), req, &out); err != nil {
		return loginHint(err)
	}
	return printJSON(out)
}

// queryOf builds a query from --where 'field op json' and --order field[:desc].
func queryOf(wheres []string, order string) (map[string]any, error) {
	filters := []map[string]any{}
	for _, w := range wheres {
		parts := strings.SplitN(strings.TrimSpace(w), " ", 3)
		if len(parts) != 3 {
			return nil, errors.Errorf("--where %q: want 'field op json', e.g. 'done == false'", w)
		}
		var val any
		if err := json.Unmarshal([]byte(parts[2]), &val); err != nil {
			val = parts[2] // a bare word is a string
		}
		filters = append(filters, map[string]any{"field": parts[0], "op": parts[1], "value": val})
	}
	q := map[string]any{"filters": filters}
	if order != "" {
		field, dir, _ := strings.Cut(order, ":")
		q["order"], q["desc"] = field, dir == "desc"
	}
	return q, nil
}

func dataArg(data, file string) (json.RawMessage, error) {
	raw := []byte(data)
	if data == "" {
		var err error
		if raw, err = readInput(file); err != nil {
			return nil, err
		}
	}
	if !json.Valid(raw) {
		return nil, errors.New("the data is not valid JSON")
	}
	return raw, nil
}

func readInput(file string) ([]byte, error) {
	if file == "" || file == "-" {
		return io.ReadAll(io.LimitReader(os.Stdin, 8<<20))
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

func dataCommands() []glazed.Command {
	target := arg("target", "Target artifact: an app page, or a data artifact that names its app")
	path := arg("path", "Document path (even segments): tasks/t1, data/users/me/profile")
	coll := arg("collection", "Collection path (odd segments): tasks, data/users/me")
	common := func(extra ...*fields.Definition) glazed.CommandDescriptionOption {
		return glazed.WithFlags(append(append(serverFlags(), extra...),
			flag("as-level", "Act at a lower level to test rules: view, interact, admin"),
			integer("if-version", -1, "Write only if the document is at this version (0: absent)"))...)
	}
	data, file := flag("data", "The JSON object (default: --file or stdin)"), flag("file", "A JSON file (default: stdin)")
	return []glazed.Command{
		&dataCmd{glazed.NewCommandDescription("get", glazed.WithShort("Print one document"), common(target, path)), "get"},
		&dataCmd{glazed.NewCommandDescription("list", glazed.WithShort("List a collection's documents"),
			common(target, coll, integer("limit", 100, "At most this many (1-1000)"))), "list"},
		&dataCmd{glazed.NewCommandDescription("query", glazed.WithShort("Query a collection"),
			glazed.WithLong("Example:\n  slop data query ws-team tasks --where 'done == false' --where 'priority >= 2' --order due:desc"),
			common(target, coll, fields.New("where", fields.TypeStringList, fields.WithHelp("A filter: 'field op json' (op: == != < <= > >= in not-in array-contains)")),
				flag("order", "Order by field[:desc]"), integer("limit", 100, "At most this many (1-1000)"))), "query"},
		&dataCmd{glazed.NewCommandDescription("set", glazed.WithShort("Write a whole document"),
			glazed.WithLong("Example:\n  slop data set ws-team data/users/me/blocks/turns/t3 --data '{\"text\": \"…\"}'"),
			common(target, path, data, file)), "set"},
		&dataCmd{glazed.NewCommandDescription("update", glazed.WithShort("Merge fields into an existing document"),
			common(target, path, data, file)), "update"},
		&dataCmd{glazed.NewCommandDescription("str-replace", glazed.WithShort("Replace one occurrence in a string field"),
			common(target, path, arg("field", "The string field"), flag("old", "Text that occurs exactly once"), flag("new", "Its replacement"))), "str_replace"},
		&dataCmd{glazed.NewCommandDescription("delete", glazed.WithShort("Delete a document"), common(target, path)), "delete"},
		&dataCmd{glazed.NewCommandDescription("batch", glazed.WithShort("Apply up to 50 writes from a JSON array"),
			common(target, optArg("file", "JSON file of [{op, path, data?, if_version?}] (default: stdin)"))), "batch"},
	}
}

type roomCmd struct {
	*glazed.CommandDescription
	action string
}

var _ glazed.BareCommand = (*roomCmd)(nil)

func (c *roomCmd) Run(ctx context.Context, v *values.Values) error {
	a := in{v}
	api, err := apiClient(ctx, a)
	if err != nil {
		return err
	}
	view, err := api.OpenAgentView(ctx, a.S("target"))
	if err != nil {
		return loginHint(err)
	}
	room := a.S("room")
	ready := make(chan error, 1)
	enc := json.NewEncoder(os.Stdout)
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	done := make(chan error, 1)
	go func() {
		done <- api.WatchView(ctx, view, func(ev client.ViewEvent) error {
			if ev.Type == "hello" {
				ready <- nil
			}
			if c.action == "watch" {
				return enc.Encode(map[string]any{"type": ev.Type, "data": ev.Data})
			}
			return nil
		})
	}()
	select {
	case err := <-done:
		return loginHint(err)
	case <-ready:
	}
	if err := api.ViewRPC(ctx, view, "room.join", map[string]any{"room": room}, nil); err != nil {
		return err
	}
	if p := a.S("presence"); p != "" {
		var patch map[string]any
		if err := json.Unmarshal([]byte(p), &patch); err != nil {
			return errors.Wrap(err, "--presence is a JSON object")
		}
		if err := api.ViewRPC(ctx, view, "room.presence", map[string]any{"room": room, "patch": patch}, nil); err != nil {
			return err
		}
	}
	if c.action == "emit" {
		var data json.RawMessage
		if raw := a.S("data"); raw != "" {
			if !json.Valid([]byte(raw)) {
				return errors.New("data is not valid JSON")
			}
			data = json.RawMessage(raw)
		}
		return api.ViewRPC(ctx, view, "room.emit", map[string]any{"room": room, "topic": a.S("topic"), "data": data}, nil)
	}
	err = <-done
	if ctx.Err() != nil {
		return nil
	}
	return err
}

func roomCommands() []glazed.Command {
	target := arg("target", "Target artifact")
	room := flag("room", "A named room (default: the lobby)")
	return []glazed.Command{
		&roomCmd{glazed.NewCommandDescription("watch", glazed.WithShort("Join a target's room as an agent peer and print its events as JSON lines"),
			glazed.WithFlags(append(serverFlags(), target, room, flag("presence", "Your presence, a JSON object"))...)), "watch"},
		&roomCmd{glazed.NewCommandDescription("emit", glazed.WithShort("Send one room message"),
			glazed.WithFlags(append(serverFlags(), target, arg("topic", "Topic"), optArg("data", "JSON data"), room)...)), "emit"},
	}
}
