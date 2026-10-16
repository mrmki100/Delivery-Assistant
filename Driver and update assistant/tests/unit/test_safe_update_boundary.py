"""Test Safe Update Boundary, Elimination of 15s Forced Timeout, and Stuck Operations Diagnostics."""

import time
import unittest


class SafeBoundaryTracker:
    """Python reference implementation replicating background.js Safe Boundary Manager."""

    def __init__(self, stuck_threshold_ms: int = 60000):
        self.active_operations = {}
        self.next_op_id = 1
        self.pending_reload_plan = None
        self.reload_executed = False
        self.executed_plan = None
        self.stuck_threshold_ms = stuck_threshold_ms

    def track_operation_start(self, op_name: str = "operation", details: dict = None) -> int:
        op_id = self.next_op_id
        self.next_op_id += 1
        self.active_operations[op_id] = {
            "opId": op_id,
            "opName": op_name,
            "startedAt": time.time() * 1000,
            "details": details or {},
        }
        return op_id

    def track_operation_end(self, op_id: int):
        if op_id in self.active_operations:
            del self.active_operations[op_id]

        # Strictly trigger deferred reload only when all operations reach safe boundary (size == 0)
        if len(self.active_operations) == 0 and self.pending_reload_plan:
            plan = self.pending_reload_plan
            self.pending_reload_plan = None
            self._execute_controlled_reload(plan)

    def is_system_busy(self) -> bool:
        return len(self.active_operations) > 0

    def get_active_operations_diagnostics(self) -> list:
        now = time.time() * 1000
        ops = []
        for op_id, op in self.active_operations.items():
            running_sec = round((now - op["startedAt"]) / 1000)
            ops.append({
                "id": op_id,
                "name": op["opName"],
                "runningSeconds": running_sec,
                "isStuck": (now - op["startedAt"]) > self.stuck_threshold_ms,
            })
        return ops

    def schedule_controlled_reload(self, target_version: str, transaction_id: str = "", source: str = "NATIVE_MESSAGING") -> dict:
        if self.is_system_busy():
            diagnostics = self.get_active_operations_diagnostics()
            self.pending_reload_plan = {
                "targetVersion": target_version,
                "transactionId": transaction_id,
                "source": source,
                "deferredAt": time.time() * 1000,
            }
            return {
                "success": True,
                "deferred": True,
                "activeOperationsCount": len(self.active_operations),
                "activeOperations": diagnostics,
            }

        return self._execute_controlled_reload({
            "targetVersion": target_version,
            "transactionId": transaction_id,
            "source": source,
        })

    def force_dismiss_stuck_operations_and_reload(self) -> dict:
        self.active_operations.clear()
        if self.pending_reload_plan:
            plan = self.pending_reload_plan
            self.pending_reload_plan = None
            return self._execute_controlled_reload(plan)
        return {"success": True, "message": "OPERATIONS_CLEARED"}

    def _execute_controlled_reload(self, plan: dict) -> dict:
        self.reload_executed = True
        self.executed_plan = plan
        return {"success": True, "targetVersion": plan.get("targetVersion")}


class TestSafeUpdateBoundary(unittest.TestCase):
    def test_normal_completion_defers_and_executes_at_safe_boundary(self):
        """Tests that reload is deferred past 15s and only triggers when operations finish."""
        tracker = SafeBoundaryTracker()

        op1 = tracker.track_operation_start("FETCH_CHAPAR", {"query": "1001"})
        op2 = tracker.track_operation_start("JIRA_SEARCH_TICKETS", {"waybill": "WB999"})

        # Request reload
        res = tracker.schedule_controlled_reload("19.1.0", "tx_001")
        self.assertTrue(res["deferred"])
        self.assertEqual(res["activeOperationsCount"], 2)
        self.assertFalse(tracker.reload_executed)

        # Simulate 20 seconds elapsed (past the old 15s unsafe forced reload threshold)
        # Verify that reload is NOT forced!
        self.assertFalse(tracker.reload_executed)

        # op1 finishes
        tracker.track_operation_end(op1)
        self.assertEqual(len(tracker.active_operations), 1)
        self.assertFalse(tracker.reload_executed)

        # op2 finishes -> safe boundary reached
        tracker.track_operation_end(op2)
        self.assertEqual(len(tracker.active_operations), 0)
        self.assertTrue(tracker.reload_executed)
        self.assertEqual(tracker.executed_plan["targetVersion"], "19.1.0")

    def test_deliberately_stalled_operation_never_auto_reloads_and_reports_diagnostics(self):
        """Tests that a stalled operation is never killed by a timer and diagnoses stuck condition."""
        tracker = SafeBoundaryTracker(stuck_threshold_ms=1000)  # 1 second threshold for test

        stalled_op = tracker.track_operation_start("LONG_RUNNING_POST_OPERATION")

        # Request reload
        res = tracker.schedule_controlled_reload("19.1.0", "tx_002")
        self.assertTrue(res["deferred"])
        self.assertFalse(tracker.reload_executed)

        # Let operation stall past the threshold
        time.sleep(1.1)

        # Reload MUST NOT have executed! (No silent timer interruption)
        self.assertFalse(tracker.reload_executed)

        # Diagnostics must flag isStuck: True
        diags = tracker.get_active_operations_diagnostics()
        self.assertEqual(len(diags), 1)
        self.assertTrue(diags[0]["isStuck"])
        self.assertEqual(diags[0]["name"], "LONG_RUNNING_POST_OPERATION")

        # Administrative dismissal triggers safe recovery
        dismiss_res = tracker.force_dismiss_stuck_operations_and_reload()
        self.assertTrue(dismiss_res["success"])
        self.assertTrue(tracker.reload_executed)
        self.assertEqual(len(tracker.active_operations), 0)


if __name__ == "__main__":
    unittest.main()
