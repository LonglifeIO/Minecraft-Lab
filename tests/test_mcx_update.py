#!/usr/bin/env python3
"""Isolated tests for host-api.py's MCXboxBroadcast update flow.

Nothing here reaches live processes: the Python-level tests monkeypatch
run_argv so pct is never executed, and the bash-level tests run the embedded
swap script against throwaway files in a temp dir with a stubbed systemctl.

Run with: python3 tests/test_mcx_update.py
"""
import hashlib
import importlib.util
import os
import subprocess
import sys
import tempfile
import unittest

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _load_hostapi():
    spec = importlib.util.spec_from_file_location("hostapi", os.path.join(REPO, "host-api.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


hostapi = _load_hostapi()


class FakeRunArgv:
    """Records every argv and replays canned (stdout, code) responses keyed by
    the pct subcommand ("push" or "exec")."""

    def __init__(self, responses):
        self.responses = responses
        self.calls = []

    def __call__(self, argv, timeout=60):
        assert isinstance(argv, list), "run_argv must receive an argument list, not a shell string"
        assert all(isinstance(a, str) for a in argv)
        self.calls.append(argv)
        queue = self.responses.get(argv[1], [])
        if not queue:
            raise AssertionError(f"unexpected pct {argv[1]} call: {argv}")
        return queue.pop(0)

    def subcommands(self):
        return [c[1] for c in self.calls]


class ProbeTests(unittest.TestCase):
    def setUp(self):
        self._orig = hostapi.run_argv

    def tearDown(self):
        hostapi.run_argv = self._orig

    def test_script_syntax(self):
        r = subprocess.run(["bash", "-n", "-c", hostapi._MCX_PROBE_SCRIPT], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)

    def test_parses_banner(self):
        banner = "Starting MCXboxBroadcast\nBuilt for Bedrock 1.21.132 (protocol 800)\n"
        fake = FakeRunArgv({"push": [("", 0)], "exec": [(banner, 0)]})
        hostapi.run_argv = fake
        self.assertEqual(hostapi._probe_mcx_supported_bedrock("/tmp/fake.jar"), "1.21.132")
        push, ex = fake.calls
        self.assertEqual(push[:3], ["pct", "push", str(hostapi._MCX_CTID)])
        self.assertIn("/tmp/fake.jar", push)
        # jar path is a positional parameter after the script, never spliced into it
        self.assertIn(hostapi._MCX_PROBE_SCRIPT, ex)
        # unique per probe so concurrent checks never clobber each other's jar
        self.assertRegex(ex[-1], r"^/tmp/MCXboxBroadcast-probe-\d+-\d+\.jar$")

    def test_push_failure_returns_none_and_skips_exec(self):
        fake = FakeRunArgv({"push": [("", 1)]})
        hostapi.run_argv = fake
        self.assertIsNone(hostapi._probe_mcx_supported_bedrock("/tmp/fake.jar"))
        self.assertEqual(fake.subcommands(), ["push"])

    def test_no_banner_returns_none(self):
        fake = FakeRunArgv({"push": [("", 0)], "exec": [("no version line here", 0)]})
        hostapi.run_argv = fake
        self.assertIsNone(hostapi._probe_mcx_supported_bedrock("/tmp/fake.jar"))


class UpdateBroadcastersTests(unittest.TestCase):
    def setUp(self):
        self._orig = hostapi.run_argv
        self.tmp = tempfile.TemporaryDirectory()
        self.jar = os.path.join(self.tmp.name, "release.jar")
        with open(self.jar, "wb") as f:
            f.write(b"new jar bytes")
        self.hash = hashlib.sha256(b"new jar bytes").hexdigest()
        self.release = {
            "localJarPath": self.jar,
            "releaseTag": "v1.2.3",
            "supportedBedrock": "1.21.132",
        }

    def tearDown(self):
        hostapi.run_argv = self._orig
        self.tmp.cleanup()

    def test_script_syntax(self):
        r = subprocess.run(["bash", "-n", "-c", hostapi._MCX_SWAP_SCRIPT], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)

    def test_missing_jar(self):
        ok, msg = hostapi._update_mcx_broadcasters({"localJarPath": None})
        self.assertFalse(ok)

    def test_noop_when_both_hashes_match(self):
        fake = FakeRunArgv({"exec": [(f"{self.hash}  a", 0), (f"{self.hash}  b", 0)]})
        hostapi.run_argv = fake
        ok, msg = hostapi._update_mcx_broadcasters(self.release)
        self.assertTrue(ok)
        self.assertIn("already installed", msg)
        self.assertNotIn("push", fake.subcommands())

    def test_remote_hash_read_failure_aborts_before_push(self):
        fake = FakeRunArgv({"exec": [("", 1)]})
        hostapi.run_argv = fake
        ok, msg = hostapi._update_mcx_broadcasters(self.release)
        self.assertFalse(ok)
        self.assertNotIn("push", fake.subcommands())

    def test_pushes_and_swaps_when_hashes_differ(self):
        fake = FakeRunArgv({
            "exec": [("aaaa  a", 0), ("bbbb  b", 0), ("active\nactive", 0)],
            "push": [("", 0)],
        })
        hostapi.run_argv = fake
        ok, msg = hostapi._update_mcx_broadcasters(self.release)
        self.assertTrue(ok, msg)
        self.assertIn("v1.2.3", msg)
        swap = fake.calls[-1]
        self.assertIn(hostapi._MCX_SWAP_SCRIPT, swap)
        # staged path, expected hash, and both jar paths ride as argv, not script text
        self.assertIn("/tmp/MCXboxBroadcast-v1.2.3.jar", swap)
        self.assertIn(self.hash, swap)
        for jar in hostapi._MCX_REMOTE_JARS:
            self.assertIn(jar, swap)

    def test_swap_failure_reported(self):
        fake = FakeRunArgv({
            "exec": [("aaaa  a", 0), ("bbbb  b", 0), ("staged jar checksum mismatch: got x want y", 1)],
            "push": [("", 0)],
        })
        hostapi.run_argv = fake
        ok, msg = hostapi._update_mcx_broadcasters(self.release)
        self.assertFalse(ok)
        self.assertIn("checksum mismatch", msg)

    def test_hostile_tag_never_reaches_shell_or_paths(self):
        self.release["releaseTag"] = "v1.2.3; rm -rf / #$(boom)"
        fake = FakeRunArgv({
            "exec": [("aaaa  a", 0), ("bbbb  b", 0), ("active", 0)],
            "push": [("", 0)],
        })
        hostapi.run_argv = fake
        ok, _ = hostapi._update_mcx_broadcasters(self.release)
        self.assertTrue(ok)
        push = fake.calls[2]
        staged = push[-1]
        self.assertRegex(staged, r"^/tmp/MCXboxBroadcast-[A-Za-z0-9._-]+\.jar$")


class SwapScriptBashTests(unittest.TestCase):
    """Executes _MCX_SWAP_SCRIPT for real against throwaway files. systemctl is
    stubbed via PATH so no service is ever touched."""

    SUFFIX = "pre-vtest-20260805-000000"

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = self.tmp.name
        bindir = os.path.join(self.root, "bin")
        os.makedirs(bindir)
        self.sysctl_log = os.path.join(self.root, "systemctl.log")
        stub = os.path.join(bindir, "systemctl")
        with open(stub, "w") as f:
            f.write(f'#!/bin/bash\necho "$@" >> {self.sysctl_log}\n'
                    'if [ "$1" = is-active ]; then printf "active\\nactive\\n"; fi\n')
        os.chmod(stub, 0o755)
        self.env = dict(os.environ, PATH=bindir + os.pathsep + os.environ["PATH"])

        self.staged = os.path.join(self.root, "staged.jar")
        self._write(self.staged, b"new jar bytes")
        self.want = hashlib.sha256(b"new jar bytes").hexdigest()
        self.jar1 = os.path.join(self.root, "svc1", "MCXboxBroadcast.jar")
        self.jar2 = os.path.join(self.root, "svc2", "MCXboxBroadcast.jar")
        for jar, content in ((self.jar1, b"old one"), (self.jar2, b"old two")):
            os.makedirs(os.path.dirname(jar))
            self._write(jar, content)

    def tearDown(self):
        self.tmp.cleanup()

    def _write(self, path, data):
        with open(path, "wb") as f:
            f.write(data)

    def _read(self, path):
        with open(path, "rb") as f:
            return f.read()

    def _run(self, want_hash=None, jars=None):
        argv = ["bash", "-c", hostapi._MCX_SWAP_SCRIPT, "mcx-swap",
                self.staged, want_hash or self.want, self.SUFFIX] + (jars or [self.jar1, self.jar2])
        return subprocess.run(argv, capture_output=True, text=True, env=self.env, timeout=30)

    def _sysctl_calls(self):
        if not os.path.exists(self.sysctl_log):
            return []
        with open(self.sysctl_log) as f:
            return f.read().splitlines()

    def test_happy_path(self):
        r = self._run()
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        for jar, old in ((self.jar1, b"old one"), (self.jar2, b"old two")):
            self.assertEqual(self._read(jar), b"new jar bytes")
            self.assertEqual(self._read(f"{jar}.{self.SUFFIX}"), old)
        self.assertFalse(os.path.exists(self.staged), "staged upload should be removed")
        calls = self._sysctl_calls()
        self.assertTrue(any(c.startswith("restart ") for c in calls))
        self.assertTrue(any(c.startswith("is-active ") for c in calls))

    def test_checksum_mismatch_touches_nothing(self):
        r = self._run(want_hash="0" * 64)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("checksum mismatch", r.stdout)
        self.assertEqual(self._read(self.jar1), b"old one")
        self.assertEqual(self._read(self.jar2), b"old two")
        self.assertFalse(os.path.exists(f"{self.jar1}.{self.SUFFIX}"))
        self.assertFalse(os.path.exists(self.staged), "staged upload should be removed even on failure")
        self.assertEqual(self._sysctl_calls(), [])

    def test_partial_install_failure_rolls_back(self):
        # second jar's parent dir doesn't exist, so its install fails after
        # jar1 was already replaced — jar1 must be restored, services untouched
        missing = os.path.join(self.root, "nope", "MCXboxBroadcast.jar")
        r = self._run(jars=[self.jar1, missing])
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("restored", r.stdout)
        self.assertEqual(self._read(self.jar1), b"old one")
        self.assertFalse(os.path.exists(self.staged))
        self.assertEqual(self._sysctl_calls(), [])

    def test_already_current_jar_not_backed_up(self):
        self._write(self.jar1, b"new jar bytes")
        r = self._run()
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertFalse(os.path.exists(f"{self.jar1}.{self.SUFFIX}"),
                         "jar already on the target hash should not get a backup")
        self.assertEqual(self._read(f"{self.jar2}.{self.SUFFIX}"), b"old two")


if __name__ == "__main__":
    unittest.main(verbosity=2)
