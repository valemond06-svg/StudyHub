from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import numpy as np

from studyhub import db as dbmod
from studyhub.ai import jobs
from studyhub.ingest import vectors


def test_enqueue_concurrently_creates_one_job_at_highest_priority(db, monkeypatch):
    monkeypatch.setattr(jobs, "_ensure_worker", lambda: None)
    priorities = list(range(8))
    ready = Barrier(len(priorities), timeout=10)

    def enqueue(priority):
        ready.wait()
        return jobs.enqueue([42], priority)

    with ThreadPoolExecutor(max_workers=len(priorities)) as pool:
        created = [job_id for result in pool.map(enqueue, priorities) for job_id in result]

    rows = db.execute("SELECT id, target_id, status, priority FROM ai_jobs").fetchall()
    assert len(created) == 1
    assert [tuple(row) for row in rows] == [(created[0], 42, "in_coda", max(priorities))]


def test_numpy_knn_uses_bounded_batches_and_caps_k(monkeypatch):
    monkeypatch.setattr(dbmod, "VEC_AVAILABLE", False)
    monkeypatch.setattr(vectors, "DIM", 3)
    monkeypatch.setattr(vectors, "NUMPY_BATCH_SIZE", 3)
    monkeypatch.setattr(vectors, "NUMPY_MAX_K", 5)
    values = [0.25, -0.5, 0.5, 0.0, 0.125, 0.5, -0.25, 0.75]
    rows = [
        (chunk_id, np.array([value, 0, 0], dtype=np.float16).tobytes())
        for chunk_id, value in enumerate(values, start=1)
    ]
    batches = []

    class Cursor:
        def fetchmany(self, size):
            assert size == 3
            start = sum(batches)
            batch = rows[start:start + size]
            batches.append(len(batch))
            return batch

    class Connection:
        def execute(self, sql, params):
            assert "course_id IN (?)" in sql
            assert params == [7]
            return Cursor()

    query = np.array([1, 0, 0], dtype=np.float32)
    result = vectors.knn(Connection(), query, 10_000, [7])

    assert result == [(8, 0.75), (3, 0.5), (6, 0.5), (1, 0.25), (5, 0.125)]
    assert batches == [3, 3, 2, 0]
    assert vectors.knn(Connection(), query, 0, [7]) == []
    assert batches == [3, 3, 2, 0]
