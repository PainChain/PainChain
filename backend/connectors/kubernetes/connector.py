# Imports needed for the module
from typing import Dict, Any
import sys
sys.path.insert(0, '/app')

# Import the new watch-based connector
from .connector_watch import sync_kubernetes, KubernetesWatchConnector

# Re-export for backwards compatibility
__all__ = ['sync_kubernetes', 'KubernetesWatchConnector']
