"""Compact Windows console CLI with Persian/English bilingual messages."""

import os
import sys
import time
from pathlib import Path
from typing import Optional

from driver_update_assistant.client import AgentClient
from driver_update_assistant.config import load_agent_config, load_server_config
from driver_update_assistant.diagnostics.network_checks import check_server_connectivity, run_full_diagnostics
from driver_update_assistant.folder_access.cleanup import FolderCleanupEngine
from driver_update_assistant.folder_access.consent import validate_shareable_folder_path
from driver_update_assistant.folder_access.one_time_code import compute_otp_hash, generate_secure_otp
from driver_update_assistant.folder_access.session import SessionStore
from driver_update_assistant.folder_access.share_manager import ShareManager
from driver_update_assistant.protocol import (
    ErrorCode,
    FolderRequestStatus,
    FolderSessionRecord,
    SharePermission,
    UpdateState,
)

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass


def clear_screen() -> None:
    os.system("cls" if os.name == "nt" else "clear")


def print_banner(device_id: str, server_status: str, version: str) -> None:
    print("=" * 60)
    print("    دستیار درایور و به‌روزرسانی / Driver and Update Assistant")
    print("=" * 60)
    print(f"  Device:     {device_id}")
    print(f"  Server:     {server_status}")
    print(f"  Extension:  v{version}")
    print("=" * 60)
    print()


def run_updater_menu(client: AgentClient) -> None:
    """Submenu for Extension Updater."""
    while True:
        clear_screen()
        installed_ver = client.get_installed_extension_version()
        print("------------------------------------------------------------")
        print("  مدیریت به‌روزرسانی اکستنشن / Extension Updater")
        print(f"  نسخه فعلی نصب‌شده: v{installed_ver}")
        print("------------------------------------------------------------")
        print("  1. بررسی و نصب به‌روزرسانی (Check & Install Update)")
        print("  2. مشاهده وضعیت تراکنش (View Transaction Status)")
        print("  3. بازیابی اضطراری به نسخه پشتیبان (Emergency Rollback)")
        print("  4. بازگشت به منوی اصلی (Back to Main Menu)")
        print("------------------------------------------------------------")

        choice = input("انتخاب کنید / Select [1-4]: ").strip()

        if choice == "1":
            print("\nدر حال بررسی سرور... / Checking update server...")
            ok, err, msg, meta = client.check_for_update()
            if not ok or not meta:
                print(f"\nنتیجه: {msg} (کد: {err.value})")
            else:
                print(f"\nنسخه جدید یافت شد: v{meta.version}")
                print(f"توضیحات: {meta.release_notes or 'بدون یادداشت'}")
                confirm = input("آیا مایل به دانلود و نصب هستید؟ (y/n): ").strip().lower()
                if confirm == "y":
                    print("\nدر حال اجرای مراحل به‌روزرسانی و تأیید امنیتی...")
                    journal = client.execute_update(meta)
                    print(f"وضعیت نهایی تراکنش: {journal.state.value}")
                    if journal.state == UpdateState.ACTIVATION_VERIFIED:
                        print("[OK] به‌روزرسانی با موفقیت کامل انجام شد و فعال گردید.")
                    elif journal.state == UpdateState.ACTIVATION_PENDING:
                        print("[WARN] فایل‌ها نصب شدند. لطفا در کروم دکمه ریلود را بزنید.")
                    elif journal.state == UpdateState.ROLLBACK_VERIFIED:
                        print("[WARN] خطا در نصب؛ بازگشت خودکار به نسخه قبل با موفقیت انجام شد.")
                    else:
                        print(f"[ERROR] خطا: {journal.error_message}")

            input("\nبرای ادامه Enter را بزنید...")

        elif choice == "2":
            journal = client.read_journal()
            print("\nوضعیت آخرین تراکنش:")
            if journal:
                print(f"  Transaction ID:   {journal.transaction_id}")
                print(f"  Target Version:   v{journal.target_version}")
                print(f"  State:            {journal.state.value}")
                print(f"  Rollback Verified:{journal.rollback_verified}")
                print(f"  Error:            {journal.last_error.value} - {journal.error_message}")
            else:
                print("  هیچ تراکنشی ثبت نشده است.")
            input("\nبرای ادامه Enter را بزنید...")

        elif choice == "3":
            print("\nدر حال بررسی وضعیت بازیابی...")
            ok, msg = client.recover_startup()
            print(f"نتیجه بازیابی: {msg}")
            input("\nبرای ادامه Enter را بزنید...")

        elif choice == "4":
            break


