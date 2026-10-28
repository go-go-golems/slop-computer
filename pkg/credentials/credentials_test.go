package credentials

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// isolate points the package at an empty config directory and clears the
// environment variables Resolve reads.
func isolate(t *testing.T) string {
	t.Helper()
	dir := filepath.Join(t.TempDir(), "slop")
	t.Setenv("SLOP_CONFIG_DIR", dir)
	t.Setenv("SLOP_SERVER", "")
	t.Setenv("SLOP_TOKEN", "")
	return dir
}

func TestNormalizeOrigin(t *testing.T) {
	for in, want := range map[string]string{
		"https://slop.boutique":       "https://slop.boutique",
		"https://Slop.Boutique:443/":  "https://slop.boutique",
		"HTTP://localhost:80":         "http://localhost",
		"http://localhost:8090":       "http://localhost:8090",
		"slop.boutique":               "https://slop.boutique",
		"  https://slop.boutique/  ":  "https://slop.boutique",
		"http://[::1]:8090":           "http://[::1]:8090",
		"https://[2001:db8::1]:443":   "https://[2001:db8::1]",
		"http://127.0.0.1:55439/":     "http://127.0.0.1:55439",
		"https://portal.test:8443///": "",
	} {
		got, err := NormalizeOrigin(in)
		if want == "" {
			if err == nil {
				t.Errorf("%q: want an error, got %q", in, got)
			}
			continue
		}
		if err != nil || got != want {
			t.Errorf("%q: got %q %v, want %q", in, got, err, want)
		}
	}
	for _, bad := range []string{"", "ftp://slop.boutique", "https://slop.boutique/api", "https://u:p@slop.boutique", "https://slop.boutique?x=1"} {
		if got, err := NormalizeOrigin(bad); err == nil {
			t.Errorf("%q: want an error, got %q", bad, got)
		}
	}
}

func TestSaveLoad(t *testing.T) {
	dir := isolate(t)
	f, warning, err := Load()
	if err != nil || warning != "" || len(f.Servers) != 0 {
		t.Fatalf("empty load %+v %q %v", f, warning, err)
	}
	exp := time.Now().Add(90 * 24 * time.Hour).UTC().Truncate(time.Second)
	f.Put("https://slop.boutique", Entry{Token: "frt_a", TokenID: "tok_a", User: User{ID: "usr_a", Name: "Ada", Role: "creator"}, Scopes: []string{"studio"}, ExpiresAt: &exp}, false)
	f.Put("http://localhost:8090", Entry{Token: "frt_b"}, false)
	if f.Default != "https://slop.boutique" {
		t.Fatalf("first login should become the default: %q", f.Default)
	}
	if err = Save(f); err != nil {
		t.Fatal(err)
	}
	st, err := os.Stat(filepath.Join(dir, "credentials.json"))
	if err != nil || st.Mode().Perm() != 0o600 {
		t.Fatalf("file mode %v %v", st, err)
	}
	if st, err = os.Stat(dir); err != nil || st.Mode().Perm() != 0o700 {
		t.Fatalf("dir mode %v %v", st, err)
	}
	if left, _ := filepath.Glob(filepath.Join(dir, ".credentials-*")); len(left) != 0 {
		t.Fatalf("temporary files left: %v", left)
	}
	got, warning, err := Load()
	if err != nil || warning != "" {
		t.Fatal(warning, err)
	}
	e := got.Servers["https://slop.boutique"]
	if got.Version != Version || e.Token != "frt_a" || e.User.Name != "Ada" || !e.ExpiresAt.Equal(exp) {
		t.Fatalf("round trip %+v", got)
	}

	if !got.Remove("https://slop.boutique") || got.Default != "http://localhost:8090" || got.Remove("https://slop.boutique") {
		t.Fatalf("remove %+v", got)
	}

	_ = os.Chmod(filepath.Join(dir, "credentials.json"), 0o644)
	if _, warning, _ = Load(); !strings.Contains(warning, "chmod 600") {
		t.Fatalf("no warning for a readable file: %q", warning)
	}
}

func TestLoadRejectsNewerVersion(t *testing.T) {
	dir := isolate(t)
	_ = os.MkdirAll(dir, 0o700)
	_ = os.WriteFile(filepath.Join(dir, "credentials.json"), []byte(`{"version":2,"servers":{}}`), 0o600)
	if _, _, err := Load(); err == nil || !strings.Contains(err.Error(), "version 2") {
		t.Fatalf("newer version: %v", err)
	}
}

func TestResolvePrecedence(t *testing.T) {
	isolate(t)
	f := File{}
	f.Put("https://slop.boutique", Entry{Token: "frt_file", Host: "tunnel.local"}, true)
	f.Put("http://localhost:8090", Entry{Token: "frt_local"}, false)
	if err := Save(f); err != nil {
		t.Fatal(err)
	}
	tokenFile := filepath.Join(t.TempDir(), "token")
	_ = os.WriteFile(tokenFile, []byte("frt_tokenfile\n"), 0o600)

	type want struct {
		server, token, host string
		ss, ts              Source
	}
	for _, c := range []struct {
		name     string
		in       Inputs
		env      map[string]string
		want     want
		errMatch string
	}{
		{"file only", Inputs{}, nil, want{"https://slop.boutique", "frt_file", "tunnel.local", FromFile, FromFile}, ""},
		{"flag server uses its stored login", Inputs{Server: "http://LOCALHOST:8090/"}, nil, want{"http://localhost:8090", "frt_local", "", FromFlag, FromFile}, ""},
		{"env server", Inputs{}, map[string]string{"SLOP_SERVER": "http://localhost:8090"}, want{"http://localhost:8090", "frt_local", "", FromEnv, FromFile}, ""},
		{"env token wins over file", Inputs{}, map[string]string{"SLOP_TOKEN": "frt_env"}, want{"https://slop.boutique", "frt_env", "", FromFile, FromEnv}, ""},
		{"token file wins over env", Inputs{TokenFile: tokenFile}, map[string]string{"SLOP_TOKEN": "frt_env"}, want{"https://slop.boutique", "frt_tokenfile", "", FromFile, FromTokenFile}, ""},
		{"flag host wins", Inputs{Host: "other"}, nil, want{"https://slop.boutique", "frt_file", "other", FromFile, FromFile}, ""},
		{"unknown server", Inputs{Server: "https://elsewhere.example"}, nil, want{}, "not logged in to https://elsewhere.example"},
		{"bad server", Inputs{Server: "https://slop.boutique/x"}, nil, want{}, "portal origin"},
	} {
		t.Run(c.name, func(t *testing.T) {
			for k, v := range c.env {
				t.Setenv(k, v)
			}
			r, err := Resolve(c.in)
			if c.errMatch != "" {
				if err == nil || !strings.Contains(err.Error(), c.errMatch) {
					t.Fatalf("want error %q, got %+v %v", c.errMatch, r, err)
				}
				return
			}
			got := want{r.Server, r.Token, r.Host, r.ServerSource, r.TokenSource}
			if err != nil || got != c.want {
				t.Fatalf("got %+v %v, want %+v", got, err, c.want)
			}
			if (r.TokenSource == FromFile) != (r.Entry != nil) {
				t.Fatalf("entry %+v for source %s", r.Entry, r.TokenSource)
			}
		})
	}
}

func TestResolveWithoutAnything(t *testing.T) {
	isolate(t)
	if _, err := Resolve(Inputs{}); err == nil || !strings.Contains(err.Error(), "auth login") {
		t.Fatalf("no server: %v", err)
	}
}
