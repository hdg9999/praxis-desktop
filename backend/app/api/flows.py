import json
import uuid
from datetime import datetime, timezone
from typing import List, Optional
from fastapi import APIRouter, HTTPException, Depends
from sqlmodel import Session, select
from pydantic import BaseModel
from app.core.database import get_session
from app.models.flow import Flow

router = APIRouter(prefix="/flows", tags=["Flows"])

class FlowCreate(BaseModel):
    name: str
    description: Optional[str] = None
    graph_data: dict

class FlowUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    graph_data: Optional[dict] = None

class FlowResponse(BaseModel):
    id: str
    name: str
    description: Optional[str]
    graph_data: dict
    created_at: datetime
    updated_at: datetime

@router.get("", response_model=List[FlowResponse])
def get_flows(db: Session = Depends(get_session)):
    flows = db.exec(select(Flow).order_by(Flow.updated_at.desc())).all()
    results = []
    for f in flows:
        results.append(FlowResponse(
            id=f.id,
            name=f.name,
            description=f.description,
            graph_data=json.loads(f.graph_data),
            created_at=f.created_at,
            updated_at=f.updated_at
        ))
    return results

@router.post("", response_model=FlowResponse)
def create_flow(data: FlowCreate, db: Session = Depends(get_session)):
    flow_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    flow = Flow(
        id=flow_id,
        name=data.name,
        description=data.description,
        graph_data=json.dumps(data.graph_data, ensure_ascii=False),
        created_at=now,
        updated_at=now
    )
    db.add(flow)
    db.commit()
    db.refresh(flow)
    return FlowResponse(
        id=flow.id,
        name=flow.name,
        description=flow.description,
        graph_data=data.graph_data,
        created_at=flow.created_at,
        updated_at=flow.updated_at
    )

@router.get("/{flow_id}", response_model=FlowResponse)
def get_flow(flow_id: str, db: Session = Depends(get_session)):
    flow = db.get(Flow, flow_id)
    if not flow:
        raise HTTPException(status_code=404, detail="Flow를 찾을 수 없습니다.")
    return FlowResponse(
        id=flow.id,
        name=flow.name,
        description=flow.description,
        graph_data=json.loads(flow.graph_data),
        created_at=flow.created_at,
        updated_at=flow.updated_at
    )

@router.put("/{flow_id}", response_model=FlowResponse)
def update_flow(flow_id: str, data: FlowUpdate, db: Session = Depends(get_session)):
    flow = db.get(Flow, flow_id)
    if not flow:
        raise HTTPException(status_code=404, detail="Flow를 찾을 수 없습니다.")

    if data.name is not None:
        flow.name = data.name
    if data.description is not None:
        flow.description = data.description
    if data.graph_data is not None:
        flow.graph_data = json.dumps(data.graph_data, ensure_ascii=False)
    
    flow.updated_at = datetime.now(timezone.utc)
    db.add(flow)
    db.commit()
    db.refresh(flow)

    return FlowResponse(
        id=flow.id,
        name=flow.name,
        description=flow.description,
        graph_data=json.loads(flow.graph_data),
        created_at=flow.created_at,
        updated_at=flow.updated_at
    )

@router.delete("/{flow_id}")
def delete_flow(flow_id: str, db: Session = Depends(get_session)):
    flow = db.get(Flow, flow_id)
    if not flow:
        raise HTTPException(status_code=404, detail="Flow를 찾을 수 없습니다.")
    db.delete(flow)
    db.commit()
    return {"success": True, "deleted_id": flow_id}
