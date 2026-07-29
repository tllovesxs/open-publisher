from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from open_publisher_runtime.config import Settings
from open_publisher_runtime.main import create_app


@pytest.fixture
def client(tmp_path) -> Iterator[TestClient]:
    settings = Settings(data_dir=tmp_path / "runtime-data")
    app = create_app(settings)
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def article_payload() -> dict[str, str]:
    return {
        "title": "测试文章",
        "markdown": "# 初稿\n\n这是第一版内容。",
    }

