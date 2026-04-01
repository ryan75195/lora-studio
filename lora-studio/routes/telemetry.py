"""Telemetry routes - view analytics on AI usage."""

from fastapi import APIRouter
from services.telemetry import get_events, get_stats

router = APIRouter()


@router.get("/api/telemetry/stats")
async def telemetry_stats():
    return get_stats()


@router.get("/api/telemetry/events")
async def telemetry_events(event_type: str = None, limit: int = 100):
    return get_events(event_type=event_type, limit=limit)
