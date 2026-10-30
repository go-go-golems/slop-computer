package server

import (
	"bytes"
	"compress/gzip"
	"io"
	"mime"
	"net/http"
	"os"
	"strings"
	"sync"

	"github.com/go-go-golems/slop-computer/pkg/store"
)

// Every response that carries stored bytes is served here (SLOP-012). How
// long it may be cached depends only on what its URL names:
//
//   - a content URL names bytes that never change (a version number, a
//     hash): cached for good;
//   - a place URL names a location whose bytes may change (main, a page's
//     own path): fresh for a minute on site hosts, then revalidated in the
//     background; revalidated on every use elsewhere.
//
// HTML documents are always revalidated, by an ETag of their body
// (writePage).

type urlClass int

const (
	contentURL urlClass = iota
	placeURL
)

// cacheControl is the Cache-Control of a URL class on the request's host.
// Site hosts serve public pages, so shared caches may keep them too.
func (s *Server) cacheControl(r *http.Request, c urlClass) string {
	public := s.isSiteHost(r.Host)
	switch {
	case c == contentURL && public:
		return "public, max-age=31536000, immutable"
	case c == contentURL:
		return "private, max-age=31536000, immutable"
	case public:
		return "public, max-age=60, stale-while-revalidate=86400"
	}
	return "private, no-cache"
}

// classOfVersion: version 0 means main, a place; any other number is content.
func classOfVersion(n int) urlClass {
	if n == 0 {
		return placeURL
	}
	return contentURL
}

func (s *Server) isSiteHost(host string) bool {
	for _, h := range s.Config.SiteHosts {
		if strings.EqualFold(h, host) {
			return true
		}
	}
	return false
}

// serveFile writes a stored file in the variant the request asks for (see
// variant), with the cache headers of its URL's class.
func (s *Server) serveFile(w http.ResponseWriter, r *http.Request, f store.FileEntry, c urlClass) {
	v, err := s.variant(r, f)
	if err != nil {
		unavailable(w, err)
		return
	}
	defer func() { _ = v.Close() }()
	h := w.Header()
	h.Set("Content-Type", v.Type)
	h.Set("ETag", `"`+v.Tag+`"`)
	h.Set("Cache-Control", s.cacheControl(r, c))
	if compressible(f.Type) {
		h.Add("Vary", "Accept-Encoding")
	}
	if v.Encoding != "" {
		h.Set("Content-Encoding", v.Encoding)
	}
	http.ServeContent(w, r, "", zeroTime, v)
}

// fileVariant is the bytes serveFile sends for one request: the stored file,
// or a file derived from it.
type fileVariant struct {
	*os.File
	Type, Tag, Encoding string
}

// variant picks what to send for f: a scaled copy of an image for ?w=
// (thumbs.go), a gzipped copy of text when the browser takes gzip (not for
// range requests), otherwise the stored file. Derived
// files are built once, beside the blobs.
func (s *Server) variant(r *http.Request, f store.FileEntry) (fileVariant, error) {
	if width, ok := snapWidth(r.URL.Query().Get("w")); ok && thumbable(f.Type) {
		if v, ok := s.thumb(f, width); ok {
			return v, nil
		}
	}
	if compressible(f.Type) && f.Size > minGzipBytes && acceptsGzip(r) && r.Header.Get("Range") == "" {
		if p, err := s.derive(f.SHA256+".gz", func(out io.Writer) error { return s.gzipBlob(f.SHA256, out) }); err == nil {
			file, err := os.Open(p) // #nosec G304 -- a derived file path, validated by blobs
			if err == nil {
				return fileVariant{File: file, Type: f.Type, Tag: f.SHA256 + ".gz", Encoding: "gzip"}, nil
			}
		}
	}
	file, err := s.Blobs.Open(f.SHA256)
	if err != nil {
		return fileVariant{}, err
	}
	return fileVariant{File: file, Type: f.Type, Tag: f.SHA256}, nil
}

// derive returns the path of a derived file, building it once; concurrent
// requests for the same file share one build.
func (s *Server) derive(name string, build func(io.Writer) error) (string, error) {
	if p, ok := s.Blobs.Derived(name); ok {
		return p, nil
	}
	p, err, _ := s.derived.Do(name, func() (any, error) {
		if p, ok := s.Blobs.Derived(name); ok {
			return p, nil
		}
		return s.Blobs.PutDerived(name, build)
	})
	if err != nil {
		return "", err
	}
	return p.(string), nil
}

func (s *Server) gzipBlob(sum string, out io.Writer) error {
	src, err := s.Blobs.Open(sum)
	if err != nil {
		return err
	}
	defer func() { _ = src.Close() }()
	zw, _ := gzip.NewWriterLevel(out, gzip.BestCompression)
	if _, err = io.Copy(zw, src); err != nil {
		return err
	}
	return zw.Close()
}

// minGzipBytes: smaller bodies gain too little to be worth compressing.
const minGzipBytes = 1024

// compressible reports whether a content type is text that gzip shrinks.
func compressible(contentType string) bool {
	t, _, _ := mime.ParseMediaType(contentType)
	switch {
	case strings.HasPrefix(t, "text/"):
		return t != "text/event-stream"
	case t == "application/json", t == "application/javascript", t == "application/xml",
		t == "image/svg+xml", t == "application/manifest+json":
		return true
	}
	return false
}

func acceptsGzip(r *http.Request) bool {
	for _, part := range strings.Split(r.Header.Get("Accept-Encoding"), ",") {
		name, q, _ := strings.Cut(strings.TrimSpace(part), ";")
		if strings.EqualFold(strings.TrimSpace(name), "gzip") && strings.ReplaceAll(strings.TrimSpace(q), " ", "") != "q=0" {
			return true
		}
	}
	return false
}

var gzipPool = sync.Pool{New: func() any { w, _ := gzip.NewWriterLevel(io.Discard, 5); return w }}

// writeBody writes a body built in memory, gzipped when that is worth it and
// the browser takes it.
func writeBody(w http.ResponseWriter, r *http.Request, status int, contentType string, body []byte) {
	h := w.Header()
	h.Set("Content-Type", contentType)
	if !compressible(contentType) || len(body) <= minGzipBytes {
		w.WriteHeader(status)
		_, _ = w.Write(body)
		return
	}
	h.Add("Vary", "Accept-Encoding")
	if !acceptsGzip(r) {
		w.WriteHeader(status)
		_, _ = w.Write(body)
		return
	}
	var buf bytes.Buffer
	zw := gzipPool.Get().(*gzip.Writer)
	zw.Reset(&buf)
	_, _ = zw.Write(body)
	_ = zw.Close()
	gzipPool.Put(zw)
	h.Set("Content-Encoding", "gzip")
	w.WriteHeader(status)
	_, _ = w.Write(buf.Bytes())
}

// etagMatch reports whether an If-None-Match header names tag.
func etagMatch(header, tag string) bool {
	for _, t := range strings.Split(header, ",") {
		t = strings.TrimPrefix(strings.TrimSpace(t), "W/")
		if t == tag || t == "*" {
			return true
		}
	}
	return false
}
