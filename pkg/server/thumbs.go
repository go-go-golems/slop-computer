package server

import (
	"bytes"
	"encoding/binary"
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

// imageSize reads an image's dimensions from its header, as it is shown
// (a JPEG turned by its EXIF orientation has them swapped), so pages can
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
	if f.Type == "image/jpeg" && turns(jpegOrientation(src)) {
		return cfg.Height, cfg.Width, true
	}
	return cfg.Width, cfg.Height, true
}

// makeThumb decodes f, scales it to width and stores the smaller of the
// copy and a marker that says "serve the original". Width is the width as
// shown: a JPEG's EXIF orientation is applied to the copy, which carries no
// EXIF of its own.
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
	if err != nil || cfg.Width*cfg.Height > maxThumbPixels {
		return same()
	}
	o := 1
	if f.Type == "image/jpeg" {
		o = jpegOrientation(src)
	}
	shownW, shownH := cfg.Width, cfg.Height
	if turns(o) {
		shownW, shownH = shownH, shownW
	}
	if shownW <= width {
		return same()
	}
	if _, err = src.Seek(0, io.SeekStart); err != nil {
		return err
	}
	img, _, err := image.Decode(src)
	if err != nil {
		return same()
	}
	height := max(1, shownH*width/shownW)
	w, h := width, height // scaled as stored, then turned
	if turns(o) {
		w, h = h, w
	}
	dst := image.NewNRGBA(image.Rect(0, 0, w, h))
	draw.CatmullRom.Scale(dst, dst.Bounds(), img, img.Bounds(), draw.Src, nil)
	dst = orient(dst, o)
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

// turns reports whether EXIF orientation o swaps width and height (5-8).
func turns(o int) bool { return o >= 5 && o <= 8 }

// jpegOrientation reads the EXIF orientation (1-8) of the JPEG in r, 1 when
// it has none or it cannot be read. It reads the segments before the image
// data, from the start of r.
func jpegOrientation(r io.ReadSeeker) int {
	if _, err := r.Seek(0, io.SeekStart); err != nil {
		return 1
	}
	var head [4]byte
	if _, err := io.ReadFull(r, head[:2]); err != nil || head[0] != 0xFF || head[1] != 0xD8 {
		return 1
	}
	for {
		if _, err := io.ReadFull(r, head[:]); err != nil || head[0] != 0xFF {
			return 1
		}
		marker, size := head[1], int(binary.BigEndian.Uint16(head[2:]))-2
		if marker == 0xDA || marker == 0xD9 || size < 0 { // image data: no EXIF before it
			return 1
		}
		if marker != 0xE1 {
			if _, err := r.Seek(int64(size), io.SeekCurrent); err != nil {
				return 1
			}
			continue
		}
		seg := make([]byte, size)
		if _, err := io.ReadFull(r, seg); err != nil {
			return 1
		}
		if o := exifOrientation(seg); o != 0 {
			return o
		}
	}
}

// exifOrientation reads tag 0x0112 of IFD0 from an APP1 segment, 0 when the
// segment is not EXIF or has no valid orientation.
func exifOrientation(seg []byte) int {
	if len(seg) < 14 || string(seg[:6]) != "Exif\x00\x00" {
		return 0
	}
	tiff := seg[6:]
	var bo binary.ByteOrder
	switch string(tiff[:2]) {
	case "II":
		bo = binary.LittleEndian
	case "MM":
		bo = binary.BigEndian
	default:
		return 0
	}
	ifd := int(bo.Uint32(tiff[4:8]))
	if ifd < 8 || ifd+2 > len(tiff) {
		return 0
	}
	n := int(bo.Uint16(tiff[ifd:]))
	for i := 0; i < n; i++ {
		e := ifd + 2 + 12*i
		if e+12 > len(tiff) {
			return 0
		}
		if bo.Uint16(tiff[e:]) == 0x0112 && bo.Uint16(tiff[e+2:]) == 3 { // orientation, SHORT
			if o := int(bo.Uint16(tiff[e+8:])); o >= 1 && o <= 8 {
				return o
			}
			return 0
		}
	}
	return 0
}

// orient turns or mirrors img the way EXIF orientation o says to show it
// (the same table as Pillow's exif_transpose).
func orient(img *image.NRGBA, o int) *image.NRGBA {
	if o <= 1 || o > 8 {
		return img
	}
	w, h := img.Bounds().Dx(), img.Bounds().Dy()
	dw, dh := w, h
	if turns(o) {
		dw, dh = h, w
	}
	out := image.NewNRGBA(image.Rect(0, 0, dw, dh))
	for y := 0; y < dh; y++ {
		for x := 0; x < dw; x++ {
			var sx, sy int // the source pixel shown at (x, y)
			switch o {
			case 2: // mirror
				sx, sy = w-1-x, y
			case 3: // turn half way
				sx, sy = w-1-x, h-1-y
			case 4: // flip
				sx, sy = x, h-1-y
			case 5: // transpose
				sx, sy = y, x
			case 6: // turn right
				sx, sy = y, h-1-x
			case 7: // transverse
				sx, sy = w-1-y, h-1-x
			case 8: // turn left
				sx, sy = w-1-y, x
			}
			out.SetNRGBA(x, y, img.NRGBAAt(sx, sy))
		}
	}
	return out
}
