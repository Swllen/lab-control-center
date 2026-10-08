"""Parameter-sweep expansion.

Given ``{"learning_rate": [1e-4, 3e-4], "batch_size": [4, 8]}`` produce every combination.
``{name}`` placeholders in the command template are substituted; parameters the template does not
reference are appended as ``--name=value`` so ``python train.py`` "just works".
"""

from __future__ import annotations

import itertools
import re
import shlex
from typing import Any

import yaml

_KEY = re.compile(r"^[A-Za-z_][A-Za-z0-9_.\-]*$")


class SweepError(ValueError):
    pass


def parse_parameters(text: str | None, mapping: dict[str, list[Any]] | None) -> dict[str, list[Any]]:
    if mapping is None:
        if not text or not text.strip():
            raise SweepError("No parameters given")
        try:
            doc = yaml.safe_load(text)
        except yaml.YAMLError as exc:
            raise SweepError(f"Invalid YAML: {exc}") from exc
        if isinstance(doc, dict) and isinstance(doc.get("parameters"), dict):
            doc = doc["parameters"]
        if not isinstance(doc, dict):
            raise SweepError("Expected a mapping of parameter -> list of values")
        mapping = doc
    params: dict[str, list[Any]] = {}
    for key, values in mapping.items():
        key = str(key)
        if not _KEY.match(key):
            raise SweepError(f"Invalid parameter name: {key!r}")
        if not isinstance(values, list):
            values = [values]
        if not values:
            raise SweepError(f"Parameter {key!r} has no values")
        for v in values:
            if isinstance(v, (dict, list)):
                raise SweepError(f"Parameter {key!r}: values must be scalars")
        params[key] = values
    if not params:
        raise SweepError("No parameters given")
    return params


def _fmt(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, float):
        return repr(value) if abs(value) >= 1e-3 or value == 0 else f"{value:g}"
    return str(value)


def _name_part(value: Any) -> str:
    return re.sub(r"[^A-Za-z0-9.+\-]", "_", _fmt(value))


def expand(name: str, template: str, params: dict[str, list[Any]], limit: int) -> list[tuple[str, str, dict[str, Any]]]:
    keys = list(params)
    total = 1
    for k in keys:
        total *= len(params[k])
    if total > limit:
        raise SweepError(f"Sweep would create {total} jobs (limit {limit})")
    referenced = {k for k in keys if "{" + k + "}" in template}
    out: list[tuple[str, str, dict[str, Any]]] = []
    for combo in itertools.product(*(params[k] for k in keys)):
        point = dict(zip(keys, combo, strict=True))
        command = template
        for k in referenced:
            command = command.replace("{" + k + "}", shlex.quote(_fmt(point[k])))
        extra = [f"--{k}={shlex.quote(_fmt(point[k]))}" for k in keys if k not in referenced]
        if extra:
            command = command.rstrip() + " " + " ".join(extra)
        job_name = f"{name}-" + "-".join(f"{k}={_name_part(point[k])}" for k in keys)
        out.append((job_name[:128], command, point))
    return out
