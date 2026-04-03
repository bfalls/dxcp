from dataclasses import dataclass
from typing import Any, Optional

from models import EngineType


@dataclass(frozen=True)
class ServiceEnvironmentRoute:
    service_id: str
    environment_id: str
    recipe_id: str


@dataclass(frozen=True)
class EngineOperationBinding:
    operation: str
    target: Optional[str]


@dataclass(frozen=True)
class ExecutionPlan:
    recipe_id: str
    recipe_revision: Optional[int]
    effective_behavior_summary: Optional[str]
    engine_type: str
    deploy_operation: EngineOperationBinding
    rollback_operation: EngineOperationBinding
    engine_config: dict[str, Any]


def execution_plan_from_recipe(recipe: dict) -> ExecutionPlan:
    engine_type = recipe.get("engine_type") or EngineType.SPINNAKER.value
    return ExecutionPlan(
        recipe_id=recipe["id"],
        recipe_revision=recipe.get("recipe_revision"),
        effective_behavior_summary=recipe.get("effective_behavior_summary"),
        engine_type=engine_type,
        deploy_operation=EngineOperationBinding("deploy", recipe.get("deploy_pipeline")),
        rollback_operation=EngineOperationBinding("rollback", recipe.get("rollback_pipeline")),
        engine_config={
            "spinnaker_application": recipe.get("spinnaker_application"),
        },
    )


def apply_execution_plan(payload: dict, execution_plan: ExecutionPlan, operation: str) -> dict:
    resolved = dict(payload)
    if execution_plan.engine_type != EngineType.SPINNAKER.value:
        raise ValueError(f"Unsupported engine_type: {execution_plan.engine_type}")

    application = execution_plan.engine_config.get("spinnaker_application")
    if application:
        resolved["spinnakerApplication"] = application

    binding = execution_plan.deploy_operation
    if operation == "rollback":
        binding = execution_plan.rollback_operation
    if binding.target:
        resolved["spinnakerPipeline"] = binding.target
    return resolved
