"""YAML config loading helpers."""

from __future__ import annotations

from functools import cache
from pathlib import Path
from typing import Any

import yaml

PACKAGE_ROOT = Path(__file__).resolve().parent.parent
SCENARIO_ROOT = PACKAGE_ROOT / "scenarios"


def load_yaml(path: str | Path) -> dict[str, Any]:
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


@cache
def load_package_yaml(relative: str) -> dict[str, Any]:
    return load_yaml(PACKAGE_ROOT / relative)


EXAMPLE_ROOT = PACKAGE_ROOT / "examples"


def list_scenarios(platform: str) -> list[str]:
    folder = SCENARIO_ROOT / platform
    stems = [p.stem for p in folder.glob("*.yaml")]
    return sorted(stems, key=lambda s: (load_yaml(folder / f"{s}.yaml").get("order", 99), s))


def list_examples(platform: str) -> list[dict]:
    index = EXAMPLE_ROOT / platform / "index.yaml"
    if not index.is_file():
        return []
    return load_yaml(index) or []


def load_example(platform: str, example_id: str) -> dict:
    for ex in list_examples(platform):
        if ex["id"] == example_id:
            code = (EXAMPLE_ROOT / platform / ex["file"]).read_text(encoding="utf-8")
            return {**ex, "code": code}
    raise FileNotFoundError(f"unknown example {platform}/{example_id}")


def load_scenario(platform: str, name: str) -> dict[str, Any]:
    path = SCENARIO_ROOT / platform / f"{name}.yaml"
    if not path.is_file():
        raise FileNotFoundError(f"unknown scenario {platform}/{name}")
    data = load_yaml(path)
    data.setdefault("id", name)
    data.setdefault("platform", platform)
    return data