def run_folder_access_menu(client: AgentClient) -> None:
    """Submenu for Feature B: Authorized Folder Access."""
    session_store = SessionStore(Path(client.config.data_dir) / "folder_sessions.json")
    share_mgr = ShareManager(dry_run=False)
    cleanup_engine = FolderCleanupEngine(session_store, share_mgr)

    while True:
        clear_screen()
        active_sessions = session_store.get_active_sessions()
        print("------------------------------------------------------------")
        print("  دسترسی مجاز به پوشه / Authorized Folder Access")
        print(f"  اشتراک‌گذاری‌های فعال: {len(active_sessions)}")
        print("------------------------------------------------------------")
        print("  1. ایجاد کد تأیید برای اشتراک پوشه (Request OTP Challenge)")
        print("  2. مشاهده و لغو اشتراک‌های فعال (View & Revoke Active Shares)")
        print("  3. پاکسازی اشتراک‌های منقضی‌شده (Clean Expired Leases)")
        print("  4. بازگشت به منوی اصلی (Back to Main Menu)")
        print("------------------------------------------------------------")

        choice = input("انتخاب کنید / Select [1-4]: ").strip()

        if choice == "1":
            print("\nمسیر پوشه مورد نظر را وارد کنید:")
            raw_folder = input("Folder Path (مثال C:\\MyLogs): ").strip()

            is_safe, err, msg, canonical = validate_shareable_folder_path(raw_folder)
            if not is_safe or not canonical:
                print(f"\n[ERROR] مسیر غیرمجاز است: {msg} (کد: {err.value})")
                input("\nبرای ادامه Enter را بزنید...")
                continue

            print("\nجزئیات درخواست اشتراک‌گذاری:")
            print(f"  مسیر تأییدشده: {canonical}")
            print("  سطح دسترسی پیش‌فرض: فقط خواندنی (Read-Only)")
            print("  مدت اعتبار: ۳۰ دقیقه")

            confirm = input("\nآیا با ایجاد کد تأیید موافقید؟ (y/n): ").strip().lower()
            if confirm == "y":
                clean_otp, formatted_otp = generate_secure_otp(8)
                req_id = f"local_req_{int(time.time())}"
                # Generate hash using configured secret
                otp_hash = compute_otp_hash(clean_otp, req_id, client.config.device_id, client.config.verification_secret)

                # Send challenge to server if online
                client._post_json(
                    f"/api/v1/folder-requests/{req_id}/approval-challenge",
                    {
                        "otp_hash": otp_hash,
                        "folder_path": canonical,
                        "permission": SharePermission.READ_ONLY.value,
                    },
                )

                print("\n" + "=" * 50)
                print(f"  کد تأیید یک‌بارمصرف شما (OTP):   {formatted_otp}")
                print(f"  شناسه درخواست (Request ID):       {req_id}")
                print("  این کد به مدت ۵ دقیقه معتبر است.")
                print("  کد بالا را به مدیر سیستم جهت تأیید ارائه دهید.")
                print("=" * 50)

                # Provision local temporary share
                share_name = f"DA_Share_{int(time.time()) % 10000}"
                ok, s_err, s_msg, fw_rule = share_mgr.create_share(
                    share_name=share_name,
                    folder_path=canonical,
                    permission=SharePermission.READ_ONLY,
                    session_id=req_id,
                )
                if ok:
                    session_rec = FolderSessionRecord(
                        session_id=req_id,
                        request_id=req_id,
                        device_id=client.config.device_id,
                        share_name=share_name,
                        folder_path=canonical,
                        permission=SharePermission.READ_ONLY,
                        admin_ip=None,
                        created_at=time.time(),
                        expires_at=time.time() + (30 * 60),
                        firewall_rule_name=fw_rule,
                        status=FolderRequestStatus.ACTIVE,
                    )
                    session_store.save_session(session_rec)
                    print(f"\nپوشه با نام شبکه '\\\\{client.config.device_id}\\{share_name}' به مدت ۳۰ دقیقه در دسترس است.")
                else:
                    print(f"\nخطا در ایجاد اشتراک ویندوز: {s_msg}")

            input("\nبرای ادامه Enter را بزنید...")

        elif choice == "2":
            if not active_sessions:
                print("\nهیچ اشتراک فعالی وجود ندارد.")
            else:
                print("\nاشتراک‌های فعال:")
                for idx, s in enumerate(active_sessions, 1):
                    mins_left = max(0, int((s.expires_at - time.time()) / 60))
                    print(f"  [{idx}] {s.share_name} -> {s.folder_path} (باقیمانده: {mins_left} دقیقه)")

                revoke_idx = input("\nشماره جهت لغو دسترسی (یا Enter برای انصراف): ").strip()
                if revoke_idx.isdigit() and 1 <= int(revoke_idx) <= len(active_sessions):
                    target_s = active_sessions[int(revoke_idx) - 1]
                    ok, msg = cleanup_engine.revoke_session(target_s.session_id)
                    print(f"نتیجه لغو: {msg}")

            input("\nبرای ادامه Enter را بزنید...")

        elif choice == "3":
            cleaned = cleanup_engine.check_and_clean_expired()
            print(f"\n{len(cleaned)} مورد منقضی‌شده پاکسازی گردید.")
            input("\nبرای ادامه Enter را بزنید...")

        elif choice == "4":
            break


