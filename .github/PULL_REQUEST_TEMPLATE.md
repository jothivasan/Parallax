## Description

<!-- Describe the changes introduced by this pull request and the rationale behind them. -->

## Related Issue

<!-- Link any related GitHub issue (e.g. Closes #123) -->

## Architectural Invariants Checked

- [ ] **Determinism**: Execution traces remain 100% deterministic and reproducible.
- [ ] **Zero Fabrication**: No physical hex memory addresses are generated for non-C/C++ languages.
- [ ] **Mode Separation**: Browser Mode remains independent from the Express backend; Native Mode does not silently fall back to Browser Mode.
- [ ] **Challenge Vault Isolation**: Hidden test cases in `src/server/challengeVault.ts` are never imported into client bundles.

## Verification Checklist

Please verify that the following local checks pass cleanly:

```bash
# 1. Strict TypeScript type-checking
npm run lint

# 2. Production client build
npm run build

# 3. Core test suite, including bundle checks
npm test
```

- [ ] `npm run lint` passes with 0 errors
- [ ] `npm test` passes with 0 failures
- [ ] `npm run build` succeeds
- [ ] Added regression unit test(s) if applicable

