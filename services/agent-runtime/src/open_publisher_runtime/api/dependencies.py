from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass
from secrets import compare_digest
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from open_publisher_runtime.application.model_access import ModelAccessLayer
from open_publisher_runtime.application.publishing import DeterministicDryRunPublisher
from open_publisher_runtime.infrastructure.artifact_store import FileSystemArtifactStore
from open_publisher_runtime.infrastructure.database import Database
from open_publisher_runtime.infrastructure.repository import SqlAlchemyRuntimeRepository
from open_publisher_runtime.workflows.preset import PresetArticleWorkflow


@dataclass(slots=True)
class RuntimeContainer:
    database: Database
    blob_store: FileSystemArtifactStore
    model_access: ModelAccessLayer
    workflow_runner: PresetArticleWorkflow
    dry_run_publisher: DeterministicDryRunPublisher


bearer_scheme = HTTPBearer(auto_error=False)


def require_sidecar_token(
    request: Request,
    credentials: Annotated[
        HTTPAuthorizationCredentials | None,
        Depends(bearer_scheme),
    ],
) -> None:
    expected = str(request.app.state.api_token)
    supplied = (
        credentials.credentials
        if credentials and credentials.scheme.casefold() == "bearer"
        else ""
    )
    if not supplied or not compare_digest(supplied, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="valid sidecar bearer token required",
            headers={"WWW-Authenticate": "Bearer"},
        )


def get_container(request: Request) -> RuntimeContainer:
    return request.app.state.container


def get_session(request: Request) -> Iterator[Session]:
    container = get_container(request)
    session = container.database.session_factory()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def get_repository(
    session: Session = None,  # type: ignore[assignment]
) -> SqlAlchemyRuntimeRepository:
    # FastAPI supplies this argument through the route-level dependency wrapper.
    if session is None:
        raise RuntimeError("database session dependency was not supplied")
    return SqlAlchemyRuntimeRepository(session)
