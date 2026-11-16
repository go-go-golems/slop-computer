package pages

// Embedded views (SLOP3-022 C.1). A tool app trusted with the workshop
// module (a bench for developing apps) opens a view of another store as the
// visiting person and frames it in its own page, on its own sandbox origin.
// The view's address carries a token, /e/<token>/v/<n>/…, which the sandbox
// resolves to the tool's origin: that origin may frame the page
// (frame-ancestors) and is the parent the page's runtime talks to, so the
// tool answers the runtime's hello and renew like the shell does. A dev
// embed (admin on the store) also gets data-src="file:line" on each element
// of its entry page and /_slop/probe.js, the dev probe.

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/net/html"

	"github.com/go-go-golems/slop-computer/pkg/access"
	"github.com/go-go-golems/slop-computer/pkg/ids"
	"github.com/go-go-golems/slop-computer/pkg/rt"
	"github.com/go-go-golems/slop-computer/pkg/verbs"
)

// embedAddr is one embedded view's frame address.
type embedAddr struct {
	label  string // the framed store+app's sandbox label
	parent string // the tool's sandbox origin, allowed to frame it
	dev    bool   // add data-src attributes and the probe
	view   string
	until  time.Time
}

// embeds are the open embed addresses, by token. A token lasts as long as a
// view's secret; a tool reopens an embed when its frame reloads.
type embeds struct {
	mu sync.Mutex
	m  map[string]embedAddr
}

func (e *embeds) put(tok string, x embedAddr) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.m == nil {
		e.m = map[string]embedAddr{}
	}
	now := time.Now()
	for k, v := range e.m {
		if now.After(v.until) {
			delete(e.m, k)
		}
	}
	e.m[tok] = x
}

func (e *embeds) get(tok string) (embedAddr, bool) {
	e.mu.Lock()
	defer e.mu.Unlock()
	x, ok := e.m[tok]
	if !ok || time.Now().After(x.until) {
		return embedAddr{}, false
	}
	return x, true
}

// byView is the embed a view was opened for.
func (e *embeds) byView(view string) (embedAddr, bool) {
	e.mu.Lock()
	defer e.mu.Unlock()
	for _, x := range e.m {
		if x.view == view {
			return x, true
		}
	}
	return embedAddr{}, false
}

// extend keeps a view's embed addresses as long as its renewed secret, so
// files the page loads later still resolve.
func (e *embeds) extend(view string, until time.Time) {
	e.mu.Lock()
	defer e.mu.Unlock()
	for k, x := range e.m {
		if x.view == view && until.After(x.until) {
			x.until = until
			e.m[k] = x
		}
	}
}

// toolOrigin is the sandbox origin of the tool app that toolStore runs.
func (s *Door) toolOrigin(toolStore, toolApp string) string {
	return s.Cfg.Scheme + "://" + s.label(toolStore, toolApp) + "." + s.Cfg.Hosts.Sandbox
}

// Embed opens a view of storeID for p, framed by the sandbox origin of the
// tool app toolStore runs (toolApp). dev also needs admin on the store. The
// answer is what the tool needs to frame the view and to answer its
// runtime's hello: {src, view, secret, version, expiresAt, origin, level,
// caps, dev}.
func (s *Door) Embed(ctx context.Context, p *access.Principal, storeID, toolStore, toolApp string, dev bool) (map[string]any, error) {
	out, err := s.embed(ctx, p, storeID, toolStore, toolApp, dev)
	return out, verbErr(err)
}

func (s *Door) embed(ctx context.Context, p *access.Principal, storeID, toolStore, toolApp string, dev bool) (map[string]any, error) {
	if s.Cfg.Hosts.Sandbox == "" {
		return nil, rtErr("unavailable", "this server has no sandbox host")
	}
	if p == nil || p.ID() == "" {
		return nil, rtErr("not_granted", "an embedded view is opened for a person")
	}
	if p.Kind == access.KindToken {
		return nil, rtErr("not_granted", tokenEmbed)
	}
	if dev {
		d, _, err := s.K.Access.Can(ctx, p, storeID, rt.LevelAdmin, "developing", true)
		if err != nil {
			return nil, err
		}
		if !d.OK {
			return nil, rtErr("not_granted", "a dev view of %s needs admin on it", storeID)
		}
	}
	parent := s.toolOrigin(toolStore, toolApp)
	v, err := s.openView(ctx, p, storeID, parent)
	if err != nil {
		return nil, err
	}
	tok := ids.Secret("emb_")
	s.rt.embeds.put(tok, embedAddr{label: s.label(v.Target, v.App), parent: parent, dev: dev, view: v.ID, until: time.Now().Add(rt.ViewTTL)})
	q := url.Values{"mode": {"app"}, "parent": {parent}}
	src := v.Origin + "/e/" + tok + "/v/" + strconv.Itoa(v.Version) + "/?" + q.Encode()
	return map[string]any{"src": src, "view": v.ID, "secret": v.Secret, "version": v.Version, "expiresAt": v.Expires,
		"origin": v.Origin, "level": v.Level, "caps": v.Caps, "dev": dev}, nil
}

