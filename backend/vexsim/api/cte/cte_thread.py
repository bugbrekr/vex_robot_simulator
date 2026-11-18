"""``cte_thread(main)`` - the entry point of a VEXcode CTE Python project.

VEXcode CTE projects put their code in ``def main():`` and end with ``cte_thread(main)``,
which starts ``main`` as the project's main thread. On the real arm the project only runs
when started this way; the simulator also runs programs without it, with a warning
(see ``vexsim.runner.worker.uses_cte_thread``)."""

from __future__ import annotations

from vexsim.api.common.runtime import runtime


def cte_thread(func, args=()):
    """Start ``func(*args)`` as the project's main thread and return immediately."""
    if not callable(func):
        raise TypeError(f"cte_thread() needs a function, e.g. cte_thread(main) - got {func!r}")
    runtime().start_thread(func, tuple(args), name=f"cte_thread:{getattr(func, '__name__', 'fn')}")
