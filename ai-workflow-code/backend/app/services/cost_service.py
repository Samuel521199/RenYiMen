from datetime import date
from decimal import Decimal, ROUND_HALF_UP

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.services import _model_imports as _model_imports
from app.models.image import GenerationLog
from app.models.stats import DailyCostStat


TOKEN_RATES_PER_1K = {
    "openai": Decimal("0.0100"),
    "google": Decimal("0.0050"),
}


def calculate_cost_usd(db: AsyncSession | None, provider: str, token_count: int) -> Decimal:
    rate = TOKEN_RATES_PER_1K.get(provider.lower())
    if rate is None:
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail=f"Cost calculation for provider '{provider}' is not implemented",
        )
    return ((Decimal(token_count) / Decimal(1000)) * rate).quantize(
        Decimal("0.0001"),
        rounding=ROUND_HALF_UP,
    )


async def log_generation_cost(
    db: AsyncSession,
    task_id: int | None,
    operator_id: int | None,
    provider: str,
    model_name: str,
    prompt: str,
    image_count: int,
    token_used: int,
    status_value: str = "success",
) -> GenerationLog:
    cost_usd = calculate_cost_usd(db, provider, token_used)
    log = GenerationLog(
        task_id=task_id,
        operator_id=operator_id,
        model_provider=provider,
        model_name=model_name,
        prompt=prompt,
        image_count=image_count,
        token_used=token_used,
        cost_usd=cost_usd,
        status=status_value,
    )
    db.add(log)

    today = date.today()
    result = await db.execute(
        select(DailyCostStat).where(
            DailyCostStat.stat_date == today,
            DailyCostStat.user_id == operator_id,
            DailyCostStat.model_provider == provider,
        )
    )
    daily = result.scalar_one_or_none()
    if daily is None:
        daily = DailyCostStat(
            stat_date=today,
            user_id=operator_id,
            model_provider=provider,
            total_tokens=0,
            total_cost=Decimal("0"),
            image_count=0,
        )
        db.add(daily)

    daily.total_tokens = int(daily.total_tokens or 0) + token_used
    daily.total_cost = Decimal(daily.total_cost or 0) + cost_usd
    daily.image_count = int(daily.image_count or 0) + image_count

    await db.commit()
    await db.refresh(log)
    return log
