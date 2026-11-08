"""Minimal pytest surface for running this suite inside the backend image.

The image ships no pytest (deliberately: it is a runtime image, and the dependency tree is
already 10.6 GB of torch). This provides exactly what `tests/` uses — `fixture`,
`mark.parametrize`, `raises` — so `scripts/run_tests_inpod.py` can execute the files.

Do NOT grow this into a test framework. If richer testing is needed, install pytest properly;
a shim that quits quietly on the constructs it does not implement is worse than no shim.
"""
from contextlib import contextmanager

# name -> list of (args tuple, kwargs dict) recorded by mark.parametrize
PARAMS: dict = {}
# name -> fixture function
FIXTURES: dict = {}


def fixture(fn=None, **_kw):
    """Register a fixture. Usable bare or called."""
    def wrap(f):
        FIXTURES[f.__name__] = f
        return f
    return wrap(fn) if fn is not None else wrap


class _ExcInfo:
    def __init__(self, value):
        self.value = value


@contextmanager
def raises(expected, match=None):
    try:
        yield _ExcInfo(None)
    except expected as e:
        if match:
            import re
            if not re.search(match, str(e)):
                raise AssertionError(f"{e!r} does not match {match!r}")
        return
    except Exception as e:  # noqa: BLE001
        raise AssertionError(f"expected {expected.__name__}, got {type(e).__name__}: {e}")
    raise AssertionError(f"expected {expected.__name__} to be raised")


class _Mark:
    @staticmethod
    def parametrize(argnames, argvalues, **kwargs):
        names = [n.strip() for n in argnames.split(",")]

        def deco(fn):
            rows = []
            for v in argvalues:
                row = v if isinstance(v, (tuple, list)) else (v,)
                rows.append(dict(zip(names, row)))
            PARAMS.setdefault(fn.__name__, []).extend(rows)
            return fn
        return deco

    def __getattr__(self, _name):
        # skip / xfail / slow and friends: no-ops that return the function unchanged
        def deco(*a, **k):
            if a and callable(a[0]):
                return a[0]

            def wrap(f):
                return f
            return wrap
        return deco


mark = _Mark()


class _MonkeyPatch:
    """The subset of pytest's monkeypatch this suite would use.

    Provided because a test that *requires* the fixture would otherwise fail with
    "no value for parameter" — a runner limitation masquerading as a test failure.
    """

    def __init__(self):
        self._undo = []

    def setenv(self, name, value, prepend=None):
        import os
        old = os.environ.get(name)
        self._undo.append(lambda: os.environ.__setitem__(name, old) if old is not None
                          else os.environ.pop(name, None))
        os.environ[name] = str(value)

    def delenv(self, name, raising=True):
        import os
        old = os.environ.get(name)
        if old is None and raising:
            raise KeyError(name)
        self._undo.append(lambda: os.environ.__setitem__(name, old) if old is not None else None)
        os.environ.pop(name, None)

    def setattr(self, target, name, value=None, raising=True):
        import importlib
        if isinstance(target, str):
            # "pkg.module.attr" form: import the module, patch the last component
            mod_name, _, attr = target.rpartition(".")
            obj = importlib.import_module(mod_name)
            value = name
            name = attr
        else:
            obj = target
        old = getattr(obj, name, None)
        self._undo.append(lambda: setattr(obj, name, old))
        setattr(obj, name, value)

    def undo(self):
        while self._undo:
            self._undo.pop()()


FIXTURES["monkeypatch"] = _MonkeyPatch
