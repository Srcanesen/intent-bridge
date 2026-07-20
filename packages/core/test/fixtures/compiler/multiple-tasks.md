[INTENT BRIDGE TASK — v1]

Message type: initial
Required user-facing response language: Turkish (tr)

## Intended outcome
Update the API and the client.

## Requested work
1. `api`: Update the API response.
2. `client`: Update the client call.

## Scope
### Task `api`
- src/api.ts

### Task `client`
- src/client.ts

## User-stated constraints
### Global
- Do not change authentication.

### Task `api`
- Keep the response shape.

### Task `client`
- Use the API response shape.

## Success criteria
### Task `api`
- The API test passes.

### Task `client`
- The client test passes.

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
Update the API and the client.
```
