"""Configuration loading and validation for Agent and Server using TOML."""

import os
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, Optional

# Python 3.11+ includes tomllib in standard library
try:
    import tomllib
except ImportError:
    try:
        import tomli as tomllib  # type: ignore
    except ImportError:
        tomllib = None  # Handled via fallback


@dataclass
class AgentConfig:
    device_id: str = "LAPTOP-01"
    server_url: str = "http://127.0.0.1:8088"
    device_token: str = "default-dev-token"
    extension_dir: str = ""
    data_dir: str = "data"
    log_dir: str = "logs"
    check_interval_seconds: int = 3600

    # Updater settings
    max_package_size_bytes: int = 50 * 1024 * 1024  # 50 MB
    public_key_path: str = ""
    verification_secret: str = "test-verification-secret"
    staging_dir: str = "data/staging"
    backup_dir: str = "data/backups"
    activation_timeout_seconds: int = 60

    # Folder Access settings
    default_lease_minutes: int = 30
    max_lease_minutes: int = 60
    otp_length: int = 8
    otp_ttl_seconds: int = 300


@dataclass
class ServerConfig:
    host: str = "0.0.0.0"
    port: int = 8088
    data_dir: str = "data"
    releases_dir: str = "releases"
    secret_key: str = "server-auth-secret-key-32-chars-min"
    signing_key_path: str = "data/keys/release_signer.key"
    public_key_path: str = "data/keys/release_verifier.pub"

    require_device_enrollment: bool = True
    max_otp_attempts: int = 3
    otp_ttl_seconds: int = 300
    rate_limit_requests_per_minute: int = 120


def get_project_root() -> Path:
    """Returns the absolute path to 'Driver and update assistant' root directory."""
    if getattr(sys, "frozen", False):
        exe_path = Path(sys.executable).resolve()
        for parent in exe_path.parents:
            if parent.name.lower() == "driver and update assistant":
                return parent
        return exe_path.parent

    file_path = Path(__file__).resolve()
    for parent in file_path.parents:
        if parent.name.lower() == "driver and update assistant":
            return parent
    return file_path.parent.parent.parent


def load_agent_config(config_path: Optional[str] = None) -> AgentConfig:
    """Loads and validates agent configuration."""
    project_root = get_project_root()
    default_path = project_root / "config" / "agent.toml"
    target_path = Path(config_path) if config_path else default_path

    config = AgentConfig()
    # Default extension_dir to parent directory if empty
    config.extension_dir = str(project_root.parent.resolve())

    if target_path.exists() and tomllib:
        with open(target_path, "rb") as f:
            raw = tomllib.load(f)

        agent_raw = raw.get("agent", {})
        updater_raw = raw.get("updater", {})
        folder_raw = raw.get("folder_access", {})

        config.device_id = str(agent_raw.get("device_id", config.device_id))
        config.server_url = str(agent_raw.get("server_url", config.server_url)).rstrip("/")
        config.device_token = str(agent_raw.get("device_token", config.device_token))
        if "extension_dir" in agent_raw and agent_raw["extension_dir"]:
            config.extension_dir = str(Path(agent_raw["extension_dir"]).resolve())
        config.data_dir = str(agent_raw.get("data_dir", config.data_dir))
        config.log_dir = str(agent_raw.get("log_dir", config.log_dir))
        config.check_interval_seconds = int(agent_raw.get("check_interval_seconds", config.check_interval_seconds))

        config.max_package_size_bytes = int(updater_raw.get("max_package_size_bytes", config.max_package_size_bytes))
        config.public_key_path = str(updater_raw.get("public_key_path", config.public_key_path))
        config.verification_secret = str(updater_raw.get("verification_secret", config.verification_secret))
        config.staging_dir = str(updater_raw.get("staging_dir", config.staging_dir))
        config.backup_dir = str(updater_raw.get("backup_dir", config.backup_dir))
        config.activation_timeout_seconds = int(updater_raw.get("activation_timeout_seconds", config.activation_timeout_seconds))

        config.default_lease_minutes = int(folder_raw.get("default_lease_minutes", config.default_lease_minutes))
        config.max_lease_minutes = int(folder_raw.get("max_lease_minutes", config.max_lease_minutes))
        config.otp_length = int(folder_raw.get("otp_length", config.otp_length))
        config.otp_ttl_seconds = int(folder_raw.get("otp_ttl_seconds", config.otp_ttl_seconds))

    # Resolve relative directories against project root
    for attr in ("data_dir", "log_dir", "staging_dir", "backup_dir"):
        val = getattr(config, attr)
        if not os.path.isabs(val):
            setattr(config, attr, str((project_root / val).resolve()))

    return config


def load_server_config(config_path: Optional[str] = None) -> ServerConfig:
    """Loads and validates administrator server configuration."""
    project_root = get_project_root()
    default_path = project_root / "config" / "server.toml"
    target_path = Path(config_path) if config_path else default_path

    config = ServerConfig()

    if target_path.exists() and tomllib:
        with open(target_path, "rb") as f:
            raw = tomllib.load(f)

        srv_raw = raw.get("server", {})
        sec_raw = raw.get("security", {})

        config.host = str(srv_raw.get("host", config.host))
        config.port = int(srv_raw.get("port", config.port))
        config.data_dir = str(srv_raw.get("data_dir", config.data_dir))
        config.releases_dir = str(srv_raw.get("releases_dir", config.releases_dir))
        config.secret_key = str(srv_raw.get("secret_key", config.secret_key))
        config.signing_key_path = str(srv_raw.get("signing_key_path", config.signing_key_path))
        config.public_key_path = str(srv_raw.get("public_key_path", config.public_key_path))

        config.require_device_enrollment = bool(sec_raw.get("require_device_enrollment", config.require_device_enrollment))
        config.max_otp_attempts = int(sec_raw.get("max_otp_attempts", config.max_otp_attempts))
        config.otp_ttl_seconds = int(sec_raw.get("otp_ttl_seconds", config.otp_ttl_seconds))
        config.rate_limit_requests_per_minute = int(sec_raw.get("rate_limit_requests_per_minute", config.rate_limit_requests_per_minute))

    # Resolve relative directories
    for attr in ("data_dir", "releases_dir", "signing_key_path", "public_key_path"):
        val = getattr(config, attr)
        if not os.path.isabs(val):
            setattr(config, attr, str((project_root / val).resolve()))

    return config
