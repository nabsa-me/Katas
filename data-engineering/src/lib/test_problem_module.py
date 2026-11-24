from pathlib import Path

from lib.problem_module import load_problem_module


def test_loads_a_module_whose_file_name_has_a_dot(tmp_path: Path) -> None:
    path = tmp_path / "report.problem.py"
    path.write_text("def answer() -> int:\n    return 42\n", encoding="utf-8")

    module = load_problem_module(path)

    assert module.__name__ == "report_problem"
    assert module.answer() == 42
