package sysdb

import (
	"reflect"
	"testing"
)

// SLOP3-007 decision 1: groups nest @admin ⊆ @subscriber ⊆ @member ⊆
// @guest; a store is in @store only.
func TestGroupsOf(t *testing.T) {
	cases := map[string][]string{
		"guest":      {"guest"},
		"member":     {"guest", "member"},
		"subscriber": {"guest", "member", "subscriber"},
		"admin":      {"guest", "member", "subscriber", "admin"},
		"store":      {"store"},
		"":           nil,
		"none":       nil,
	}
	for aud, want := range cases {
		if got := GroupsOf(aud); !reflect.DeepEqual(got, want) {
			t.Errorf("GroupsOf(%q) = %v, want %v", aud, got, want)
		}
	}
	if !InGroup("admin", "@member") || InGroup("member", "@subscriber") || InGroup("store", "@guest") {
		t.Fatal("InGroup disagrees with GroupsOf")
	}
}