// tokenEmbed refuses embeds to a caller with a token. A view keeps only its
// person, and its calls act with the person's full authority, so a view
// opened for a token would shed the token's scopes (and outlive its
// revocation). An embed is for a page in a browser, opened by a person.
const tokenEmbed = "embedded views are opened for a person in a browser, not for a token: a view would not keep the token's scopes"

// verbErr gives the page door's protocol errors their codes as verb
// errors, for the workshop module that calls Embed and RenewEmbed.
func verbErr(err error) error {
	var f *rtFail
	if errors.As(err, &f) {
		return &verbs.Error{Code: f.Code, Message: f.Message}
	}
	return err
}

// RenewEmbed renews an embedded view's secret for the person it was opened
// for, asked by the tool that opened it (the runtime's renew, answered by
// the tool instead of the shell). A view whose access changed is not
// renewed; the tool opens a new one.
func (s *Door) RenewEmbed(ctx context.Context, p *access.Principal, viewID, toolStore, toolApp string) (map[string]any, error) {
	out, err := s.renewEmbed(ctx, p, viewID, toolStore, toolApp)
	return out, verbErr(err)
}

func (s *Door) renewEmbed(ctx context.Context, p *access.Principal, viewID, toolStore, toolApp string) (map[string]any, error) {
	if p != nil && p.Kind == access.KindToken {
		return nil, rtErr("not_granted", tokenEmbed) // the answer carries the view's secret
	}
	v := s.rt.views.Get(viewID)
	x, ok := s.rt.embeds.byView(viewID)
	if v == nil || !ok || p == nil || v.User != p.ID() || x.parent != s.toolOrigin(toolStore, toolApp) {
		return nil, rtErr("not_found", "no such embedded view")
	}
	if row, err := s.Registry.StoreByID(ctx, v.Target); err != nil || s.recheck(ctx, v, row) {
		return nil, rtErr("not_found", "no such embedded view")
	}
	s.rt.views.Renew(v)
	s.rt.embeds.extend(v.ID, v.Expires)
	return map[string]any{"view": v.ID, "secret": v.Secret, "expiresAt": v.Expires}, nil
}

var bodyOpen = regexp.MustCompile(`(?i)<body[\s>/]`)

// instrumentSkip are the elements that get no data-src: the document's
// frame and what does not render.
var instrumentSkip = map[string]bool{"html": true, "head": true, "meta": true, "link": true, "title": true,
	"script": true, "style": true, "base": true, "br": true, "wbr": true, "template": true, "noscript": true}

// instrument adds data-src="file:line" to every element in a page's body
// (to every element when the page has no <body>), so a tool can map what
// it sees in a frame back to the line that wrote it. Elements that carry a
// data-src keep theirs; everything else is left byte for byte. A page the
// tokenizer cannot read is returned unchanged.
func instrument(page []byte, file string) []byte {
	z := html.NewTokenizer(bytes.NewReader(page))
	var out bytes.Buffer
	out.Grow(len(page) + len(page)/8)
	line := 1
	inBody := !bodyOpen.Match(page)
	for {
		tt := z.Next()
		if tt == html.ErrorToken {
			if z.Err() == io.EOF {
				return out.Bytes()
			}
			return page
		}
		raw := append([]byte(nil), z.Raw()...)
		start := line
		line += bytes.Count(raw, []byte{'\n'})
		if tt == html.StartTagToken || tt == html.SelfClosingTagToken {
			name, more := z.TagName()
			tag := string(name)
			if tag == "body" {
				inBody = true
			}
			has := false
			for more {
				var k []byte
				k, _, more = z.TagAttr()
				if string(k) == "data-src" {
					has = true
				}
			}
			if inBody && !instrumentSkip[tag] && !has {
				raw = withAttr(raw, ` data-src="`+html.EscapeString(file)+`:`+strconv.Itoa(start)+`"`)
			}
		}
		out.Write(raw)
	}
}

// withAttr inserts attr before a start tag's closing > or />, keeping a
// self-closing slash last (it matters in inline SVG: <defs/> holds nothing).
func withAttr(raw []byte, attr string) []byte {
	end := len(raw)
	if end == 0 || raw[end-1] != '>' {
		return raw
	}
	end--
	if end > 1 && raw[end-1] == '/' && closesTag(raw[:end-1]) {
		end--
	}
	head := bytes.TrimRight(raw[:end], " \t\r\n\f")
	out := make([]byte, 0, len(raw)+len(attr))
	out = append(out, head...)
	out = append(out, attr...)
	return append(out, raw[end:]...)
}

// closesTag reports whether a slash right after head (a start tag up to
// its last slash) makes the tag self-closing, as HTML's tokenizer reads it:
// after whitespace or a quote, after the tag name (<g/>) or an attribute
// without a value (<rect hidden/>); not after an unquoted value, which
// takes the slash (type=text/> is type="text/").
func closesTag(head []byte) bool {
	if strings.IndexByte(" \t\r\n\f\"'", head[len(head)-1]) >= 0 {
		return true
	}
	word := head[bytes.LastIndexAny(head, " \t\r\n\f")+1:]
	return !bytes.Contains(word, []byte("="))
}
