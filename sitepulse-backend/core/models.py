"""Pydantic request models shared by the routes."""
from typing import Dict, List, Optional

from pydantic import BaseModel


class PointData(BaseModel):
    pctX: float
    pctY: float


class PolygonData(BaseModel):
    unit_id: str
    unit_number: str
    status: str
    color: str
    temporal_state: str = 'completed'
    points: List[PointData]


class ExportRequest(BaseModel):
    include_data: bool
    polygons: List[PolygonData]
    project_name: str
    sheet_name: str
    legend_data: Optional[Dict] = None
