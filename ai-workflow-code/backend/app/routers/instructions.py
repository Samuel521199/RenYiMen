from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_current_user, get_db
from app.models.instruction import Instruction, WorkflowType
from app.schemas.instruction import (
    InstructionCreate,
    InstructionResponse,
    InstructionUpdate,
    WorkflowTypeCreate,
    WorkflowTypeResponse,
)
from app.utils.response import ok


router = APIRouter()


def serialize_workflow_type(workflow_type: WorkflowType) -> dict[str, Any]:
    return WorkflowTypeResponse.model_validate(workflow_type).model_dump(mode="json")


def serialize_instruction(instruction: Instruction) -> dict[str, Any]:
    return InstructionResponse.model_validate(instruction).model_dump(mode="json")


async def get_instruction_or_404(db: AsyncSession, instruction_id: int) -> Instruction:
    result = await db.execute(select(Instruction).where(Instruction.id == instruction_id))
    instruction = result.scalar_one_or_none()
    if instruction is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Instruction not found",
        )
    return instruction


@router.get("/api/workflow-types")
async def list_workflow_types(
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    result = await db.execute(select(WorkflowType).order_by(WorkflowType.id.asc()))
    workflow_types = [serialize_workflow_type(item) for item in result.scalars().all()]
    return ok(workflow_types)


@router.post("/api/workflow-types/create")
async def create_workflow_type(
    req: WorkflowTypeCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    workflow_type = WorkflowType(**req.model_dump())
    db.add(workflow_type)
    await db.commit()
    await db.refresh(workflow_type)
    return ok(serialize_workflow_type(workflow_type))


@router.get("/api/instructions")
async def list_instructions(
    workflow_type_id: int | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    query = select(Instruction).order_by(Instruction.id.desc())
    if workflow_type_id is not None:
        query = query.where(Instruction.workflow_type_id == workflow_type_id)
    result = await db.execute(query)
    instructions = [serialize_instruction(item) for item in result.scalars().all()]
    return ok(instructions)


@router.post("/api/instructions/create")
async def create_instruction(
    req: InstructionCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    instruction = Instruction(
        **req.model_dump(),
        created_by=int(current_user["id"]),
    )
    db.add(instruction)
    await db.commit()
    await db.refresh(instruction)
    return ok(serialize_instruction(instruction))


@router.put("/api/instructions/{id}")
async def update_instruction(
    id: int,
    req: InstructionUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    instruction = await get_instruction_or_404(db, id)
    for field, value in req.model_dump(exclude_unset=True).items():
        setattr(instruction, field, value)
    await db.commit()
    await db.refresh(instruction)
    return ok(serialize_instruction(instruction))


@router.delete("/api/instructions/{id}")
async def delete_instruction(
    id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    instruction = await get_instruction_or_404(db, id)
    await db.delete(instruction)
    await db.commit()
    return ok({"deleted": id})


@router.patch("/api/instructions/{id}/toggle")
async def toggle_instruction(
    id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    instruction = await get_instruction_or_404(db, id)
    instruction.active = not instruction.active
    await db.commit()
    await db.refresh(instruction)
    return ok(serialize_instruction(instruction))
