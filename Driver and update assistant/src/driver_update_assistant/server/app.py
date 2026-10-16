"""Administrator Server HTTP/REST service implemented using Python standard library."""

import hashlib
import hmac
import http.server
import json
import logging
import os
import socketserver
import time
from pathlib import Path
from typing import Any, Dict, Optional, Tuple
from urllib.parse import parse_qs, urlparse

from driver_update_assistant.config import ServerConfig, load_server_config
from driver_update_assistant.logging_setup import setup_logger
from driver_update_assistant.protocol import (
    DeviceStatusReport,
    ErrorCode,
    FolderRequestStatus,
    ReleaseMetadata,
    SharePermission,
    UpdateState,
)
from driver_update_assistant.server.audit_log import AuditLogger
from driver_update_assistant.server.authentication import authenticate_admin, authenticate_request
from driver_update_assistant.server.device_registry import DeviceRegistry
from driver_update_assistant.server.release_store import ReleaseStore
from driver_update_assistant.folder_access.app_access import AppMediatedAccessManager
from driver_update_assistant.diagnostics.network_checks import check_port_available


class AdminServerState:
    """Encapsulates shared state for the Admin HTTP server."""

    def __init__(self, config: ServerConfig):
        self.config = config
        self.logger = setup_logger("admin_server", config.data_dir, "server.log")
        self.registry = DeviceRegistry(os.path.join(config.data_dir, "admin_registry.db"))
        self.audit = AuditLogger(os.path.join(config.data_dir, "admin_registry.db"))
        self.store = ReleaseStore(config.releases_dir)
        # In-memory store for pending folder requests: request_id -> dict
        self.folder_requests: Dict[str, Dict[str, Any]] = {}
        # Advertised shared folders from enrolled devices: device_id -> List[dict]
        self.client_shared_folders: Dict[str, List[Dict[str, Any]]] = {}
        # Application-mediated folder access engine
        self.app_access_manager = AppMediatedAccessManager()


def hash_otp_challenge(otp: str, request_id: str, device_id: str, secret_key: str) -> str:
    """Generates server-side HMAC of an OTP bound to the request."""
    # Clean up formatted code: remove dashes and spaces
    clean_code = otp.replace("-", "").strip()
    msg = f"{clean_code}:{request_id}:{device_id}".encode("utf-8")
    return hmac.new(secret_key.encode("utf-8"), msg, hashlib.sha256).hexdigest()


