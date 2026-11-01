package verbs

import (
	"github.com/go-go-golems/slop/pkg/config"
	"github.com/go-go-golems/slop/pkg/system"
)

// Env is what verbs work against. Later phases add the kernel (stores,
// actors, access checks); keeping it one struct lets every door share it.
type Env struct {
	Cfg    *config.Config
	Sys    *system.DB
	Kernel Kernel
}

// Kernel is the part of the kernel verbs need. It is an interface so this
// package does not import the kernel (which imports verbs for eval).
type Kernel interface{}
