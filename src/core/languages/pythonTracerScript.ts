/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DRY RUN PHASE 5: Real Python 3 AST + Runtime Instrumentation Script
 *
 * This script runs inside real CPython 3.10+ / Pyodide (CPython WebAssembly).
 * It combines:
 *   1. Pre-execution AST security validation (_SecurityValidator)
 *   2. Source-location-preserving AST transformation (_DryRunAstTransformer)
 *   3. Frame-aware runtime trace engine (_PyTraceRuntime)
 *   4. Python memory & object identity model (id()-backed stable heap IDs, alias tracking, circular ref protection)
 */

export const PYTHON_TRACER_SCRIPT = String.raw`
import ast
import builtins
import copy
import json
import math
import sys
import time
import traceback

SAFE_IMPORT_WHITELIST = {
    "math",
    "heapq",
    "collections",
    "bisect",
    "itertools",
    "functools",
    "typing",
    "dataclasses",
    "enum",
    "copy",
    "random",
    "string",
    "operator",
}

DISALLOWED_MODULES = {
    "os",
    "sys",
    "subprocess",
    "socket",
    "urllib",
    "http",
    "requests",
    "pathlib",
    "shutil",
    "ctypes",
    "multiprocessing",
    "threading",
    "asyncio",
    "importlib",
    "builtins",
    "inspect",
    "pickle",
    "marshal",
    "tempfile",
    "glob",
    "io",
    "pty",
    "fcntl",
    "resource",
    "signal",
    "js",
    "pyodide",
    "pyodide_js",
    "micropip",
    "emscripten",
    "webloop",
}

DISALLOWED_BUILTINS = {
    "eval",
    "exec",
    "compile",
    "open",
    "input",
    "__import__",
    "globals",
    "locals",
    "vars",
    "getattr",
    "setattr",
    "delattr",
    "breakpoint",
    "exit",
    "quit",
    "help",
    "memoryview",
}

DISALLOWED_DUNDERS = {
    "__subclasses__",
    "__bases__",
    "__mro__",
    "__globals__",
    "__code__",
    "__closure__",
    "__builtins__",
    "__import__",
    "__loader__",
    "__spec__",
    "__dict__",
}

MUTATING_LIST_METHODS = {
    "append",
    "extend",
    "insert",
    "pop",
    "remove",
    "reverse",
    "sort",
    "clear",
}

MUTATING_SET_METHODS = {
    "add",
    "remove",
    "discard",
    "pop",
    "clear",
    "update",
}

MUTATING_DICT_METHODS = {
    "pop",
    "popitem",
    "clear",
    "update",
    "setdefault",
}


class ExecutionQuotaError( BaseException ):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status
        self.message = message


class _SecurityValidator(ast.NodeVisitor):
    def __init__(self):
        self.violations = []

    def visit_Import(self, node):
        for alias in node.names:
            root_mod = alias.name.split(".")[0]
            if root_mod in DISALLOWED_MODULES or root_mod not in SAFE_IMPORT_WHITELIST:
                self.violations.append(
                    f"Security violation (line {node.lineno}): Import of restricted module '{alias.name}' is disallowed in sandbox."
                )
        self.generic_visit(node)

    def visit_ImportFrom(self, node):
        mod_name = (node.module or "").split(".")[0]
        if mod_name in DISALLOWED_MODULES or mod_name not in SAFE_IMPORT_WHITELIST:
            self.violations.append(
                f"Security violation (line {node.lineno}): Import from restricted module '{node.module}' is disallowed in sandbox."
            )
        self.generic_visit(node)

    def visit_Call(self, node):
        if isinstance(node.func, ast.Name) and node.func.id in DISALLOWED_BUILTINS:
            self.violations.append(
                f"Security violation (line {node.lineno}): Call to restricted builtin '{node.func.id}()' is disallowed in sandbox."
            )
        self.generic_visit(node)

    def visit_Attribute(self, node):
        if node.attr in DISALLOWED_DUNDERS:
            self.violations.append(
                f"Security violation (line {node.lineno}): Access to internal dunder attribute '{node.attr}' is disallowed."
            )
        self.generic_visit(node)

    def visit_Name(self, node):
        if node.id in DISALLOWED_DUNDERS:
            self.violations.append(
                f"Security violation (line {node.lineno}): Access to restricted symbol '{node.id}' is disallowed."
            )
        self.generic_visit(node)


def _extract_index_var_name(slice_node):
    if isinstance(slice_node, ast.Name):
        return slice_node.id
    if isinstance(slice_node, ast.BinOp):
        if isinstance(slice_node.left, ast.Name):
            return slice_node.left.id
        if isinstance(slice_node.right, ast.Name):
            return slice_node.right.id
    if isinstance(slice_node, ast.UnaryOp) and isinstance(slice_node.operand, ast.Name):
        return slice_node.operand.id
    return None


def _extract_target_names(target_node, out=None):
    if out is None:
        out = []
    if isinstance(target_node, ast.Name):
        out.append(target_node.id)
    elif isinstance(target_node, (ast.Tuple, ast.List)):
        for elt in target_node.elts:
            _extract_target_names(elt, out)
    elif isinstance(target_node, ast.Starred):
        _extract_target_names(target_node.value, out)
    return out


class _DryRunAstTransformer(ast.NodeTransformer):
    def __init__(self, source_lines):
        super().__init__()
        self.source_lines = source_lines
        self.loop_counter = 0
        self.fn_counter = 0
        self.in_class_stack = []
        self.fn_stack = []

    def _loc(self, node):
        line = getattr(node, "lineno", 1) or 1
        col = (getattr(node, "col_offset", 0) or 0) + 1
        return line, col

    def _end_loc(self, node):
        line = getattr(node, "end_lineno", None) or getattr(node, "lineno", 1) or 1
        col = (getattr(node, "end_col_offset", None) or getattr(node, "col_offset", 0) or 0) + 1
        return line, col

    def _source_segment(self, node):
        try:
            seg = ast.get_source_segment("\n".join(self.source_lines), node)
            if seg:
                return seg.strip()
        except Exception:
            pass
        return None

    def _dr_call(self, method_name, args, ref_node):
        call_node = ast.Call(
            func=ast.Attribute(
                value=ast.Name(id="__dr__", ctx=ast.Load()),
                attr=method_name,
                ctx=ast.Load(),
            ),
            args=args,
            keywords=[],
        )
        return ast.copy_location(call_node, ref_node)

    def visit_ClassDef(self, node):
        self.in_class_stack.append(node.name)
        new_body = []
        for stmt in node.body:
            res = self.visit(stmt)
            if isinstance(res, list):
                new_body.extend(res)
            elif res is not None:
                new_body.append(res)
        node.body = new_body or [ast.Pass()]
        self.in_class_stack.pop()

        line, col = self._loc(node)
        reg_stmt = ast.copy_location(
            ast.Expr(
                value=self._dr_call(
                    "register_var",
                    [
                        ast.Constant(value=node.name),
                        ast.Name(id=node.name, ctx=ast.Load()),
                        ast.Constant(value="class"),
                        ast.Constant(value=line),
                        ast.Constant(value=col),
                    ],
                    node,
                )
            ),
            node,
        )
        return [node, reg_stmt]

    def visit_FunctionDef(self, node):
        self.fn_counter += 1
        fn_id = self.fn_counter
        frame_var = f"__dr_frame_{fn_id}"
        is_method_init = len(self.in_class_stack) > 0 and node.name == "__init__"
        self.fn_stack.append((frame_var, node.name, is_method_init))

        line, col = self._loc(node)
        end_line, end_col = self._end_loc(node)

        param_names = [arg.arg for arg in node.args.args]
        if node.args.vararg:
            param_names.append(node.args.vararg.arg)
        for kwarg in node.args.kwonlyargs:
            param_names.append(kwarg.arg)
        if node.args.kwarg:
            param_names.append(node.args.kwarg.arg)

        new_body = []
        for stmt in node.body:
            res = self.visit(stmt)
            if isinstance(res, list):
                new_body.extend(res)
            elif res is not None:
                new_body.append(res)

        self.fn_stack.pop()

        enter_assign = ast.Assign(
            targets=[ast.Name(id=frame_var, ctx=ast.Store())],
            value=self._dr_call(
                "enter_fn",
                [
                    ast.Constant(value=node.name),
                    ast.List(elts=[ast.Constant(value=p) for p in param_names], ctx=ast.Load()),
                    ast.List(elts=[ast.Name(id=p, ctx=ast.Load()) for p in param_names], ctx=ast.Load()),
                    ast.Constant(value=line),
                    ast.Constant(value=col),
                ],
                node,
            ),
        )

        implicit_ret = ast.Expr(
            value=self._dr_call(
                "ret_implicit",
                [
                    ast.Name(id=frame_var, ctx=ast.Load()),
                    ast.Constant(value=node.name),
                    ast.Name(id=param_names[0], ctx=ast.Load()) if (is_method_init and len(param_names) > 0) else ast.Constant(value=None),
                    ast.Constant(value=end_line),
                    ast.Constant(value=end_col),
                ],
                node,
            )
        )

        exit_call = ast.Expr(
            value=self._dr_call(
                "exit_fn",
                [ast.Name(id=frame_var, ctx=ast.Load())],
                node,
            )
        )

        try_block = ast.Try(
            body=new_body + [implicit_ret],
            handlers=[],
            orelse=[],
            finalbody=[exit_call],
        )

        node.body = [
            ast.copy_location(enter_assign, node),
            ast.copy_location(try_block, node),
        ]

        if len(self.in_class_stack) == 0:
            reg_fn_stmt = ast.copy_location(
                ast.Expr(
                    value=self._dr_call(
                        "register_var",
                        [
                            ast.Constant(value=node.name),
                            ast.Name(id=node.name, ctx=ast.Load()),
                            ast.Constant(value="def"),
                            ast.Constant(value=line),
                            ast.Constant(value=col),
                        ],
                        node,
                    )
                ),
                node,
            )
            return [node, reg_fn_stmt]

        return node

    def visit_Return(self, node):
        line, col = self._loc(node)
        val_node = self.visit(node.value) if node.value is not None else ast.Constant(value=None)
        if not self.fn_stack:
            node.value = val_node
            return node

        frame_var, fn_name, is_method_init = self.fn_stack[-1]
        if is_method_init:
            # __init__ must return None in Python
            node.value = None
            return node

        node.value = self._dr_call(
            "ret",
            [
                ast.Name(id=frame_var, ctx=ast.Load()),
                ast.Constant(value=fn_name),
                val_node,
                ast.Constant(value=line),
                ast.Constant(value=col),
            ],
            node,
        )
        return node

    def visit_Assign(self, node):
        line, col = self._loc(node)

        # Case 1: Single target
        if len(node.targets) == 1:
            target = node.targets[0]

            # 1a: Simple variable assignment: x = expr
            if isinstance(target, ast.Name):
                rhs = self.visit(node.value)
                rhs_var_name = node.value.id if isinstance(node.value, ast.Name) else None
                node.value = self._dr_call(
                    "assign_var",
                    [
                        ast.Constant(value=target.id),
                        rhs,
                        ast.Constant(value="="),
                        ast.Constant(value=rhs_var_name),
                        ast.Constant(value=line),
                        ast.Constant(value=col),
                    ],
                    node,
                )
                return node

            # 1b: Subscript assignment: nums[i] = expr or freq[k] = expr
            if isinstance(target, ast.Subscript) and not isinstance(target.slice, ast.Slice):
                obj_expr = self.visit(target.value)
                idx_expr = self.visit(target.slice)
                rhs_expr = self.visit(node.value)
                obj_name = target.value.id if isinstance(target.value, ast.Name) else None
                idx_var = _extract_index_var_name(target.slice)
                rhs_var = node.value.id if isinstance(node.value, ast.Name) else None

                return ast.copy_location(
                    ast.Expr(
                        value=self._dr_call(
                            "set_subscript",
                            [
                                obj_expr,
                                idx_expr,
                                rhs_expr,
                                ast.Constant(value="="),
                                ast.Constant(value=obj_name),
                                ast.Constant(value=idx_var),
                                ast.Constant(value=rhs_var),
                                ast.Constant(value=line),
                                ast.Constant(value=col),
                            ],
                            node,
                        )
                    ),
                    node,
                )

            # 1c: Attribute assignment: head.next = Node(20) or self.value = value
            if isinstance(target, ast.Attribute):
                obj_expr = self.visit(target.value)
                rhs_expr = self.visit(node.value)
                obj_name = target.value.id if isinstance(target.value, ast.Name) else None
                return ast.copy_location(
                    ast.Expr(
                        value=self._dr_call(
                            "set_attr",
                            [
                                obj_expr,
                                ast.Constant(value=target.attr),
                                rhs_expr,
                                ast.Constant(value="="),
                                ast.Constant(value=obj_name),
                                ast.Constant(value=line),
                                ast.Constant(value=col),
                            ],
                            node,
                        )
                    ),
                    node,
                )

            # 1d: Tuple/List unpacking assignment: a, b = b, a OR nums[i], nums[j] = nums[j], nums[i]
            if isinstance(target, (ast.Tuple, ast.List)):
                elts = target.elts
                # Check if all LHS targets are subscripts (e.g. nums[i], nums[j] = nums[j], nums[i])
                if all(isinstance(e, ast.Subscript) and not isinstance(e.slice, ast.Slice) for e in elts):
                    rhs_visited = self.visit(node.value)
                    objs_list = ast.List(elts=[self.visit(e.value) for e in elts], ctx=ast.Load())
                    idxs_list = ast.List(elts=[self.visit(e.slice) for e in elts], ctx=ast.Load())
                    obj_names = ast.List(
                        elts=[ast.Constant(value=e.value.id if isinstance(e.value, ast.Name) else None) for e in elts],
                        ctx=ast.Load(),
                    )
                    idx_vars = ast.List(
                        elts=[ast.Constant(value=_extract_index_var_name(e.slice)) for e in elts],
                        ctx=ast.Load(),
                    )
                    return ast.copy_location(
                        ast.Expr(
                            value=self._dr_call(
                                "tuple_subscript_assign",
                                [
                                    objs_list,
                                    idxs_list,
                                    rhs_visited,
                                    obj_names,
                                    idx_vars,
                                    ast.Constant(value=line),
                                    ast.Constant(value=col),
                                ],
                                node,
                            )
                        ),
                        node,
                    )

                # Otherwise, standard variable unpacking (e.g. left, right = 0, len(nums) - 1)
                node.value = self.visit(node.value)
                bound_names = _extract_target_names(target)
                if bound_names:
                    sync_stmt = ast.copy_location(
                        ast.Expr(
                            value=self._dr_call(
                                "record_unpack_assign",
                                [
                                    ast.List(elts=[ast.Constant(value=n) for n in bound_names], ctx=ast.Load()),
                                    ast.List(elts=[ast.Name(id=n, ctx=ast.Load()) for n in bound_names], ctx=ast.Load()),
                                    ast.Constant(value=line),
                                    ast.Constant(value=col),
                                ],
                                node,
                            )
                        ),
                        node,
                    )
                    return [node, sync_stmt]

        # Chained assignment fallback: a = b = 0
        node.value = self.visit(node.value)
        bound_names = []
        for t in node.targets:
            _extract_target_names(t, bound_names)
        if bound_names:
            sync_stmt = ast.copy_location(
                ast.Expr(
                    value=self._dr_call(
                        "record_unpack_assign",
                        [
                            ast.List(elts=[ast.Constant(value=n) for n in bound_names], ctx=ast.Load()),
                            ast.List(elts=[ast.Name(id=n, ctx=ast.Load()) for n in bound_names], ctx=ast.Load()),
                            ast.Constant(value=line),
                            ast.Constant(value=col),
                        ],
                        node,
                    )
                ),
                node,
            )
            return [node, sync_stmt]
        return node

    def visit_AnnAssign(self, node):
        line, col = self._loc(node)
        if node.value is not None and isinstance(node.target, ast.Name):
            rhs = self.visit(node.value)
            return ast.copy_location(
                ast.Assign(
                    targets=[ast.Name(id=node.target.id, ctx=ast.Store())],
                    value=self._dr_call(
                        "assign_var",
                        [
                            ast.Constant(value=node.target.id),
                            rhs,
                            ast.Constant(value="="),
                            ast.Constant(value=None),
                            ast.Constant(value=line),
                            ast.Constant(value=col),
                        ],
                        node,
                    ),
                ),
                node,
            )
        return node

    def _aug_op_str(self, op):
        if isinstance(op, ast.Add):
            return "+="
        if isinstance(op, ast.Sub):
            return "-="
        if isinstance(op, ast.Mult):
            return "*="
        if isinstance(op, ast.Div):
            return "/="
        if isinstance(op, ast.FloorDiv):
            return "//="
        if isinstance(op, ast.Mod):
            return "%="
        if isinstance(op, ast.Pow):
            return "**="
        if isinstance(op, ast.BitAnd):
            return "&="
        if isinstance(op, ast.BitOr):
            return "|="
        if isinstance(op, ast.BitXor):
            return "^="
        if isinstance(op, ast.LShift):
            return "<<="
        if isinstance(op, ast.RShift):
            return ">>="
        return "+="

    def visit_AugAssign(self, node):
        line, col = self._loc(node)
        op_str = self._aug_op_str(node.op)
        rhs = self.visit(node.value)
        target = node.target

        if isinstance(target, ast.Name):
            return ast.copy_location(
                ast.Assign(
                    targets=[ast.Name(id=target.id, ctx=ast.Store())],
                    value=self._dr_call(
                        "aug_assign_var",
                        [
                            ast.Constant(value=target.id),
                            ast.Name(id=target.id, ctx=ast.Load()),
                            rhs,
                            ast.Constant(value=op_str),
                            ast.Constant(value=line),
                            ast.Constant(value=col),
                        ],
                        node,
                    ),
                ),
                node,
            )

        if isinstance(target, ast.Subscript) and not isinstance(target.slice, ast.Slice):
            obj_expr = self.visit(target.value)
            idx_expr = self.visit(target.slice)
            obj_name = target.value.id if isinstance(target.value, ast.Name) else None
            idx_var = _extract_index_var_name(target.slice)
            return ast.copy_location(
                ast.Expr(
                    value=self._dr_call(
                        "set_subscript",
                        [
                            obj_expr,
                            idx_expr,
                            rhs,
                            ast.Constant(value=op_str),
                            ast.Constant(value=obj_name),
                            ast.Constant(value=idx_var),
                            ast.Constant(value=None),
                            ast.Constant(value=line),
                            ast.Constant(value=col),
                        ],
                        node,
                    )
                ),
                node,
            )

        if isinstance(target, ast.Attribute):
            obj_expr = self.visit(target.value)
            obj_name = target.value.id if isinstance(target.value, ast.Name) else None
            return ast.copy_location(
                ast.Expr(
                    value=self._dr_call(
                        "set_attr",
                        [
                            obj_expr,
                            ast.Constant(value=target.attr),
                            rhs,
                            ast.Constant(value=op_str),
                            ast.Constant(value=obj_name),
                            ast.Constant(value=line),
                            ast.Constant(value=col),
                        ],
                        node,
                    )
                ),
                node,
            )

        node.value = rhs
        return node

    def visit_Delete(self, node):
        line, col = self._loc(node)
        new_stmts = []
        for target in node.targets:
            if isinstance(target, ast.Subscript) and not isinstance(target.slice, ast.Slice):
                obj_expr = self.visit(target.value)
                idx_expr = self.visit(target.slice)
                obj_name = target.value.id if isinstance(target.value, ast.Name) else None
                new_stmts.append(
                    ast.copy_location(
                        ast.Expr(
                            value=self._dr_call(
                                "del_subscript",
                                [
                                    obj_expr,
                                    idx_expr,
                                    ast.Constant(value=obj_name),
                                    ast.Constant(value=line),
                                    ast.Constant(value=col),
                                ],
                                node,
                            )
                        ),
                        node,
                    )
                )
            else:
                new_stmts.append(ast.Delete(targets=[target]))
        return new_stmts

    def visit_List(self, node):
        if isinstance(node.ctx, ast.Load):
            line, col = self._loc(node)
            node.elts = [self.visit(e) for e in node.elts]
            return self._dr_call(
                "create_list",
                [node, ast.Constant(value=line), ast.Constant(value=col)],
                node,
            )
        return self.generic_visit(node)

    def visit_Tuple(self, node):
        if isinstance(node.ctx, ast.Load):
            line, col = self._loc(node)
            node.elts = [self.visit(e) for e in node.elts]
            return self._dr_call(
                "create_tuple",
                [node, ast.Constant(value=line), ast.Constant(value=col)],
                node,
            )
        return self.generic_visit(node)

    def visit_Dict(self, node):
        line, col = self._loc(node)
        node.keys = [self.visit(k) if k is not None else None for k in node.keys]
        node.values = [self.visit(v) for v in node.values]
        return self._dr_call(
            "create_dict",
            [node, ast.Constant(value=line), ast.Constant(value=col)],
            node,
        )

    def visit_Set(self, node):
        line, col = self._loc(node)
        node.elts = [self.visit(e) for e in node.elts]
        return self._dr_call(
            "create_set",
            [node, ast.Constant(value=line), ast.Constant(value=col)],
            node,
        )

    def visit_Subscript(self, node):
        if not isinstance(node.ctx, ast.Load):
            return self.generic_visit(node)

        line, col = self._loc(node)
        obj_expr = self.visit(node.value)
        obj_name = node.value.id if isinstance(node.value, ast.Name) else None

        if isinstance(node.slice, ast.Slice):
            lower = self.visit(node.slice.lower) if node.slice.lower else ast.Constant(value=None)
            upper = self.visit(node.slice.upper) if node.slice.upper else ast.Constant(value=None)
            step = self.visit(node.slice.step) if node.slice.step else ast.Constant(value=None)
            return self._dr_call(
                "get_slice",
                [
                    obj_expr,
                    lower,
                    upper,
                    step,
                    ast.Constant(value=obj_name),
                    ast.Constant(value=line),
                    ast.Constant(value=col),
                ],
                node,
            )

        idx_var = _extract_index_var_name(node.slice)
        idx_expr = self.visit(node.slice)
        return self._dr_call(
            "get_subscript",
            [
                obj_expr,
                idx_expr,
                ast.Constant(value=obj_name),
                ast.Constant(value=idx_var),
                ast.Constant(value=line),
                ast.Constant(value=col),
            ],
            node,
        )

    def visit_Call(self, node):
        line, col = self._loc(node)
        visited_args = [self.visit(a) for a in node.args]
        visited_keywords = [
            ast.keyword(arg=kw.arg, value=self.visit(kw.value)) for kw in node.keywords
        ]

        # Intercept print(...)
        if isinstance(node.func, ast.Name) and node.func.id == "print":
            kw_dict = ast.Dict(
                keys=[ast.Constant(value=kw.arg) for kw in visited_keywords if kw.arg is not None],
                values=[kw.value for kw in visited_keywords if kw.arg is not None],
            )
            return self._dr_call(
                "call_print",
                [
                    ast.List(elts=visited_args, ctx=ast.Load()),
                    kw_dict,
                    ast.Constant(value=line),
                    ast.Constant(value=col),
                ],
                node,
            )

        # Intercept method calls: obj.method(...)
        if isinstance(node.func, ast.Attribute) and not any(
            isinstance(a, ast.Starred) for a in visited_args
        ) and not any(kw.arg is None for kw in visited_keywords):
            obj_expr = self.visit(node.func.value)
            obj_name = node.func.value.id if isinstance(node.func.value, ast.Name) else None
            method_name = node.func.attr
            kw_dict = ast.Dict(
                keys=[ast.Constant(value=kw.arg) for kw in visited_keywords],
                values=[kw.value for kw in visited_keywords],
            )
            return self._dr_call(
                "call_method",
                [
                    obj_expr,
                    ast.Constant(value=method_name),
                    ast.List(elts=visited_args, ctx=ast.Load()),
                    kw_dict,
                    ast.Constant(value=obj_name),
                    ast.Constant(value=line),
                    ast.Constant(value=col),
                ],
                node,
            )

        node.func = self.visit(node.func)
        node.args = visited_args
        node.keywords = visited_keywords
        return node

    def visit_If(self, node):
        test_line, test_col = self._loc(node.test)
        expr_str = self._source_segment(node.test)
        has_orelse = len(node.orelse) > 0
        visited_test = self.visit(node.test)

        node.test = self._dr_call(
            "cond",
            [
                visited_test,
                ast.Constant(value="if"),
                ast.Constant(value=test_line),
                ast.Constant(value=test_col),
                ast.Constant(value=has_orelse),
                ast.Constant(value=expr_str),
            ],
            node.test,
        )

        new_body = []
        for stmt in node.body:
            res = self.visit(stmt)
            if isinstance(res, list):
                new_body.extend(res)
            elif res is not None:
                new_body.append(res)
        node.body = new_body or [ast.Pass()]

        new_orelse = []
        for stmt in node.orelse:
            res = self.visit(stmt)
            if isinstance(res, list):
                new_orelse.extend(res)
            elif res is not None:
                new_orelse.append(res)
        node.orelse = new_orelse
        return node

    def visit_IfExp(self, node):
        test_line, test_col = self._loc(node.test)
        expr_str = self._source_segment(node.test)
        visited_test = self.visit(node.test)
        node.test = self._dr_call(
            "cond",
            [
                visited_test,
                ast.Constant(value="ternary"),
                ast.Constant(value=test_line),
                ast.Constant(value=test_col),
                ast.Constant(value=True),
                ast.Constant(value=expr_str),
            ],
            node.test,
        )
        node.body = self.visit(node.body)
        node.orelse = self.visit(node.orelse)
        return node

    def visit_While(self, node):
        self.loop_counter += 1
        loop_id = f"loop_{self.loop_counter}"
        line, col = self._loc(node)
        test_line, test_col = self._loc(node.test)
        expr_str = self._source_segment(node.test)

        visited_test = self.visit(node.test)
        node.test = self._dr_call(
            "cond",
            [
                visited_test,
                ast.Constant(value="while"),
                ast.Constant(value=test_line),
                ast.Constant(value=test_col),
                ast.Constant(value=False),
                ast.Constant(value=expr_str),
            ],
            node.test,
        )

        iter_stmt = ast.copy_location(
            ast.Expr(
                value=self._dr_call(
                    "loop_iter",
                    [
                        ast.Constant(value=loop_id),
                        ast.Constant(value="while"),
                        ast.Constant(value=line),
                        ast.Constant(value=col),
                    ],
                    node,
                )
            ),
            node,
        )

        new_body = [iter_stmt]
        for stmt in node.body:
            res = self.visit(stmt)
            if isinstance(res, list):
                new_body.extend(res)
            elif res is not None:
                new_body.append(res)
        node.body = new_body

        new_orelse = []
        for stmt in node.orelse:
            res = self.visit(stmt)
            if isinstance(res, list):
                new_orelse.extend(res)
            elif res is not None:
                new_orelse.append(res)
        node.orelse = new_orelse

        init_stmt = ast.copy_location(
            ast.Expr(
                value=self._dr_call(
                    "loop_init",
                    [
                        ast.Constant(value=loop_id),
                        ast.Constant(value="while"),
                        ast.Constant(value=line),
                        ast.Constant(value=col),
                        ast.Constant(value=expr_str),
                    ],
                    node,
                )
            ),
            node,
        )

        end_stmt = ast.copy_location(
            ast.Expr(
                value=self._dr_call(
                    "loop_end",
                    [
                        ast.Constant(value=loop_id),
                        ast.Constant(value="while"),
                        ast.Constant(value=line),
                        ast.Constant(value=col),
                    ],
                    node,
                )
            ),
            node,
        )

        return ast.copy_location(
            ast.Try(
                body=[init_stmt, node],
                handlers=[],
                orelse=[],
                finalbody=[end_stmt],
            ),
            node,
        )

    def visit_For(self, node):
        self.loop_counter += 1
        loop_id = f"loop_{self.loop_counter}"
        line, col = self._loc(node)
        iter_str = self._source_segment(node.iter)
        target_str = self._source_segment(node.target)
        cond_label = f"{target_str} in {iter_str}" if (target_str and iter_str) else iter_str

        node.iter = self.visit(node.iter)
        bound_names = _extract_target_names(node.target)

        iter_stmt = ast.copy_location(
            ast.Expr(
                value=self._dr_call(
                    "loop_iter",
                    [
                        ast.Constant(value=loop_id),
                        ast.Constant(value="for"),
                        ast.Constant(value=line),
                        ast.Constant(value=col),
                    ],
                    node,
                )
            ),
            node,
        )

        bind_stmt = ast.copy_location(
            ast.Expr(
                value=self._dr_call(
                    "bind_for_vars",
                    [
                        ast.List(elts=[ast.Constant(value=n) for n in bound_names], ctx=ast.Load()),
                        ast.List(elts=[ast.Name(id=n, ctx=ast.Load()) for n in bound_names], ctx=ast.Load()),
                        ast.Constant(value=line),
                        ast.Constant(value=col),
                    ],
                    node,
                )
            ),
            node,
        )

        new_body = [iter_stmt, bind_stmt]
        for stmt in node.body:
            res = self.visit(stmt)
            if isinstance(res, list):
                new_body.extend(res)
            elif res is not None:
                new_body.append(res)
        node.body = new_body

        new_orelse = []
        for stmt in node.orelse:
            res = self.visit(stmt)
            if isinstance(res, list):
                new_orelse.extend(res)
            elif res is not None:
                new_orelse.append(res)
        node.orelse = new_orelse

        init_stmt = ast.copy_location(
            ast.Expr(
                value=self._dr_call(
                    "loop_init",
                    [
                        ast.Constant(value=loop_id),
                        ast.Constant(value="for"),
                        ast.Constant(value=line),
                        ast.Constant(value=col),
                        ast.Constant(value=cond_label),
                    ],
                    node,
                )
            ),
            node,
        )

        end_stmt = ast.copy_location(
            ast.Expr(
                value=self._dr_call(
                    "loop_end",
                    [
                        ast.Constant(value=loop_id),
                        ast.Constant(value="for"),
                        ast.Constant(value=line),
                        ast.Constant(value=col),
                    ],
                    node,
                )
            ),
            node,
        )

        return ast.copy_location(
            ast.Try(
                body=[init_stmt, node],
                handlers=[],
                orelse=[],
                finalbody=[end_stmt],
            ),
            node,
        )


class _PyTraceRuntime:
    def __init__(
        self,
        source_code,
        max_steps=3000,
        timeout_ms=2000,
        max_heap_objects=500,
        max_output_chars=25000,
        event_callback=None,
        stream_batch_size=25,
    ):
        self.source_code = source_code
        self.source_lines = source_code.split("\n")
        self.max_steps = max_steps
        self.timeout_ms = timeout_ms
        self.max_heap_objects = max_heap_objects
        self.max_output_chars = max_output_chars
        self._event_callback = event_callback
        self._stream_batch_size = max(1, int(stream_batch_size or 25))
        self._flushed_event_count = 0

        self.start_time = time.perf_counter()
        self.step_index = 0
        self.events = []
        self.stdout = []
        self.stderr = []
        self.output_chars = 0

        # Stable object identity map: id(obj) -> stable string ID ("list@1", "dict@2", "Node@1")
        self.obj_ids = {}
        self.keep_alive = []
        self.type_counters = {}
        self.total_heap_allocations = 0

        # Stack frames
        self.frame_counter = 0
        self.frames = [
            {
                "id": "frame_global",
                "functionName": "<module>",
                "fileName": "solution.py",
                "line": 1,
                "col": 1,
                "scopeName": "global",
                "variables": {},
                "variableMeta": {},
                "depth": 1,
            }
        ]
        self.returned_frames = set()

        # Loop tracking
        self.loop_iterations = {}
        self.active_loop_stack = []

        # Array index variable tracking & genuine swap detection
        self.array_index_vars = {}
        self.recent_list_reads = []
        self.var_read_origins = {}
        self.pending_swaps = {}
        self.has_fatal_error = False

    def _check_quotas(self):
        if self.step_index >= self.max_steps:
            self.has_fatal_error = True
            raise ExecutionQuotaError(
                "max_steps_exceeded",
                f"Execution halted: Maximum step limit ({self.max_steps}) exceeded.",
            )
        elapsed_ms = (time.perf_counter() - self.start_time) * 1000.0
        if elapsed_ms > self.timeout_ms:
            self.has_fatal_error = True
            raise ExecutionQuotaError(
                "timeout",
                f"Execution halted: CPU time budget ({self.timeout_ms}ms) exceeded.",
            )

    def _get_code_line(self, line):
        if 1 <= line <= len(self.source_lines):
            return self.source_lines[line - 1]
        return ""

    def _current_frame(self):
        return self.frames[-1]

    def get_or_assign_obj_id(self, obj):
        raw_id = id(obj)
        if raw_id in self.obj_ids:
            return self.obj_ids[raw_id]

        self.total_heap_allocations += 1
        if self.total_heap_allocations > self.max_heap_objects:
            self.has_fatal_error = True
            raise ExecutionQuotaError(
                "error",
                f"Execution halted: Maximum heap allocation limit ({self.max_heap_objects}) exceeded.",
            )

        self.keep_alive.append(obj)
        if isinstance(obj, list):
            prefix = "list"
        elif isinstance(obj, tuple):
            prefix = "tuple"
        elif isinstance(obj, dict):
            prefix = "dict"
        elif isinstance(obj, set):
            prefix = "set"
        else:
            prefix = type(obj).__name__

        count = self.type_counters.get(prefix, 0) + 1
        self.type_counters[prefix] = count
        stable_id = f"{prefix}@{count}"
        self.obj_ids[raw_id] = stable_id
        return stable_id

    def _format_short_val(self, val, depth=0):
        if val is None:
            return "None"
        if isinstance(val, bool):
            return "True" if val else "False"
        if isinstance(val, (int, float)):
            return str(val)
        if isinstance(val, str):
            return repr(val)
        if depth > 2:
            return "..."
        if isinstance(val, list):
            inner = ", ".join(self._format_short_val(x, depth + 1) for x in val[:8])
            if len(val) > 8:
                inner += f", ... ({len(val)} items)"
            return f"[{inner}]"
        if isinstance(val, tuple):
            inner = ", ".join(self._format_short_val(x, depth + 1) for x in val[:8])
            if len(val) == 1:
                inner += ","
            return f"({inner})"
        if isinstance(val, set):
            if len(val) == 0:
                return "set()"
            inner = ", ".join(self._format_short_val(x, depth + 1) for x in list(val)[:8])
            return "{" + inner + "}"
        if isinstance(val, dict):
            pairs = []
            for k, v in list(val.items())[:6]:
                pairs.append(f"{self._format_short_val(k, depth + 1)}: {self._format_short_val(v, depth + 1)}")
            if len(val) > 6:
                pairs.append("...")
            return "{" + ", ".join(pairs) + "}"
        obj_id = self.get_or_assign_obj_id(val)
        return f"{type(val).__name__} ({obj_id})"

    def _serialize_value(self, raw_val, heap, visited, depth=0):
        if raw_val is None:
            return {
                "kind": "null",
                "typeName": "NoneType",
                "value": None,
                "displayString": "None",
            }

        if isinstance(raw_val, bool):
            return {
                "kind": "primitive",
                "typeName": "bool",
                "value": raw_val,
                "displayString": "True" if raw_val else "False",
            }

        if isinstance(raw_val, (int, float)):
            t_name = "int" if isinstance(raw_val, int) else "float"
            return {
                "kind": "primitive",
                "typeName": t_name,
                "value": raw_val,
                "displayString": str(raw_val),
            }

        if isinstance(raw_val, str):
            return {
                "kind": "primitive",
                "typeName": "str",
                "value": raw_val,
                "length": len(raw_val),
                "displayString": repr(raw_val),
            }

        if callable(raw_val) and not hasattr(raw_val, "__dict__") or isinstance(raw_val, type):
            fn_name = getattr(raw_val, "__name__", repr(raw_val))
            kind_label = "class" if isinstance(raw_val, type) else "function"
            return {
                "kind": "primitive",
                "typeName": kind_label,
                "value": f"[{kind_label}: {fn_name}]",
                "displayString": f"<{kind_label} {fn_name}>",
            }

        # Lists & Tuples
        if isinstance(raw_val, (list, tuple)):
            is_tuple = isinstance(raw_val, tuple)
            obj_id = self.get_or_assign_obj_id(raw_val)
            type_label = f"tuple({len(raw_val)})" if is_tuple else f"list({len(raw_val)})"

            if obj_id not in visited and depth < 10:
                visited.add(obj_id)
                serialized_elements = [
                    self._serialize_value(el, heap, visited, depth + 1)
                    for el in raw_val
                ]
                fields = {
                    "length": {
                        "kind": "primitive",
                        "typeName": "int",
                        "value": len(raw_val),
                        "displayString": str(len(raw_val)),
                    }
                }
                if is_tuple:
                    fields["immutable"] = {
                        "kind": "primitive",
                        "typeName": "bool",
                        "value": True,
                        "displayString": "True",
                    }
                heap[obj_id] = {
                    "id": obj_id,
                    "address": obj_id,
                    "typeName": type_label,
                    "fields": fields,
                    "elements": serialized_elements,
                }

            snapshot_vals = []
            for el in raw_val:
                if el is None or isinstance(el, (bool, int, float, str)):
                    snapshot_vals.append(el)
                else:
                    snapshot_vals.append(self.get_or_assign_obj_id(el))

            return {
                "kind": "array",
                "typeName": type_label,
                "value": snapshot_vals,
                "address": obj_id,
                "targetAddress": obj_id,
                "length": len(raw_val),
                "displayString": self._format_short_val(raw_val),
            }

        # Sets
        if isinstance(raw_val, set):
            obj_id = self.get_or_assign_obj_id(raw_val)
            ordered_items = list(raw_val)
            type_label = f"set({len(ordered_items)})"
            if obj_id not in visited and depth < 10:
                visited.add(obj_id)
                serialized_elements = [
                    self._serialize_value(el, heap, visited, depth + 1)
                    for el in ordered_items
                ]
                heap[obj_id] = {
                    "id": obj_id,
                    "address": obj_id,
                    "typeName": type_label,
                    "fields": {
                        "length": {
                            "kind": "primitive",
                            "typeName": "int",
                            "value": len(ordered_items),
                            "displayString": str(len(ordered_items)),
                        }
                    },
                    "elements": serialized_elements,
                }
            snapshot_vals = [
                el if (el is None or isinstance(el, (bool, int, float, str))) else self.get_or_assign_obj_id(el)
                for el in ordered_items
            ]
            return {
                "kind": "array",
                "typeName": type_label,
                "value": snapshot_vals,
                "address": obj_id,
                "targetAddress": obj_id,
                "length": len(ordered_items),
                "displayString": self._format_short_val(raw_val),
            }

        # Dictionaries
        if isinstance(raw_val, dict):
            obj_id = self.get_or_assign_obj_id(raw_val)
            type_label = f"dict({len(raw_val)})"
            if obj_id not in visited and depth < 10:
                visited.add(obj_id)
                fields = {}
                entries = []
                for k, v in raw_val.items():
                    value = self._serialize_value(v, heap, visited, depth + 1)
                    fields[str(k)] = value
                    entries.append({"key": self._serialize_value(k, heap, visited, depth + 1), "value": value})
                heap[obj_id] = {
                    "id": obj_id,
                    "address": obj_id,
                    "typeName": type_label,
                    "fields": fields,
                    "entries": entries,
                }
            return {
                "kind": "reference",
                "typeName": type_label,
                "value": obj_id,
                "address": obj_id,
                "targetAddress": obj_id,
                "length": len(raw_val),
                "displayString": self._format_short_val(raw_val),
            }

        # Custom class instances (e.g. Node, TreeNode)
        if hasattr(raw_val, "__dict__"):
            obj_id = self.get_or_assign_obj_id(raw_val)
            cls_name = type(raw_val).__name__
            if obj_id not in visited and depth < 10:
                visited.add(obj_id)
                fields = {}
                for k, v in vars(raw_val).items():
                    if not k.startswith("__"):
                        fields[str(k)] = self._serialize_value(v, heap, visited, depth + 1)
                heap[obj_id] = {
                    "id": obj_id,
                    "address": obj_id,
                    "typeName": cls_name,
                    "fields": fields,
                }
            return {
                "kind": "reference",
                "typeName": cls_name,
                "value": obj_id,
                "address": obj_id,
                "targetAddress": obj_id,
                "displayString": f"{cls_name} ({obj_id})",
            }

        return {
            "kind": "primitive",
            "typeName": type(raw_val).__name__,
            "value": str(raw_val),
            "displayString": str(raw_val),
        }

    def _isolated_snapshot(self, val):
        dummy_heap = {}
        visited = set()
        return self._serialize_value(val, dummy_heap, visited, 0)

    def _build_state_snapshot(self, active_line, active_col, diffs, step_idx):
        heap = {}
        visited = set()
        stack_frames = []

        for idx, frame in enumerate(self.frames):
            vars_record = {}
            for k, v in frame["variables"].items():
                if k.startswith("__dr"):
                    continue
                # Skip function/class definitions in local variable table so user data variables stay clean
                meta = frame["variableMeta"].get(k, {})
                if meta.get("declarationKind") in ("def", "class"):
                    continue

                base_val = self._serialize_value(v, heap, visited, 0)
                diff_for_var = next(
                    (d for d in diffs if d["variableName"] == k and d["scope"] == frame["scopeName"]),
                    None,
                )
                if diff_for_var:
                    change_state = "created" if diff_for_var["changeType"] == "created" else "updated"
                else:
                    change_state = "unchanged"

                entry = dict(base_val)
                entry["declarationKind"] = meta.get("declarationKind", "var")
                if "previousValue" in meta:
                    entry["previousValue"] = meta["previousValue"]
                if "previousDisplayString" in meta:
                    entry["previousDisplayString"] = meta["previousDisplayString"]
                entry["lastModifiedStep"] = meta.get("lastModifiedStep", step_idx)
                entry["changeState"] = change_state
                vars_record[k] = entry

            is_top = idx == len(self.frames) - 1
            sf = {
                "id": frame["id"],
                "functionName": frame["functionName"],
                "fileName": frame["fileName"],
                "line": active_line if is_top else frame["line"],
                "col": active_col if is_top else frame["col"],
                "scopeName": frame["scopeName"],
                "variables": vars_record,
                "depth": frame["depth"],
            }
            if "args" in frame:
                sf["args"] = frame["args"]
            if "returnValue" in frame:
                sf["returnValue"] = frame["returnValue"]
            stack_frames.append(sf)

        return stack_frames, heap

    def _record_event(
        self,
        event_type,
        line,
        col,
        description,
        diffs=None,
        condition_expression=None,
        condition_result=None,
        branch_taken=None,
        loop_id=None,
        loop_kind=None,
        iteration_count=None,
        function_name=None,
        args=None,
        return_value=None,
        array_op=None,
        extra_meta=None,
        indexed_read=None,
    ):
        self._check_quotas()
        if diffs is None:
            diffs = []

        top = self._current_frame()
        top["line"] = line
        top["col"] = col

        curr_idx = self.step_index
        self.step_index += 1

        stack_frames, heap = self._build_state_snapshot(line, col, diffs, curr_idx)
        active_loops_snap = [dict(l) for l in self.active_loop_stack] if self.active_loop_stack else None

        idx_vars_record = {
            arr_id: list(vset) for arr_id, vset in self.array_index_vars.items()
        }

        metadata = {"languageRuntime": "CPython"}
        if idx_vars_record:
            metadata["arrayIndexVars"] = idx_vars_record
        if extra_meta:
            metadata.update(extra_meta)

        ev = {
            "stepIndex": curr_idx,
            "type": event_type,
            "line": line,
            "col": col,
            "codeLine": self._get_code_line(line),
            "description": description,
            "stackFrames": stack_frames,
            "heap": heap,
            "stdout": list(self.stdout),
            "stderr": list(self.stderr),
            "diffs": diffs,
            "timestamp": int(time.time() * 1000),
            "metadata": metadata,
        }
        if condition_expression is not None:
            ev["conditionExpression"] = condition_expression
        if condition_result is not None:
            ev["conditionResult"] = condition_result
        if branch_taken is not None:
            ev["branchTaken"] = branch_taken
        if loop_id is not None:
            ev["loopId"] = loop_id
        if loop_kind is not None:
            ev["loopKind"] = loop_kind
        if iteration_count is not None:
            ev["iterationCount"] = iteration_count
        if active_loops_snap is not None:
            ev["activeLoops"] = active_loops_snap
        if function_name is not None:
            ev["functionName"] = function_name
        if args is not None:
            ev["args"] = args
        if return_value is not None:
            ev["returnValue"] = return_value
        if indexed_read is not None:
            ev["indexedRead"] = indexed_read
        if array_op is not None:
            ev["arrayOp"] = array_op

        self.events.append(ev)
        if self._event_callback is not None and (len(self.events) - self._flushed_event_count) >= self._stream_batch_size:
            self.flush_stream_events()
        return ev

    def flush_stream_events(self):
        if self._event_callback is None:
            return
        if self._flushed_event_count >= len(self.events):
            return
        chunk = self.events[self._flushed_event_count:]
        self._flushed_event_count = len(self.events)
        try:
            self._event_callback(len(self.events), json.dumps(chunk))
        except Exception:
            pass

    # =========================================================================
    # AST HOOKS
    # =========================================================================

    def register_var(self, name, value, kind, line, col):
        frame = self._current_frame()
        frame["variables"][name] = value
        frame["variableMeta"][name] = {
            "declarationKind": kind,
            "lastModifiedStep": self.step_index,
        }
        return value

    def assign_var(self, name, value, op, rhs_var_name, line, col):
        frame = self._current_frame()
        had_prev = name in frame["variables"]
        prev_raw = frame["variables"].get(name)
        prev_snap = self._isolated_snapshot(prev_raw) if had_prev else None
        prev_meta = frame["variableMeta"].get(name, {})

        frame["variables"][name] = value
        meta = {
            "declarationKind": prev_meta.get("declarationKind", "var"),
            "lastModifiedStep": self.step_index,
        }
        if prev_snap is not None:
            meta["previousValue"] = prev_snap.get("value")
            meta["previousDisplayString"] = prev_snap.get("displayString")
        frame["variableMeta"][name] = meta

        if self.recent_list_reads:
            last_read = self.recent_list_reads[-1]
            if last_read["value"] == value:
                self.var_read_origins[name] = last_read

        new_snap = self._isolated_snapshot(value)
        diff = {
            "variableName": name,
            "scope": frame["scopeName"],
            "oldValue": prev_snap,
            "newValue": new_snap,
            "changeType": "updated" if had_prev else "created",
        }

        array_op = None
        if isinstance(value, (list, tuple)) and not had_prev:
            obj_id = self.get_or_assign_obj_id(value)
            array_op = {
                "objectId": obj_id,
                "variableName": name,
                "operation": "create",
                "value": list(value),
                "newElements": list(value),
                "newLength": len(value),
            }

        if had_prev:
            desc = f"Update {name} ({op}): {prev_snap['displayString']} → {new_snap['displayString']}"
            ev_type = "assign"
        else:
            alias_note = f" (alias of {rhs_var_name} -> {new_snap.get('targetAddress')})" if (rhs_var_name and new_snap.get("targetAddress")) else ""
            desc = f"Bind {name} = {new_snap['displayString']}{alias_note}"
            ev_type = "declare"

        self._record_event(
            ev_type,
            line,
            col,
            desc,
            diffs=[diff],
            array_op=array_op,
        )
        return value

    def aug_assign_var(self, name, old_val, rhs_val, op_str, line, col):
        if op_str == "+=":
            new_val = old_val + rhs_val
        elif op_str == "-=":
            new_val = old_val - rhs_val
        elif op_str == "*=":
            new_val = old_val * rhs_val
        elif op_str == "/=":
            new_val = old_val / rhs_val
        elif op_str == "//=":
            new_val = old_val // rhs_val
        elif op_str == "%=":
            new_val = old_val % rhs_val
        elif op_str == "**=":
            new_val = old_val ** rhs_val
        elif op_str == "&=":
            new_val = old_val & rhs_val
        elif op_str == "|=":
            new_val = old_val | rhs_val
        elif op_str == "^=":
            new_val = old_val ^ rhs_val
        elif op_str == "<<=":
            new_val = old_val << rhs_val
        elif op_str == ">>=":
            new_val = old_val >> rhs_val
        else:
            new_val = old_val + rhs_val

        return self.assign_var(name, new_val, op_str, None, line, col)

    def record_unpack_assign(self, names, values, line, col):
        frame = self._current_frame()
        diffs = []
        parts = []
        any_existed = False

        for name, val in zip(names, values):
            had_prev = name in frame["variables"]
            if had_prev:
                any_existed = True
            prev_raw = frame["variables"].get(name)
            prev_snap = self._isolated_snapshot(prev_raw) if had_prev else None
            prev_meta = frame["variableMeta"].get(name, {})

            frame["variables"][name] = val
            meta = {
                "declarationKind": prev_meta.get("declarationKind", "var"),
                "lastModifiedStep": self.step_index,
            }
            if prev_snap is not None:
                meta["previousValue"] = prev_snap.get("value")
                meta["previousDisplayString"] = prev_snap.get("displayString")
            frame["variableMeta"][name] = meta

            new_snap = self._isolated_snapshot(val)
            diffs.append({
                "variableName": name,
                "scope": frame["scopeName"],
                "oldValue": prev_snap,
                "newValue": new_snap,
                "changeType": "updated" if had_prev else "created",
            })
            parts.append(f"{name}={new_snap['displayString']}")

        if diffs:
            self._record_event(
                "assign" if any_existed else "declare",
                line,
                col,
                f"Unpack assignment: {', '.join(parts)}",
                diffs=diffs,
            )

    def bind_for_vars(self, names, values, line, col):
        frame = self._current_frame()
        diffs = []
        parts = []
        any_existed = False

        for name, val in zip(names, values):
            had_prev = name in frame["variables"]
            if had_prev:
                any_existed = True
            prev_raw = frame["variables"].get(name)
            prev_snap = self._isolated_snapshot(prev_raw) if had_prev else None

            frame["variables"][name] = val
            meta = {
                "declarationKind": "loop",
                "lastModifiedStep": self.step_index,
            }
            if prev_snap is not None:
                meta["previousValue"] = prev_snap.get("value")
                meta["previousDisplayString"] = prev_snap.get("displayString")
            frame["variableMeta"][name] = meta

            new_snap = self._isolated_snapshot(val)
            diffs.append({
                "variableName": name,
                "scope": frame["scopeName"],
                "oldValue": prev_snap,
                "newValue": new_snap,
                "changeType": "updated" if had_prev else "created",
            })
            parts.append(f"{name} = {new_snap['displayString']}")

        if diffs:
            self._record_event(
                "assign" if any_existed else "declare",
                line,
                col,
                f"For-loop variable {', '.join(parts)}",
                diffs=diffs,
            )

    def create_list(self, lst, line, col):
        obj_id = self.get_or_assign_obj_id(lst)
        snap = self._isolated_snapshot(lst)
        self._record_event(
            "array_create",
            line,
            col,
            f"Create list ({obj_id}) of length {len(lst)}: {snap['displayString']}",
            array_op={
                "objectId": obj_id,
                "operation": "create",
                "value": list(lst),
                "newElements": list(lst),
                "newLength": len(lst),
            },
        )
        return lst

    def create_tuple(self, tup, line, col):
        self.get_or_assign_obj_id(tup)
        return tup

    def create_dict(self, dct, line, col):
        self.get_or_assign_obj_id(dct)
        return dct

    def create_set(self, st, line, col):
        self.get_or_assign_obj_id(st)
        return st

    def _record_index_var(self, obj_id, idx_var_name):
        if not idx_var_name:
            return
        s = self.array_index_vars.get(obj_id)
        if s is None:
            s = set()
            self.array_index_vars[obj_id] = s
        s.add(idx_var_name)

    def get_subscript(self, obj, key, obj_name, idx_var_name, line, col):
        val = obj[key]
        if isinstance(obj, str) and isinstance(key, int) and obj_name:
            self._record_event("read", line, col, f"Read {obj_name}[{key}] → {val!r}",
                indexed_read={"variableName": obj_name, "index": key % len(obj), "indexVarName": idx_var_name, "value": repr(val)})
        if isinstance(obj, (list, tuple)) and isinstance(key, int):
            norm_idx = key if key >= 0 else len(obj) + key
            obj_id = self.get_or_assign_obj_id(obj)
            self._record_index_var(obj_id, idx_var_name)

            read_rec = {
                "listId": id(obj),
                "index": norm_idx,
                "value": val,
                "stepIndex": self.step_index,
            }
            self.recent_list_reads.append(read_rec)
            if len(self.recent_list_reads) > 8:
                self.recent_list_reads.pop(0)

            label = f"{obj_name or obj_id}[{key}]"
            val_snap = self._isolated_snapshot(val)
            self._record_event(
                "array_read",
                line,
                col,
                f"Read {label}{f' (via {idx_var_name}={key})' if idx_var_name else ''} → {val_snap['displayString']}",
                array_op={
                    "objectId": obj_id,
                    "variableName": obj_name,
                    "operation": "read",
                    "index": norm_idx,
                    "indexVarName": idx_var_name,
                    "value": val,
                    "newLength": len(obj),
                },
            )
        elif isinstance(obj, dict):
            obj_id = self.get_or_assign_obj_id(obj)
            val_snap = self._isolated_snapshot(val)
            self._record_event(
                "read",
                line,
                col,
                f"Read dict {obj_name or obj_id}[{repr(key)}] → {val_snap['displayString']}",
            )
        return val

    def get_slice(self, obj, lower, upper, step, obj_name, line, col):
        s = slice(lower, upper, step)
        res = obj[s]
        if isinstance(obj, (list, tuple, str)):
            res_snap = self._isolated_snapshot(res)
            slice_str = f"{'' if lower is None else lower}:{'' if upper is None else upper}{'' if step is None else f':{step}'}"
            if isinstance(obj, (list, tuple)):
                obj_id = self.get_or_assign_obj_id(obj)
                self._record_event(
                    "array_read",
                    line,
                    col,
                    f"Slice {obj_name or obj_id}[{slice_str}] → {res_snap['displayString']}",
                    array_op={
                        "objectId": obj_id,
                        "variableName": obj_name,
                        "operation": "read",
                        "value": list(res) if isinstance(res, (list, tuple)) else res,
                        "newLength": len(obj),
                    },
                    extra_meta={"slice": slice_str},
                )
            else:
                self._record_event(
                    "read",
                    line,
                    col,
                    f"Slice string {obj_name or repr(obj)}[{slice_str}] → {res_snap['displayString']}",
                    extra_meta={"slice": slice_str},
                )
        return res

    def set_subscript(self, obj, key, rhs_val, op_str, obj_name, idx_var_name, rhs_var_name, line, col):
        had_key = False
        old_val = None
        try:
            if isinstance(obj, dict):
                had_key = key in obj
                old_val = obj.get(key)
            else:
                old_val = obj[key]
                had_key = True
        except Exception:
            pass

        if op_str == "=":
            new_val = rhs_val
        elif op_str == "+=":
            new_val = old_val + rhs_val
        elif op_str == "-=":
            new_val = old_val - rhs_val
        elif op_str == "*=":
            new_val = old_val * rhs_val
        elif op_str == "/=":
            new_val = old_val / rhs_val
        elif op_str == "//=":
            new_val = old_val // rhs_val
        elif op_str == "%=":
            new_val = old_val % rhs_val
        else:
            new_val = rhs_val

        # Perform actual Python subscript mutation (raises TypeError on tuple automatically!)
        obj[key] = new_val

        if isinstance(obj, list) and isinstance(key, int):
            norm_idx = key if key >= 0 else len(obj) + key
            obj_id = self.get_or_assign_obj_id(obj)
            self._record_index_var(obj_id, idx_var_name)

            label = f"{obj_name or obj_id}[{norm_idx}]"
            old_snap = self._isolated_snapshot(old_val)
            new_snap = self._isolated_snapshot(new_val)

            self._record_event(
                "array_write",
                line,
                col,
                f"Write {label} = {new_snap['displayString']} (was {old_snap['displayString']})",
                diffs=[
                    {
                        "variableName": label,
                        "scope": "heap",
                        "oldValue": old_snap,
                        "newValue": new_snap,
                        "changeType": "updated",
                    }
                ],
                array_op={
                    "objectId": obj_id,
                    "variableName": obj_name,
                    "operation": "write",
                    "index": norm_idx,
                    "indexVarName": idx_var_name,
                    "oldValue": old_val,
                    "value": new_val,
                    "newLength": len(obj),
                },
            )
            self._check_and_record_swap(obj, obj_id, obj_name, norm_idx, old_val, new_val, rhs_var_name, line, col)

        elif isinstance(obj, dict):
            obj_id = self.get_or_assign_obj_id(obj)
            label = f"{obj_name or obj_id}[{repr(key)}]"
            old_snap = self._isolated_snapshot(old_val) if had_key else None
            new_snap = self._isolated_snapshot(new_val)
            self._record_event(
                "assign",
                line,
                col,
                f"Set dict key {label} = {new_snap['displayString']}",
                diffs=[
                    {
                        "variableName": label,
                        "scope": "heap",
                        "oldValue": old_snap,
                        "newValue": new_snap,
                        "changeType": "updated" if had_key else "created",
                    }
                ],
            )
        return new_val

    def tuple_subscript_assign(self, objs, idxs, rhs_iterable, obj_names, idx_vars, line, col):
        rhs_vals = list(rhs_iterable)
        if len(objs) == 2 and objs[0] is objs[1] and isinstance(objs[0], list):
            lst = objs[0]
            idx_a = idxs[0] if idxs[0] >= 0 else len(lst) + idxs[0]
            idx_b = idxs[1] if idxs[1] >= 0 else len(lst) + idxs[1]
            old_a = lst[idx_a]
            old_b = lst[idx_b]
            new_a, new_b = rhs_vals[0], rhs_vals[1]

            lst[idx_a] = new_a
            lst[idx_b] = new_b

            obj_id = self.get_or_assign_obj_id(lst)
            obj_name = obj_names[0] or obj_id
            self._record_index_var(obj_id, idx_vars[0])
            self._record_index_var(obj_id, idx_vars[1])

            if idx_a != idx_b and new_a == old_b and new_b == old_a:
                self._record_event(
                    "array_swap",
                    line,
                    col,
                    f"Swap {obj_name}[{idx_a}] ({self._format_short_val(old_a)}) ↔ {obj_name}[{idx_b}] ({self._format_short_val(old_b)})",
                    diffs=[
                        {
                            "variableName": f"{obj_name}[{idx_a}]",
                            "scope": "heap",
                            "oldValue": self._isolated_snapshot(old_a),
                            "newValue": self._isolated_snapshot(new_a),
                            "changeType": "updated",
                        },
                        {
                            "variableName": f"{obj_name}[{idx_b}]",
                            "scope": "heap",
                            "oldValue": self._isolated_snapshot(old_b),
                            "newValue": self._isolated_snapshot(new_b),
                            "changeType": "updated",
                        },
                    ],
                    array_op={
                        "objectId": obj_id,
                        "variableName": obj_names[0],
                        "operation": "swap",
                        "swapIndices": [idx_a, idx_b],
                        "oldValue": [old_a, old_b],
                        "value": [new_a, new_b],
                        "newLength": len(lst),
                    },
                )
                return rhs_vals

        for obj, idx, val, o_name, i_var in zip(objs, idxs, rhs_vals, obj_names, idx_vars):
            self.set_subscript(obj, idx, val, "=", o_name, i_var, None, line, col)
        return rhs_vals

    def _check_and_record_swap(self, lst, obj_id, obj_name, written_idx, old_val, new_val, rhs_var_name, line, col):
        list_raw_id = id(lst)
        pending = self.pending_swaps.get(list_raw_id)
        if pending and pending["idxB"] == written_idx and new_val == pending["valA"]:
            from_temp = self.var_read_origins.get(rhs_var_name) if rhs_var_name else None
            is_genuine = (not rhs_var_name) or (
                from_temp and from_temp["listId"] == list_raw_id and from_temp["index"] == pending["idxA"]
            )
            if is_genuine:
                del self.pending_swaps[list_raw_id]
                label = obj_name or obj_id
                self._record_event(
                    "array_swap",
                    line,
                    col,
                    f"Swap detected on {label}: index [{pending['idxA']}] ({self._format_short_val(pending['valA'])}) ↔ index [{pending['idxB']}] ({self._format_short_val(pending['valB'])})",
                    array_op={
                        "objectId": obj_id,
                        "variableName": obj_name,
                        "operation": "swap",
                        "swapIndices": [pending["idxA"], pending["idxB"]],
                        "oldValue": [pending["valA"], pending["valB"]],
                        "value": [pending["valB"], pending["valA"]],
                        "newLength": len(lst),
                    },
                )
                return

        matching_read = next(
            (
                r
                for r in reversed(self.recent_list_reads)
                if r["listId"] == list_raw_id and r["index"] != written_idx and r["value"] == new_val
            ),
            None,
        )
        if matching_read:
            self.pending_swaps[list_raw_id] = {
                "idxA": written_idx,
                "idxB": matching_read["index"],
                "valA": old_val,
                "valB": new_val,
                "stepIndex": self.step_index,
            }

    def del_subscript(self, obj, key, obj_name, line, col):
        old_val = obj[key]
        del obj[key]
        obj_id = self.get_or_assign_obj_id(obj)
        if isinstance(obj, list):
            self._record_event(
                "array_mutate",
                line,
                col,
                f"Delete {obj_name or obj_id}[{key}] (removed {self._format_short_val(old_val)})",
                array_op={
                    "objectId": obj_id,
                    "variableName": obj_name,
                    "operation": "mutate",
                    "method": "del",
                    "oldValue": len(obj) + 1,
                    "value": old_val,
                    "newElements": list(obj),
                    "newLength": len(obj),
                },
            )
        else:
            self._record_event(
                "assign",
                line,
                col,
                f"Delete key {obj_name or obj_id}[{repr(key)}]",
            )

    def set_attr(self, obj, attr_name, rhs_val, op_str, obj_name, line, col):
        had_attr = hasattr(obj, attr_name)
        old_val = getattr(obj, attr_name, None) if had_attr else None

        if op_str == "=":
            new_val = rhs_val
        elif op_str == "+=":
            new_val = old_val + rhs_val
        elif op_str == "-=":
            new_val = old_val - rhs_val
        elif op_str == "*=":
            new_val = old_val * rhs_val
        else:
            new_val = rhs_val

        setattr(obj, attr_name, new_val)
        obj_id = self.get_or_assign_obj_id(obj)
        label = f"{obj_name or obj_id}.{attr_name}"
        old_snap = self._isolated_snapshot(old_val) if had_attr else None
        new_snap = self._isolated_snapshot(new_val)

        self._record_event(
            "assign",
            line,
            col,
            f"Set attribute {label} = {new_snap['displayString']}",
            diffs=[
                {
                    "variableName": label,
                    "scope": "heap",
                    "oldValue": old_snap,
                    "newValue": new_snap,
                    "changeType": "updated" if had_attr else "created",
                }
            ],
        )
        return new_val

    def call_print(self, args, kwargs, line, col):
        sep = kwargs.get("sep", " ")
        if sep is None:
            sep = " "
        formatted = sep.join(str(a) for a in args)
        self.output_chars += len(formatted)
        if self.output_chars > self.max_output_chars:
            self.has_fatal_error = True
            raise ExecutionQuotaError(
                "error",
                f"Execution halted: Maximum stdout buffer limit ({self.max_output_chars} chars) exceeded.",
            )
        self.stdout.append(formatted)
        self._record_event(
            "stdout",
            line,
            col,
            f"print: {formatted}",
        )
        return None

    def call_method(self, obj, method_name, args, kwargs, obj_name, line, col):
        fn = getattr(obj, method_name)

        if isinstance(obj, list) and method_name in MUTATING_LIST_METHODS:
            obj_id = self.get_or_assign_obj_id(obj)
            old_len = len(obj)
            old_elements = list(obj)
            res = fn(*args, **kwargs)
            new_len = len(obj)
            new_elements = list(obj)

            arg_str = ", ".join(self._format_short_val(a) for a in args)
            self._record_event(
                "array_mutate",
                line,
                col,
                f"{obj_name or obj_id}.{method_name}({arg_str}) → length {old_len} → {new_len}",
                array_op={
                    "objectId": obj_id,
                    "variableName": obj_name,
                    "operation": "mutate",
                    "method": method_name,
                    "methodArgs": [self._format_short_val(a) for a in args],
                    "oldValue": old_len,
                    "value": res if (res is None or isinstance(res, (bool, int, float, str))) else self._format_short_val(res),
                    "oldElements": [x if isinstance(x, (bool, int, float, str)) or x is None else self.get_or_assign_obj_id(x) for x in old_elements],
                    "newElements": [x if isinstance(x, (bool, int, float, str)) or x is None else self.get_or_assign_obj_id(x) for x in new_elements],
                    "newLength": new_len,
                },
            )
            return res

        if isinstance(obj, set) and method_name in MUTATING_SET_METHODS:
            obj_id = self.get_or_assign_obj_id(obj)
            old_len = len(obj)
            old_elements = list(obj)
            res = fn(*args, **kwargs)
            new_len = len(obj)
            new_elements = list(obj)
            arg_str = ", ".join(self._format_short_val(a) for a in args)
            self._record_event(
                "array_mutate",
                line,
                col,
                f"{obj_name or obj_id}.{method_name}({arg_str}) → size {old_len} → {new_len}",
                array_op={
                    "objectId": obj_id,
                    "variableName": obj_name,
                    "operation": "mutate",
                    "method": method_name,
                    "oldValue": old_len,
                    "value": res if (res is None or isinstance(res, (bool, int, float, str))) else self._format_short_val(res),
                    "oldElements": old_elements,
                    "newElements": new_elements,
                    "newLength": new_len,
                },
            )
            return res

        if isinstance(obj, dict) and method_name in MUTATING_DICT_METHODS:
            obj_id = self.get_or_assign_obj_id(obj)
            old_len = len(obj)
            res = fn(*args, **kwargs)
            new_len = len(obj)
            arg_str = ", ".join(self._format_short_val(a) for a in args)
            self._record_event(
                "assign",
                line,
                col,
                f"{obj_name or obj_id}.{method_name}({arg_str}) → keys {old_len} → {new_len}",
            )
            return res

        return fn(*args, **kwargs)

    def cond(self, raw_val, kind, line, col, has_orelse=False, expr_str=None):
        res = bool(raw_val)
        if kind in ("if", "ternary"):
            branch = "consequent" if res else ("alternate" if has_orelse else "none")
        else:
            branch = "loop_body" if res else "loop_exit"
            if self.active_loop_stack:
                top_loop = self.active_loop_stack[-1]
                if expr_str:
                    top_loop["conditionExpression"] = expr_str
                top_loop["lastConditionResult"] = res

        label = f" [{expr_str}]" if expr_str else ""
        self._record_event(
            "condition",
            line,
            col,
            f"Condition ({kind}){label} evaluated to {res} → branch: {branch}",
            condition_expression=expr_str,
            condition_result=res,
            branch_taken=branch,
        )
        return raw_val

    def loop_init(self, loop_id, loop_kind, line, col, expr_str=None):
        self.loop_iterations[loop_id] = 0
        ctx = {
            "loopId": loop_id,
            "loopKind": loop_kind,
            "iterationCount": 0,
            "line": line,
            "col": col,
            "depth": len(self.active_loop_stack) + 1,
        }
        if expr_str:
            ctx["conditionExpression"] = expr_str
        self.active_loop_stack.append(ctx)

        self._record_event(
            "loop_init",
            line,
            col,
            f"Initialize {loop_kind} loop ({loop_id})",
            loop_id=loop_id,
            loop_kind=loop_kind,
            iteration_count=0,
            condition_expression=expr_str,
        )

    def loop_iter(self, loop_id, loop_kind, line, col):
        nxt = self.loop_iterations.get(loop_id, 0) + 1
        self.loop_iterations[loop_id] = nxt
        for l in self.active_loop_stack:
            if l["loopId"] == loop_id:
                l["iterationCount"] = nxt
                break

        self._record_event(
            "loop_iter",
            line,
            col,
            f"Loop ({loop_kind}) iteration #{nxt}",
            loop_id=loop_id,
            loop_kind=loop_kind,
            iteration_count=nxt,
        )

    def loop_end(self, loop_id, loop_kind, line, col):
        self.active_loop_stack = [l for l in self.active_loop_stack if l["loopId"] != loop_id]
        if self.has_fatal_error:
            return
        total = self.loop_iterations.get(loop_id, 0)
        self._record_event(
            "loop_end",
            line,
            col,
            f"Completed {loop_kind} loop after {total} iteration(s)",
            loop_id=loop_id,
            loop_kind=loop_kind,
            iteration_count=total,
        )

    def enter_fn(self, fn_name, param_names, arg_values, line, col):
        self.frame_counter += 1
        frame_id = f"frame_{self.frame_counter}"
        vars_dict = {}
        var_meta = {}
        serialized_args = []
        args_record = {}
        diffs = []

        for p_name, a_val in zip(param_names, arg_values):
            vars_dict[p_name] = a_val
            var_meta[p_name] = {
                "declarationKind": "param",
                "lastModifiedStep": self.step_index,
            }
            snap = self._isolated_snapshot(a_val)
            serialized_args.append(snap)
            args_record[p_name] = snap
            diffs.append({
                "variableName": p_name,
                "scope": fn_name,
                "oldValue": None,
                "newValue": snap,
                "changeType": "created",
            })

        new_frame = {
            "id": frame_id,
            "functionName": fn_name,
            "fileName": "solution.py",
            "line": line,
            "col": col,
            "scopeName": "local",
            "variables": vars_dict,
            "variableMeta": var_meta,
            "args": args_record,
            "depth": len(self.frames) + 1,
        }
        self.frames.append(new_frame)

        args_summary = ", ".join(
            f"{p}={s['displayString']}" for p, s in zip(param_names, serialized_args)
        )
        self._record_event(
            "call",
            line,
            col,
            f"Call {fn_name}({args_summary}) [depth {new_frame['depth']}]",
            diffs=diffs,
            function_name=fn_name,
            args=serialized_args,
        )
        return frame_id

    def ret(self, frame_id, fn_name, return_val, line, col):
        self.returned_frames.add(frame_id)
        ret_snap = self._isolated_snapshot(return_val)
        for f in self.frames:
            if f["id"] == frame_id:
                f["returnValue"] = ret_snap
                break

        self._record_event(
            "return",
            line,
            col,
            f"Return {ret_snap['displayString']} from {fn_name}()",
            function_name=fn_name,
            return_value=ret_snap,
        )
        return return_val

    def ret_implicit(self, frame_id, fn_name, self_obj, line, col):
        if frame_id in self.returned_frames or self.has_fatal_error:
            return None
        self.returned_frames.add(frame_id)
        ret_snap = self._isolated_snapshot(self_obj if self_obj is not None else None)
        for f in self.frames:
            if f["id"] == frame_id:
                f["returnValue"] = ret_snap
                break

        self._record_event(
            "return",
            line,
            col,
            f"Complete {fn_name}() → {ret_snap['displayString']}",
            function_name=fn_name,
            return_value=ret_snap,
        )
        return None

    def exit_fn(self, frame_id):
        self.returned_frames.discard(frame_id)
        self.frames = [f for f in self.frames if f["id"] != frame_id]

    def record_runtime_error(self, exc, line, col):
        self.has_fatal_error = True
        msg = f"{type(exc).__name__}: {str(exc)}"
        self.stderr.append(msg)
        curr_idx = self.step_index
        self.step_index += 1
        stack_frames, heap = self._build_state_snapshot(line, col, [], curr_idx)
        self.events.append({
            "stepIndex": curr_idx,
            "type": "error",
            "line": line,
            "col": col,
            "codeLine": self._get_code_line(line),
            "description": msg,
            "stackFrames": stack_frames,
            "heap": heap,
            "stdout": list(self.stdout),
            "stderr": list(self.stderr),
            "diffs": [],
            "timestamp": int(time.time() * 1000),
            "metadata": {"languageRuntime": "CPython"},
        })


def _extract_user_error_line(exc, default_line=1):
    tb = exc.__traceback__
    last_user_line = default_line
    while tb is not None:
        frame = tb.tb_frame
        if frame.f_code.co_filename == "solution.py":
            last_user_line = tb.tb_lineno
        tb = tb.tb_next
    return last_user_line


def _make_safe_builtins():
    safe = {}
    allowed_names = [
        "abs", "all", "any", "ascii", "bin", "bool", "bytes", "callable", "chr",
        "complex", "dict", "dir", "divmod", "enumerate", "filter", "float", "format",
        "frozenset", "hash", "hex", "id", "int", "isinstance", "issubclass", "iter",
        "len", "list", "map", "max", "min", "next", "object", "oct", "ord", "pow",
        "property", "range", "repr", "reversed", "round", "set", "slice", "sorted",
        "staticmethod", "str", "sum", "super", "tuple", "type", "zip",
        "Exception", "BaseException", "ValueError", "TypeError", "KeyError",
        "IndexError", "ZeroDivisionError", "AttributeError", "RuntimeError",
        "StopIteration", "AssertionError", "NameError", "OverflowError",
        "RecursionError", "NotImplementedError", "__build_class__",
    ]
    for name in allowed_names:
        if hasattr(builtins, name):
            safe[name] = getattr(builtins, name)

    real_import = builtins.__import__

    def _safe_import(name, globals=None, locals=None, fromlist=(), level=0):
        root = name.split(".")[0]
        if root in DISALLOWED_MODULES or root not in SAFE_IMPORT_WHITELIST:
            raise ImportError(f"Import of module '{name}' is blocked by the Parallax security sandbox.")
        return real_import(name, globals, locals, fromlist, level)

    safe["__import__"] = _safe_import
    return safe


def run_dry_run_trace(payload_json, event_callback=None, stream_batch_size=25):
    t0 = time.perf_counter()
    payload = json.loads(payload_json)
    code = payload.get("code", "")
    max_steps = int(payload.get("maxSteps", 3000))
    timeout_ms = int(payload.get("timeoutMs", 2000))
    max_heap_objects = int(payload.get("maxHeapObjects", 500))
    max_output_chars = int(payload.get("maxOutputChars", 25000))

    source_lines = code.split("\n")

    # 1. Parse Python AST (catches SyntaxError & IndentationError before execution)
    try:
        tree = ast.parse(code, filename="solution.py")
    except SyntaxError as syn_err:
        line = syn_err.lineno or 1
        col = syn_err.offset or 1
        code_line = source_lines[line - 1] if 1 <= line <= len(source_lines) else ""
        err_msg = f"{type(syn_err).__name__} (line {line}, col {col}): {syn_err.msg}"
        return json.dumps({
            "language": "python",
            "sourceCode": code,
            "events": [
                {
                    "stepIndex": 0,
                    "type": "error",
                    "line": line,
                    "col": col,
                    "codeLine": code_line,
                    "description": err_msg,
                    "stackFrames": [],
                    "heap": {},
                    "stdout": [],
                    "stderr": [err_msg],
                    "diffs": [],
                    "timestamp": int(time.time() * 1000),
                }
            ],
            "totalSteps": 1,
            "status": "error",
            "errorMessage": err_msg,
            "metrics": {
                "executionTimeMs": max(1, int((time.perf_counter() - t0) * 1000)),
                "stepCount": 1,
                "peakMemoryBytes": 1024,
                "heapAllocations": 0,
            },
        })

    # 2. Pre-execution AST Security Check
    validator = _SecurityValidator()
    validator.visit(tree)
    if validator.violations:
        err_msg = "Security sandbox check failed:\n" + "\n".join(validator.violations)
        return json.dumps({
            "language": "python",
            "sourceCode": code,
            "events": [
                {
                    "stepIndex": 0,
                    "type": "error",
                    "line": 1,
                    "col": 1,
                    "codeLine": source_lines[0] if source_lines else "",
                    "description": err_msg,
                    "stackFrames": [],
                    "heap": {},
                    "stdout": [],
                    "stderr": validator.violations,
                    "diffs": [],
                    "timestamp": int(time.time() * 1000),
                }
            ],
            "totalSteps": 1,
            "status": "error",
            "errorMessage": err_msg,
            "metrics": {
                "executionTimeMs": max(1, int((time.perf_counter() - t0) * 1000)),
                "stepCount": 1,
                "peakMemoryBytes": 0,
                "heapAllocations": 0,
            },
        })

    # 3. Transform AST with source-mapped runtime instrumentation hooks
    transformer = _DryRunAstTransformer(source_lines)
    instrumented_tree = transformer.visit(tree)
    ast.fix_missing_locations(instrumented_tree)

    runtime = _PyTraceRuntime(
        code,
        max_steps=max_steps,
        timeout_ms=timeout_ms,
        max_heap_objects=max_heap_objects,
        max_output_chars=max_output_chars,
        event_callback=event_callback,
        stream_batch_size=stream_batch_size,
    )

    old_rec_limit = sys.getrecursionlimit()
    safe_rec_cap = 120 if sys.platform == "emscripten" else 180
    sys.setrecursionlimit(min(old_rec_limit, safe_rec_cap))

    sandbox_globals = {
        "__builtins__": _make_safe_builtins(),
        "__name__": "__main__",
        "__dr__": runtime,
    }

    try:
        compiled = compile(instrumented_tree, filename="solution.py", mode="exec")
        exec(compiled, sandbox_globals, sandbox_globals)
        if len(runtime.events) == 0:
            runtime._record_event("line", 1, 1, "Module definitions evaluated")
        runtime.flush_stream_events()

        return json.dumps({
            "language": "python",
            "sourceCode": code,
            "events": runtime.events,
            "totalSteps": len(runtime.events),
            "status": "completed",
            "metrics": {
                "executionTimeMs": max(1, int((time.perf_counter() - t0) * 1000)),
                "stepCount": len(runtime.events),
                "peakMemoryBytes": len(runtime.events) * 1024,
                "heapAllocations": runtime.total_heap_allocations,
            },
        })
    except ExecutionQuotaError as quota_err:
        runtime.flush_stream_events()
        return json.dumps({
            "language": "python",
            "sourceCode": code,
            "events": runtime.events,
            "totalSteps": len(runtime.events),
            "status": quota_err.status,
            "errorMessage": quota_err.message,
            "metrics": {
                "executionTimeMs": max(1, int((time.perf_counter() - t0) * 1000)),
                "stepCount": len(runtime.events),
                "peakMemoryBytes": len(runtime.events) * 1024,
                "heapAllocations": runtime.total_heap_allocations,
            },
        })
    except BaseException as exc:
        fallback_line = runtime._current_frame().get("line", 1)
        err_line = _extract_user_error_line(exc, fallback_line)
        runtime.record_runtime_error(exc, err_line, 1)
        runtime.flush_stream_events()
        full_err = f"{type(exc).__name__}: {str(exc)}"
        return json.dumps({
            "language": "python",
            "sourceCode": code,
            "events": runtime.events,
            "totalSteps": len(runtime.events),
            "status": "error",
            "errorMessage": full_err,
            "metrics": {
                "executionTimeMs": max(1, int((time.perf_counter() - t0) * 1000)),
                "stepCount": len(runtime.events),
                "peakMemoryBytes": len(runtime.events) * 1024,
                "heapAllocations": runtime.total_heap_allocations,
            },
        })
    finally:
        sys.setrecursionlimit(old_rec_limit)
`;
