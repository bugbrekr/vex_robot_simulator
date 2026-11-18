"""Messages exchanged between worker <-> server <-> browser (JSON objects with a ``type``).

worker -> server/browser:
  hello    {scene}                       static scene description (sent once per worker)
  frame    {t, arm, tower, world}         ~30 Hz state
  console  {text}                         student print output
  warning  {text}                         simulator notices (e.g. unreachable target)
  error    {message, line, traceback}     uncaught student exception
  status   {state}                        idle | running | finished | stopped

browser -> server -> worker (one persistent worker per session; the scene survives runs):
  reset    {scenario}                    server starts a NEW worker (fresh map)
  run      {code}                        new project run (homes to safe position first)
  stop / speed {value} / pause {value} / bumper {pressed} / erase
  pendant: safe | manual {enabled} | drag {pos} | drag_end | jog {mode: xyz|rpy|abs, delta|pos}
           | tool {tool?, magnet?, pen_offset?, speed?}     (ignored while a project runs)
  objects (any time): add_object {kind,x,y} | grab_object {id} | move_object {id,pos}
           | drop_object {id,x,y,delete?} | remove_object {id} | clear_objects
  simulator-only: sim_home | marker {protrusion}
"""

from __future__ import annotations

import json
import threading
from typing import IO, Any


class JsonLineWriter:
    def __init__(self, stream: IO[str]):
        self.stream = stream
        self.lock = threading.Lock()

    def send(self, msg: dict[str, Any]) -> None:
        line = json.dumps(msg, separators=(",", ":"))
        with self.lock:
            try:
                self.stream.write(line + "\n")
                self.stream.flush()
            except (BrokenPipeError, ValueError):
                pass