class AdminHTTPRequestHandler(http.server.BaseHTTPRequestHandler):
    """Handles REST API requests for Admin Server."""

    server_state: AdminServerState

    def _send_json(self, status: int, data: Dict[str, Any]) -> None:
        payload = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _send_error(self, status: int, error_code: str, message: str) -> None:
        self._send_json(status, {"success": False, "error": error_code, "message": message})

    def _read_json_body(self) -> Optional[Dict[str, Any]]:
        try:
            content_length = int(self.headers.get("Content-Length", 0))
            if content_length <= 0 or content_length > 10 * 1024 * 1024:
                return {}
            body = self.rfile.read(content_length).decode("utf-8")
            return json.loads(body)
        except Exception:
            return None

    def log_message(self, format: str, *args: Any) -> None:
        # Route standard server log to our redacting logger
        self.server_state.logger.debug("%s - - [%s] %s", self.client_address[0], self.log_date_time_string(), format % args)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/")
        state = self.server_state

        # Health endpoint (Unauthenticated)
        if path == "/api/v1/health":
            self._send_json(200, {"status": "ok", "timestamp": time.time(), "version": "1.0.0"})
            return

        # Authenticate Device
        is_auth, reason, device_id = authenticate_request(
            dict(self.headers), state.registry, state.config.require_device_enrollment
        )
        if not is_auth:
            self._send_error(401, reason, "Device authentication failed")
            return

        # Latest release metadata
        if path == "/api/v1/releases/latest":
            latest = state.store.get_latest_release()
            if not latest:
                self._send_error(404, "NO_RELEASE_FOUND", "No releases published yet")
                return
            self._send_json(200, {"success": True, "release": latest.to_dict()})
            return

        # Specific release metadata: /api/v1/releases/<rel_id>/metadata
        if path.startswith("/api/v1/releases/") and path.endswith("/metadata"):
            parts = path.split("/")
            rel_id = parts[4]
            meta = state.store.get_release_metadata(rel_id)
            if not meta:
                self._send_error(404, "RELEASE_NOT_FOUND", f"Release {rel_id} not found")
                return
            self._send_json(200, {"success": True, "release": meta.to_dict()})
            return

        # Download release package: /api/v1/releases/<rel_id>/package
        if path.startswith("/api/v1/releases/") and path.endswith("/package"):
            parts = path.split("/")
            rel_id = parts[4]
            pkg_path = state.store.get_package_path(rel_id)
            if not pkg_path or not pkg_path.is_file():
                self._send_error(404, "PACKAGE_NOT_FOUND", f"Package for {rel_id} not found")
                return
            size = pkg_path.stat().st_size
            self.send_response(200)
            self.send_header("Content-Type", "application/zip")
            self.send_header("Content-Length", str(size))
            self.send_header("Content-Disposition", f"attachment; filename={pkg_path.name}")
            self.end_headers()
            with open(pkg_path, "rb") as f:
                while chunk := f.read(65536):
                    self.wfile.write(chunk)
            state.audit.log_event("PACKAGE_DOWNLOADED", "SUCCESS", device_id=device_id, details={"release_id": rel_id})
            return

        # Check pending folder requests for device
        if path == "/api/v1/folder-requests/pending":
            pending = [
                req for req in state.folder_requests.values()
                if req.get("device_id") == device_id and req.get("status") in (FolderRequestStatus.PENDING.value, FolderRequestStatus.CHALLENGED.value)
            ]
            self._send_json(200, {"success": True, "pending_requests": pending})
            return

        # Admin: List devices
        if path == "/api/v1/admin/devices":
            if not authenticate_admin(dict(self.headers), state.config.secret_key):
                self._send_error(403, "ADMIN_UNAUTHORIZED", "Admin authorization required")
                return
            devices = state.registry.list_devices()
            self._send_json(200, {"success": True, "devices": devices})
            return

        # Admin: Audit logs
        if path == "/api/v1/admin/audit-logs":
            if not authenticate_admin(dict(self.headers), state.config.secret_key):
                self._send_error(403, "ADMIN_UNAUTHORIZED", "Admin authorization required")
                return
            logs = state.audit.get_recent_events(limit=100)
            self._send_json(200, {"success": True, "logs": logs})
            return

        # Admin: Query advertised shared folders for an enrolled device
        if path.startswith("/api/v1/admin/devices/") and path.endswith("/shared-folders"):
            if not authenticate_admin(dict(self.headers), state.config.secret_key):
                self._send_error(403, "ADMIN_UNAUTHORIZED", "Admin authorization required")
                return
            parts = path.split("/")
            target_dev = parts[5]
            folders = state.client_shared_folders.get(target_dev, [])
            self._send_json(200, {"success": True, "device_id": target_dev, "shared_folders": folders})
            return

        # Admin: Browse files in an active application-mediated session
        if path.startswith("/api/v1/admin/folder-sessions/") and path.endswith("/browse"):
            if not authenticate_admin(dict(self.headers), state.config.secret_key):
                self._send_error(403, "ADMIN_UNAUTHORIZED", "Admin authorization required")
                return
            parts = path.split("/")
            session_id = parts[5]
            subpath = parse_qs(parsed.query).get("subpath", [""])[0]
            ok, items, err = state.app_access_manager.list_directory(session_id, subpath)
            if ok:
                self._send_json(200, {"success": True, "session_id": session_id, "items": items})
            else:
                self._send_error(400, "BROWSE_ERROR", err)
            return

        # Admin: Download file in an active application-mediated session
        if path.startswith("/api/v1/admin/folder-sessions/") and path.endswith("/download"):
            if not authenticate_admin(dict(self.headers), state.config.secret_key):
                self._send_error(403, "ADMIN_UNAUTHORIZED", "Admin authorization required")
                return
            parts = path.split("/")
            session_id = parts[5]
            file_rel = parse_qs(parsed.query).get("file", [""])[0]
            ok, content, err = state.app_access_manager.read_file(session_id, file_rel)
            if ok and content is not None:
                self.send_response(200)
                self.send_header("Content-Type", "application/octet-stream")
                self.send_header("Content-Length", str(len(content)))
                self.send_header("Content-Disposition", f"attachment; filename={Path(file_rel).name}")
                self.end_headers()
                self.wfile.write(content)
            else:
                self._send_error(400, "READ_ERROR", err)
            return

        self._send_error(404, "ROUTE_NOT_FOUND", f"Endpoint {path} not found")

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/")
        state = self.server_state

        body = self._read_json_body()
        if body is None:
            self._send_error(400, "MALFORMED_JSON", "Invalid JSON payload")
            return

        # Admin endpoints
        if path.startswith("/api/v1/admin/"):
            if not authenticate_admin(dict(self.headers), state.config.secret_key):
                self._send_error(403, "ADMIN_UNAUTHORIZED", "Admin authorization required")
                return

            if path == "/api/v1/admin/enroll":
                dev_id = body.get("device_id")
                token = body.get("token")
                hostname = body.get("hostname")
                if not dev_id or not token:
                    self._send_error(400, "MISSING_FIELDS", "device_id and token required")
                    return
                state.registry.enroll_device(dev_id, token, hostname)
                state.audit.log_event("DEVICE_ENROLLED", "SUCCESS", device_id=dev_id)
                self._send_json(200, {"success": True, "message": f"Device {dev_id} enrolled"})
                return

            if path == "/api/v1/admin/revoke":
                dev_id = body.get("device_id")
                if not dev_id:
                    self._send_error(400, "MISSING_FIELDS", "device_id required")
                    return
                state.registry.revoke_device(dev_id)
                state.audit.log_event("DEVICE_REVOKED", "SUCCESS", device_id=dev_id)
                self._send_json(200, {"success": True, "message": f"Device {dev_id} revoked"})
                return

            if path == "/api/v1/admin/folder-request":
                # Admin creates a folder request to send to device
                req_id = f"req_{int(time.time())}_{os.urandom(4).hex()}"
                dev_id = body.get("device_id")
                purpose = body.get("purpose", "Administrative support")
                folder = body.get("proposed_folder", "")
                perm = body.get("permission", SharePermission.READ_ONLY.value)
                duration = int(body.get("duration_minutes", 30))

                req_record = {
                    "request_id": req_id,
                    "device_id": dev_id,
                    "admin_id": body.get("admin_id", "Admin"),
                    "purpose": purpose,
                    "proposed_folder": folder,
                    "permission": perm,
                    "duration_minutes": duration,
                    "status": FolderRequestStatus.PENDING.value,
                    "created_at": time.time(),
                    "expires_at": time.time() + (duration * 60),
                    "attempts": 0,
                    "otp_hash": None,
                }
                state.folder_requests[req_id] = req_record
                state.audit.log_event("FOLDER_REQUEST_CREATED", "SUCCESS", device_id=dev_id, admin_id=req_record["admin_id"], details={"request_id": req_id})
                self._send_json(200, {"success": True, "request": req_record})
                return

            if path == "/api/v1/admin/approve-folder":
                # Admin enters the OTP received from employee
                req_id = body.get("request_id")
                code = body.get("code", "")
                if not req_id or not code:
                    self._send_error(400, "MISSING_FIELDS", "request_id and code required")
                    return

                req_record = state.folder_requests.get(req_id)
                if not req_record:
                    self._send_error(404, "REQUEST_NOT_FOUND", "Request not found")
                    return

                if req_record["status"] != FolderRequestStatus.CHALLENGED.value:
                    self._send_error(400, "INVALID_STATE", f"Request not awaiting approval (status: {req_record['status']})")
                    return

                if time.time() > req_record.get("otp_expires_at", 0):
                    req_record["status"] = FolderRequestStatus.EXPIRED.value
                    self._send_error(400, "OTP_EXPIRED", "One-time code has expired")
                    return

                req_record["attempts"] = req_record.get("attempts", 0) + 1
                if req_record["attempts"] > state.config.max_otp_attempts:
                    req_record["status"] = FolderRequestStatus.DENIED.value
                    self._send_error(400, "OTP_MAX_ATTEMPTS", "Maximum attempts exceeded; request cancelled")
                    return

                expected_hash = req_record.get("otp_hash")
                computed_hash = hash_otp_challenge(code, req_id, req_record["device_id"], state.config.secret_key)

                if not hmac.compare_digest(expected_hash, computed_hash):
                    remaining = state.config.max_otp_attempts - req_record["attempts"]
                    self._send_error(400, "OTP_INVALID", f"Incorrect code. {remaining} attempt(s) remaining.")
                    return

                # Code matches!
                req_record["status"] = FolderRequestStatus.APPROVED.value
                state.audit.log_event("FOLDER_REQUEST_APPROVED", "SUCCESS", device_id=req_record["device_id"], details={"request_id": req_id})
                self._send_json(200, {"success": True, "message": "Code validated successfully; request approved"})
                return

        # Authenticate Device for non-admin endpoints
        is_auth, reason, device_id = authenticate_request(
            dict(self.headers), state.registry, state.config.require_device_enrollment
        )
        if not is_auth:
            self._send_error(401, reason, "Device authentication failed")
            return

        # Device Check-in
        if path == "/api/v1/devices/check-in":
            client_ip = self.client_address[0]
            installed_ver = body.get("installed_version")
            last_state = body.get("last_state")
            shared_folders = body.get("shared_folders")
            if shared_folders is not None:
                state.client_shared_folders[device_id] = shared_folders

            state.registry.update_checkin(
                device_id=device_id,
                ip_address=client_ip,
                installed_version=installed_ver,
                last_state=last_state,
            )
            self._send_json(200, {"success": True, "timestamp": time.time()})
            return

        # Device Status Report (Telemetry)
        if path == "/api/v1/devices/update-status":
            try:
                report = DeviceStatusReport.from_dict(body)
                state.registry.update_checkin(
                    device_id=device_id,
                    installed_version=report.previous_version if report.rollback_verified else report.target_version,
                    last_state=report.state.value,
                    rollback_verified=report.rollback_verified,
                )
                state.audit.log_event(
                    "UPDATE_STATUS_REPORT",
                    outcome=report.state.value,
                    device_id=device_id,
                    details=report.to_dict(),
                )
                self._send_json(200, {"success": True, "event_id": report.event_id})
                return
            except Exception as e:
                self._send_error(400, "INVALID_REPORT_SCHEMA", str(e))
                return

        # Direct approval of folder request from employee machine
        if path.startswith("/api/v1/folder-requests/") and path.endswith("/approve"):
            parts = path.split("/")
            req_id = parts[4]
            req_record = state.folder_requests.get(req_id)
            if not req_record or req_record["device_id"] != device_id:
                self._send_error(404, "REQUEST_NOT_FOUND", "Folder request not found for device")
                return

            folder_path = body.get("folder_path") or req_record.get("proposed_folder")
            perm = body.get("permission") or req_record.get("permission")

            req_record["status"] = FolderRequestStatus.APPROVED.value
            req_record["resolved_folder"] = folder_path
            req_record["permission"] = perm

            session = state.app_access_manager.create_session(
                request_id=req_id,
                device_id=device_id,
                admin_id=req_record.get("admin_id", "Admin"),
                folder_path=folder_path,
                permission=perm,
                purpose=req_record.get("purpose", ""),
                duration_minutes=req_record.get("duration_minutes", 30),
            )
            req_record["session_id"] = session.session_id

            state.audit.log_event(
                "FOLDER_REQUEST_APPROVED",
                "SUCCESS",
                device_id=device_id,
                details={
                    "request_id": req_id,
                    "session_id": session.session_id,
                    "folder_path": folder_path,
                    "permission": perm,
                },
            )
            self._send_json(200, {"success": True, "message": "Request approved", "session": session.to_dict()})
            return

        # Revoke folder request from employee machine
        if path.startswith("/api/v1/folder-requests/") and path.endswith("/revoke"):
            parts = path.split("/")
            req_id = parts[4]
            req_record = state.folder_requests.get(req_id)
            if req_record and req_record["device_id"] == device_id:
                req_record["status"] = FolderRequestStatus.REVOKED.value
                state.app_access_manager.revoke_by_folder(req_record.get("proposed_folder", ""))
                state.audit.log_event("FOLDER_REQUEST_REVOKED", "REVOKED", device_id=device_id, details={"request_id": req_id})
                self._send_json(200, {"success": True, "message": "Access revoked"})
                return
            self._send_error(404, "REQUEST_NOT_FOUND", "Request not found")
            return

        # Folder request challenge submission from employee machine:
        # Agent sends the computed otp_hash for the challenge
        if path.startswith("/api/v1/folder-requests/") and path.endswith("/approval-challenge"):
            parts = path.split("/")
            req_id = parts[4]
            req_record = state.folder_requests.get(req_id)
            if not req_record or req_record["device_id"] != device_id:
                self._send_error(404, "REQUEST_NOT_FOUND", "Folder request not found for device")
                return

            otp_hash = body.get("otp_hash")
            folder_path = body.get("folder_path")
            permission = body.get("permission")

            if not otp_hash or not folder_path:
                self._send_error(400, "MISSING_FIELDS", "otp_hash and folder_path required")
                return

            req_record["otp_hash"] = otp_hash
            req_record["resolved_folder"] = folder_path
            req_record["permission"] = permission or req_record["permission"]
            req_record["status"] = FolderRequestStatus.CHALLENGED.value
            req_record["otp_expires_at"] = time.time() + state.config.otp_ttl_seconds
            req_record["attempts"] = 0

            state.audit.log_event(
                "FOLDER_CHALLENGE_SUBMITTED",
                "SUCCESS",
                device_id=device_id,
                details={"request_id": req_id, "folder_path": folder_path, "permission": req_record["permission"]},
            )
            self._send_json(200, {"success": True, "message": "Challenge registered; awaiting admin code verification"})
            return

        # Deny folder request
        if path.startswith("/api/v1/folder-requests/") and path.endswith("/deny"):
            parts = path.split("/")
            req_id = parts[4]
            req_record = state.folder_requests.get(req_id)
            if req_record and req_record["device_id"] == device_id:
                req_record["status"] = FolderRequestStatus.DENIED.value
                state.audit.log_event("FOLDER_REQUEST_DENIED", "DENIED", device_id=device_id, details={"request_id": req_id})
                self._send_json(200, {"success": True, "message": "Request denied"})
                return
            self._send_error(404, "REQUEST_NOT_FOUND", "Request not found")
            return

        self._send_error(404, "ROUTE_NOT_FOUND", f"Endpoint {path} not found")


