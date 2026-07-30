from __future__ import annotations

import base64
import hashlib
import json
from pathlib import Path

import pytest

from open_publisher_runtime.application.content_package_directory import (
    ContentPackageDirectoryService,
)
from open_publisher_runtime.content_package_cli import main
from open_publisher_runtime.domain.contracts import (
    ContentPackageArticleV1,
    ContentPackageAssetV1,
    ContentPackageV1,
)


def _package() -> ContentPackageV1:
    image = b"portable-image"
    markdown = "# Portable\n\nWandao can import this directory."
    return ContentPackageV1(
        package_id="package:portable-demo",
        article=ContentPackageArticleV1(
            title="Portable",
            revision_number=2,
            canonical_markdown=markdown,
            content_hash=hashlib.sha256(markdown.encode()).hexdigest(),
        ),
        assets=[
            ContentPackageAssetV1(
                path="assets/image.bin",
                kind="image",
                media_type="application/octet-stream",
                content_base64=base64.b64encode(image).decode(),
                content_hash=hashlib.sha256(image).hexdigest(),
                metadata={"artifact_id": "artifact:image"},
            )
        ],
        metadata={
            "article_id": "article:portable",
            "revision_id": "revision:portable:2",
            "platform_variant_ids": ["variant:wechat"],
        },
    )


