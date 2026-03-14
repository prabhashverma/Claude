import json
from datetime import datetime
from dataclasses import dataclass, field
from pathlib import Path

STATE_DIR = Path("data/state")


@dataclass
class StageResult:
    summary_text: str = ""
    stats: dict = field(default_factory=dict)
    review_items: list = field(default_factory=list)

    def summary(self):
        return self.summary_text

    def to_dict(self):
        return self.stats


@dataclass
class PipelineState:
    run_id: str
    status: str = "running"
    lca_file: str = ""
    perm_file: str = ""
    completed_stages: list = field(default_factory=list)
    current_stage: str = ""
    stats: dict = field(default_factory=dict)
    review_items: list = field(default_factory=list)
    errors: list = field(default_factory=list)
    started_at: str = ""

    @classmethod
    def create(cls, lca_file, perm_file):
        run_id = f"RUN_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        state = cls(
            run_id=run_id,
            lca_file=lca_file,
            perm_file=perm_file,
            started_at=datetime.now().isoformat(),
        )
        STATE_DIR.mkdir(parents=True, exist_ok=True)
        state.save()
        return state

    @classmethod
    def load(cls, run_id):
        path = STATE_DIR / f"{run_id}.json"
        with open(path) as f:
            data = json.load(f)
        return cls(**data)

    def save(self):
        STATE_DIR.mkdir(parents=True, exist_ok=True)
        path = STATE_DIR / f"{self.run_id}.json"
        with open(path, "w") as f:
            json.dump(self.__dict__, f, indent=2)

    def mark_complete(self, stage, result):
        self.completed_stages.append(stage)
        self.current_stage = stage
        self.stats[stage] = result.to_dict() if hasattr(result, "to_dict") else {}
        self.review_items.extend(
            result.review_items if hasattr(result, "review_items") else []
        )
        self.save()

    def mark_failed(self, stage, error):
        self.errors.append(
            {"stage": stage, "error": error, "time": datetime.now().isoformat()}
        )
        self.status = "failed"
        self.save()

    def final_summary(self):
        return f"""
Run ID: {self.run_id}
LCA rows: {self.stats.get('normalize_lca', {}).get('clean_rows', 'N/A')}
PERM rows: {self.stats.get('normalize_perm', {}).get('clean_rows', 'N/A')}
New employers: {self.stats.get('entity_recon', {}).get('new_employers', 'N/A')}
Review items: {len(self.review_items)}
        """
