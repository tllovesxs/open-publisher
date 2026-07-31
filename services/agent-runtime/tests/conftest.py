from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from open_publisher_runtime.config import Settings
from open_publisher_runtime.main import LOCAL_DEMO_ENV, MODEL_ENV_VARIABLES, create_app

TEST_API_TOKEN = "test-open-publisher-sidecar-token-0001"


@pytest.fixture(autouse=True)
def isolate_model_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    for variable in MODEL_ENV_VARIABLES:
        monkeypatch.delenv(variable, raising=False)


@pytest.fixture
def client(tmp_path, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    # Runtime behavior tests intentionally opt into local simulation. Production
    # defaults to an explicit unconfigured-model failure instead of fabricated output.
    monkeypatch.setenv(LOCAL_DEMO_ENV, "true")
    settings = Settings(
        data_dir=tmp_path / "runtime-data",
        api_token=TEST_API_TOKEN,
    )
    app = create_app(settings)
    with TestClient(app) as test_client:
        test_client.headers.update({"Authorization": f"Bearer {TEST_API_TOKEN}"})
        yield test_client


@pytest.fixture
def article_payload() -> dict[str, str]:
    return {
        "title": "测试文章",
        "markdown": "# 初稿\n\n这是第一版内容。",
    }
