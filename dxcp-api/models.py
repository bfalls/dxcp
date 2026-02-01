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
    spinnakerApplication: Optional[str] = None
    spinnakerPipeline: Optional[str] = None


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
    rollbackOf: Optional[str] = None
    failures: List[NormalizedFailure] = []


class DeliveryGroupGuardrails(BaseModel):
    max_concurrent_deployments: Optional[int] = None
    daily_deploy_quota: Optional[int] = None
    daily_rollback_quota: Optional[int] = None


class DeliveryGroup(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    owner: Optional[str] = None
    services: List[str]
    allowed_recipes: List[str]
    guardrails: Optional[DeliveryGroupGuardrails] = None


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


class BuildRegisterExistingRequest(BaseModel):
    service: str
    version: str
    artifactRef: Optional[str] = None
    s3Bucket: Optional[str] = None
    s3Key: Optional[str] = None


class ErrorResponse(BaseModel):
    code: str
    message: str
    details: Optional[dict] = None
