"""Thread-safe pub/sub used by models to fire student-facing callbacks."""

from __future__ import annotations

import threading
from collections import defaultdict
from collections.abc import Callable


class EventBus:
    def __init__(self) -> None:
        self._subs: dict[str, list[Callable[..., None]]] = defaultdict(list)
        self._lock = threading.Lock()

    def subscribe(self, topic: str, fn: Callable[..., None]) -> None:
        with self._lock:
            self._subs[topic].append(fn)

    def publish(self, topic: str, *args) -> None:
        with self._lock:
            subs = list(self._subs.get(topic, ()))
        for fn in subs:
            fn(*args)
