"""Protocol definitions, constants, data schemas, and state enumerations."""

import json
from dataclasses import asdict, dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional


class UpdateState(str, Enum):
    """Formal states in the update transaction state machine."""

    IDLE = "IDLE"
    CHECKING = "CHECKING"
    UPDATE_AVAILABLE = "UPDATE_AVAILABLE"
    DOWNLOADING = "DOWNLOADING"
    DOWNLOAD_VERIFIED = "DOWNLOAD_VERIFIED"
    STAGING = "STAGING"
    STAGED = "STAGED"
    BACKUP_CREATED = "BACKUP_CREATED"
    INSTALLING = "INSTALLING"
    FILES_INSTALLED = "FILES_INSTALLED"
    ACTIVATION_PENDING = "ACTIVATION_PENDING"
    ACTIVATION_VERIFIED = "ACTIVATION_VERIFIED"
    ROLLING_BACK = "ROLLING_BACK"
    ROLLBACK_VERIFIED = "ROLLBACK_VERIFIED"
    FAILED = "FAILED"
    NEEDS_MANUAL_INTERVENTION = "NEEDS_MANUAL_INTERVENTION"


class SharePermission(str, Enum):
    """Allowed permissions for temporary folder access."""

    READ_ONLY = "READ"
    READ_WRITE = "FULL"


class FolderRequestStatus(str, Enum):
    """Status lifecycle for authorized folder access requests."""

    QUEUED = "QUEUED"
    SENT = "SENT"
    PENDING = "PENDING"
    CHALLENGED = "CHALLENGED"
    APPROVED = "APPROVED"
    DENIED = "DENIED"
    ACTIVE = "ACTIVE"
    EXPIRED = "EXPIRED"
    REVOKED = "REVOKED"
    FAILED = "FAILED"


class ErrorCode(str, Enum):
    """Standardized error codes for reporting and diagnostics."""

    NONE = "NONE"
    SERVER_UNAVAILABLE = "SERVER_UNAVAILABLE"
    TIMEOUT = "TIMEOUT"
    AUTH_FAILED = "AUTH_FAILED"
    DEVICE_REVOKED = "DEVICE_REVOKED"
    DEVICE_UNKNOWN = "DEVICE_UNKNOWN"
    PACKAGE_TRUNCATED = "PACKAGE_TRUNCATED"
    HASH_MISMATCH = "HASH_MISMATCH"
    SIGNATURE_INVALID = "SIGNATURE_INVALID"
    METADATA_MALFORMED = "METADATA_MALFORMED"
    VERSION_CONFLICT = "VERSION_CONFLICT"
    PATH_TRAVERSAL_DETECTED = "PATH_TRAVERSAL_DETECTED"
    FORBIDDEN_FILE_TYPE = "FORBIDDEN_FILE_TYPE"
    PACKAGE_TOO_LARGE = "PACKAGE_TOO_LARGE"
    DISK_FULL = "DISK_FULL"
    PERMISSION_DENIED = "PERMISSION_DENIED"
    FILE_LOCKED = "FILE_LOCKED"
    PROCESS_INTERRUPTED = "PROCESS_INTERRUPTED"
    ROLLBACK_FAILED = "ROLLBACK_FAILED"
    BACKUP_CORRUPTED = "BACKUP_CORRUPTED"
    ACTIVATION_FAILED = "ACTIVATION_FAILED"
    HEALTH_CHECK_FAILED = "HEALTH_CHECK_FAILED"
    CONCURRENT_TRANSACTION = "CONCURRENT_TRANSACTION"
    INVALID_TARGET_DIR = "INVALID_TARGET_DIR"
    INCOMPATIBLE_RELEASE = "INCOMPATIBLE_RELEASE"
    OTP_INVALID = "OTP_INVALID"
    OTP_EXPIRED = "OTP_EXPIRED"
    OTP_MAX_ATTEMPTS = "OTP_MAX_ATTEMPTS"
    OTP_REPLAY_ATTEMPT = "OTP_REPLAY_ATTEMPT"
    FOLDER_BLOCKED = "FOLDER_BLOCKED"
    FOLDER_NOT_FOUND = "FOLDER_NOT_FOUND"
    SHARE_CREATION_FAILED = "SHARE_CREATION_FAILED"
    CLEANUP_FAILED = "CLEANUP_FAILED"


