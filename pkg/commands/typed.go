package commands

// or is *p, or d when the argument was not given (a typed verb's optional
// number whose zero means something: days 0 is "no expiry").
func or[T any](p *T, d T) T {
	if p == nil {
		return d
	}
	return *p
}
