# Security policy

## Report a vulnerability privately

Once the ParallelX GitHub repository is public and private vulnerability reporting is enabled, use **Security → Report a vulnerability** on the repository. Include the affected version, runtime and execution mode, and enough context for maintainers to verify the behavior. Keep credentials, personal data, and full project files out of reports.

Use a private channel for a suspected vulnerability. Public issues are for ordinary bugs and documentation problems.

## Execution boundaries

Browser Mode runs programs in dedicated Web Workers. Wall-clock timeouts, step budgets, and output caps protect the workbench from runaway execution. The worker and WebAssembly boundaries were designed for local educational use.

Native Mode executes programs on the server host under the server's operating-system account. A per-run temporary directory and process timeout manage files and execution lifetime. They leave operating-system permissions and network access under the host's control. Use Native Mode for trusted local code. Before exposing it to untrusted submissions, apply separate operating-system isolation, restricted credentials, and resource and network controls.

The browser uses symbolic identities for managed objects and WebAssembly linear memory offsets for C and C++. Native C and C++ traces can record process addresses.

## Challenge evaluation

The client includes public example cases. The server evaluates additional cases from `src/server/challengeVault.ts` and returns sanitized results. The production tests check that the client bundle omits those server-side cases. Anyone with access to this source repository can read the bundled server fixtures in the source tree.

See the [security and sandbox reference](docs/reference/SECURITY_AND_SANDBOX_LIMITATIONS.md) for implementation details.
