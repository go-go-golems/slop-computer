package store_test

import (
	"context"
	"testing"

	"github.com/go-go-golems/slop-computer/pkg/store"
	"github.com/go-go-golems/slop-computer/pkg/store/storetest"
	"github.com/pkg/errors"
)

func TestKernel(t *testing.T) {
	ctx := context.Background()
	s := storetest.Open(t)
	u, _ := s.UpsertIdentity(ctx, store.Identity{Issuer: "local", Subject: "manuel"}, store.RoleAdmin)
	proj := "lab-site"
	if _, _, err := s.PutProject(ctx, store.Project{ID: proj, Name: "Lab site", Brief: "The site."}, u.ID); err != nil {
		t.Fatal(err)
	}
	tree := map[string]store.FileEntry{"index.html": {SHA256: "aa", Size: 1, Type: "text/html"}}

	// First push creates the artifact.
	res, err := s.Push(ctx, store.PushInput{Artifact: "pricing", Tree: tree, Message: "first", Via: "cli", MoveMain: true, Actor: u.ID,
		Create: &store.ArtifactInput{Title: "Pricing", Kind: store.KindPage, Project: &proj}})
	if err != nil || !res.Created || res.Version.N != 1 || res.Artifact.Main != 1 || len(res.Events) != 2 {
		t.Fatalf("push 1: %+v %v", res, err)
	}
	// Without a base the second push is refused: main moved.
	_, err = s.Push(ctx, store.PushInput{Artifact: "pricing", Tree: tree, MoveMain: true, Actor: u.ID, Via: "cli"})
	var moved *store.MainMovedError
	if !errors.As(err, &moved) || moved.Main != 1 {
		t.Fatalf("push without base: %v", err)
	}
	one := 1
	res, err = s.Push(ctx, store.PushInput{Artifact: "pricing", Base: &one, Tree: map[string]store.FileEntry{"index.html": {SHA256: "bb", Size: 2, Type: "text/html"}, "a.css": {SHA256: "cc", Size: 3, Type: "text/css"}},
		Message: "second", Via: "claude", MoveMain: true, Actor: u.ID})
	if err != nil || res.Version.N != 2 || res.Version.Files["a.css"].SHA256 != "cc" {
		t.Fatalf("push 2: %+v %v", res, err)
	}
	if _, err = s.Push(ctx, store.PushInput{Artifact: "pricing", Base: &one, Tree: map[string]store.FileEntry{"x.css": {SHA256: "cc"}}, MoveMain: true, Actor: u.ID, Force: true, Via: "cli"}); err == nil {
		t.Fatal("a page version without index.html must be refused")
	}
	vs, err := s.Versions(ctx, "pricing")
	if err != nil || len(vs) != 2 || vs[1].Parent == nil || *vs[1].Parent != 1 {
		t.Fatalf("versions %+v %v", vs, err)
	}

	// Routes: set, pin, undo.
	r, _, err := s.SetRoute(ctx, store.Route{Host: "site.localhost", Path: "/pricing", Page: "pricing"}, "created", u.ID)
	if err != nil || r.Version != nil {
		t.Fatalf("set route %+v %v", r, err)
	}
	if _, _, err = s.SetRoute(ctx, store.Route{Host: "site.localhost", Path: "/pricing", Page: "pricing", Version: &one}, "pin v1", u.ID); err != nil {
		t.Fatal(err)
	}
	back, _, err := s.UndoRoute(ctx, "site.localhost", "/pricing", u.ID)
	if err != nil || back == nil || back.Version != nil {
		t.Fatalf("undo %+v %v", back, err)
	}
	log, err := s.RouteLog(ctx, "site.localhost", "/pricing", 0)
	if err != nil || len(log) != 3 || log[0].Note != "undo" {
		t.Fatalf("route log %+v %v", log, err)
	}
	if _, _, err = s.SetRoute(ctx, store.Route{Host: "site.localhost", Path: "/bad/*/x", Page: "pricing"}, "", u.ID); err == nil {
		t.Fatal("* must be the last segment")
	}

	// Threads and replies, including a reply attached to a push.
	th, _, err := s.CreateThread(ctx, "pricing", 2, store.JSON(`{"selector":"section.tiers"}`), "too much air", u.ID, "", false)
	if err != nil || len(th.Comments) != 1 {
		t.Fatalf("thread %+v %v", th, err)
	}
	two := 2
	res, err = s.Push(ctx, store.PushInput{Artifact: "pricing", Base: &two, Tree: tree, MoveMain: true, Actor: u.ID, Via: "claude", TokenID: "tok_x",
		Reply: &store.ReplyInput{Thread: th.ID, Text: "Done in v3"}})
	if err != nil {
		t.Fatal(err)
	}
	got, err := s.Thread(ctx, th.ID)
	if err != nil || len(got.Comments) != 2 || !got.Comments[1].Agent || *got.Comments[1].Version != 3 {
		t.Fatalf("reply with push %+v %v", got, err)
	}
	if _, _, err = s.ResolveThread(ctx, th.ID, true, u.ID); err != nil {
		t.Fatal(err)
	}
	open, err := s.Threads(ctx, store.ThreadFilter{Project: proj, OpenOnly: true})
	if err != nil || len(open) != 0 {
		t.Fatalf("open threads %+v %v", open, err)
	}

	// Events are ordered and replayable.
	evs, err := s.EventsAfter(ctx, 0, 0)
	if err != nil || len(evs) < 8 {
		t.Fatalf("events %d %v", len(evs), err)
	}
	for i := 1; i < len(evs); i++ {
		if evs[i].Seq <= evs[i-1].Seq {
			t.Fatal("events out of order")
		}
	}
	last, _ := s.LastSeq(ctx)
	if last != evs[len(evs)-1].Seq {
		t.Fatalf("last seq %d", last)
	}
}
