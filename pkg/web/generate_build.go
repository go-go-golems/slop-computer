//go:build ignore

// generate_build builds web/workshop with pnpm and copies dist/ into
// pkg/web/workshop. Run through `go generate ./pkg/web`.
package main

import (
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "generate: "+err.Error())
		os.Exit(1)
	}
}

func run() error {
	root, err := repoRoot()
	if err != nil {
		return err
	}
	ui := filepath.Join(root, "web", "workshop")
	for _, args := range [][]string{{"install", "--frozen-lockfile"}, {"run", "build"}} {
		cmd := exec.Command("pnpm", args...)
		cmd.Dir, cmd.Stdout, cmd.Stderr = ui, os.Stdout, os.Stderr
		if err := cmd.Run(); err != nil {
			return fmt.Errorf("pnpm %v: %w", args, err)
		}
	}
	dst := filepath.Join(root, "pkg", "web", "workshop")
	if err := os.RemoveAll(dst); err != nil {
		return err
	}
	src := filepath.Join(ui, "dist")
	return filepath.WalkDir(src, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(src, p)
		if filepath.Ext(p) == ".map" {
			return nil // source maps stay out of the binary
		}
		out := filepath.Join(dst, rel)
		if d.IsDir() {
			return os.MkdirAll(out, 0o755)
		}
		b, err := os.ReadFile(p)
		if err != nil {
			return err
		}
		return os.WriteFile(out, b, 0o644)
	})
}

func repoRoot() (string, error) {
	dir, err := os.Getwd()
	if err != nil {
		return "", err
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
			return dir, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", fmt.Errorf("go.mod not found")
		}
		dir = parent
	}
}
