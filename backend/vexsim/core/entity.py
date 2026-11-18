"""Base class for everything the engine steps."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from vexsim.core.engine import SimEngine


class Entity:
    """A simulated thing with a fixed-step update and a JSON snapshot."""

    kind = "entity"

    def __init__(self, name: str):
        self.name = name
        self.engine: SimEngine | None = None

    def attach(self, engine: SimEngine) -> None:
        self.engine = engine

    def step(self, t: float, dt: float) -> None:  # pragma: no cover - default no-op
        pass

    def snapshot(self) -> dict[str, Any]:
        return {}

    def describe(self) -> dict[str, Any]:
        """Static description sent once to the frontend (geometry etc.)."""
        return {"name": self.name, "kind": self.kind}
