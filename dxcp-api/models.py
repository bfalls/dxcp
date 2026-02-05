from enum import Enum
from typing import List, Optional
from pydantic import BaseModel, Field


class Role(str, Enum):
    PLATFORM_ADMIN = "PLATFORM_ADMIN"
    DELIVERY_OWNER = "DELIVERY_OWNER"
    OBSERVER = "OBSERVER"


class DeploymentState(str, Enum):
    PENDING = "PENDING"
    ACTIVE = "ACTIVE"
    IN_PROGRESS = "IN_PROGRESS"
    SUCCEEDED = "SUCCEEDED"
    FAILED = "FAILED"
    CANCELED = "CANCELED"
    ROLLED_BACK = "ROLLED_BACK"


class DeploymentOutcome(str, Enum):
    SUCCEEDED = "SUCCEEDED"
    FAILED = "FAILED"
    ROLLED_BACK = "ROLLED_BACK"
    CANCELED = "CANCELED"
    SUPERSEDED = "SUPERSEDED"


class DeploymentKind(str, Enum):
    ROLL_FORWARD = "ROLL_FORWARD"
    ROLLBACK = "ROLLBACK"


class RecipeStatus(str, Enum):
    ACTIVE = "active"
    DEPRECATED = "deprecated"


class DeploymentIntent(BaseModel):
    service: str
    environment: str
    version: str
    changeSummary: str = Field(..., max_length=240)
    recipeId: str


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
    recipeId: str
    state: DeploymentState
    deploymentKind: Optional[DeploymentKind] = None
    outcome: Optional[DeploymentOutcome] = None
    changeSummary: str
    createdAt: str
    updatedAt: str
    deliveryGroupId: str
    engineExecutionId: Optional[str] = None
    engineExecutionUrl: Optional[str] = None
    rollbackOf: Optional[str] = None
    failures: List[NormalizedFailure] = []


class TimelineEvent(BaseModel):
    key: str
    label: str
    occurredAt: str
    detail: Optional[str] = None


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
    created_at: Optional[str] = None
    created_by: Optional[str] = None
    updated_at: Optional[str] = None
    updated_by: Optional[str] = None
    last_change_reason: Optional[str] = None


class DeliveryGroupUpsert(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    owner: Optional[str] = None
    services: List[str]
    allowed_recipes: List[str]
    guardrails: Optional[DeliveryGroupGuardrails] = None
    change_reason: Optional[str] = None


class Recipe(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    spinnaker_application: Optional[str] = None
    deploy_pipeline: Optional[str] = None
    rollback_pipeline: Optional[str] = None
    status: RecipeStatus = RecipeStatus.ACTIVE
    created_at: Optional[str] = None
    created_by: Optional[str] = None
    updated_at: Optional[str] = None
    updated_by: Optional[str] = None
    last_change_reason: Optional[str] = None


class RecipeUpsert(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    spinnaker_application: Optional[str] = None
    deploy_pipeline: Optional[str] = None
    rollback_pipeline: Optional[str] = None
    status: RecipeStatus = RecipeStatus.ACTIVE
    change_reason: Optional[str] = None


class AuditOutcome(str, Enum):
    SUCCESS = "SUCCESS"
    DENIED = "DENIED"
    FAILED = "FAILED"


class AuditEvent(BaseModel):
    event_id: str
    event_type: str
    actor_id: str
    actor_role: str
    target_type: str
    target_id: str
    timestamp: str
    outcome: AuditOutcome
    summary: str
    delivery_group_id: Optional[str] = None
    service_name: Optional[str] = None
    environment: Optional[str] = None


class Actor(BaseModel):
    actor_id: str
    role: Role


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
    request_id: str
    operator_hint: Optional[str] = None
    details: Optional[dict] = None
