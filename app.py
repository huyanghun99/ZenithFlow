from __future__ import annotations
import json
import sqlite3
from pathlib import Path
from typing import Any, Dict

from flask import Flask, jsonify, render_template, request, send_from_directory

APP_DIR = Path(__file__).resolve().parent
DB_PATH = APP_DIR / "db.sqlite3"

app = Flask(__name__, template_folder="templates", static_folder="static")


def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    conn = get_db()
    try:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS kv (
                k TEXT PRIMARY KEY,
                v TEXT NOT NULL,
                updated_at TEXT DEFAULT (datetime('now'))
            )
            """
        )
        conn.commit()
    finally:
        conn.close()


@app.get("/")
def index():
    return render_template("index.html")


@app.get("/nav")
def nav():
    return render_template("nav.html")


@app.get("/api/health")
def health():
    return jsonify({"ok": True})


@app.get("/api/state")
def api_get_state():
    conn = get_db()
    try:
        row = conn.execute("SELECT v FROM kv WHERE k = ?", ("app_state",)).fetchone()
        if not row:
            return jsonify({"state": None})
        try:
            return jsonify({"state": json.loads(row["v"])})
        except Exception:
            # If corrupted, return None rather than crashing
            return jsonify({"state": None})
    finally:
        conn.close()


@app.post("/api/state")
def api_save_state():
    payload: Dict[str, Any] = request.get_json(silent=True) or {}
    state = payload.get("state")
    if state is None or not isinstance(state, dict):
        return jsonify({"ok": False, "error": "Missing 'state' object"}), 400

    # Basic size guard (keep local demo safe)
    raw = json.dumps(state, ensure_ascii=False)
    if len(raw) > 2_000_000:
        return jsonify({"ok": False, "error": "State too large"}), 413

    conn = get_db()
    try:
        conn.execute(
            "INSERT INTO kv(k, v, updated_at) VALUES(?, ?, datetime('now')) "
            "ON CONFLICT(k) DO UPDATE SET v=excluded.v, updated_at=datetime('now')",
            ("app_state", raw),
        )
        conn.commit()
        return jsonify({"ok": True})
    finally:
        conn.close()


@app.get("/api/nav")
def api_get_nav():
    conn = get_db()
    try:
        row = conn.execute("SELECT v FROM kv WHERE k = ?", ("nav_data",)).fetchone()
        if not row:
            return jsonify({"success": True, "data": []})
        try:
            return jsonify({"success": True, "data": json.loads(row["v"])})
        except Exception:
            # If corrupted, return empty array rather than crashing
            return jsonify({"success": True, "data": []})
    finally:
        conn.close()


@app.post("/api/nav")
def api_save_nav():
    payload = request.get_json(silent=True) or []
    if not isinstance(payload, list):
        return jsonify({"success": False, "error": "Invalid data format"}), 400

    # Basic size guard
    raw = json.dumps(payload, ensure_ascii=False)
    if len(raw) > 2_000_000:
        return jsonify({"success": False, "error": "Data too large"}), 413

    conn = get_db()
    try:
        conn.execute(
            "INSERT INTO kv(k, v, updated_at) VALUES(?, ?, datetime('now')) "
            "ON CONFLICT(k) DO UPDATE SET v=excluded.v, updated_at=datetime('now')",
            ("nav_data", raw),
        )
        conn.commit()
        return jsonify({"success": True})
    finally:
        conn.close()


if __name__ == "__main__":
    init_db()
    app.run(host="0.0.0.0", port=15001, debug=True)