@dataclass
class ReleaseMetadata:
    """Signed metadata representing an extension release."""

    product_id: str
    version: str
    release_id: str
    min_updater_version: str
    package_size: int
    package_sha256: str
    files_manifest: Dict[str, str]  # relative_path -> sha256
    signature: str
    timestamp: float
    release_notes: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ReleaseMetadata":
        return cls(
            product_id=data["product_id"],
            version=data["version"],
            release_id=data["release_id"],
            min_updater_version=data.get("min_updater_version", "1.0.0"),
            package_size=int(data["package_size"]),
            package_sha256=data["package_sha256"],
            files_manifest=data.get("files_manifest", {}),
            signature=data.get("signature", ""),
            timestamp=float(data.get("timestamp", 0.0)),
            release_notes=data.get("release_notes", ""),
        )


@dataclass
class TransactionJournal:
    """Durable transaction journal record for crash resilience."""

    transaction_id: str
    release_id: str
    previous_version: str
    target_version: str
    state: UpdateState
    rollback_verified: bool = False
    last_error: ErrorCode = ErrorCode.NONE
    error_message: str = ""
    checkpoint_time: float = 0.0
    backup_path: Optional[str] = None
    staging_path: Optional[str] = None
    target_path: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["state"] = self.state.value
        d["last_error"] = self.last_error.value
        return d

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "TransactionJournal":
        return cls(
            transaction_id=data["transaction_id"],
            release_id=data["release_id"],
            previous_version=data["previous_version"],
            target_version=data["target_version"],
            state=UpdateState(data["state"]),
            rollback_verified=bool(data.get("rollback_verified", False)),
            last_error=ErrorCode(data.get("last_error", ErrorCode.NONE.value)),
            error_message=data.get("error_message", ""),
            checkpoint_time=float(data.get("checkpoint_time", 0.0)),
            backup_path=data.get("backup_path"),
            staging_path=data.get("staging_path"),
            target_path=data.get("target_path"),
        )


@dataclass
class DeviceStatusReport:
    """Device status telemetry report sent to the administrator server."""

    event_id: str
    device_id: str
    release_id: str
    transaction_id: str
    previous_version: str
    target_version: str
    state: UpdateState
    rollback_verified: bool
    reason_code: ErrorCode
    message: str
    checkpoint_time: float

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["state"] = self.state.value
        d["reason_code"] = self.reason_code.value
        return d

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "DeviceStatusReport":
        return cls(
            event_id=data["event_id"],
            device_id=data["device_id"],
            release_id=data["release_id"],
            transaction_id=data["transaction_id"],
            previous_version=data["previous_version"],
            target_version=data["target_version"],
            state=UpdateState(data["state"]),
            rollback_verified=bool(data["rollback_verified"]),
            reason_code=ErrorCode(data["reason_code"]),
            message=data.get("message", ""),
            checkpoint_time=float(data.get("checkpoint_time", 0.0)),
        )


@dataclass
class FolderSessionRecord:
    """Durable record tracking an active network folder share."""

    session_id: str
    request_id: str
    device_id: str
    share_name: str
    folder_path: str
    permission: SharePermission
    admin_ip: Optional[str]
    created_at: float
    expires_at: float
    firewall_rule_name: Optional[str] = None
    status: FolderRequestStatus = FolderRequestStatus.ACTIVE

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["permission"] = self.permission.value
        d["status"] = self.status.value
        return d

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "FolderSessionRecord":
        return cls(
            session_id=data["session_id"],
            request_id=data["request_id"],
            device_id=data["device_id"],
            share_name=data["share_name"],
            folder_path=data["folder_path"],
            permission=SharePermission(data["permission"]),
            admin_ip=data.get("admin_ip"),
            created_at=float(data["created_at"]),
            expires_at=float(data["expires_at"]),
            firewall_rule_name=data.get("firewall_rule_name"),
            status=FolderRequestStatus(data.get("status", FolderRequestStatus.ACTIVE.value)),
        )