class AdminServer:
    """Threaded HTTP Server for the Admin laptop."""

    def __init__(self, config: ServerConfig):
        self.config = config
        self.state = AdminServerState(config)
        self.httpd: Optional[http.server.ThreadingHTTPServer] = None

    def start(self) -> None:
        avail, reason = check_port_available(self.config.host, self.config.port)
        if not avail:
            self.state.logger.error("Port conflict: %s", reason)
            raise RuntimeError(reason)

        handler = AdminHTTPRequestHandler
        handler.server_state = self.state
        self.httpd = http.server.ThreadingHTTPServer((self.config.host, self.config.port), handler)
        self.state.logger.info("Admin Server listening on %s:%d", self.config.host, self.config.port)
        self.httpd.serve_forever()

    def shutdown(self) -> None:
        if self.httpd:
            self.httpd.shutdown()
            self.httpd.server_close()
            self.state.logger.info("Admin Server stopped.")


def run_server_cli() -> None:
    """Entry point for starting the admin server from command line."""
    import sys
    config = load_server_config()
    server = AdminServer(config)
    try:
        print(f"Starting Admin Server on {config.host}:{config.port} ... (Ctrl+C to stop)")
        server.start()
    except KeyboardInterrupt:
        print("Stopping Admin Server...")
        server.shutdown()
        sys.exit(0)


if __name__ == "__main__":
    run_server_cli()
