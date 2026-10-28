package cmds

import (
	"context"
	"strconv"

	"github.com/go-go-golems/glazed/pkg/cmds/fields"
	"github.com/go-go-golems/slop-computer/pkg/client"
	"github.com/go-go-golems/slop-computer/pkg/credentials"
	"github.com/pkg/errors"
)

// optI parses an optional integer flag given as a string ("" = unset).
func (a in) optI(name string) (*int, error) {
	s := a.S(name)
	if s == "" {
		return nil, nil
	}
	n, err := strconv.Atoi(s)
	if err != nil {
		return nil, errors.Errorf("--%s must be a whole number", name)
	}
	return &n, nil
}

func hostOption(host string) []client.Option {
	if host == "" {
		return nil
	}
	return []client.Option{client.WithHost(host)}
}

// loginHint tells the user how to replace a token the server rejected.
func loginHint(err error) error {
	if client.IsCode(err, "token_invalid") {
		return errors.Wrap(err, "the server rejected the token (revoked or expired); run slop auth login, or update SLOP_TOKEN or --token-file")
	}
	return err
}

// serverFlags are the connection flags of every API command.
func serverFlags() []*fields.Definition {
	return []*fields.Definition{
		flag("server", "Server origin (default: $SLOP_SERVER, then the default stored login)"),
		flag("token-file", "File containing the API token (default: $SLOP_TOKEN, then the stored login)"),
		flag("host", "Host header override, for tunnels"),
	}
}

// apiClient resolves the server and token the way every API command does.
func apiClient(_ context.Context, a in) (*client.Client, error) {
	res, err := credentials.Resolve(credentials.Inputs{Server: a.S("server"), TokenFile: a.S("token-file"), Host: a.S("host")})
	if err != nil {
		return nil, err
	}
	return client.New(res.Server, res.Token, hostOption(res.Host)...), nil
}
