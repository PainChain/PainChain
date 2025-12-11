import os
from celery import Celery
from celery.schedules import crontab

# Get Redis URL from environment
REDIS_URL = os.getenv('REDIS_URL', 'redis://localhost:6379/0')

# Create Celery app
celery_app = Celery(
    'painchain',
    broker=REDIS_URL,
    backend=REDIS_URL,
    include=['tasks']
)

# Celery configuration
celery_app.conf.update(
    task_serializer='json',
    accept_content=['json'],
    result_serializer='json',
    timezone='UTC',
    enable_utc=True,
    task_track_started=True,
    task_time_limit=30 * 60,  # 30 minutes
    worker_prefetch_multiplier=1,
    worker_max_tasks_per_child=1000,
    worker_concurrency=8,  # Increased from default 4 to handle parallel K8s watches
)

# Periodic task schedule
# This checks every 10 seconds which connections need syncing based on their individual poll_interval
celery_app.conf.beat_schedule = {
    'check-connections-for-sync': {
        'task': 'tasks.sync_all_connections',
        'schedule': 10.0,  # Check every 10 seconds
    },
}
