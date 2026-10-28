// Package records turns the files of a data version into the records pages
// read through window.slop.data: Markdown with front matter, JSON, CSV or
// text. It ports the Workshop prototype's parser (sources/workshop/render.js
// frontMatter/records/tokensCSS) and renders Markdown with goldmark.
package records

import (
	"bytes"
	"encoding/json"
	"path"
	"regexp"
	"sort"
	"strings"

	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/extension"
)

// Record is one parsed file. Every record has id (the base name without
// extension) and path.
type Record map[string]any

var md = goldmark.New(goldmark.WithExtensions(extension.GFM))

var frontMatterRe = regexp.MustCompile(`(?s)^---\n(.*?)\n---\n?(.*)$`)

// FrontMatter splits "---\nkey: value\n---\nbody". Values in [a, b] become
// lists, true/false booleans; everything else stays a string.
func FrontMatter(text string) (map[string]any, string) {
	text = strings.ReplaceAll(text, "\r", "")
	m := frontMatterRe.FindStringSubmatch(text)
	meta := map[string]any{}
	if m == nil {
		return meta, text
	}
	for _, line := range strings.Split(m[1], "\n") {
		i := strings.Index(line, ":")
		if i < 0 {
			continue
		}
		k, v := strings.TrimSpace(line[:i]), strings.TrimSpace(line[i+1:])
		switch {
		case strings.HasPrefix(v, "[") && strings.HasSuffix(v, "]"):
			items := []string{}
			for _, x := range strings.Split(v[1:len(v)-1], ",") {
				if x = strings.TrimSpace(x); x != "" {
					items = append(items, x)
				}
			}
			meta[k] = items
		case v == "true" || v == "false":
			meta[k] = v == "true"
		default:
			meta[k] = strings.Trim(v, `"`)
		}
	}
	return meta, m[2]
}

// Markdown renders Markdown to HTML.
func Markdown(src string) string {
	var buf bytes.Buffer
	if err := md.Convert([]byte(src), &buf); err != nil {
		return ""
	}
	return buf.String()
}

func base(p string) string { b := path.Base(p); return strings.TrimSuffix(b, path.Ext(b)) }

// Parse turns one file into a record.
func Parse(p string, content []byte) Record {
	r := Record{}
	switch path.Ext(p) {
	case ".md":
		meta, body := FrontMatter(string(content))
		r["tags"] = []string{}
		for k, v := range meta {
			r[k] = v
		}
		words := len(strings.Fields(body))
		r["body"] = body
		r["html"] = Markdown(body)
		r["minutes"] = max(1, (words+100)/200)
	case ".json":
		var obj map[string]any
		if err := json.Unmarshal(content, &obj); err != nil {
			r["error"] = "not valid JSON"
		}
		for k, v := range obj {
			r[k] = v
		}
	case ".csv":
		r["csv"] = string(content)
	default:
		r["text"] = string(content)
	}
	r["id"], r["path"] = base(p), p
	return r
}

// FromFiles parses every file of a version, sorted by path. read returns a
// file's bytes.
func FromFiles(paths []string, read func(string) ([]byte, error)) ([]Record, error) {
	sort.Strings(paths)
	out := []Record{}
	for _, p := range paths {
		b, err := read(p)
		if err != nil {
			return nil, err
		}
		out = append(out, Parse(p, b))
	}
	return out, nil
}

// Tokens is the tokens.json of a tokens data artifact (the shape of the
// prototype's lab-tokens).
type Tokens struct {
	Colors map[string]string `json:"colors"`
	Type   struct {
		Sans string `json:"sans"`
		Mono string `json:"mono"`
	} `json:"type"`
	Radius string `json:"radius"`
}

var cssValue = regexp.MustCompile(`^[^;{}<>]*$`)
var cssName = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)

// CSS turns tokens into html:root custom properties; unsafe names or values
// are skipped.
func (t Tokens) CSS() string {
	keys := make([]string, 0, len(t.Colors))
	for k := range t.Colors {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	vars := []string{}
	add := func(k, v string) {
		if v != "" && cssName.MatchString(k) && cssValue.MatchString(v) {
			vars = append(vars, "--"+k+":"+v)
		}
	}
	for _, k := range keys {
		add(k, t.Colors[k])
	}
	add("sans", t.Type.Sans)
	add("mono", t.Type.Mono)
	add("radius", t.Radius)
	return "html:root{" + strings.Join(vars, ";") + "}"
}
