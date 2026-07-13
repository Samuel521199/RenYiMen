from sqlalchemy import Column, Integer, String, Text, Boolean, ForeignKey, TIMESTAMP
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func
from app.database import Base


class TrendingTopicTypeConfig(Base):
    __tablename__ = "trending_topic_type_config"
    __table_args__ = {'extend_existing': True}
    id = Column(Integer, primary_key=True)
    topic_type = Column(String(50), unique=True, nullable=False)
    name_zh = Column(String(100), nullable=False)
    risk_level = Column(String(10), nullable=False)
    allow_game_integration = Column(Boolean, default=False)
    allowed_angles = Column(JSONB, default=list)
    allowed_image_types = Column(JSONB, default=list)
    allowed_actions = Column(JSONB, default=list)
    copy_style = Column(String(30), nullable=False)
    notes = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())


class TrendingJob(Base):
    __tablename__ = "trending_jobs"
    __table_args__ = {'extend_existing': True}
    id = Column(Integer, primary_key=True)
    session_id = Column(Integer, ForeignKey("workflow_sessions.id"), nullable=True)
    task_id = Column(Integer, ForeignKey("tasks.id"), nullable=True)
    news_title = Column(Text, nullable=False)
    publish_time = Column(TIMESTAMP(timezone=True), nullable=True)
    topic_type = Column(String(50), nullable=False)
    risk_level = Column(String(10), nullable=False)
    allow_game_integration = Column(Boolean, default=False)
    selected_angle = Column(String(50), nullable=True)
    selected_image_type = Column(String(50), nullable=True)
    selected_action = Column(String(100), nullable=True)
    copy_text = Column(Text, nullable=True)
    ad_size = Column(String(20), default="1080x1080")
    image_language = Column(String(20), default="english")
    draft_image_url = Column(Text, nullable=True)
    final_image_url = Column(Text, nullable=True)
    refined_image_url = Column(Text, nullable=True)
    status = Column(String(20), default="draft")
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())
    updated_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), onupdate=func.now())


class TrendingNewsTask(Base):
    __tablename__ = "trending_news_tasks"
    __table_args__ = {'extend_existing': True}

    id = Column(Integer, primary_key=True)
    task_id = Column(String(100), unique=True, nullable=False)
    title = Column(Text, nullable=False)
    publish_time = Column(TIMESTAMP(timezone=True), nullable=True)
    topic_type = Column(String(50), nullable=False)
    event_summary = Column(Text, nullable=True)
    main_entities = Column(JSONB, default=list)
    event_action = Column(Text, nullable=True)
    event_result = Column(Text, nullable=True)
    emotion_direction = Column(String(20), nullable=True)
    risk_tags = Column(JSONB, default=list)
    local_relevance = Column(Text, nullable=True)
    source_name = Column(String(200), nullable=True)
    source_url = Column(Text, nullable=True)
    risk_level = Column(String(10), nullable=True)
    allow_game_integration = Column(Boolean, default=False)
    import_status = Column(String(20), default="NEW")
    process_status = Column(String(20), default="PENDING")
    image_status = Column(String(20), default="NOT_GENERATED")
    trending_job_id = Column(Integer, ForeignKey("trending_jobs.id"), nullable=True)
    imported_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    imported_at = Column(TIMESTAMP(timezone=True), server_default=func.now())
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())
