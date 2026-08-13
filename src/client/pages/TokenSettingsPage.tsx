/** MCP token settings: create scoped tokens, revoke, view usage; manage OAuth connections. */
import { useEffect, useState } from "react";
import { api, formatInstant } from "../api";
import type { McpTokenDto, OauthGrantDto } from "../../shared/contracts/issues";
import { MCP_SCOPES } from "../../shared/limits";
import { PageHeader, Loading, ErrorState, EmptyState } from "../components/ui";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";

export function TokenSettingsPage() {
  const [tokens, setTokens] = useState<McpTokenDto[] | null>(null);
  const [grants, setGrants] = useState<OauthGrantDto[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["read:issue", "read:search", "read:graph", "read:planning"]);
  const [expiresInDays, setExpiresInDays] = useState<string>("90");
  const [created, setCreated] = useState<{ token: string; prefix: string } | null>(null);
  const [creating, setCreating] = useState(false);

  const load = () => {
    setTokens(null);
    setGrants(null);
    setError(null);
    api
      .tokens()
      .then(setTokens)
      .catch(setError);
    api
      .oauthGrants()
      .then(setGrants)
      .catch((e) => setError((prev: unknown) => prev ?? e));
  };

  useEffect(load, []);

  const toggleScope = (scope: string) =>
    setScopes((prev) => (prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]));

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || scopes.length === 0) return;
    setCreating(true);
    setError(null);
    try {
      const result = await api.createToken({
        name: name.trim(),
        scopes,
        expires_in_days: expiresInDays ? Number(expiresInDays) : null,
      });
      setCreated({ token: result.token, prefix: result.prefix });
      setName("");
      load();
    } catch (err) {
      setError(err);
    } finally {
      setCreating(false);
    }
  };

  return (
    <>
      <PageHeader title="MCP tokens" />
      <p className="mb-4 text-sm text-muted-foreground">
        Personal access tokens authenticate MCP clients against <code>/mcp</code>; OAuth connections authenticate
        clients like ChatGPT through the authorization-code flow. Only SHA-256 hashes of secrets are stored; scopes
        are enforced per tool call. Revoking a credential takes effect immediately.
      </p>

      {created && (
        <div className="token-reveal mb-4 flex flex-wrap items-center gap-2.5 rounded-lg border border-success bg-success/10 p-3.5">
          <h3 className="text-sm font-semibold">Token created — copy it now, it will not be shown again</h3>
          <code className="token-value break-all text-sm select-all">{created.token}</code>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              void navigator.clipboard.writeText(created.token);
            }}
          >
            Copy
          </Button>
          <Button variant="link" size="sm" className="h-auto px-0 text-xs" onClick={() => setCreated(null)}>
            dismiss
          </Button>
        </div>
      )}

      <form className="token-form mb-6 flex max-w-[560px] flex-col gap-3 rounded-lg border border-border bg-card p-4" onSubmit={create}>
        <h3 className="text-sm font-semibold">New token</h3>
        <Label className="flex w-full flex-col items-start gap-1.5 text-xs font-medium text-muted-foreground">
          <span>Name</span>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Claude desktop" maxLength={64} />
        </Label>
        <fieldset className="flex flex-col gap-1.5">
          <legend className="text-xs font-medium text-muted-foreground">Scopes</legend>
          <div className="scope-grid grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-1">
            {MCP_SCOPES.map((s) => (
              <Label key={s} className="flex flex-row items-center gap-1.5 text-sm text-foreground">
                <input type="checkbox" className="accent-primary" checked={scopes.includes(s)} onChange={() => toggleScope(s)} />
                {s}
              </Label>
            ))}
          </div>
        </fieldset>
        <Label className="flex w-full flex-col items-start gap-1.5 text-xs font-medium text-muted-foreground">
          <span>Expires in (days, blank = never)</span>
          <Input
            type="number"
            min={1}
            max={365}
            className="w-40"
            value={expiresInDays}
            onChange={(e) => setExpiresInDays(e.target.value)}
          />
        </Label>
        <Button type="submit" disabled={creating || !name.trim() || scopes.length === 0}>
          {creating ? "Creating…" : "Create token"}
        </Button>
      </form>

      <h2 className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wider text-muted-foreground">OAuth connections</h2>
      <p className="mb-2 text-sm text-muted-foreground">
        OAuth clients (e.g. ChatGPT) authenticate via the authorization-code flow with PKCE. Each connection is a
        revocable grant; revoking it invalidates its access and refresh tokens immediately.
      </p>
      {!error && !grants && <Loading />}
      {grants && grants.length === 0 && <EmptyState>No OAuth connections yet.</EmptyState>}
      {grants && grants.length > 0 && (
        <table className="oauth-grants-table token-table">
          <thead>
            <tr>
              <th>Client</th>
              <th>Scopes</th>
              <th>Created</th>
              <th>Last used</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {grants.map((g) => (
              <tr key={g.id} className={g.revoked_at ? "opacity-60" : ""}>
                <td>{g.client_name}</td>
                <td className="scope-cell max-w-[260px]">{g.scopes.join(", ")}</td>
                <td>{formatInstant(g.created_at)}</td>
                <td>{g.last_used_at ? formatInstant(g.last_used_at) : "—"}</td>
                <td>
                  <Badge variant="outline" className={g.revoked_at ? "text-muted-foreground" : "border-success text-success"}>
                    {g.revoked_at ? "revoked" : "active"}
                  </Badge>
                </td>
                <td>
                  {!g.revoked_at && (
                    <Button
                      variant="link"
                      size="sm"
                      className="h-auto px-0 text-xs text-destructive"
                      onClick={async () => {
                        setError(null);
                        try {
                          await api.revokeOauthGrant(g.id);
                          load(); // only reflect success
                        } catch (err) {
                          setError(err);
                        }
                      }}
                    >
                      revoke
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2 className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Existing tokens</h2>
      {error ? <ErrorState error={error} /> : null}
      {!error && !tokens && <Loading />}
      {tokens && tokens.length === 0 && <EmptyState>No tokens yet.</EmptyState>}
      {tokens && tokens.length > 0 && (
        <table className="token-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Prefix</th>
              <th>Scopes</th>
              <th>Created</th>
              <th>Expires</th>
              <th>Last used</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {tokens.map((t) => (
              <tr key={t.id} className={t.revoked_at ? "opacity-60" : ""}>
                <td>{t.name}</td>
                <td>
                  <code>{t.prefix}…</code>
                </td>
                <td className="scope-cell max-w-[260px]">{t.scopes.join(", ")}</td>
                <td>{formatInstant(t.created_at)}</td>
                <td>{t.expires_at ? formatInstant(t.expires_at) : "never"}</td>
                <td>{t.last_used_at ? formatInstant(t.last_used_at) : "—"}</td>
                <td>
                  <Badge variant="outline" className={t.revoked_at ? "text-muted-foreground" : "border-success text-success"}>
                    {t.revoked_at ? "revoked" : "active"}
                  </Badge>
                </td>
                <td>
                  {!t.revoked_at && (
                    <Button
                      variant="link"
                      size="sm"
                      className="h-auto px-0 text-xs text-destructive"
                      onClick={async () => {
                        setError(null);
                        try {
                          await api.revokeToken(t.id);
                          load(); // only reflect success
                        } catch (err) {
                          setError(err);
                        }
                      }}
                    >
                      revoke
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
