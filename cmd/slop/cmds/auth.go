package cmds

import (
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/spf13/cobra"

	"github.com/go-go-golems/slop-computer/pkg/client"
)

func authCmd() *cobra.Command {
	auth := &cobra.Command{Use: "auth", Short: "Log in to a slop server and manage the stored token"}
	auth.AddCommand(authLoginCmd(), authStatusCmd(), authLogoutCmd())
	return auth
}

func authLoginCmd() *cobra.Command {
	var name, scopes string
	var days int
	cmd := &cobra.Command{
		Use:   "login",
		Short: "Get a token by approving this CLI in the browser (device login)",
		RunE: func(cmd *cobra.Command, args []string) error {
			server := strings.TrimRight(flagServer, "/")
			if server == "" {
				server = os.Getenv("SLOP_SERVER")
			}
			if server == "" {
				return errors.New("--server is required the first time")
			}
			if name == "" {
				h, _ := os.Hostname()
				name = "slop CLI on " + h
			}
			c, err := clientFor(server)
			if err != nil {
				return err
			}
			c.Token = "" // the device flow needs no token
			req := map[string]any{"name": name, "days": days}
			if scopes != "" {
				req["scopes"] = strings.Split(scopes, ",")
			}
			var start struct {
				DeviceCode, UserCode, VerificationURLComplete string
				Interval                                      int
			}
			var raw map[string]any
			if err := c.Post("/auth/device", req, &raw); err != nil {
				return err
			}
			start.DeviceCode, _ = raw["deviceCode"].(string)
			start.UserCode, _ = raw["userCode"].(string)
			start.VerificationURLComplete, _ = raw["verificationUrlComplete"].(string)
			fmt.Fprintf(os.Stderr, "Open %s\nand approve the code %s.\nWaiting…\n", start.VerificationURLComplete, start.UserCode)
			deadline := time.Now().Add(11 * time.Minute)
			for time.Now().Before(deadline) {
				time.Sleep(2 * time.Second)
				var tok map[string]any
				err := c.Post("/auth/device/token", map[string]any{"deviceCode": start.DeviceCode}, &tok)
				var ae *client.APIError
				if errors.As(err, &ae) && ae.Code == "authorization_pending" {
					continue
				}
				if err != nil {
					return err
				}
				creds, err := client.LoadCredentials()
				if err != nil {
					return err
				}
				l := client.Login{Name: name, SavedAt: time.Now().UTC().Format(time.RFC3339)}
				l.Token, _ = tok["token"].(string)
				l.TokenID, _ = tok["tokenId"].(string)
				l.ExpiresAt = tok["expiresAt"]
				if u, ok := tok["user"].(map[string]any); ok {
					l.User = u
				}
				if sc, ok := tok["scopes"].([]any); ok {
					for _, s := range sc {
						l.Scopes = append(l.Scopes, fmt.Sprint(s))
					}
				}
				creds.Servers[server] = l
				creds.Default = server
				if err := creds.Save(); err != nil {
					return err
				}
				fmt.Fprintf(os.Stderr, "Logged in to %s as %v with scopes %v (token %s).\n", server, l.User["name"], l.Scopes, l.TokenID)
				return nil
			}
			return errors.New("the login expired; run it again")
		},
	}
	cmd.Flags().StringVar(&name, "name", "", "a name for this token (default: slop CLI on <host>)")
	cmd.Flags().StringVar(&scopes, "scopes", "", "comma-separated scopes to ask for (default: all your role allows)")
	cmd.Flags().IntVar(&days, "days", 30, "token lifetime in days (0 = no expiry; admin tokens 1–90)")
	return cmd
}

func clientFor(server string) (*client.Client, error) {
	c, err := client.Resolve(server)
	if err != nil {
		return nil, err
	}
	return c, nil
}

func authStatusCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "status",
		Short: "Show the stored logins and check the default one",
		RunE: func(cmd *cobra.Command, args []string) error {
			creds, err := client.LoadCredentials()
			if err != nil {
				return err
			}
			rows := []any{}
			for url, l := range creds.Servers {
				rows = append(rows, map[string]any{"server": url, "default": url == creds.Default, "token": l.TokenID, "name": l.Name, "scopes": l.Scopes})
			}
			return print(rows)
		},
	}
}

func authLogoutCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "logout",
		Short: "Revoke the stored token and forget it",
		RunE: func(cmd *cobra.Command, args []string) error {
			c, err := client.Resolve(flagServer)
			if err != nil {
				return err
			}
			creds, err := client.LoadCredentials()
			if err != nil {
				return err
			}
			l := creds.Servers[c.Server]
			if l.TokenID != "" {
				if _, err := c.Call("token.rm", map[string]any{"id": l.TokenID}); err != nil {
					fmt.Fprintln(os.Stderr, "could not revoke the token:", err)
				}
			}
			delete(creds.Servers, c.Server)
			if creds.Default == c.Server {
				creds.Default = ""
			}
			return creds.Save()
		},
	}
}
