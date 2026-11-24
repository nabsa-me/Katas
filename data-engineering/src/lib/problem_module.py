"""Loads the flawed `<name>.problem.py` versions, which `import` cannot reach because of the dot in the file name."""

import importlib.util
import sys
from pathlib import Path
from types import ModuleType


def load_problem_module(path: Path) -> ModuleType:
    """Imports a file by path, under a module name derived from it (`extractor.problem.py` → `extractor_problem`)."""
    name = path.name.removesuffix(".py").replace(".", "_")
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ImportError(f"Cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module
