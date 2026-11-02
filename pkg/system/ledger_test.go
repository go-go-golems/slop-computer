package system

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"
)

func usage(t *testing.T, d *DB, account string) (used, reserved int64) {
	t.Helper()
	p := Period(d.Now())
	return d.LLMUsed(context.Background(), account, p), d.LLMReserved(context.Background(), account, p)
}

// Ledger writes are not authority: they must not move the epoch (which
// would make every open view decide again on every model round).
func TestReservationsDoNotMoveEpoch(t *testing.T) {
	d := openTestDB(t)
	ctx := context.Background()
	before := d.Epoch()
	h, err := d.Reserve(ctx, "usr_a", nil, 10, 20, "c1/0")
	if err != nil {
		t.Fatal(err)
	}
	if err := d.Settle(ctx, h.ID, 25); err != nil {
		t.Fatal(err)
	}
	if d.Epoch() != before {
		t.Fatalf("epoch moved %d -> %d", before, d.Epoch())
	}
	if used, reserved := usage(t, d, "usr_a"); used != 25 || reserved != 0 {
		t.Fatalf("used %d reserved %d", used, reserved)
	}
}

// A hold whose outcome never arrives is charged in full once it expires.
func TestHoldExpiresAtFullAmount(t *testing.T) {
	d := openTestDB(t)
	ctx := context.Background()
	limit := int64(100)
	h, err := d.Reserve(ctx, "usr_a", &limit, 10, 30, "c1/0")
	if err != nil || h.Amount != 40 || h.Output != 30 {
		t.Fatalf("hold %+v, %v", h, err)
	}
	if n, _ := d.ExpireHolds(ctx); n != 0 {
		t.Fatalf("expired %d before its time", n)
	}
	later := time.Now().Add(HoldTTL + time.Minute)
	d.Now = func() time.Time { return later }
	if n, err := d.ExpireHolds(ctx); n != 1 || err != nil {
		t.Fatalf("expired %d, %v", n, err)
	}
	if used, reserved := usage(t, d, "usr_a"); used != 40 || reserved != 0 {
		t.Fatalf("used %d reserved %d", used, reserved)
	}
	// Settling it late changes nothing: it is closed.
	if err := d.Settle(ctx, h.ID, 1); err != nil {
		t.Fatal(err)
	}
	if used, _ := usage(t, d, "usr_a"); used != 40 {
		t.Fatalf("a closed hold settled again: used %d", used)
	}
}

// A retried reservation (same key) returns the hold it made, reserving
// nothing more.
func TestRetryReusesHold(t *testing.T) {
	d := openTestDB(t)
	ctx := context.Background()
	limit := int64(100)
	a, err := d.Reserve(ctx, "usr_a", &limit, 10, 30, "c1/0")
	if err != nil {
		t.Fatal(err)
	}
	b, err := d.Reserve(ctx, "usr_a", &limit, 10, 30, "c1/0")
	if err != nil || b != a {
		t.Fatalf("retry: %+v vs %+v, %v", b, a, err)
	}
	if _, reserved := usage(t, d, "usr_a"); reserved != 40 {
		t.Fatalf("reserved %d after a retry", reserved)
	}
}

// Parallel reservations never set aside more than the limit, and the
// output cap shrinks to what is left: spent + reserved ≤ limit always.
func TestConcurrentReservationsStayWithinLimit(t *testing.T) {
	d := openTestDB(t)
	ctx := context.Background()
	limit := int64(500)
	var wg sync.WaitGroup
	var mu sync.Mutex
	var holds []Hold
	refused := 0
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			h, err := d.Reserve(ctx, "usr_a", &limit, 20, 80, fmt.Sprintf("c%d/0", i))
			mu.Lock()
			defer mu.Unlock()
			switch {
			case errors.Is(err, ErrQuota):
				refused++
			case err != nil:
				t.Error(err)
			default:
				holds = append(holds, h)
			}
		}(i)
	}
	wg.Wait()
	var sum int64
	for _, h := range holds {
		sum += h.Amount
		if h.Output <= 0 || h.Output > 80 {
			t.Fatalf("output cap %d", h.Output)
		}
	}
	if _, reserved := usage(t, d, "usr_a"); reserved != sum || sum > limit {
		t.Fatalf("reserved %d, holds %d, limit %d", reserved, sum, limit)
	}
	if len(holds) == 0 || refused == 0 {
		t.Fatalf("%d holds, %d refused: the limit must bind", len(holds), refused)
	}
	// Each settles at its full output: still within the limit.
	for _, h := range holds {
		if err := d.Settle(ctx, h.ID, h.Amount); err != nil {
			t.Fatal(err)
		}
	}
	if used, reserved := usage(t, d, "usr_a"); used > limit || reserved != 0 {
		t.Fatalf("used %d reserved %d", used, reserved)
	}
}
