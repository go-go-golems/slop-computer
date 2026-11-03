package cmds

import (
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"strings"
	"text/tabwriter"

	"gopkg.in/yaml.v3"
)

// print writes a result in the chosen output format.
func printOut(v any) error {
	switch flagOutput {
	case "json":
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		enc.SetEscapeHTML(false)
		return enc.Encode(v)
	case "table":
		if rows, ok := v.([]any); ok && len(rows) > 0 {
			if _, ok := rows[0].(map[string]any); ok {
				return printTable(rows)
			}
		}
		fallthrough
	default:
		b, err := yaml.Marshal(normalize(v))
		if err != nil {
			return err
		}
		_, err = os.Stdout.Write(b)
		return err
	}
}

// normalize turns json.Number into int64/float64 so YAML prints numbers.
func normalize(v any) any {
	switch x := v.(type) {
	case json.Number:
		if n, err := x.Int64(); err == nil {
			return n
		}
		f, _ := x.Float64()
		return f
	case map[string]any:
		for k, e := range x {
			x[k] = normalize(e)
		}
	case []any:
		for i, e := range x {
			x[i] = normalize(e)
		}
	}
	return v
}

func printTable(rows []any) error {
	cols := []string{}
	seen := map[string]bool{}
	for _, r := range rows {
		m, _ := r.(map[string]any)
		keys := make([]string, 0, len(m))
		for k := range m {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		for _, k := range keys {
			if !seen[k] {
				seen[k] = true
				cols = append(cols, k)
			}
		}
	}
	tw := tabwriter.NewWriter(os.Stdout, 0, 2, 2, ' ', 0)
	fmt.Fprintln(tw, strings.ToUpper(strings.Join(cols, "\t")))
	for _, r := range rows {
		m, _ := r.(map[string]any)
		cells := make([]string, len(cols))
		for i, c := range cols {
			cells[i] = cell(m[c])
		}
		fmt.Fprintln(tw, strings.Join(cells, "\t"))
	}
	return tw.Flush()
}

func cell(v any) string {
	switch x := v.(type) {
	case nil:
		return ""
	case string:
		if len(x) > 60 {
			return x[:57] + "..."
		}
		return x
	case json.Number:
		return x.String()
	}
	b, _ := json.Marshal(v)
	s := string(b)
	if len(s) > 60 {
		s = s[:57] + "..."
	}
	return s
}
