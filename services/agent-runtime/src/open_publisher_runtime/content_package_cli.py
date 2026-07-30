from __future__ import annotations

import argparse
import json
from pathlib import Path

from open_publisher_runtime.application.content_package_directory import (
    ContentPackageDirectoryService,
)
from open_publisher_runtime.domain.contracts import ContentPackageV1


def parser() -> argparse.ArgumentParser:
    command = argparse.ArgumentParser(
        prog="open-publisher-content-package",
        description="Materialize or verify a portable ContentPackage v1 directory.",
    )
    subcommands = command.add_subparsers(dest="command", required=True)

    materialize = subcommands.add_parser(
        "materialize",
        help="Convert a ContentPackage transfer JSON document into a directory.",
    )
    materialize.add_argument("source_json", type=Path)
    materialize.add_argument("destination", type=Path)

    verify = subcommands.add_parser(
        "verify",
        help="Verify a materialized ContentPackage directory and every entry hash.",
    )
    verify.add_argument("directory", type=Path)
    return command


def main(arguments: list[str] | None = None) -> int:
    options = parser().parse_args(arguments)
    service = ContentPackageDirectoryService()
    if options.command == "materialize":
        package = ContentPackageV1.model_validate_json(
            options.source_json.read_text(encoding="utf-8")
        )
        result = service.materialize(package, options.destination)
        print(
            json.dumps(
                {
                    "root": str(result.root),
                    "packageHash": result.manifest["packageHash"],
                },
                ensure_ascii=False,
            )
        )
        return 0

    manifest = service.verify(options.directory)
    print(
        json.dumps(
            {
                "root": str(options.directory.resolve()),
                "packageHash": manifest["packageHash"],
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
