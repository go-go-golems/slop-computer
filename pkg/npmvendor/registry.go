// Package npmvendor adds npm packages to an app as ordinary files: what
// slop vendor does (SLOP3-024, design §4.7).
//
// It fetches a package and its dependencies from an npm registry, checks
// each tarball against the registry's integrity hash, unpacks them into a
// temporary node_modules, and bundles the requested entry points once with
// esbuild: ES modules with code splitting for pages, one CommonJS file per
// entry for the actor. The output, the packages' declaration files and a
// lock (vendor/vendor.json) are written into the app's folder, and the
// names are mapped in app.json (slop.imports). No package script ever runs:
// npm is never run, tarballs are only read. Only a person runs this, from
// the CLI; the server never fetches packages.
package npmvendor

import (
	"context"
	"crypto/sha256"
	"crypto/sha512"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"hash"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/Masterminds/semver/v3"
)

// DefaultRegistry is npm's public registry.
const DefaultRegistry = "https://registry.npmjs.org"

const (
	maxMetadata = 64 << 20  // one package's metadata
	maxTarball  = 64 << 20  // one package's tarball
	maxPackages = 500       // packages in one add
	maxUnpacked = 256 << 20 // bytes unpacked from one add
)

// Registry reads package metadata and tarballs from an npm registry.
type Registry struct {
	URL    string // e.g. https://registry.npmjs.org
	Client *http.Client
}

type packument struct {
	Name     string                 `json:"name"`
	DistTags map[string]string      `json:"dist-tags"`
	Versions map[string]versionMeta `json:"versions"`
}

type versionMeta struct {
	Name                 string            `json:"name"`
	Version              string            `json:"version"`
	Dependencies         map[string]string `json:"dependencies"`
	PeerDependencies     map[string]string `json:"peerDependencies"`
	OptionalDependencies map[string]string `json:"optionalDependencies"`
	Dist                 struct {
		Tarball   string `json:"tarball"`
		Integrity string `json:"integrity"`
	} `json:"dist"`
}

func (r *Registry) client() *http.Client {
	if r.Client != nil {
		return r.Client
	}
	return &http.Client{Timeout: 2 * time.Minute}
}

func (r *Registry) get(ctx context.Context, u, accept string, limit int64) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	if accept != "" {
		req.Header.Set("Accept", accept)
	}
	resp, err := r.client().Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("GET %s: %s", u, resp.Status)
	}
	b, err := io.ReadAll(io.LimitReader(resp.Body, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(b)) > limit {
		return nil, fmt.Errorf("GET %s: more than %d bytes", u, limit)
	}
	return b, nil
}

// packument is a package's metadata (npm's abbreviated form when the
// registry has it).
func (r *Registry) packument(ctx context.Context, name string) (*packument, error) {
	u := strings.TrimSuffix(r.URL, "/") + "/" + strings.Replace(url.PathEscape(name), "%40", "@", 1)
	b, err := r.get(ctx, u, "application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8", maxMetadata)
	if err != nil {
		return nil, err
	}
	var p packument
	if err := json.Unmarshal(b, &p); err != nil {
		return nil, fmt.Errorf("%s: metadata: %v", name, err)
	}
	return &p, nil
}

// tarball downloads a version's tarball and checks it against the
// registry's integrity hash (sha512, sha384 or sha256; sha1 alone is not
// trusted).
func (r *Registry) tarball(ctx context.Context, v versionMeta) ([]byte, error) {
	if v.Dist.Tarball == "" {
		return nil, fmt.Errorf("%s@%s: the registry names no tarball", v.Name, v.Version)
	}
	b, err := r.get(ctx, v.Dist.Tarball, "", maxTarball)
	if err != nil {
		return nil, err
	}
	if err := checkIntegrity(b, v.Dist.Integrity); err != nil {
		return nil, fmt.Errorf("%s@%s: %v", v.Name, v.Version, err)
	}
	return b, nil
}

// checkIntegrity checks b against a subresource-integrity string, using the
// strongest hash it names.
func checkIntegrity(b []byte, sri string) error {
	best, rank := "", 0
	ranks := map[string]int{"sha256": 1, "sha384": 2, "sha512": 3}
	for _, part := range strings.Fields(sri) {
		alg, _, _ := strings.Cut(part, "-")
		if ranks[alg] > rank {
			best, rank = part, ranks[alg]
		}
	}
	if best == "" {
		return fmt.Errorf("no sha256, sha384 or sha512 integrity from the registry (%q)", sri)
	}
	alg, want, _ := strings.Cut(best, "-")
	var h hash.Hash
	switch alg {
	case "sha512":
		h = sha512.New()
	case "sha384":
		h = sha512.New384()
	default:
		h = sha256.New()
	}
	_, _ = h.Write(b)
	if got := base64.StdEncoding.EncodeToString(h.Sum(nil)); got != want {
		return fmt.Errorf("integrity mismatch: the tarball is %s-%s, the registry says %s", alg, got, best)
	}
	return nil
}

