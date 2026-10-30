# Security and private data

This application can execute commands and change files using its configured SSH
accounts. Run it for trusted operators. Publishing the source does not grant access
to a running instance or make its deployment secure by itself.

## Keep private

Never publish `.env`, `.env.local`, SSH private keys, session cookies, AI keys,
databases or backups. `backend/data/`, local env files and runtime logs are ignored
by Git. This does not remove already tracked files or sanitize ZIP archives,
screenshots, issue attachments or past Git commits.

The database contains password hashes, server addresses, account names, job commands
and environment variables. Job scripts/logs and process command lines may contain
credentials. Access logs contain network metadata. Protect the session signing
secret in `backend/data/secret_key` as a credential.

If a real secret was exposed, revoke/rotate it first. Deleting it in a later commit
does not remove historical copies. Pattern scans cannot guarantee absence of secrets.

## Authentication and exposure

- Set a unique first-run password or use the generated one. Changing the bootstrap
  env setting does not reset an existing account.
- Access uses signed HttpOnly session cookies and API role checks. There is no
  extra token approval, MFA, login rate limiting or comprehensive audit log.
- `start.cmd` starts missing services on localhost; `start-lan.cmd` starts them on
  all interfaces. Limit firewall sources to intended peers. Origin allow-lists and
  private-IP detection are not network access controls.
- LAN HTTP is unencrypted. Deployment beyond a trusted network needs HTTPS for
  frontend and backend/WebSockets, suitable proxying, cookie settings and access
  restrictions. Do not expose the development server directly to the internet.
- The scan-path filter blocks some obvious probes. It is not a WAF; 404 responses
  are not proof that every possible attack failed.

## Remote privileges

Web roles do not create separate Linux identities. Remote operations use the SSH
login configured for the server. Grant web access only to people trusted with that
login's command-execution and filesystem permissions.

Verify remote host keys before adding servers. With `LCC_SSH_KNOWN_HOSTS=auto`,
the current implementation warns and disables verification if the known_hosts file
does not exist. Create it with a verified SSH connection or set an explicit path.
Avoid `ignore` outside disposable environments.

Use only the exact read-only sudo rule in [QUOTAS.md](docs/QUOTAS.md) for quota
collection, not unrestricted passwordless sudo. Process inspection does not use sudo.
GPU scheduling is cooperative, not a security boundary against other Linux users.

## Updates and reporting

Keep dependencies updated; use dependency audits, backend tests, frontend type checks
and build checks when updating. Back up SQLite before startup schema upgrades and
plan restarts around plain-shell terminals.

Do not put secrets or live-installation exploit details in a public issue. Use
GitHub private vulnerability reporting if enabled, or an established private channel
with the maintainer. Provide affected versions, impact and a reproduction using
fabricated credentials/data.
