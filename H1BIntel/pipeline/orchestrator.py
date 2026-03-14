"""
H1BIntel Pipeline Orchestrator
Resumable, staged ETL pipeline for DOL LCA + PERM data.
"""

import asyncio
import argparse
import sys
import io

# Force UTF-8 output on Windows
if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

from rich.console import Console
from state import PipelineState
from agents.parser_agent import ParserAgent
from agents.normalizer_agent import NormalizerAgent
from agents.entity_agent import EntityAgent
from agents.scorer_agent import ScorerAgent

console = Console()

STAGES = [
    ("parse_lca", ParserAgent, {"file_type": "lca"}),
    ("parse_perm", ParserAgent, {"file_type": "perm"}),
    ("normalize_lca", NormalizerAgent, {"file_type": "lca"}),
    ("normalize_perm", NormalizerAgent, {"file_type": "perm"}),
    ("entity_recon", EntityAgent, {}),
    ("compute_scores", ScorerAgent, {}),
    # Future stages:
    # ("title_normalization", TitleAgent,      {}),
    # ("link_lca_perm",       LinkerAgent,     {}),
    # ("load_staging",        LoaderAgent,     {"target": "staging"}),
]


async def run_pipeline(args):
    if args.resume:
        state = PipelineState.load(args.run_id)
        console.print(f"\n[bold]Resuming run {state.run_id}[/bold]")
    else:
        if not args.lca or not args.perm:
            console.print("[red]Error: --lca and --perm required for new run[/red]")
            return
        state = PipelineState.create(lca_file=args.lca, perm_file=args.perm)
        console.print(f"\n[bold]Starting run {state.run_id}[/bold]")

    console.print(f"  LCA file:  {state.lca_file}")
    console.print(f"  PERM file: {state.perm_file}")

    for stage_name, AgentClass, kwargs in STAGES:
        if stage_name in state.completed_stages:
            console.print(f"[dim]✓ Skipping {stage_name}[/dim]")
            continue

        console.print(f"\n[bold blue]→ {stage_name}[/bold blue]")
        agent = AgentClass(state=state, **kwargs)

        try:
            result = await agent.run()
            state.mark_complete(stage_name, result)
            console.print(f"[green]✓ {stage_name} complete[/green] — {result.summary()}")
        except Exception as e:
            state.mark_failed(stage_name, str(e))
            console.print(f"[red]✗ {stage_name} failed: {e}[/red]")
            console.print(f"  Resume with: python orchestrator.py --resume --run-id {state.run_id}")
            raise

    # Summary
    review_count = len(state.review_items)
    if review_count > 0:
        console.print(f"\n[yellow]⚠  {review_count} items flagged for review[/yellow]")

    state.status = "completed"
    state.save()
    console.print(f"\n[bold green]✅ Pipeline complete![/bold green]")
    console.print(state.final_summary())


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="H1BIntel ETL Pipeline")
    parser.add_argument("--lca", help="Path to LCA xlsx file")
    parser.add_argument("--perm", help="Path to PERM xlsx file")
    parser.add_argument("--resume", action="store_true", help="Resume a previous run")
    parser.add_argument("--run-id", help="Run ID to resume")
    parser.add_argument("--auto-approve", action="store_true", help="Skip human review")
    args = parser.parse_args()
    asyncio.run(run_pipeline(args))
