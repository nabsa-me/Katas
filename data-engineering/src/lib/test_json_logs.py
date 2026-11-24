import io
import json
from collections.abc import Iterator

import pytest
import structlog

from lib.json_logs import configure_json_logs


@pytest.fixture(autouse=True)
def reset_structlog() -> Iterator[None]:
    yield
    structlog.reset_defaults()


def test_every_event_is_one_json_line_with_level_timestamp_and_bound_values() -> None:
    stream = io.StringIO()
    configure_json_logs(stream)

    structlog.get_logger().bind(run_id="run-1").info("batch_committed", page=2)

    line = json.loads(stream.getvalue())
    assert line["event"] == "batch_committed"
    assert line["run_id"] == "run-1"
    assert line["page"] == 2
    assert line["level"] == "info"
    assert line["timestamp"].endswith("Z")