def run_main_cli() -> None:
    """Main Console Loop with exactly two primary features."""
    config = load_agent_config()
    client = AgentClient(config)

    # Startup recovery check for interrupted update or lingering shares
    client.recover_startup()
    session_store = SessionStore(Path(config.data_dir) / "folder_sessions.json")
    share_mgr = ShareManager(dry_run=False)
    FolderCleanupEngine(session_store, share_mgr).startup_recovery()

    while True:
        clear_screen()
        online, _ = check_server_connectivity(config.server_url, timeout_seconds=1.5)
        server_status = "آنلاین (Connected)" if online else "آفلاین (Offline)"
        version = client.get_installed_extension_version()

        print_banner(config.device_id, server_status, version)

        print("  1. به‌روزرسانی اکستنشن (Extension Updater)")
        print("  2. دسترسی مجاز به پوشه (Authorized Folder Access)")
        print("  3. عیب‌یابی و وضعیت سیستم (Status & Diagnostics)")
        print("  4. خروج (Exit)")
        print()

        choice = input("گزینه را انتخاب کنید / Select option [1-4]: ").strip()

        if choice == "1":
            run_updater_menu(client)
        elif choice == "2":
            run_folder_access_menu(client)
        elif choice == "3":
            clear_screen()
            print("------------------------------------------------------------")
            print("  عیب‌یابی شبکه و سیستم / System Diagnostics")
            print("------------------------------------------------------------")
            diag = run_full_diagnostics(config.server_url)
            print(f"  Device Hostname:   {diag['hostname']}")
            print(f"  Local IPs:         {', '.join(diag['local_ips'])}")
            print(f"  Server URL:        {diag['server_url']}")
            print(f"  Server Reachable:  {'بله (Yes)' if diag['server_reachable'] else 'خیر (No)'}")
            print(f"  Message:           {diag['server_message']}")
            print("------------------------------------------------------------")
            input("\nبرای ادامه Enter را بزنید...")
        elif choice == "4":
            print("\nخداحافظ! / Goodbye.")
            sys.exit(0)


def run_admin_cli(args: list) -> None:
    """Administrator CLI commands for server management and publishing."""
    import argparse
    from driver_update_assistant.server.app import AdminServer
    from driver_update_assistant.server.device_registry import DeviceRegistry
    from driver_update_assistant.server.release_store import ReleaseStore

    srv_config = load_server_config()

    parser = argparse.ArgumentParser(description="Driver Assistant Administrator Tool")
    subparsers = parser.add_subparsers(dest="subcommand")

    # Publish release
    pub_p = subparsers.add_parser("publish", help="Publish a new extension release")
    pub_p.add_argument("--version", required=True, help="New extension version (e.g. 20.0)")
    pub_p.add_argument("--source-dir", required=True, help="Path to extension directory")
    pub_p.add_argument("--notes", default="", help="Release notes")

    # Enroll device
    enroll_p = subparsers.add_parser("enroll", help="Enroll a new device")
    enroll_p.add_argument("--device-id", required=True, help="Device ID")
    enroll_p.add_argument("--token", default=None, help="Token secret (generated if omitted)")

    # Status
    subparsers.add_parser("status", help="View fleet status")

    parsed_args = parser.parse_args(args)

    if parsed_args.subcommand == "publish":
        store = ReleaseStore(srv_config.releases_dir)
        print(f"Packaging and signing version {parsed_args.version} from {parsed_args.source_dir}...")
        try:
            meta, zip_path = store.publish_release(
                version=parsed_args.version,
                source_dir=parsed_args.source_dir,
                secret_key=srv_config.secret_key,
                notes=parsed_args.notes,
            )
            print(f"[OK] Release {meta.release_id} published successfully!")
            print(f"   Package: {zip_path}")
            print(f"   SHA-256: {meta.package_sha256}")
            print(f"   Signature: {meta.signature}")
        except Exception as e:
            print(f"[ERROR] Failed to publish release: {str(e)}")

    elif parsed_args.subcommand == "enroll":
        reg = DeviceRegistry(os.path.join(srv_config.data_dir, "admin_registry.db"))
        token = parsed_args.token or os.urandom(16).hex()
        reg.enroll_device(parsed_args.device_id, token)
        print(f"[OK] Device {parsed_args.device_id} enrolled successfully!")
        print(f"   Device Token: {token}")

    elif parsed_args.subcommand == "status":
        reg = DeviceRegistry(os.path.join(srv_config.data_dir, "admin_registry.db"))
        devices = reg.list_devices()
        print("=" * 60)
        print("  Enrolled Device Inventory")
        print("=" * 60)
        for d in devices:
            print(f"  Device:    {d['device_id']}")
            print(f"  Version:   v{d['installed_version']}")
            print(f"  State:     {d['last_state']}")
            print(f"  Status:    {d['status']}")
            print(f"  Check-in:  {time.ctime(d['last_checkin']) if d['last_checkin'] else 'Never'}")
            print("-" * 60)

    else:
        parser.print_help()


def main() -> None:
    if len(sys.argv) > 1 and sys.argv[1] == "--admin":
        run_admin_cli(sys.argv[2:])
    elif len(sys.argv) > 1 and sys.argv[1] == "--recover":
        cfg = load_agent_config()
        client = AgentClient(cfg)
        ok, msg = client.recover_startup()
        print(f"Recovery status: {msg}")
    else:
        run_main_cli()


if __name__ == "__main__":
    main()
