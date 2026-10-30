package server

import (
	"bytes"
	"image"
	_ "image/gif" // sizes of GIF files
	"image/jpeg"
	"image/png"
	"io"
	"os"
	"strconv"

	"github.com/go-go-golems/slop-computer/pkg/store"
	"golang.org/x/image/draw"
	_ "golang.org/x/image/webp" // decode WebP sources
)

// Thumbnails: any image URL takes ?w=<width> and serves the image scaled to
// that width (SLOP-012). Widths snap up to a fixed ladder, so each image has
// at most len(thumbWidths) copies; images are never enlarged; the copy is
// JPEG for opaque images and PNG for transparent ones, and the original is
// served whenever the copy would not be smaller. Copies live beside the
// blobs as <sha>.w<width>.<jpg|png>, or an empty <sha>.w<width>.same marker.

var thumbWidths = []int{160, 320, 480, 640, 960, 1280, 1920}

// maxThumbPixels: larger images are served as they are rather than decoded.
const maxThumbPixels = 50_000_000

// thumbSlots bounds concurrent decodes: a 4000x3000 image is 48 MB decoded.
const thumbSlots = 2

// snapWidth reads ?w= and snaps it up to the ladder.
func snapWidth(q string) (int, bool) {
	w, err := strconv.Atoi(q)
	if err != nil || w <= 0 {
		return 0, false
	}
	for _, x := range thumbWidths {
		if w <= x {
			return x, true
		}
	}
	return thumbWidths[len(thumbWidths)-1], true
}

func thumbable(contentType string) bool {
	switch contentType {
	case "image/jpeg", "image/png", "image/webp":
		return true
	}
	return false
}

var thumbTypes = []struct{ ext, typ string }{{"jpg", "image/jpeg"}, {"png", "image/png"}, {"same", ""}}

// thumb opens the copy of f at width, building it once. ok is false when the
// original should be served instead.
func (s *Server) thumb(f store.FileEntry, width int) (fileVariant, bool) {
	key := f.SHA256 + ".w" + strconv.Itoa(width)
	find := func() (string, string, bool) {
		for _, t := range thumbTypes {
			if p, ok := s.Blobs.Derived(key + "." + t.ext); ok {
				return p, t.typ, true
			}
		}
		return "", "", false
	}
	p, typ, ok := find()
	if !ok {
		_, err, _ := s.derived.Do(key, func() (any, error) {
			if _, _, ok := find(); ok {
				return nil, nil
			}
			s.thumbSlots <- struct{}{}
			defer func() { <-s.thumbSlots }()
			return nil, s.makeThumb(f, width, key)
		})
		if err != nil {
			return fileVariant{}, false
		}
		if p, typ, ok = find(); !ok {
			return fileVariant{}, false
		}
	}
	if typ == "" { // the original is the better answer
		return fileVariant{}, false
	}
	file, err := os.Open(p) // #nosec G304 -- a derived file path, validated by blobs
	if err != nil {
		return fileVariant{}, false
	}
	return fileVariant{File: file, Type: typ, Tag: key}, true
}

// imageSize reads an image's dimensions from its header, so pages can
// reserve its space and pick widths (records of image files carry them).
func (s *Server) imageSize(f store.FileEntry) (int, int, bool) {
	if !thumbable(f.Type) && f.Type != "image/gif" {
		return 0, 0, false
	}
	src, err := s.Blobs.Open(f.SHA256)
	if err != nil {
		return 0, 0, false
	}
	defer func() { _ = src.Close() }()
	cfg, _, err := image.DecodeConfig(src)
	if err != nil {
		return 0, 0, false
	}
	return cfg.Width, cfg.Height, true
}

// makeThumb decodes f, scales it to width and stores the smaller of the
// copy and a marker that says "serve the original".
func (s *Server) makeThumb(f store.FileEntry, width int, key string) error {
	same := func() error {
		_, err := s.Blobs.PutDerived(key+".same", func(io.Writer) error { return nil })
		return err
	}
	src, err := s.Blobs.Open(f.SHA256)
	if err != nil {
		return err
	}
	defer func() { _ = src.Close() }()
	cfg, _, err := image.DecodeConfig(src)
	if err != nil || cfg.Width <= width || cfg.Width*cfg.Height > maxThumbPixels {
		return same()
	}
	if _, err = src.Seek(0, io.SeekStart); err != nil {
		return err
	}
	img, _, err := image.Decode(src)
	if err != nil {
		return same()
	}
	height := max(1, cfg.Height*width/cfg.Width)
	dst := image.NewNRGBA(image.Rect(0, 0, width, height))
	draw.CatmullRom.Scale(dst, dst.Bounds(), img, img.Bounds(), draw.Src, nil)
	var buf bytes.Buffer
	ext := "jpg"
	if dst.Opaque() {
		err = jpeg.Encode(&buf, dst, &jpeg.Options{Quality: 80})
	} else {
		ext, err = "png", (&png.Encoder{CompressionLevel: png.BestCompression}).Encode(&buf, dst)
	}
	if err != nil || int64(buf.Len()) >= f.Size {
		return same()
	}
	_, err = s.Blobs.PutDerived(key+"."+ext, func(w io.Writer) error { _, err := w.Write(buf.Bytes()); return err })
	return err
}
