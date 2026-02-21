#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import re
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List

import pytest


REPO_ROOT = Path(__file__).resolve().parents[2]
DXCP_API_ROOT = Path(__file__).resolve().parents[1]
CONTRACT_DOC = REPO_ROOT / "docs" / "governance-tests" / "GOVERNANCE_CONTRACT.md"
OUTPUT_PATH = REPO_ROOT / ".dxcpapi.governance.snapshot.json"


@dataclass
class TestResult:
    nodeid: str
    outcome: str
    duration_seconds: float


def _read_contract_version() -> str:
    if not CONTRACT_DOC.exists():
        return "unknown"
    text = CONTRACT_DOC.read_text(encoding="utf-8", errors="replace")
    for line in text.splitlines():
        match = re.search(r"(?:contract[_ -]?version|version)\s*[:=]\s*([A-Za-z0-9._-]+)", line, re.IGNORECASE)
        if match:
            return match.group(1)
    return "unknown"


class GovernanceContractPlugin:
    def __init__(self) -> None:
        self._results: Dict[str, TestResult] = {}

    @property
    def results(self) -> List[TestResult]:
        return list(self._results.values())

    def pytest_runtest_logreport(self, report):  # type: ignore[no-untyped-def]
        nodeid = report.nodeid
        existing = self._results.get(nodeid)
        duration = float(getattr(report, "duration", 0.0) or 0.0)
        if existing is None:
            existing = TestResult(nodeid=nodeid, outcome="skipped", duration_seconds=0.0)
            self._results[nodeid] = existing

        if report.when == "call":
            existing.duration_seconds = duration
            existing.outcome = report.outcome
            return

        if report.when == "setup" and report.outcome == "skipped":
            existing.duration_seconds = duration
            existing.outcome = "skipped"
            return

        if report.outcome == "failed":
            existing.duration_seconds = max(existing.duration_seconds, duration)
            existing.outcome = "failed"


def _build_summary(results: List[TestResult]) -> dict:
    total = len(results)
    passed = sum(1 for item in results if item.outcome == "passed")
    failed = sum(1 for item in results if item.outcome == "failed")
    skipped = sum(1 for item in results if item.outcome == "skipped")
    return {
        "total": total,
        "passed": passed,
        "failed": failed,
        "skipped": skipped,
    }


def main() -> int:
    plugin = GovernanceContractPlugin()
    os.chdir(DXCP_API_ROOT)
    args = [
        "-m",
        "governance_contract",
        "tests",
        "-q",
    ]
    exit_code = pytest.main(args, plugins=[plugin])
    results = sorted(plugin.results, key=lambda item: item.nodeid)
    summary = _build_summary(results)

    payload = {
        "contract_version": _read_contract_version(),
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "suite": "dxcp-api-unit",
        "summary": summary,
        "tests": [
            {
                "nodeid": item.nodeid,
                "outcome": item.outcome,
                "duration_seconds": round(item.duration_seconds, 6),
            }
            for item in results
        ],
    }
    OUTPUT_PATH.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"[INFO] Wrote governance unit snapshot: {OUTPUT_PATH}")
    return int(exit_code)


if __name__ == "__main__":
    sys.exit(main())
