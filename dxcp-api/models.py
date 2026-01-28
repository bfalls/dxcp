from enum import Enum
from typing import List, Optional
from pydantic import BaseModel, Field


class DeploymentState(str, Enum):
    PENDING = "PENDING"
    ACTIVE = "ACTIVE"
    IN_PROGRESS = "IN_PROGRESS"
    SUCCEEDED = "SUCCEEDED"
    FAILED = "FAILED"
    CANCELED = "CANCELED"
    ROLLED_BACK = "ROLLED_BACK"


class DeploymentIntent(BaseModel):
    service: str
    environment: str
    version: str
    changeSummary: str = Field(..., max_length=240)


class NormalizedFailure(BaseModel):
    category: str
    summary: str
    detail: Optional[str] = None
    actionHint: Optional[str] = None
    observedAt: str


class DeploymentRecord(BaseModel):
    id: str
    service: str
    environment: str
    version: str
    state: DeploymentState
    createdAt: str
    updatedAt: str
    spinnakerExecutionId: str
    spinnakerExecutionUrl: str
    failures: List[NormalizedFailure] = []


class BuildUploadRequest(BaseModel):
    service: str
    version: str
    expectedSizeBytes: int
    expectedSha256: str
    contentType: str


class BuildUploadCapability(BaseModel):
    uploadType: str
    uploadUrl: Optional[str] = None
    uploadToken: Optional[str] = None
    expiresAt: str
    expectedSizeBytes: int
    expectedSha256: str
    expectedContentType: str


class BuildRegistration(BaseModel):
    service: str
    version: str
    artifactRef: str
    sha256: str
    sizeBytes: int
    contentType: str
    registeredAt: Optional[str] = None


class ErrorResponse(BaseModel):
    code: str
    message: str
    details: Optional[dict] = None