// pick chooses the version of p a spec asks for: a dist-tag (latest when
// empty), an exact version, or the highest version in a range.
func pick(p *packument, spec string) (versionMeta, error) {
	spec = strings.TrimSpace(spec)
	if spec == "" || spec == "*" {
		spec = "latest"
	}
	if v, ok := p.DistTags[spec]; ok {
		spec = v
	}
	if v, ok := p.Versions[spec]; ok {
		return v, nil
	}
	if strings.ContainsAny(spec, ":/") {
		return versionMeta{}, fmt.Errorf("%s@%s: only registry versions and ranges are supported", p.Name, spec)
	}
	c, err := semver.NewConstraint(spec)
	if err != nil {
		return versionMeta{}, fmt.Errorf("%s@%s: %v", p.Name, spec, err)
	}
	var best *semver.Version
	for s := range p.Versions {
		v, err := semver.NewVersion(s)
		if err != nil || !c.Check(v) {
			continue
		}
		if best == nil || v.GreaterThan(best) {
			best = v
		}
	}
	if best == nil {
		return versionMeta{}, fmt.Errorf("%s: no version matches %s", p.Name, spec)
	}
	return p.Versions[best.Original()], nil
}

func satisfies(version, spec string) bool {
	spec = strings.TrimSpace(spec)
	if spec == "" || spec == "*" || spec == "latest" || spec == version {
		return true
	}
	c, err := semver.NewConstraint(spec)
	if err != nil {
		return false
	}
	v, err := semver.NewVersion(version)
	return err == nil && c.Check(v)
}

// install is one package placed in the temporary node_modules.
type install struct {
	dir  string // its directory under node_modules: lit, lit/node_modules/lit-html
	meta versionMeta
	tgz  []byte
}

// resolveAll places a package and its dependencies the way npm does: each
// at the top of node_modules unless a different version is already there,
// in which case under the package that needs it.
func (r *Registry) resolveAll(ctx context.Context, name, spec string) ([]*install, []string, error) {
	placed := map[string]*install{}
	cache := map[string]*packument{}
	var warnings []string
	var visit func(name, spec, from string, optional bool) error
	visit = func(name, spec, from string, optional bool) error {
		// The copy the package at from would load: its own node_modules,
		// then each enclosing package's, then the top.
		shadowed := false
		for _, d := range ancestors(from) {
			if in, ok := placed[join(d, name)]; ok {
				if satisfies(in.meta.Version, spec) {
					return nil
				}
				shadowed = true // a nearer copy of another version: place this one beside from
				break
			}
		}
		if len(placed) >= maxPackages {
			return fmt.Errorf("more than %d packages", maxPackages)
		}
		p, ok := cache[name]
		if !ok {
			var err error
			if p, err = r.packument(ctx, name); err != nil {
				if optional {
					warnings = append(warnings, "skipped the optional dependency "+name+": "+err.Error())
					return nil
				}
				return err
			}
			cache[name] = p
		}
		meta, err := pick(p, spec)
		if err != nil {
			return err
		}
		dir := name
		if _, taken := placed[dir]; taken || shadowed {
			dir = join(from, name)
		}
		in := &install{dir: dir, meta: meta}
		placed[dir] = in
		for _, dep := range sortedKeys(meta.Dependencies) {
			if err := visit(dep, meta.Dependencies[dep], dir, false); err != nil {
				return err
			}
		}
		for _, dep := range sortedKeys(meta.OptionalDependencies) {
			if _, also := meta.Dependencies[dep]; !also {
				if err := visit(dep, meta.OptionalDependencies[dep], dir, true); err != nil {
					warnings = append(warnings, "skipped the optional dependency "+dep+": "+err.Error())
				}
			}
		}
		return nil
	}
	if err := visit(name, spec, "", false); err != nil {
		return nil, nil, err
	}
	out := make([]*install, 0, len(placed))
	for _, d := range sortedKeys(placed) {
		out = append(out, placed[d])
	}
	// A peer the tree does not hold is the app's to vendor.
	for _, in := range out {
		for _, peer := range sortedKeys(in.meta.PeerDependencies) {
			found := false
			for _, d := range ancestors(in.dir) {
				if _, ok := placed[join(d, peer)]; ok {
					found = true
					break
				}
			}
			if !found {
				warnings = append(warnings, fmt.Sprintf("%s wants %s %s as a peer: vendor it too if the app uses it", in.meta.Name, peer, in.meta.PeerDependencies[peer]))
			}
		}
	}
	for _, in := range out {
		tgz, err := r.tarball(ctx, in.meta)
		if err != nil {
			return nil, nil, err
		}
		in.tgz = tgz
	}
	return out, warnings, nil
}

// ancestors are the package directories whose node_modules a package at dir
// searches, nearest first; "" is the top.
func ancestors(dir string) []string {
	out := []string{}
	for dir != "" {
		out = append(out, dir)
		i := strings.LastIndex(dir, "/node_modules/")
		if i < 0 {
			break
		}
		dir = dir[:i]
	}
	return append(out, "")
}

func join(dir, name string) string {
	if dir == "" {
		return name
	}
	return dir + "/node_modules/" + name
}

func sortedKeys[V any](m map[string]V) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}
