from __future__ import annotations

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.api.deps import SSH, Hub, ServerDep
from app.core.deps import AdminUser, CurrentUser, DbSession, OperatorUser
from app.core.paths import PathError, resolve_key_path
from app.models import Server
from app.schemas.server import (
    ConnectionTestResult,
    PowerAction,
    ServerConnectionFields,
    ServerCreate,
    SSHConfigHostOut,
    SSHConfigImport,
    ServerOut,
    ServerUpdate,
)
from app.services.ssh_config import read_ssh_config
from app.services.server_actions import PowerActionError, run_power_action
from app.services.ssh_manager import SSHError, SSHManager, SSHTarget

router = APIRouter(prefix="/api/servers", tags=["servers"])


def _check_key(key_path: str | None) -> None:
    if key_path:
        try:
            resolve_key_path(key_path)
        except PathError as exc:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc


@router.get("", response_model=list[ServerOut])
async def list_servers(_: CurrentUser, db: DbSession) -> list[Server]:
    return list(await db.scalars(select(Server).order_by(Server.id)))


@router.post("", response_model=ServerOut, status_code=status.HTTP_201_CREATED)
async def create_server(body: ServerCreate, _: OperatorUser, db: DbSession, hub: Hub) -> Server:
    if body.transport == "ssh" and not body.ssh_config_host:
        _check_key(body.key_path)
    server = Server(**body.model_dump())
    db.add(server)
    try:
        await db.commit()
    except IntegrityError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, f"A server named '{body.name}' already exists") from exc
    await db.refresh(server)
    hub.upsert(server)
    return server


@router.get("/ssh-config", response_model=list[SSHConfigHostOut])
async def list_ssh_config_hosts(_: OperatorUser, db: DbSession) -> list[SSHConfigHostOut]:
    """Host aliases from ~/.ssh/config on the control-center host (no secrets are read)."""
    existing = {s.ssh_config_host: s.id for s in await db.scalars(select(Server)) if s.ssh_config_host}
    return [
        SSHConfigHostOut(
            alias=h.alias, hostname=h.hostname, user=h.user, port=h.port,
            identity_file=h.identity_file, proxy_jump=h.proxy_jump, imported_as=existing.get(h.alias),
        )
        for h in read_ssh_config()
    ]


@router.post("/ssh-config/import", response_model=list[ServerOut], status_code=status.HTTP_201_CREATED)
async def import_ssh_config_hosts(body: SSHConfigImport, _: OperatorUser, db: DbSession, hub: Hub) -> list[Server]:
    available = {h.alias: h for h in read_ssh_config()}
    existing = list(await db.scalars(select(Server)))
    taken_aliases = {s.ssh_config_host for s in existing}
    taken_names = {s.name for s in existing}
    created: list[Server] = []
    for alias in dict.fromkeys(body.aliases):
        host = available.get(alias)
        if host is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, f"Host '{alias}' not found in ~/.ssh/config")
        if alias in taken_aliases:
            continue
        name = alias if alias not in taken_names else f"{alias}-ssh"
        server = Server(
            name=name, hostname=host.hostname, port=host.port, username=host.user or "",
            key_path=None, ssh_config_host=alias, transport="ssh", tags=[],
            description=f"From ~/.ssh/config (Host {alias})",
        )
        db.add(server)
        created.append(server)
        taken_names.add(name)
    await db.commit()
    for server in created:
        await db.refresh(server)
        hub.upsert(server)
    return created


@router.post("/test", response_model=ConnectionTestResult)
async def test_unsaved(body: ServerConnectionFields, _: OperatorUser) -> ConnectionTestResult:
    if body.transport == "demo":
        return ConnectionTestResult(ok=True, latency_ms=0.1, hostname="demo", os_name="Simulated")
    if not body.ssh_config_host:
        _check_key(body.key_path)
    return await SSHManager.test(
        SSHTarget(body.hostname, body.port, body.username, body.key_path, body.ssh_config_host)
    )


@router.get("/{server_id}", response_model=ServerOut)
async def get_server(server: ServerDep, _: CurrentUser) -> Server:
    return server


@router.patch("/{server_id}", response_model=ServerOut)
async def update_server(
    server: ServerDep, body: ServerUpdate, _: OperatorUser, db: DbSession, hub: Hub, ssh: SSH
) -> Server:
    changes = body.model_dump(exclude_unset=True)
    if "key_path" in changes:
        changes["key_path"] = (changes["key_path"] or "").strip() or None
        if server.transport == "ssh" and not server.ssh_config_host:
            _check_key(changes["key_path"])
    for key, value in changes.items():
        setattr(server, key, value)
    try:
        await db.commit()
    except IntegrityError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, "Server name already in use") from exc
    await db.refresh(server)
    await ssh.invalidate(server.id)
    hub.upsert(server)
    return server


@router.delete("/{server_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_server(server: ServerDep, _: AdminUser, db: DbSession, hub: Hub) -> None:
    await hub.remove(server.id)
    await db.delete(server)
    await db.commit()


@router.post("/{server_id}/test", response_model=ConnectionTestResult)
async def test_saved(server: ServerDep, _: OperatorUser) -> ConnectionTestResult:
    if server.transport == "demo":
        return ConnectionTestResult(ok=True, latency_ms=0.1, hostname=server.name, os_name="Simulated")
    return await SSHManager.test(SSHTarget.from_model(server))


@router.post("/{server_id}/power", status_code=status.HTTP_202_ACCEPTED)
async def power(server: ServerDep, body: PowerAction, _: AdminUser, hub: Hub, ssh: SSH) -> dict[str, str]:
    if body.confirm != server.name:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Confirmation does not match the server name")
    try:
        await run_power_action(server, body.action, ssh, hub)
    except (PowerActionError, SSHError) as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc
    return {"status": "accepted", "action": body.action}
