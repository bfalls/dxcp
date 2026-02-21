from enum import Enum
from typing import List, Optional
from pydantic import BaseModel, Field


class Role(str, Enum):
    PLATFORM_ADMIN = "PLATFORM_ADMIN"
    DELIVERY_OWNER = "DELIVERY_OWNER"
    OBSERVER = "OBSERVER"
    CI_PUBLISHER = "CI_PUBLISHER"


class CiPublisherProvider(str, Enum):
    GITHUB = "github"
    JENKINS = "jenkins"
    SPINNAKER = "spinnaker"
    CUSTOM = "custom"


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
    PROMOTE = "PROMOTE"


class RecipeStatus(str, Enum):
    ACTIVE = "active"
    DEPRECATED = "deprecated"


class EngineType(str, Enum):
    # Explicit engine identity even while DXCP is Spinnaker-only.
    SPINNAKER = "SPINNAKER"


class EnvironmentType(str, Enum):
    NON_PROD = "non_prod"
    PROD = "prod"


class DeploymentIntent(BaseModel):
    service: str
    environment: str
    version: str
    changeSummary: str = Field(..., max_length=240)
    recipeId: str


class PromotionIntent(BaseModel):
    service: str
    source_environment: str
    target_environment: str
    version: str
    recipeId: str
    changeSummary: str = Field(..., max_length=240)


class PolicySummaryRequest(BaseModel):
    service: str
    environment: str
    recipeId: Optional[str] = None


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
    recipeRevision: Optional[int] = None
    effectiveBehaviorSummary: Optional[str] = None
    state: DeploymentState
    deploymentKind: Optional[DeploymentKind] = None
    outcome: Optional[DeploymentOutcome] = None
    intentCorrelationId: Optional[str] = None
    supersededBy: Optional[str] = None
    changeSummary: str
    createdAt: str
    updatedAt: str
    deliveryGroupId: str
    engine_type: EngineType
    engineExecutionId: Optional[str] = None
    engineExecutionUrl: Optional[str] = None
    rollbackOf: Optional[str] = None
    sourceEnvironment: Optional[str] = None
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
    allowed_environments: Optional[List[str]] = None
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
    allowed_environments: Optional[List[str]] = None
    allowed_recipes: List[str]
    guardrails: Optional[DeliveryGroupGuardrails] = None
    change_reason: Optional[str] = None


class Environment(BaseModel):
    id: str
    name: str
    display_name: Optional[str] = None
    type: EnvironmentType
    promotion_order: Optional[int] = None
    delivery_group_id: str
    is_enabled: bool
    guardrails: Optional[DeliveryGroupGuardrails] = None


class Recipe(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    engine_type: EngineType
    spinnaker_application: Optional[str] = None
    deploy_pipeline: Optional[str] = None
    rollback_pipeline: Optional[str] = None
    recipe_revision: int
    effective_behavior_summary: str = Field(..., max_length=240)
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
    effective_behavior_summary: str = Field(..., max_length=240)
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
    email: Optional[str] = None


class CiPublisher(BaseModel):
    name: str
    provider: CiPublisherProvider

    issuers: Optional[List[str]] = None
    audiences: Optional[List[str]] = None
    authorized_party_azp: Optional[List[str]] = None
    subjects: Optional[List[str]] = None
    subject_prefixes: Optional[List[str]] = None
    emails: Optional[List[str]] = None

    description: Optional[str] = None
    owner: Optional[str] = None
    links: Optional[List[str]] = None


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
    git_sha: str
    git_branch: str
    ci_provider: str
    ci_run_id: str
    built_at: str
    commit_url: Optional[str] = None
    run_url: Optional[str] = None
    sha256: str
    sizeBytes: int
    contentType: str
    checksum_sha256: Optional[str] = None
    repo: Optional[str] = None
    actor: Optional[str] = None
    registeredAt: Optional[str] = None


class BuildRegisterExistingRequest(BaseModel):
    service: str
    version: str
    artifactRef: str
    git_sha: str
    git_branch: str
    ci_provider: str
    ci_run_id: str
    built_at: str
    commit_url: Optional[str] = None
    run_url: Optional[str] = None
    sha256: Optional[str] = None
    sizeBytes: Optional[int] = None
    contentType: Optional[str] = None
    checksum_sha256: Optional[str] = None
    repo: Optional[str] = None
    actor: Optional[str] = None
    s3Bucket: Optional[str] = None
    s3Key: Optional[str] = None


class ErrorResponse(BaseModel):
    code: str
    error_code: str
    failure_cause: str
    message: str
    request_id: str
    operator_hint: Optional[str] = None
    details: Optional[dict] = None
