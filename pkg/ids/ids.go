// Package ids makes random identifiers and secrets, and hashes secrets for storage.
package ids

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base32"
	"encoding/base64"
	"encoding/hex"
	"strings"
)

// New returns prefix + n random bytes as lowercase hex (usr_8a5ab993…).
func New(prefix string, n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return prefix + hex.EncodeToString(b)
}

// Secret returns prefix + 32 random bytes, URL-safe base64 (slp_…).
func Secret(prefix string) string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return prefix + base64.RawURLEncoding.EncodeToString(b)
}

var b32 = base32.NewEncoding("abcdefghijklmnopqrstuvwxyz234567").WithPadding(base32.NoPadding)

// Slug returns prefix + n random base32 characters (s-k3j9…).
func Slug(prefix string, n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return prefix + b32.EncodeToString(b)[:n]
}

// UserCode returns a code people type: XXXX-XXXX from an unambiguous alphabet.
func UserCode() string {
	const alpha = "BCDFGHJKLMNPQRSTVWXZ23456789"
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	var sb strings.Builder
	for i, c := range b {
		if i == 4 {
			sb.WriteByte('-')
		}
		sb.WriteByte(alpha[int(c)%len(alpha)])
	}
	return sb.String()
}

// Hash is the storage form of a secret: hex sha256.
func Hash(secret string) string {
	h := sha256.Sum256([]byte(secret))
	return hex.EncodeToString(h[:])
}
