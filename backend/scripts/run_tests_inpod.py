"""Run `tests/*.py` inside the backend image, where pytest is not installed.

Usage:  python scripts/run_tests_inpod.py /tmp/test_a.py /tmp/test_b.py ...
        python scripts/run_tests_inpod.py "/tmp/test_*.py"

WHY: `kubectl exec` cannot run pytest in this image, and `kubectl cp` does not work either —
the files arrive via `kubectl exec -i ... sh -c 'cat > /tmp/x.py'`. This then executes them
with a shim, expands @parametrize rows, and injects fixtures by parameter name.

Exit code is 1 if anything failed, so it can gate a deploy.
"""
import glob
import importlib.util
import inspect
import os
import sys
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import pytest_shim  # noqa: E402  (must be importable AS `pytest` below)
sys.modules.setdefault("pytest", pytest_shim)

sys.path.insert(0, "/app")


def _load(path):
    name = "t_" + os.path.basename(path).replace(".py", "")
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _call(fn, params):
    """Call a test, resolving fixture arguments by parameter name."""
    sig = inspect.signature(fn)
    kwargs = {}
    for pname, p in sig.parameters.items():
        if pname in params:
            kwargs[pname] = params[pname]
        elif pname in pytest_shim.FIXTURES:
            kwargs[pname] = pytest_shim.FIXTURES[pname]()
        elif p.default is not inspect.Parameter.empty:
            # A parameter with a default is optional. `monkeypatch=None` is the common case:
            # the test guards itself and needs no injection. Passing nothing (rather than the
            # default explicitly) keeps the call identical to how pytest would make it when
            # the fixture is not requested.
            continue
        else:
            raise AssertionError(f"no value for parameter {pname!r} (no fixture, no parametrize)")
    return fn(**kwargs)


def main(argv):
    files = []
    for a in argv or ["/tmp/test_*.py"]:
        files.extend(sorted(glob.glob(a)) if any(c in a for c in "*?") else [a])
    total = passed = 0
    failures = []
    for f in files:
        if not os.path.exists(f):
            print(f"  MISSING {f}")
            failures.append((f, "<file>", "not found"))
            continue
        try:
            mod = _load(f)
        except Exception:
            print(f"  LOAD FAIL {os.path.basename(f)}")
            traceback.print_exc(limit=2)
            failures.append((f, "<import>", "load error"))
            total += 1
            continue
        fns = [(n, fn) for n, fn in vars(mod).items()
               if n.startswith("test_") and inspect.isfunction(fn)]
        good = 0
        for name, fn in fns:
            rows = pytest_shim.PARAMS.get(name) or [{}]
            for params in rows:
                total += 1
                tag = name if len(rows) == 1 else f"{name}[{','.join(str(v) for v in params.values())}]"
                try:
                    _call(fn, params)
                    passed += 1
                    good += 1
                except Exception as e:
                    failures.append((os.path.basename(f), tag, f"{type(e).__name__}: {e}"))
                    print(f"  FAIL {os.path.basename(f)}::{tag}\n       {type(e).__name__}: {e}")
        # `good` counts executed assertions (parametrize rows expand), so report both the
        # assertion total and the number of test functions — printing 16/8 looked like a bug.
        n_asserts = sum(len(pytest_shim.PARAMS.get(n) or [{}]) for n, _ in fns)
        print(f"  {os.path.basename(f):<38} {good}/{n_asserts} assertions from {len(fns)} functions")
    print(f"\n  TOTAL {passed}/{total} assertions passed")
    if failures:
        print(f"  {len(failures)} FAILURE(S)")
        return 1
    print("  ALL PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
