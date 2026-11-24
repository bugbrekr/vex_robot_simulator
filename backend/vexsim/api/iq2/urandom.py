"""MicroPython's ``urandom`` module (VEXcode IQ projects ``import urandom`` to seed it)."""

from __future__ import annotations

import random as _random

_rng = _random.Random(0)


def seed(n=None) -> None:
    _rng.seed(n)


def getrandbits(n: int) -> int:
    return _rng.getrandbits(n)


def randint(a: int, b: int) -> int:
    return _rng.randint(a, b)


def randrange(*args) -> int:
    return _rng.randrange(*args)


def random() -> float:
    return _rng.random()


def uniform(a: float, b: float) -> float:
    return _rng.uniform(a, b)


def choice(seq):
    return _rng.choice(seq)
