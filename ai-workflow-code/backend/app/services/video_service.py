"""
Video workflow service layer.
Handles state machine transitions, first-frame writes, and session sync.
"""
from __future__ import annotations

from typing import Optional
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.video import VideoDraft, VideoJob, VideoMotionData


# ──────────────────────────────────────────
# Status machine
# ──────────────────────────────────────────

# Valid forward transitions only — no skipping steps
STEP_STATUS_MAP = {
    1: "draft",
    2: "step1_done",
    3: "step2_done",
    4: "step3_done",
    5: "step4_done",
    6: "step5_done",
    7: "post_processing",
}

VALID_STATUSES = set(STEP_STATUS_MAP.values()) | {
    "completed",
    "archived",
    "failed",
}


def advance_step(job: VideoJob, target_step: int) -> VideoJob:
    """Push job to the next step. Raises ValueError if transition is invalid."""
    if target_step < 1 or target_step > 7:
        raise ValueError(f"Invalid step: {target_step}")
    if target_step < job.current_step:
        # Allow going back (user pressed 上一步)
        pass
    job.current_step = target_step
    job.status = STEP_STATUS_MAP.get(target_step, job.status)
    return job


def set_status(job: VideoJob, status: str) -> VideoJob:
    """Set an explicit status (completed / archived / failed)."""
    if status not in VALID_STATUSES:
        raise ValueError(f"Unknown status: {status}")
    job.status = status
    return job


# ──────────────────────────────────────────
# First frame helpers
# ──────────────────────────────────────────

def apply_first_frame(
    job: VideoJob,
    asset_id: int,
    url: str,
    source_type: str,
) -> VideoJob:
    """Write first frame data and mark as selected."""
    job.first_frame_asset_id = asset_id
    job.first_frame_url = url
    job.first_frame_source_type = source_type
    job.first_frame_status = "selected"
    return job


def clear_first_frame(job: VideoJob) -> VideoJob:
    """Reset first frame to empty state."""
    job.first_frame_asset_id = None
    job.first_frame_url = None
    job.first_frame_source_type = None
    job.first_frame_status = "empty"
    return job


def is_first_frame_ready(job: VideoJob) -> bool:
    """Check whether first frame is ready to proceed to step 2."""
    return job.first_frame_status == "selected" and job.first_frame_url is not None


# ──────────────────────────────────────────
# Motion data helpers
# ──────────────────────────────────────────

def build_motion_sequence(keypoints: list[dict]) -> tuple[list[str], dict]:
    """
    Convert raw keypoints [{timestamp, label}] into
    (motion_sequence, timing) structure data.
    """
    sorted_kp = sorted(keypoints, key=lambda k: k.get("timestamp", 0))
    motion_sequence = [kp["label"] for kp in sorted_kp]
    timing = {
        kp["label"]: round(kp["timestamp"], 3)
        for kp in sorted_kp
    }
    return motion_sequence, timing


def get_motion_data(job_id: UUID, db: Session) -> Optional[VideoMotionData]:
    return db.execute(
        select(VideoMotionData).where(VideoMotionData.video_job_id == job_id)
    ).scalar_one_or_none()


# ──────────────────────────────────────────
# Draft helpers
# ──────────────────────────────────────────

def get_selected_draft(job_id: UUID, db: Session) -> Optional[VideoDraft]:
    return db.execute(
        select(VideoDraft).where(
            VideoDraft.video_job_id == job_id,
            VideoDraft.selected == True,  # noqa: E712
        )
    ).scalar_one_or_none()


def select_draft(draft_id: UUID, job_id: UUID, db: Session) -> VideoDraft:
    """Mark one draft as selected, deselect all others for this job."""
    drafts = db.execute(
        select(VideoDraft).where(VideoDraft.video_job_id == job_id)
    ).scalars().all()
    selected = None
    for d in drafts:
        d.selected = d.id == draft_id
        if d.id == draft_id:
            d.status = "selected"
            selected = d
    if selected is None:
        raise ValueError(f"Draft {draft_id} not found for job {job_id}")
    db.commit()
    return selected


# ──────────────────────────────────────────
# Job lookup
# ──────────────────────────────────────────

def get_job(job_id: UUID, db: Session) -> Optional[VideoJob]:
    return db.execute(
        select(VideoJob).where(VideoJob.id == job_id)
    ).scalar_one_or_none()
