package pages

import "testing"

// A resend that arrives while the first run is still going waits for it.
func TestOnceWaitsForTheFirstRun(t *testing.T) {
	var c onceCache
	k := onceKey{"club", "usr_a", "k"}
	release, started := make(chan struct{}), make(chan struct{})
	runs := 0
	first := make(chan any)
	go func() {
		out, _ := c.do(k, func() (any, error) { runs++; close(started); <-release; return "first", nil })
		first <- out
	}()
	<-started
	second := make(chan any)
	go func() {
		out, _ := c.do(k, func() (any, error) { runs++; return "second", nil })
		second <- out
	}()
	close(release)
	if a, b := <-first, <-second; a != "first" || b != "first" || runs != 1 {
		t.Fatalf("results %v, %v after %d runs", a, b, runs)
	}
}