def test_materialized_directory_matches_contract_shape_and_verifies(tmp_path) -> None:
    service = ContentPackageDirectoryService()
    destination = tmp_path / "content-package"

    result = service.materialize(_package(), destination)

    assert result.root == destination.resolve()
    assert (
        (destination / "articles" / "article_portable.md")
        .read_text(encoding="utf-8")
        .startswith("# Portable")
    )
    assert (destination / "assets" / "image.bin").read_bytes() == b"portable-image"
    manifest = json.loads((destination / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["schemaVersion"] == "1.0"
    assert manifest["sourceApp"] == "open-publisher"
    assert manifest["packageHash"].startswith("sha256:")
    assert manifest["articleRevisionId"] == "revision:portable:2"
    assert len(manifest["entries"]) == 2
    assert service.verify(destination) == manifest


def test_materializer_never_overwrites_and_verifier_detects_tampering(tmp_path) -> None:
    service = ContentPackageDirectoryService()
    destination = tmp_path / "content-package"
    service.materialize(_package(), destination)

    with pytest.raises(FileExistsError):
        service.materialize(_package(), destination)

    (destination / "assets" / "image.bin").write_bytes(b"tampered")
    with pytest.raises(ValueError, match="entry size mismatch"):
        service.verify(destination)


def test_materializer_rejects_nonportable_asset_names_before_writing(tmp_path) -> None:
    package = _package()
    package.assets[0].path = "assets/NUL.txt"
    destination = tmp_path / "content-package"

    with pytest.raises(ValueError, match="not portable"):
        ContentPackageDirectoryService().materialize(package, destination)
    assert not destination.exists()


def test_materializer_rejects_tampered_canonical_markdown(tmp_path) -> None:
    package = _package()
    package.article.content_hash = "0" * 64

    with pytest.raises(ValueError, match="Markdown hash mismatch"):
        ContentPackageDirectoryService().materialize(package, tmp_path / "content-package")


def test_materializer_rejects_duplicate_artifact_ids_before_writing(tmp_path) -> None:
    package = _package()
    package.assets.append(
        ContentPackageAssetV1(
            path="assets/second.bin",
            kind="image",
            media_type="application/octet-stream",
            content_base64=package.assets[0].content_base64,
            content_hash=package.assets[0].content_hash,
            metadata={"artifact_id": "artifact:image"},
        )
    )
    destination = tmp_path / "content-package"

    with pytest.raises(ValueError, match="artifact ids must be unique"):
        ContentPackageDirectoryService().materialize(package, destination)
    assert not destination.exists()


def test_verifier_rejects_duplicate_artifact_ids_and_unbounded_entries(
    tmp_path, monkeypatch
) -> None:
    service = ContentPackageDirectoryService()
    destination = tmp_path / "content-package"
    service.materialize(_package(), destination)
    manifest_path = destination / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["entries"][1]["artifactId"] = manifest["entries"][0]["artifactId"]

    from open_publisher_runtime.application import content_package_directory as directory_module

    without_hash = {key: value for key, value in manifest.items() if key != "packageHash"}
    manifest["packageHash"] = directory_module._manifest_with_hash(without_hash)["packageHash"]
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    with pytest.raises(ValueError, match="duplicate ContentPackage artifact id"):
        service.verify(destination)

    monkeypatch.setattr(directory_module, "MAX_CONTENT_PACKAGE_ASSETS", 0)
    with pytest.raises(ValueError, match="too many entries"):
        service.verify(destination)


def test_verifier_checks_actual_entry_size_before_reading_forged_file(
    tmp_path,
    monkeypatch,
) -> None:
    from open_publisher_runtime.application import content_package_directory as directory_module

    service = ContentPackageDirectoryService()
    destination = tmp_path / "content-package"
    service.materialize(_package(), destination)
    asset_path = destination / "assets" / "image.bin"
    oversized = b"x" * 9
    asset_path.write_bytes(oversized)

    manifest_path = destination / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    asset_entry = next(
        entry for entry in manifest["entries"] if entry["path"].startswith("assets/")
    )
    asset_entry["sizeBytes"] = 1
    asset_entry["contentHash"] = f"sha256:{hashlib.sha256(oversized).hexdigest()}"
    without_hash = {key: value for key, value in manifest.items() if key != "packageHash"}
    manifest["packageHash"] = directory_module._manifest_with_hash(without_hash)["packageHash"]
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    original_read_bytes = Path.read_bytes

    def reject_asset_read(path: Path) -> bytes:
        if path == asset_path:
            raise AssertionError("oversized asset was read before its stat size was checked")
        return original_read_bytes(path)

    monkeypatch.setattr(Path, "read_bytes", reject_asset_read)
    monkeypatch.setattr(directory_module, "MAX_CONTENT_PACKAGE_ASSET_BYTES", 8)
    with pytest.raises(ValueError, match="entry exceeds the size limit"):
        service.verify(destination)


def test_verifier_checks_actual_total_before_reading_later_entry(
    tmp_path,
    monkeypatch,
) -> None:
    from open_publisher_runtime.application import content_package_directory as directory_module

    service = ContentPackageDirectoryService()
    destination = tmp_path / "content-package"
    service.materialize(_package(), destination)
    article_path = destination / "articles" / "article_portable.md"
    asset_path = destination / "assets" / "image.bin"
    asset_data = asset_path.read_bytes()

    manifest_path = destination / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    asset_entry = next(
        entry for entry in manifest["entries"] if entry["path"].startswith("assets/")
    )
    asset_entry["sizeBytes"] = 1
    without_hash = {key: value for key, value in manifest.items() if key != "packageHash"}
    manifest["packageHash"] = directory_module._manifest_with_hash(without_hash)["packageHash"]
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    original_read_bytes = Path.read_bytes

    def reject_asset_read(path: Path) -> bytes:
        if path == asset_path:
            raise AssertionError("asset was read before the actual total size was checked")
        return original_read_bytes(path)

    monkeypatch.setattr(Path, "read_bytes", reject_asset_read)
    monkeypatch.setattr(
        directory_module,
        "MAX_CONTENT_PACKAGE_DIRECTORY_BYTES",
        article_path.stat().st_size + len(asset_data) - 1,
    )
    with pytest.raises(ValueError, match="actual total size limit"):
        service.verify(destination)


def test_cli_materializes_and_verifies_a_transfer_document(tmp_path, capsys) -> None:
    source = tmp_path / "package.json"
    source.write_text(_package().model_dump_json(), encoding="utf-8")
    destination = tmp_path / "portable"

    assert main(["materialize", str(source), str(destination)]) == 0
    materialized = json.loads(capsys.readouterr().out)
    assert materialized["packageHash"].startswith("sha256:")

    assert main(["verify", str(destination)]) == 0
    verified = json.loads(capsys.readouterr().out)
    assert verified["packageHash"] == materialized["packageHash"]
