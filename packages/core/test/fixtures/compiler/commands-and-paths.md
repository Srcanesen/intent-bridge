[INTENT BRIDGE TASK — v1]

Message type: initial
Required user-facing response language: Turkish (tr)

## Intended outcome
Run the specified test command for the API file.

## Requested work
1. `api-test`: Run pnpm test -- --reporter=verbose.

## Scope
### Task `api-test`
- src/api.ts

## User-stated constraints
### Global
- Do not add dependencies.

### Task `api-test`
- Preserve identifier requestId.

## Success criteria
### Task `api-test`
- pnpm test -- --reporter=verbose passes.

## Execution guidance
- Inspect relevant repository context before implementation.
- Do not treat assumptions as user requirements.
- Do not expand scope beyond the requested work.
- Resolve low-risk uncertainty from repository evidence.
- Ask the user only when a material product decision cannot be safely resolved.
- Use an appropriate verification method.
- Explain the result in Turkish (tr).

## Original user request
```
Run pnpm test -- --reporter=verbose for src/api.ts.
```
