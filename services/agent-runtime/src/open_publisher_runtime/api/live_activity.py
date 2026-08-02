from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field
from threading import Lock

from open_publisher_runtime.domain.entities import RuntimeEvent


@dataclass(slots=True)
class LiveWorkflowActivityStore:
    """Thread-safe, bounded transport for progress that must reach the editor now."""

    max_events_per_run: int = 512
    _events_by_run: dict[str, deque[RuntimeEvent]] = field(default_factory=dict)
    _lock: Lock = field(default_factory=Lock)

    def append(self, event: RuntimeEvent) -> None:
        if event.run_id is None:
            return
        with self._lock:
            events = self._events_by_run.setdefault(
                event.run_id,
                deque(maxlen=self.max_events_per_run),
            )
            events.append(event)

    def snapshot(self, run_id: str) -> list[RuntimeEvent]:
        with self._lock:
            return list(self._events_by_run.get(run_id, ()))
