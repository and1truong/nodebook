/** MCP token settings: create scoped tokens, revoke, view usage. */
import { useEffect, useState } from "react";
import { api, formatInstant } from "../api";
import type { McpTokenDto } from "../../shared/contracts/issues";
import { MCP_SCOPES } from "../../shared/limits";
import { PageHeader, Loading, ErrorState, EmptyState } from "../components/ui";

export function TokenSettingsPage() {
  const [tokens, setTokens] = useState<McpTokenDto[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["read:issue", "read:search", "read:graph", "read:planning"]);
  const [expiresInDays, setExpiresInDays] = useState<string>("90");
  const [created, setCreated] = useState<{ token: string; prefix: string } | null>(null);
  const [creating, setCreating] = useState(false);

  const load = () => {
    setTokens(null);
    setError(null);
    api
      .tokens()
      .then(setTokens)
      .catch(setError);
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
      <p className="page-sub">
        Personal access tokens authenticate MCP clients against <code>/mcp</code>. Only the SHA-256 hash is stored;
        scopes are enforced per tool call. Revoking a token takes effect immediately.
      </p>

      {created && (
        <div className="token-reveal">
          <h3>Token created — copy it now, it will not be shown again</h3>
          <code className="token-value">{created.token}</code>
          <button
            className="btn small"
            onClick={() => {
              void navigator.clipboard.writeText(created.token);
            }}
          >
            Copy
          </button>
          <button className="linklike" onClick={() => setCreated(null)}>
            dismiss
          </button>
        </div>
      )}

      <form className="token-form panel" onSubmit={create}>
        <h3>New token</h3>
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Claude desktop" maxLength={64} />
        </label>
        <fieldset>
          <legend>Scopes</legend>
          <div className="scope-grid">
            {MCP_SCOPES.map((s) => (
              <label key={s} className="checkline">
                <input type="checkbox" checked={scopes.includes(s)} onChange={() => toggleScope(s)} />
                {s}
              </label>
            ))}
          </div>
        </fieldset>
        <label>
          Expires in (days, blank = never)
          <input type="number" min={1} max={365} value={expiresInDays} onChange={(e) => setExpiresInDays(e.target.value)} />
        </label>
        <button type="submit" className="btn primary" disabled={creating || !name.trim() || scopes.length === 0}>
          {creating ? "Creating…" : "Create token"}
        </button>
      </form>

      <h2 className="section-title">Existing tokens</h2>
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
              <tr key={t.id} className={t.revoked_at ? "dim" : ""}>
                <td>{t.name}</td>
                <td>
                  <code>{t.prefix}…</code>
                </td>
                <td className="scope-cell">{t.scopes.join(", ")}</td>
                <td>{formatInstant(t.created_at)}</td>
                <td>{t.expires_at ? formatInstant(t.expires_at) : "never"}</td>
                <td>{t.last_used_at ? formatInstant(t.last_used_at) : "—"}</td>
                <td>
                  <span className={`badge status-${t.revoked_at ? "closed" : "open"}`}>{t.revoked_at ? "revoked" : "active"}</span>
                </td>
                <td>
                  {!t.revoked_at && (
                    <button
                      className="linklike danger"
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
                    </button>
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
